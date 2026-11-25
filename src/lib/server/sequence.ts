/**
 * Sekwencja: the films of an e-mail / thank-you-page sequence. Every film (in one or more versions,
 * when a take was recorded twice) is an edit made of ready-cut clips - the expert, clients' quotes,
 * title cards - uploaded as a package: the clip files plus manifest.json that says which clips make
 * which film. Each version is an ordinary Studio composition (1:1), so it can be reviewed, fixed and
 * exported there.
 */
import fsp from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { env } from "./env";
import { decodePcm, makePreviewProxy, probe, run } from "./ffmpeg";
import { makeTempDir, putFile } from "./storage";
import { HttpError } from "./errors";
import { computeWaveform } from "../editor/silence";
import { buildSegments } from "../editor/subtitles";
import { buildInitialDocument } from "../editor/factory";
import { docDuration } from "../editor/timeline";
import { themeFromRow, DEFAULT_THEME } from "../themes";
import type { AVClip, EditorDocument } from "../editor/types";

export const SEQ_SIZE = 1080;
type Word = { text: string; start: number; end: number };

const word = z.object({ text: z.string().max(80), start: z.number().min(0), end: z.number().min(0) });
export const Manifest = z.object({
  films: z
    .array(
      z.object({
        code: z.string().trim().min(1).max(12),
        title: z.string().trim().min(1).max(200),
        subject: z.string().trim().max(300).nullable().optional(),
        versions: z
          .array(
            z.object({
              version: z.string().trim().min(1).max(12),
              note: z.string().trim().max(2000).nullable().optional(),
              parts: z.array(z.object({ clip: z.string().trim().min(1).max(200), label: z.string().trim().max(40).default("KLIP") })).min(1).max(200),
              /** explainers over the film: where each starts, how far it may run, and from which second of its file */
              overlays: z.array(z.object({ clip: z.string().trim().min(1).max(200), at: z.number().min(0), until: z.number().min(0), sourceIn: z.number().min(0).optional(), name: z.string().trim().max(120).optional() })).max(60).optional(),
            }),
          )
          .min(1)
          .max(20),
      }),
    )
    .min(1)
    .max(60),
  /** words of the clips (seconds inside the clip), for the subtitles */
  words: z.record(z.string(), z.array(word).max(4000)).optional(),
});
export type SequenceManifest = z.infer<typeof Manifest>;

/** A clip of the package: stored as it is (they come cut and sized), with a preview proxy and a waveform. */
export async function ingestSequenceClip(projectId: string, src: string, name: string) {
  const info = await probe(src).catch(() => null);
  if (!info?.hasVideo) throw new HttpError(415, `„${name}”: plik wideo jest uszkodzony lub ma nieprawidłowy format`);
  if (info.duration > 600) throw new HttpError(413, `„${name}”: klip może mieć maksymalnie 10 minut`);
  const work = await makeTempDir("seq-clip");
  try {
    // 30 fps H.264 + AAC, like every recording in the Studio (a clip without sound gets a silent track)
    const out = path.join(work, "clip.mp4");
    await run(env.ffmpeg, [
      "-hide_banner", "-v", "error", "-y", "-i", src, ...(info.hasAudio ? [] : ["-f", "lavfi", "-t", String(info.duration), "-i", "anullsrc=r=48000:cl=stereo"]),
      "-map", "0:v:0", "-map", info.hasAudio ? "0:a:0" : "1:a:0",
      "-vf", "scale='min(1920,iw)':'min(1920,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,fps=30,format=yuv420p",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-g", "30", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-shortest", "-movflags", "+faststart", out,
    ]);
    const n = await probe(out);
    const key = `projects/${projectId}/sequence/${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}.mp4`;
    const size = await putFile(key, out, "video/mp4");
    const waveform = computeWaveform(await decodePcm(out, 16000), 16000, 100);
    const proxy = path.join(work, "proxy.webm");
    await makePreviewProxy(out, proxy);
    const pKey = key.replace(/\.mp4$/, ".proxy.webm");
    const pSize = await putFile(pKey, proxy, "video/webm");
    const pa = await prisma.mediaAsset.create({ data: { kind: "PREVIEW_PROXY", projectId, storageKey: pKey, mimeType: "video/webm", sizeBytes: pSize, durationSec: n.duration, hasAudio: true, hasVideo: true } });
    const asset = await prisma.mediaAsset.create({
      data: { kind: "RECORDING_NORMALIZED", projectId, storageKey: key, mimeType: "video/mp4", sizeBytes: size, durationSec: n.duration, width: n.width, height: n.height, fps: n.fps, hasAudio: true, hasVideo: true, originalName: name, waveform: waveform as unknown as Prisma.InputJsonValue, meta: { proxyAssetId: pa.id, source: "sequence-clip" } },
    });
    const clip = await prisma.sequenceClip.upsert({
      where: { projectId_name: { projectId, name } },
      create: { projectId, name, assetId: asset.id, durationSec: n.duration },
      update: { assetId: asset.id, durationSec: n.duration },
    });
    return { id: clip.id, name, durationSec: n.duration, replaced: clip.createdAt.getTime() < Date.now() - 5000 };
  } finally {
    await fsp.rm(work, { recursive: true, force: true });
  }
}

type ClipRow = { name: string; assetId: string; durationSec: number; words: unknown };

/** One film version as a Studio document: the clips one after another, 1:1, subtitles from the clips' words. */
export function sequenceDocument(title: string, parts: Array<{ clip: string; label: string }>, clips: Map<string, ClipRow>, theme: ReturnType<typeof themeFromRow>, logo: boolean): EditorDocument | null {
  const used = parts.map((p) => ({ p, c: clips.get(p.clip) })).filter((x): x is { p: { clip: string; label: string }; c: ClipRow } => !!x.c);
  if (!used.length) return null;
  const doc = buildInitialDocument({ questionText: title, theme, mode: "ANSWER_ONLY", recording: { assetId: used[0].c.assetId, duration: used[0].c.durationSec }, narration: null, segments: [], pauses: [], visibility: "NARRATION_ONLY", questionSeconds: 0, logo });
  doc.width = SEQ_SIZE;
  doc.height = SEQ_SIZE;
  // the films carry their own title cards: no question card on top
  doc.overlays = doc.overlays.filter((o) => !(o.kind === "text" && o.role === "question"));
  const out: AVClip[] = [];
  let t = 0;
  used.forEach(({ p, c }, k) => {
    out.push({ id: `seq_${k}_${Math.random().toString(36).slice(2, 8)}`, assetId: c.assetId, sourceIn: 0, sourceOut: c.durationSec, start: Math.round(t * 30) / 30, volume: 1, muted: false, framing: { scale: 1, cx: 0.5, cy: 0.5 }, label: p.label.toUpperCase() });
    t = Math.round((t + c.durationSec) * 30) / 30;
  });
  doc.clips = out;
  const seen = new Set<string>();
  doc.subtitles.segments = used.flatMap(({ c }) => {
    if (seen.has(c.assetId)) return [];
    seen.add(c.assetId);
    const words = (Array.isArray(c.words) ? (c.words as Word[]) : []).filter((w) => w.end <= c.durationSec + 0.3);
    return words.length ? buildSegments(c.assetId, words) : [];
  });
  doc.pauses = [];
  // a square frame: the subtitles sit low, under the speaker's face and hands
  doc.subtitles = { ...doc.subtitles, style: { ...doc.subtitles.style, y: 0.86 } };
  doc.meta.questionText = title;
  return doc;
}

const nameOf = (code: string, version: string, title: string) => `Sekwencja ${code}${version} - ${title}`.slice(0, 180);

/**
 * The package's manifest: the words go to the clips, every film version gets (or updates) its edit.
 * An edit already changed in the Studio is rebuilt only when its list of clips changed (or `rebuild`).
 */
export async function importManifest(projectId: string, m: SequenceManifest, opts: { rebuild?: boolean } = {}) {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, include: { theme: true } });
  for (const [name, words] of Object.entries(m.words ?? {})) await prisma.sequenceClip.updateMany({ where: { projectId, name }, data: { words: words as unknown as Prisma.InputJsonValue } });
  const clips = new Map((await prisma.sequenceClip.findMany({ where: { projectId } })).map((c) => [c.name, c as ClipRow]));
  const theme = project.theme ? themeFromRow(project.theme) : DEFAULT_THEME;
  const report: Array<{ film: string; status: "created" | "updated" | "kept" | "missing"; missing: string[] }> = [];
  let order = 0;
  for (const f of m.films)
    for (const v of f.versions) {
      order++;
      const missing = [...new Set(v.parts.filter((p) => !clips.has(p.clip)).map((p) => p.clip))];
      const existing = await prisma.sequenceFilm.findUnique({ where: { projectId_code_version: { projectId, code: f.code, version: v.version } } });
      const comp = existing?.compositionId ? await prisma.videoComposition.findUnique({ where: { id: existing.compositionId }, select: { id: true } }) : null;
      const same = !!existing && JSON.stringify(existing.parts) === JSON.stringify(v.parts);
      let compositionId = comp?.id ?? null;
      let status: (typeof report)[number]["status"] = missing.length ? "missing" : "kept";
      if (!missing.length && (!comp || !same || opts.rebuild)) {
        const doc = sequenceDocument(f.title, v.parts, clips, theme, !!project.theme?.logoAssetId);
        if (doc) {
          const name = nameOf(f.code, v.version, f.title);
          if (comp) await prisma.videoComposition.update({ where: { id: comp.id }, data: { name, document: doc as unknown as Prisma.InputJsonValue, version: { increment: 1 } } });
          else compositionId = (await prisma.videoComposition.create({ data: { projectId, name, status: "READY_TO_EDIT", document: doc as unknown as Prisma.InputJsonValue } })).id;
          status = comp ? "updated" : "created";
        }
      }
      const data = {
        title: f.title, subject: f.subject ?? null, note: v.note ?? null, parts: v.parts as unknown as Prisma.InputJsonValue, compositionId, order,
        ...(v.overlays ? { overlays: v.overlays as unknown as Prisma.InputJsonValue } : {}),
        // an edit laid out again starts without the explainer layers
        ...(status === "created" || status === "updated" ? { placed: [] } : {}),
      };
      if (existing) await prisma.sequenceFilm.update({ where: { id: existing.id }, data });
      else await prisma.sequenceFilm.create({ data: { projectId, code: f.code, version: v.version, ...data } });
      report.push({ film: `${f.code}${v.version}`, status, missing });
    }
  const explainers = await applyExplainers(projectId);
  return { explainers, films: report.length, created: report.filter((r) => r.status === "created").length, updated: report.filter((r) => r.status === "updated").length, kept: report.filter((r) => r.status === "kept").length, missing: report.filter((r) => r.status === "missing") };
}

type Placement = { clip: string; at: number; until: number; sourceIn?: number; name?: string };
const placementKey = (p: Placement, i: number) => `${p.clip}@${i}`;
const layerId = (key: string) => `expl_${key.replace(/[^a-zA-Z0-9]+/g, "_")}`.slice(0, 64);

/**
 * Explainers as layers: every placement of a film whose clip is in the library (and that was not
 * placed before) becomes a full-frame video layer at its moment, running for the clip's length but
 * never past `until`. Layers switched off or removed in the Studio stay as the editor left them.
 */
export async function applyExplainers(projectId: string) {
  const clips = new Map((await prisma.sequenceClip.findMany({ where: { projectId } })).map((c) => [c.name, c]));
  const films = await prisma.sequenceFilm.findMany({ where: { projectId, compositionId: { not: null } } });
  let added = 0;
  for (const f of films) {
    const want = ((f.overlays ?? []) as unknown as Placement[]).map((p, i) => ({ p, key: placementKey(p, i) })).filter((x) => clips.has(x.p.clip) && !f.placed.includes(x.key));
    if (!want.length) continue;
    for (let attempt = 0; attempt < 5; attempt++) {
      const cur = await prisma.videoComposition.findUnique({ where: { id: f.compositionId! } });
      if (!cur) break;
      const doc = cur.document as unknown as EditorDocument;
      const total = docDuration(doc);
      const layers = want.flatMap(({ p, key }) => {
        const c = clips.get(p.clip)!;
        const sourceIn = Math.min(p.sourceIn ?? 0, Math.max(0, c.durationSec - 0.5));
        const end = Math.min(p.at + (c.durationSec - sourceIn), p.until, total);
        if (end - p.at < 0.8 || doc.overlays.some((o) => o.id === layerId(key))) return [];
        return [{ id: layerId(key), name: p.name ?? `Explainer ${p.clip.replace(/\.[a-z0-9]+$/i, "")}`, kind: "video" as const, assetId: c.assetId, start: Math.round(p.at * 30) / 30, end: Math.round(end * 30) / 30, x: 0, y: 0, w: 1, h: 1, opacity: 1, animation: "fade" as const, fit: "cover" as const, sourceIn, loop: false, volume: 0.4, radius: 0 }];
      });
      const next = { ...doc, overlays: [...doc.overlays, ...layers] };
      const r = layers.length ? await prisma.videoComposition.updateMany({ where: { id: cur.id, version: cur.version }, data: { document: next as unknown as Prisma.InputJsonValue, version: { increment: 1 } } }) : { count: 1 };
      if (r.count === 1) {
        await prisma.sequenceFilm.update({ where: { id: f.id }, data: { placed: [...f.placed, ...want.map((x) => x.key)] } });
        added += layers.length;
        break;
      }
      await new Promise((res) => setTimeout(res, 300));
    }
  }
  return { added };
}

/** Switch every explainer layer of a film version on or off (the layers stay in the edit). */
export async function setExplainers(filmId: string, on: boolean) {
  const f = await prisma.sequenceFilm.findUniqueOrThrow({ where: { id: filmId } });
  if (!f.compositionId) return { changed: 0 };
  for (let attempt = 0; attempt < 5; attempt++) {
    const cur = await prisma.videoComposition.findUniqueOrThrow({ where: { id: f.compositionId } });
    const doc = cur.document as unknown as EditorDocument;
    let changed = 0;
    const overlays = doc.overlays.map((o) => (o.id.startsWith("expl_") && !!o.hidden === on ? (changed++, { ...o, hidden: !on }) : o));
    if (!changed) return { changed: 0 };
    const r = await prisma.videoComposition.updateMany({ where: { id: cur.id, version: cur.version }, data: { document: { ...doc, overlays } as unknown as Prisma.InputJsonValue, version: { increment: 1 } } });
    if (r.count === 1) return { changed };
    await new Promise((res) => setTimeout(res, 300));
  }
  throw new HttpError(409, "Montaż był w tym czasie edytowany - spróbuj ponownie");
}

/** Everything the Sekwencja tab shows. */
export async function sequenceData(projectId: string) {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { id: true, name: true } });
  const films = await prisma.sequenceFilm.findMany({ where: { projectId }, orderBy: [{ order: "asc" }, { code: "asc" }, { version: "asc" }] });
  const clips = await prisma.sequenceClip.findMany({ where: { projectId }, select: { name: true, durationSec: true } });
  const have = new Set(clips.map((c) => c.name));
  const comps = await prisma.videoComposition.findMany({ where: { id: { in: films.map((f) => f.compositionId).filter((x): x is string => !!x) } }, select: { id: true, document: true, status: true, updatedAt: true } });
  const byId = new Map(comps.map((c) => [c.id, c]));
  return {
    project,
    clips: clips.length,
    films: films.map((f) => {
      const c = f.compositionId ? byId.get(f.compositionId) : undefined;
      const parts = f.parts as unknown as Array<{ clip: string; label: string }>;
      const wanted = (f.overlays ?? []) as unknown as Placement[];
      const layers = c ? (c.document as unknown as EditorDocument).overlays.filter((o) => o.id.startsWith("expl_")) : [];
      return {
        explainers: { planned: wanted.length, inEdit: layers.length, on: layers.filter((o) => !o.hidden).length, waiting: [...new Set(wanted.filter((p) => !have.has(p.clip)).map((p) => p.clip))] },
        id: f.id,
        code: f.code,
        version: f.version,
        title: f.title,
        subject: f.subject,
        note: f.note,
        review: f.review,
        parts: parts.length,
        labels: parts.map((p) => p.label),
        missing: [...new Set(parts.filter((p) => !have.has(p.clip)).map((p) => p.clip))],
        compositionId: c ? c.id : null,
        durationSec: c ? docDuration(c.document as unknown as EditorDocument) : null,
        exported: c?.status === "EXPORTED",
        updatedAt: (c?.updatedAt ?? f.updatedAt).toISOString(),
      };
    }),
  };
}
