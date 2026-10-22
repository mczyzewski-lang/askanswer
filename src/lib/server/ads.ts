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

type Footage = FootageWords & { assetId: string; name: string; duration: number };

/** The cut for a found part: a little air before the first and after the last word, without the neighbours. */
function cutRange(m: StoredMatch, f: Footage): [number, number] {
  const idx0 = f.words.findIndex((w) => w.start >= m.start! - 1e-6);
  const idx1 = f.words.findIndex((w) => w.end >= m.end! - 1e-6);
  const prevEnd = idx0 > 0 ? f.words[idx0 - 1].end : 0;
  const nextStart = idx1 >= 0 && idx1 + 1 < f.words.length ? f.words[idx1 + 1].start : f.duration;
  const a = Math.max(0, prevEnd + 0.02, m.start! - 0.15);
  const b = Math.min(f.duration || m.end! + 0.25, nextStart - 0.02, m.end! + 0.25);
  return [a, a + Math.max(0.2, b - a)];
}

/** Reels that differ only in the hook are one edit: grouped by everything that is not the hook. */
export function groupKey(parts: Array<{ role: string; text: string }>, code: string, groupCode?: string | null): string {
  // the file says which hooks belong together (reel;hook-number): P01-h01, P01-h02 → reel P01
  if (groupCode) return `group:${groupCode}`;
  const rest = parts.filter((p) => p.role !== "hook");
  return rest.length && rest.length < parts.length ? JSON.stringify(rest.map((p) => [p.role, p.text.trim().replace(/\s+/g, " ")])) : `solo:${code}`;
}

/**
 * Lay out the reels: match their parts in the footage and create one composition per GROUP of reels
 * that share everything but the hook (hook → body → CTA as clips, subtitles from the transcript,
 * pause suggestions); each reel is a hook version of it. Existing edits get new hook versions added;
 * `rebuild` lays them out from scratch.
 */
export async function buildReels(projectId: string, opts: { reelIds?: string[]; rebuild?: boolean } = {}) {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, include: { theme: true } });
  const footageRows = await prisma.adFootage.findMany({ where: { projectId, status: "READY" }, orderBy: [{ order: "asc" }, { createdAt: "asc" }] });
  const footage: Footage[] = footageRows
    .filter((f) => f.assetId && Array.isArray(f.words))
    .map((f) => ({ id: f.id, assetId: f.assetId!, name: f.name, duration: f.durationSec ?? 0, words: f.words as unknown as FootageWord[] }));
  if (!footage.length) throw new Error("Brak przetworzonych nagrań — wgraj pliki wideo i poczekaj na transkrypcję.");
  const all = await prisma.adReel.findMany({ where: { projectId }, orderBy: { order: "asc" } });
  const parts = (r: (typeof all)[number]) => r.parts as unknown as Array<{ role: string; text: string }>;
  const groups = new Map<string, typeof all>();
  for (const r of all) {
    const k = groupKey(parts(r), r.code, r.groupCode);
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const wanted = opts.reelIds?.length ? new Set(opts.reelIds) : null;
  const todo = [...groups.values()].filter((g) => !wanted || g.some((r) => wanted.has(r.id)));
  const found = matchAll(todo.flatMap((g) => g.flatMap((r) => parts(r).map((p) => p.text))), footage);
  const assets = await prisma.mediaAsset.findMany({ where: { id: { in: footage.map((f) => f.assetId) } }, select: { id: true, waveform: true } });
  const waveOf = new Map(assets.map((a) => [a.id, a.waveform as unknown as Waveform | null]));
  const theme = project.theme ? themeFromRow(project.theme) : DEFAULT_THEME;
  const toStored = (p: { role: string; text: string }): StoredMatch => {
    const m = found.get(p.text);
    const f = m ? footage.find((x) => x.id === m.footageId) : null;
    if (!m || !f || m.score < MIN_SCORE) return { role: p.role, text: p.text, missing: true, score: m?.score ?? 0 };
    return { role: p.role, text: p.text, footageId: f.id, footageName: f.name, start: m.start, end: m.end, score: Math.round(m.score * 100) / 100, extra: m.extra };
  };
  let built = 0;
  for (const group of todo) {
    const msOf = new Map(group.map((r) => [r.id, parts(r).map(toStored)]));
    const hookOf = (r: (typeof group)[number]) => msOf.get(r.id)!.find((m) => m.role === "hook" && !m.missing) ?? null;
    // the edit the group already has (its first member that points to an existing composition)
    let compositionId: string | null = null;
    for (const r of group)
      if (r.compositionId && (await prisma.videoComposition.findUnique({ where: { id: r.compositionId }, select: { id: true } }))) {
        compositionId = r.compositionId;
        break;
      }
    const isGroup = group.length > 1 && !groupKeyIsSolo(group[0], parts);
    const title = (r: (typeof group)[number]) => r.title || r.code;
    const name = isGroup ? `${group[0].groupCode ?? `${group[0].code}–${group[group.length - 1].code}`} · ${group.length} wersji hooka` : group[0].title ? `${group[0].code} — ${group[0].title}` : group[0].code;
    let doc: EditorDocument | null = null;
    if (compositionId && !opts.rebuild) {
      const cur = await prisma.videoComposition.findUniqueOrThrow({ where: { id: compositionId } });
      doc = cur.document as unknown as EditorDocument;
      // new reels of the group become new hook versions of the existing edit
      if (doc.hooks) {
        const have = new Set(doc.hooks.variants.map((v) => v.code));
        const base = doc.clips.find((c) => c.id === doc!.hooks!.clipId);
        const added = group.filter((r) => !have.has(r.code) && hookOf(r));
        if (added.length && base) {
          for (const r of added) doc.hooks.variants.push(hookVariant(r.id, r.code, title(r), hookOf(r)!, footage, base));
          addWords(doc, added.map((r) => hookOf(r)!), footage, waveOf);
          await prisma.videoComposition.update({ where: { id: compositionId }, data: { document: doc as unknown as Prisma.InputJsonValue, version: { increment: 1 } } });
        }
      }
    } else {
      const lead = group.find((r) => hookOf(r)) ?? group[0];
      doc = reelDocument(title(lead), msOf.get(lead.id)!, footage, waveOf, theme, project);
      if (doc) {
        const hookClip = doc.clips.find((c) => c.label === "HOOK");
        if (isGroup && hookClip) {
          const { id: _i, start: _s, ...base } = hookClip;
          void _i;
          void _s;
          const members = group.filter((r) => hookOf(r));
          doc.hooks = {
            clipId: hookClip.id,
            active: Math.max(0, members.indexOf(lead)),
            variants: members.map((r) => hookVariant(r.id, r.code, title(r), hookOf(r)!, footage, { ...base, id: hookClip.id, start: 0 })),
          };
          addWords(doc, members.filter((r) => r !== lead).map((r) => hookOf(r)!), footage, waveOf);
        }
        if (compositionId) await prisma.videoComposition.update({ where: { id: compositionId }, data: { name, document: doc as unknown as Prisma.InputJsonValue, version: { increment: 1 } } });
        else compositionId = (await prisma.videoComposition.create({ data: { projectId, name, status: "READY_TO_EDIT", document: doc as unknown as Prisma.InputJsonValue } })).id;
        built++;
        // the project's finishing, like after an expert recording
        const { applyProjectDefaults } = await import("./project-defaults");
        await applyProjectDefaults(compositionId).catch(() => {});
        if (project.autoBlur || project.autoVoice || project.autoZooms || project.autoImageEnhance) await enqueue("auto-polish", { compositionId }, { idempotencyKey: `auto-polish:${compositionId}:${Date.now()}`, maxAttempts: 2 });
      }
    }
    const variants = doc?.hooks?.variants ?? [];
    for (const r of group) {
      const idx = variants.findIndex((v) => v.code === r.code);
      // a reel whose hook was not found has no version in the shared edit yet
      const laid = !!doc && (idx >= 0 || !doc.hooks);
      await prisma.adReel.update({ where: { id: r.id }, data: { matches: msOf.get(r.id)! as unknown as Prisma.InputJsonValue, compositionId: laid ? compositionId : null, hookIndex: idx >= 0 ? idx : null } });
    }
  }
  return { reels: todo.reduce((n, g) => n + g.length, 0), built, groups: todo.length };
}

function groupKeyIsSolo(r: { code: string; parts: unknown; groupCode: string | null }, parts: (r: never) => Array<{ role: string; text: string }>) {
  return groupKey(parts(r as never), r.code, r.groupCode).startsWith("solo:");
}

/** A hook version: the found hook cut, with the look / background / framing of the edit's hook clip. */
function hookVariant(reelId: string, code: string, title: string, m: StoredMatch, footage: Footage[], base: AVClip) {
  const f = footage.find((x) => x.id === m.footageId)!;
  const [a, b] = cutRange(m, f);
  const { id: _i, start: _s, ...rest } = base;
  void _i;
  void _s;
  return { id: `hook_${reelId}`, code, title, clip: { ...rest, assetId: f.assetId, sourceIn: a, sourceOut: b } };
}

/** Subtitles and pause suggestions for extra hook cuts (they show when their version is on). */
function addWords(doc: EditorDocument, ms: StoredMatch[], footage: Footage[], waveOf: Map<string, Waveform | null>) {
  for (const m of ms) {
    const f = footage.find((x) => x.id === m.footageId)!;
    const [a, b] = cutRange(m, f);
    doc.subtitles.segments.push(...buildSegments(f.assetId, f.words.filter((w) => w.start >= a - 0.01 && w.end <= b + 0.01)));
    const wf = waveOf.get(f.assetId);
    if (wf)
      doc.pauses.push(
        ...detectPauses({ waveform: wf, words: f.words, sensitivity: "standard", padding: 0.2 })
          .filter((p) => p.start > a + 0.05 && p.end < b - 0.05)
          .map((p, i) => ({ ...p, id: `pause_${f.assetId.slice(-6)}_h${Math.round(a * 10)}_${i}`, assetId: f.assetId, status: "pending" as const })),
      );
  }
}

function reelDocument(
  title: string,
  ms: StoredMatch[],
  footage: Footage[],
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
    // the reel's title stays at the top for the whole reel
    visibility: "FULL",
    questionSeconds: project.questionSeconds,
    logo: !!project.theme?.logoAssetId,
  });
  const framing = doc.clips[0]?.framing ?? { scale: 1, cx: 0.5, cy: 0.42 };
  const clips: AVClip[] = [];
  const ranges = new Map<string, Array<[number, number]>>();
  let t = 0;
  used.forEach((m, k) => {
    const f = footage.find((x) => x.id === m.footageId)!;
    const [a, b] = cutRange(m, f);
    const len = b - a;
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

/**
 * A campaign has its own editable theme (like every project): from a preset, or a copy of another
 * theme (e.g. the one of an expert project) so editing the campaign's look never changes that project.
 */
export async function ownTheme(name: string, from: { presetKey?: string | null; themeId?: string | null } = {}) {
  const { THEME_PRESETS } = await import("../themes");
  const src = from.themeId ? await prisma.theme.findUnique({ where: { id: from.themeId } }) : null;
  if (src) {
    const { id: _id, createdAt: _c, updatedAt: _u, isPreset: _p, name: srcName, ...rest } = src;
    void _id;
    void _c;
    void _u;
    void _p;
    return prisma.theme.create({ data: { ...rest, name: `${srcName.replace(/ \(.*\)$/, "")} (${name.slice(0, 40)})`, isPreset: false } });
  }
  const preset = THEME_PRESETS.find((t) => t.key === from.presetKey) ?? THEME_PRESETS[0];
  return prisma.theme.create({
    data: {
      name: `${preset.name} (${name.slice(0, 40)})`,
      presetKey: preset.key,
      primaryColor: preset.primary,
      accentColor: preset.accent,
      secondaryColor: preset.secondary,
      textColor: preset.text,
      highlightColor: preset.highlight,
      backgroundColor: preset.background,
      questionFont: preset.questionFont,
      subtitleFont: preset.subtitleFont,
      labelFont: preset.labelFont,
    },
  });
}
