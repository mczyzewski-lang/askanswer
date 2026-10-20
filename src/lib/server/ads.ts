/**
 * Ads Studio: raw footage (the expert reading hooks, bodies and CTAs, with retakes) + a script file
 * → one ready-to-edit reel per script row, cut from the transcripts.
 */
import fsp from "node:fs/promises";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { decodePcm, extractSpeechAudio, makePreviewProxy, normalizeRecording, probe } from "./ffmpeg";
import { makeTempDir, putFile, toLocalFile } from "./storage";
import { transcribe } from "./elevenlabs";
import { elevenLabsConfigured } from "./env";
import { enqueue } from "./jobs";
import { computeWaveform, detectPauses } from "../editor/silence";
import { buildSegments } from "../editor/subtitles";
import { buildInitialDocument } from "../editor/factory";
import { themeFromRow, DEFAULT_THEME } from "../themes";
import { matchPart, type FootageWords, type PartMatch } from "../ads-match";
import type { AVClip, EditorDocument, Waveform } from "../editor/types";

export type FootageWord = { text: string; start: number; end: number };

async function footageStep(id: string, step: string) {
  await prisma.adFootage.update({ where: { id }, data: { step } });
}

/** Worker: normalize the footage, waveform + preview, then the transcript with word times. */
export async function processFootage(footageId: string): Promise<void> {
  const f = await prisma.adFootage.findUniqueOrThrow({ where: { id: footageId } });
  if (!f.originalAssetId) throw new Error("Plik nie został jeszcze w pełni wysłany");
  const original = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: f.originalAssetId } });
  await prisma.adFootage.update({ where: { id: f.id }, data: { status: "PROCESSING", error: null } });
  const work = await makeTempDir(`ads-${f.id}`);
  const src = await toLocalFile(original.storageKey);
  try {
    await footageStep(f.id, "Normalizacja wideo");
    const info = await probe(src.path);
    if (!info.hasVideo) throw new Error("Plik nie zawiera obrazu");
    const out = path.join(work, "normalized.mp4");
    await normalizeRecording(src.path, out, undefined, info.duration);
    const n = await probe(out);
    const key = `projects/${f.projectId}/ads/${f.id}/normalized.mp4`;
    const size = await putFile(key, out, "video/mp4");
    await footageStep(f.id, "Analiza dźwięku");
    const pcm = n.hasAudio ? await decodePcm(out, 16000) : new Float32Array(0);
    const waveform = computeWaveform(pcm, 16000, 100);
    await footageStep(f.id, "Przygotowanie podglądu");
    const proxy = path.join(work, "proxy.webm");
    await makePreviewProxy(out, proxy);
    const pKey = `projects/${f.projectId}/ads/${f.id}/proxy.webm`;
    const pSize = await putFile(pKey, proxy, "video/webm");
    const pa = await prisma.mediaAsset.upsert({
      where: { storageKey: pKey },
      create: { kind: "PREVIEW_PROXY", projectId: f.projectId, storageKey: pKey, mimeType: "video/webm", sizeBytes: pSize, durationSec: n.duration, hasAudio: n.hasAudio, hasVideo: true },
      update: { sizeBytes: pSize },
    });
    const asset = await prisma.mediaAsset.upsert({
      where: { storageKey: key },
      create: { kind: "RECORDING_NORMALIZED", projectId: f.projectId, storageKey: key, mimeType: "video/mp4", sizeBytes: size, durationSec: n.duration, width: n.width, height: n.height, fps: n.fps, hasAudio: n.hasAudio, hasVideo: true, originalName: f.name, waveform: waveform as unknown as Prisma.InputJsonValue, meta: { proxyAssetId: pa.id } },
      update: { sizeBytes: size, durationSec: n.duration, width: n.width, height: n.height, waveform: waveform as unknown as Prisma.InputJsonValue, meta: { proxyAssetId: pa.id } },
    });
    await prisma.adFootage.update({ where: { id: f.id }, data: { assetId: asset.id, durationSec: n.duration } });

    await footageStep(f.id, "Transkrypcja ElevenLabs");
    if (!elevenLabsConfigured()) throw new Error("Transkrypcja wymaga klucza ELEVENLABS_API_KEY.");
    const mp3 = path.join(work, "speech.mp3");
    await extractSpeechAudio(out, mp3);
    const r = await transcribe(mp3, { language: "pol" });
    const words: FootageWord[] = r.words.filter((w) => (w.type ?? "word") === "word" && w.text.trim()).map((w) => ({ text: w.text.trim(), start: w.start, end: w.end }));
    await prisma.adFootage.update({ where: { id: f.id }, data: { words: words as unknown as Prisma.InputJsonValue, status: "READY", step: "Gotowe", error: null } });
  } catch (e) {
    await prisma.adFootage.update({ where: { id: f.id }, data: { status: "FAILED", error: (e as Error).message.slice(0, 1000) } });
    throw e;
  } finally {
    await src.cleanup();
    await fsp.rm(work, { recursive: true, force: true });
  }
}

/** Parts below this share of the script found are reported as missing instead of cut in. */
export const MIN_SCORE = 0.45;

export interface StoredMatch {
  role: string;
  text: string;
  footageId?: string;
  footageName?: string;
  start?: number;
  end?: number;
  score?: number;
  extra?: string[];
  missing?: boolean;
}

/** Find every distinct part text once (bodies / CTAs are shared by many reels). */
export function matchAll(texts: string[], footage: FootageWords[]): Map<string, PartMatch | null> {
  const unique = [...new Set(texts)];
  // pass 1: where each part starts, so a part's flowing tail never swallows the next part
  const first = new Map(unique.map((t) => [t, matchPart(t, footage, { maxTail: 0 })]));
  const stops = new Map<string, Set<number>>();
  for (const m of first.values()) if (m && m.score >= MIN_SCORE) (stops.get(m.footageId) ?? stops.set(m.footageId, new Set()).get(m.footageId)!).add(m.i0);
  return new Map(unique.map((t) => [t, matchPart(t, footage, { stops })]));
}

/**
 * Lay out the reels: match their parts in the footage and create a composition per reel (hook →
 * body → CTA as clips, subtitles from the transcript, pause suggestions). Reels that already have a
 * composition are left alone unless `rebuild`.
 */
export async function buildReels(projectId: string, opts: { reelIds?: string[]; rebuild?: boolean } = {}) {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, include: { theme: true } });
  const footageRows = await prisma.adFootage.findMany({ where: { projectId, status: "READY" }, orderBy: [{ order: "asc" }, { createdAt: "asc" }] });
  const footage: Array<FootageWords & { assetId: string; name: string; duration: number }> = footageRows
    .filter((f) => f.assetId && Array.isArray(f.words))
    .map((f) => ({ id: f.id, assetId: f.assetId!, name: f.name, duration: f.durationSec ?? 0, words: f.words as unknown as FootageWord[] }));
  if (!footage.length) throw new Error("Brak przetworzonych nagrań — wgraj pliki wideo i poczekaj na transkrypcję.");
  const reels = await prisma.adReel.findMany({ where: { projectId, ...(opts.reelIds?.length ? { id: { in: opts.reelIds } } : {}) }, orderBy: { order: "asc" } });
  const parts = (r: (typeof reels)[number]) => r.parts as unknown as Array<{ role: string; text: string }>;
  const found = matchAll(reels.flatMap((r) => parts(r).map((p) => p.text)), footage);
  const assets = await prisma.mediaAsset.findMany({ where: { id: { in: footage.map((f) => f.assetId) } }, select: { id: true, waveform: true, durationSec: true } });
  const waveOf = new Map(assets.map((a) => [a.id, a.waveform as unknown as Waveform | null]));
  const theme = project.theme ? themeFromRow(project.theme) : DEFAULT_THEME;
  let built = 0;
  for (const reel of reels) {
    const ms: StoredMatch[] = parts(reel).map((p) => {
      const m = found.get(p.text);
      const f = m ? footage.find((x) => x.id === m.footageId) : null;
      if (!m || !f || m.score < MIN_SCORE) return { role: p.role, text: p.text, missing: true, score: m?.score ?? 0 };
      return { role: p.role, text: p.text, footageId: f.id, footageName: f.name, start: m.start, end: m.end, score: Math.round(m.score * 100) / 100, extra: m.extra };
    });
    let compositionId = reel.compositionId;
    if (opts.rebuild || !compositionId || !(await prisma.videoComposition.findUnique({ where: { id: compositionId }, select: { id: true } }))) {
      const doc = reelDocument(reel.title || reel.code, ms, footage, waveOf, theme, project);
      if (doc) {
        const name = reel.title ? `${reel.code} — ${reel.title}` : reel.code;
        if (compositionId && opts.rebuild && (await prisma.videoComposition.findUnique({ where: { id: compositionId }, select: { id: true } })))
          await prisma.videoComposition.update({ where: { id: compositionId }, data: { name, document: doc as unknown as Prisma.InputJsonValue, version: { increment: 1 } } });
        else compositionId = (await prisma.videoComposition.create({ data: { projectId, name, status: "READY_TO_EDIT", document: doc as unknown as Prisma.InputJsonValue } })).id;
        built++;
        // the project's finishing, like after an expert recording
        const { applyProjectDefaults } = await import("./project-defaults");
        await applyProjectDefaults(compositionId).catch(() => {});
        if (project.autoBlur || project.autoVoice || project.autoZooms || project.autoImageEnhance) await enqueue("auto-polish", { compositionId }, { idempotencyKey: `auto-polish:${compositionId}:${Date.now()}`, maxAttempts: 2 });
      }
    }
    await prisma.adReel.update({ where: { id: reel.id }, data: { matches: ms as unknown as Prisma.InputJsonValue, compositionId } });
  }
  return { reels: reels.length, built };
}

function reelDocument(
  title: string,
  ms: StoredMatch[],
  footage: Array<FootageWords & { assetId: string; duration: number }>,
  waveOf: Map<string, Waveform | null>,
  theme: ReturnType<typeof themeFromRow>,
  project: { questionVisibility: "NARRATION_ONLY" | "FIRST_SECONDS" | "FULL"; questionSeconds: number; theme: { logoAssetId: string | null } | null },
): EditorDocument | null {
  const used = ms.filter((m) => !m.missing && m.footageId);
  if (!used.length) return null;
  const f0 = footage.find((f) => f.id === used[0].footageId)!;
  const doc = buildInitialDocument({
    questionText: title,
    theme,
    mode: "ANSWER_ONLY",
    recording: { assetId: f0.assetId, duration: f0.duration },
    narration: null,
    segments: [],
    pauses: [],
    visibility: project.questionVisibility,
    questionSeconds: project.questionSeconds,
    logo: !!project.theme?.logoAssetId,
  });
  const framing = doc.clips[0]?.framing ?? { scale: 1, cx: 0.5, cy: 0.42 };
  const clips: AVClip[] = [];
  const ranges = new Map<string, Array<[number, number]>>();
  let t = 0;
  used.forEach((m, k) => {
    const f = footage.find((x) => x.id === m.footageId)!;
    // a little air before the first and after the last word, without catching the neighbouring words
    const idx0 = f.words.findIndex((w) => w.start >= m.start! - 1e-6);
    const idx1 = f.words.findIndex((w) => w.end >= m.end! - 1e-6);
    const prevEnd = idx0 > 0 ? f.words[idx0 - 1].end : 0;
    const nextStart = idx1 >= 0 && idx1 + 1 < f.words.length ? f.words[idx1 + 1].start : f.duration;
    const a = Math.max(0, prevEnd + 0.02, m.start! - 0.15);
    const b = Math.min(f.duration || m.end! + 0.25, nextStart - 0.02, m.end! + 0.25);
    const len = Math.max(0.2, b - a);
    clips.push({ id: `clip_${k}_${Math.random().toString(36).slice(2, 8)}`, assetId: f.assetId, sourceIn: a, sourceOut: a + len, start: Math.round(t * 30) / 30, volume: 1, muted: false, framing, label: m.role.toUpperCase() });
    t = Math.round((t + len) * 30) / 30;
    (ranges.get(f.assetId) ?? ranges.set(f.assetId, []).get(f.assetId)!).push([a, a + len]);
  });
  doc.clips = clips;
  // subtitles: the transcript words inside the cuts (they map onto the timeline through the clips)
  doc.subtitles.segments = [...ranges.entries()].flatMap(([assetId, rs]) => {
    const f = footage.find((x) => x.assetId === assetId)!;
    return buildSegments(assetId, f.words.filter((w) => rs.some(([a, b]) => w.start >= a - 0.01 && w.end <= b + 0.01)));
  });
  // pause suggestions inside the cuts (applied in the Studio)
  doc.pauses = [...ranges.entries()].flatMap(([assetId, rs]) => {
    const wf = waveOf.get(assetId);
    if (!wf) return [];
    const f = footage.find((x) => x.assetId === assetId)!;
    return detectPauses({ waveform: wf, words: f.words, sensitivity: "standard", padding: 0.2 })
      .filter((p) => rs.some(([a, b]) => p.start > a + 0.05 && p.end < b - 0.05))
      .map((p, i) => ({ ...p, id: `pause_${assetId.slice(-6)}_${i}`, assetId, status: "pending" as const }));
  });
  doc.meta.questionText = title;
  return doc;
}
