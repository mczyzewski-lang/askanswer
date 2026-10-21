import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { prisma } from "./db";
import { makeTempDir, putFile, toLocalFile } from "./storage";
import { renderComposition, concatRenders, type RenderAsset } from "../render/server-render";
import type { EditorDocument } from "../editor/types";
import { EXPORT_FORMATS, type ExportFormat } from "../editor/factory";
import { themeFromRow } from "../themes";
import { syncTheme } from "../question-styles";
import { applyEndCard } from "../end-card";
import { applyProjectDefaults } from "./project-defaults";
import { switchHook } from "../editor/timeline";
import { probe } from "./ffmpeg";

export interface RenderSettings {
  format: ExportFormat;
  quality: "draft" | "standard" | "high";
  /** Ads Studio: which hook version to render */
  hook?: number | null;
}

/** Container memory limit in bytes (cgroup v2/v1), falling back to total RAM. */
function memoryLimit(): number {
  for (const f of ["/sys/fs/cgroup/memory.max", "/sys/fs/cgroup/memory/memory.limit_in_bytes"]) {
    try {
      const v = fs.readFileSync(f, "utf8").trim();
      const n = Number(v);
      if (v !== "max" && Number.isFinite(n) && n > 0 && n < 1e15) return n;
    } catch {
      /* not available */
    }
  }
  return os.totalmem();
}

/**
 * How many frame ranges to render in parallel. Each renderer process needs roughly
 * 650 MB at 1080p, and the web app + worker need ~800 MB, so small servers render
 * in a single process (slower, but it never runs out of memory).
 */
export function renderConcurrency(): number {
  const gb = memoryLimit() / 1024 ** 3;
  const byMemory = Math.max(1, Math.floor((gb - 0.8) / 0.65));
  const byCpu = Math.max(1, Math.min(3, os.cpus().length - 1));
  const requested = Number(process.env.RENDER_CONCURRENCY) || byCpu;
  return Math.max(1, Math.min(requested, byMemory, byCpu));
}

export function referencedAssetIds(doc: EditorDocument): string[] {
  const ids = new Set<string>();
  for (const c of doc.clips) {
    ids.add(c.assetId);
    if (c.audioAssetId) ids.add(c.audioAssetId);
    if (c.background?.imageAssetId) ids.add(c.background.imageAssetId);
  }
  if (doc.endCard && doc.theme.logoAssetId) ids.add(doc.theme.logoAssetId);
  if (doc.callStyle?.avatarAssetId) ids.add(doc.callStyle.avatarAssetId);
  for (const c of doc.narration) ids.add(c.assetId);
  for (const c of doc.music) ids.add(c.assetId);
  for (const o of doc.overlays) {
    if (o.kind === "image" || o.kind === "logo") {
      const id = o.assetId ?? (o.kind === "logo" ? doc.theme.logoAssetId : null);
      if (id) ids.add(id);
    }
    if (o.kind === "video") ids.add(o.assetId);
  }
  return [...ids];
}

/** Recordings whose person mask the export needs: a blurred room or a replacement (AI) background. */
export function maskedAssetIds(doc: EditorDocument): Set<string> {
  return new Set(doc.clips.filter((c) => (c.background?.blur ?? 0) > 0 || !!c.background?.imageAssetId).map((c) => c.assetId));
}

/** Load a composition document with the project's current theme applied (themes are global per project). */
export async function loadDocForRender(compositionId: string): Promise<{ doc: EditorDocument; name: string; projectId: string }> {
  await applyProjectDefaults(compositionId).catch((e) => console.error("[defaults]", (e as Error).message));
  const comp = await prisma.videoComposition.findUniqueOrThrow({ where: { id: compositionId }, include: { project: { include: { theme: true } } } });
  const doc = comp.document as unknown as EditorDocument;
  if (comp.project.theme) syncTheme(doc, themeFromRow(comp.project.theme));
  applyEndCard(doc, comp.project);
  return { doc, name: comp.name, projectId: comp.projectId };
}

async function renderOne(doc: EditorDocument, out: string, settings: RenderSettings, onProgress: (p: number) => Promise<void>) {
  const ids = referencedAssetIds(doc);
  const rows = await prisma.mediaAsset.findMany({ where: { id: { in: ids } } });
  const locals: Array<{ cleanup: () => Promise<void> }> = [];
  const assets = new Map<string, RenderAsset>();
  try {
    for (const r of rows) {
      const f = await toLocalFile(r.storageKey);
      locals.push(f);
      assets.set(r.id, { id: r.id, path: f.path, width: r.width, height: r.height, hasAudio: r.hasAudio, hasVideo: r.hasVideo, kind: r.kind, durationSec: r.durationSec });
    }
    // background blur or an AI background behind the expert: the person masks of those recordings
    const blurred = maskedAssetIds(doc);
    for (const r of rows) {
      const maskId = (r.meta as { maskAssetId?: string } | null)?.maskAssetId;
      if (!blurred.has(r.id) || !maskId) continue;
      const m = await prisma.mediaAsset.findUnique({ where: { id: maskId } });
      if (!m) continue;
      const f = await toLocalFile(m.storageKey);
      locals.push(f);
      assets.get(r.id)!.maskPath = f.path;
    }
    const missing = doc.clips.filter((c) => !assets.has(c.assetId));
    if (missing.length) throw new Error("Brak pliku źródłowego dla części klipów — nie można wyrenderować");
    const fmt = EXPORT_FORMATS[settings.format] ?? EXPORT_FORMATS["1080x1920"];
    const parallel = renderConcurrency();
    return await renderComposition(doc, assets, out, { width: fmt.width, height: fmt.height, quality: settings.quality, parallel, onProgress });
  } finally {
    for (const l of locals) await l.cleanup();
  }
}

export async function runRender(renderJobId: string): Promise<void> {
  const job = await prisma.renderJob.findUniqueOrThrow({ where: { id: renderJobId } });
  if (job.status === "SUCCEEDED" && job.outputAssetId) return; // idempotent
  const settings = job.settings as unknown as RenderSettings;
  await prisma.renderJob.update({ where: { id: job.id }, data: { status: "RUNNING", progress: 0, error: null, attempts: { increment: 1 } } });
  const dir = await makeTempDir(`render-${job.id}`);
  let lastWrite = 0;
  const progress = (base: number, span: number) => async (p: number) => {
    const now = Date.now();
    if (now - lastWrite < 700 && p < 1) return;
    lastWrite = now;
    await prisma.renderJob.update({ where: { id: job.id }, data: { progress: Math.min(0.99, base + span * p) } });
  };
  try {
    const out = path.join(dir, "output.mp4");
    let name = "wideo";
    if (job.kind === "combined") {
      const ids = job.compositionIds;
      if (!ids.length) throw new Error("Brak wybranych filmów do połączenia");
      const parts: string[] = [];
      for (let i = 0; i < ids.length; i++) {
        const { doc } = await loadDocForRender(ids[i]);
        // one CTA end card, after the last film only
        if (i < ids.length - 1) delete doc.endCard;
        const part = path.join(dir, `part-${i}.mp4`);
        await renderOne(doc, part, settings, progress(i / ids.length, 0.97 / ids.length));
        parts.push(part);
      }
      await concatRenders(parts, out);
      name = "wywiad-polaczony";
    } else {
      const loaded = await loadDocForRender(job.compositionId!);
      let doc = loaded.doc;
      name = loaded.name;
      // one hook version of an Ads Studio edit: its reel's file name
      if (settings.hook != null && doc.hooks?.variants[settings.hook]) {
        const v = doc.hooks.variants[settings.hook];
        doc = switchHook(doc, settings.hook);
        name = v.title ? `${v.code} ${v.title}` : v.code;
      }
      await renderOne(doc, out, settings, progress(0, 0.99));
    }
    const info = await probe(out);
    if (!info.hasVideo || info.duration <= 0) throw new Error("Render nie wygenerował poprawnego pliku MP4");
    const key = `projects/${job.projectId}/renders/${job.id}.mp4`;
    const size = await putFile(key, out, "video/mp4");
    const asset = await prisma.mediaAsset.upsert({
      where: { storageKey: key },
      create: {
        kind: "RENDER",
        projectId: job.projectId,
        storageKey: key,
        mimeType: "video/mp4",
        sizeBytes: size,
        durationSec: info.duration,
        width: info.width,
        height: info.height,
        fps: info.fps,
        hasAudio: info.hasAudio,
        hasVideo: true,
        originalName: `${name.replace(/[^\p{L}\p{N}\- ]/gu, "").trim().slice(0, 60) || "wideo"}.mp4`,
      },
      update: { sizeBytes: size, durationSec: info.duration },
    });
    await prisma.renderJob.update({ where: { id: job.id }, data: { status: "SUCCEEDED", progress: 1, outputAssetId: asset.id } });
    if (job.compositionId) await prisma.videoComposition.update({ where: { id: job.compositionId }, data: { status: "EXPORTED" } });
    else await prisma.videoComposition.updateMany({ where: { id: { in: job.compositionIds } }, data: { status: "EXPORTED" } });
  } catch (e) {
    await prisma.renderJob.update({ where: { id: job.id }, data: { status: "QUEUED", error: (e as Error).message.slice(0, 2000) } });
    throw e;
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}
