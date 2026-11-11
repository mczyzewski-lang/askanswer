/**
 * Nowy Etap — Explainery: the export. Every frame is drawn by the reel's own draw function (the
 * code the browser preview runs) on a server canvas and piped raw into FFmpeg → H.264 1080×1920,
 * 30 fps. The narration (ElevenLabs, when configured) is generated per beat and placed exactly at
 * the beat's start, so the picture and the voice cannot drift; without it the file has a silent
 * AAC track.
 */
import fsp from "node:fs/promises";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createCanvas, loadImage, type Image } from "@napi-rs/canvas";
import { prisma } from "./db";
import { env, elevenLabsConfigured } from "./env";
import { makeTempDir, putFile, signedUrl, toLocalFile } from "./storage";
import { probe } from "./ffmpeg";
import { ensureNarration } from "./narration";
import { HttpError } from "./errors";
import { registerFonts } from "../render/server-render";
import { REEL_FPS, REEL_H, REEL_STYLES, REEL_W, reelById, type StyleKey } from "../explainers";

export const styleOf = (v: unknown): StyleKey => (REEL_STYLES.some((s) => s.key === v) ? (v as StyleKey) : "editorial");

/** the white logo: the project's dark-background logo, else the Nowy Etap mark that ships with the app */
async function logoFor(projectId: string): Promise<Image | null> {
  const p = await prisma.project.findUnique({ where: { id: projectId }, include: { theme: true } });
  const id = p?.theme?.logoDarkAssetId;
  try {
    if (id) {
      const a = await prisma.mediaAsset.findUnique({ where: { id } });
      if (a) {
        const f = await toLocalFile(a.storageKey);
        try {
          return await loadImage(await fsp.readFile(f.path));
        } finally {
          await f.cleanup();
        }
      }
    }
    const file = path.join(process.cwd(), "public", "presets", "nowy-etap-white.png");
    return fs.existsSync(file) ? await loadImage(await fsp.readFile(file)) : null;
  } catch {
    return null;
  }
}

/** one frame as PNG (thumbnail / first frame / a still of a beat) */
export async function explainerFrame(projectId: string, reelId: string, t: number, style: StyleKey = "editorial"): Promise<Buffer> {
  const reel = reelById(reelId);
  if (!reel?.draw) throw new HttpError(404, "Nie ma takiego reelsa");
  registerFonts();
  const canvas = createCanvas(REEL_W, REEL_H);
  reel.draw(canvas.getContext("2d") as never, Math.max(0, Math.min(reel.duration - 1 / REEL_FPS, t)), { logo: await logoFor(projectId), style });
  return canvas.encode("png");
}

export interface ExplainerRender {
  reelId: string;
  assetId: string;
  url: string;
  duration: number;
  voiced: boolean;
  /** beats whose narration is longer than the beat (the voice would run into the next one) */
  overruns: Array<{ beat: string; voice: number; beat_s: number }>;
}

/** Worker "explainer-render": the reel as an MP4 (optionally with the narration). `vo` overrides the narration text per beat. */
export async function renderExplainer(projectId: string, reelId: string, opts: { voice?: boolean; vo?: Record<string, string>; style?: StyleKey; onProgress?: (p: number) => void | Promise<void> } = {}): Promise<ExplainerRender> {
  const reel = reelById(reelId);
  if (!reel?.draw) throw new Error("Ten reels nie ma jeszcze sceny do wyrenderowania.");
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  registerFonts();
  const style = styleOf(opts.style);
  const logo = await logoFor(projectId);
  const work = await makeTempDir(`explainer-${reelId}`);
  try {
    // the voice: one narration per beat, placed at the beat's start
    const voiced: Array<{ file: string; at: number }> = [];
    const overruns: ExplainerRender["overruns"] = [];
    if (opts.voice !== false && elevenLabsConfigured()) {
      for (const [i, b] of reel.beats.entries()) {
        const text = (opts.vo?.[b.id] ?? b.vo).trim();
        if (!text) continue;
        const id = await ensureNarration(text, { voiceId: project.voiceId, modelId: project.ttsModel, projectId });
        const asset = await prisma.mediaAsset.findUniqueOrThrow({ where: { id } });
        const local = await toLocalFile(asset.storageKey);
        const file = path.join(work, `voice-${i}.mp3`);
        await fsp.copyFile(local.path, file);
        await local.cleanup();
        const d = (await probe(file).catch(() => null))?.duration ?? asset.durationSec ?? 0;
        if (d > b.end - b.start + 0.25) overruns.push({ beat: b.id, voice: Math.round(d * 10) / 10, beat_s: Math.round((b.end - b.start) * 10) / 10 });
        voiced.push({ file, at: b.start });
      }
    }
    const mp4 = path.join(work, "reel.mp4");
    const total = Math.round(reel.duration * REEL_FPS);
    const audioIn = voiced.length ? voiced.flatMap((v) => ["-i", v.file]) : ["-f", "lavfi", "-t", String(reel.duration), "-i", "anullsrc=r=48000:cl=stereo"];
    const audioFilter = voiced.length
      ? `${voiced.map((v, i) => `[${i + 1}:a]adelay=${Math.round(v.at * 1000)}|${Math.round(v.at * 1000)},aresample=48000[v${i}]`).join(";")};${voiced.map((_, i) => `[v${i}]`).join("")}amix=inputs=${voiced.length}:normalize=0,apad[a]`
      : "[1:a]anull[a]";
    const ff = spawn(
      env.ffmpeg,
      [
        "-hide_banner", "-loglevel", "error", "-y",
        "-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${REEL_W}x${REEL_H}`, "-r", String(REEL_FPS), "-i", "-",
        ...audioIn,
        "-filter_complex", `[0:v]format=yuv420p[v];${audioFilter}`,
        "-map", "[v]", "-map", "[a]",
        "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-c:a", "aac", "-b:a", "160k", "-ac", "2",
        "-t", String(reel.duration), "-movflags", "+faststart", mp4,
      ],
      { stdio: ["pipe", "ignore", "pipe"] },
    );
    let err = "";
    ff.stderr.on("data", (d) => (err += String(d)));
    const done = new Promise<void>((res, rej) => {
      ff.on("error", rej);
      ff.on("close", (code) => (code === 0 ? res() : rej(new Error(`FFmpeg: ${err.slice(-400) || code}`))));
    });
    const canvas = createCanvas(REEL_W, REEL_H);
    const ctx = canvas.getContext("2d");
    for (let f = 0; f < total; f++) {
      reel.draw(ctx as never, f / REEL_FPS, { logo, style });
      const px = ctx.getImageData(0, 0, REEL_W, REEL_H).data;
      const ok = ff.stdin.write(Buffer.from(px.buffer, px.byteOffset, px.byteLength));
      if (!ok) await new Promise<void>((r) => ff.stdin.once("drain", () => r()));
      if (f % 30 === 0) await opts.onProgress?.(f / total);
    }
    ff.stdin.end();
    await done;
    const info = await probe(mp4);
    const key = `projects/${projectId}/explainers/${reelId}-${style}-${Date.now().toString(36)}.mp4`;
    const size = await putFile(key, mp4, "video/mp4");
    const name = `nowy-etap_explainer-${String(reel.n).padStart(2, "0")}_${reelId}_${style}_1080x1920.mp4`;
    const asset = await prisma.mediaAsset.create({
      data: { kind: "RENDER", projectId, storageKey: key, mimeType: "video/mp4", sizeBytes: size, durationSec: info.duration, width: info.width, height: info.height, hasAudio: true, hasVideo: true, originalName: name, meta: { source: "explainer", reelId, style, voiced: voiced.length > 0, overruns } },
    });
    return { reelId, assetId: asset.id, url: await signedUrl(key, { download: name }), duration: info.duration, voiced: voiced.length > 0, overruns };
  } finally {
    await fsp.rm(work, { recursive: true, force: true });
  }
}

/** the latest render of every reel of the project, per style (key "reelId:style") */
export async function explainerRenders(projectId: string) {
  const rows = await prisma.mediaAsset.findMany({ where: { projectId, kind: "RENDER", meta: { path: ["source"], equals: "explainer" } }, orderBy: { createdAt: "desc" }, take: 60 });
  const out: Record<string, { assetId: string; url: string; createdAt: string; voiced: boolean; duration: number | null; overruns: ExplainerRender["overruns"] }> = {};
  for (const a of rows) {
    const m = (a.meta ?? {}) as { reelId?: string; style?: string; voiced?: boolean; overruns?: ExplainerRender["overruns"] };
    const k = `${m.reelId}:${styleOf(m.style)}`;
    if (!m.reelId || out[k]) continue;
    out[k] = { assetId: a.id, url: await signedUrl(a.storageKey, { download: a.originalName ?? `${m.reelId}.mp4` }), createdAt: a.createdAt.toISOString(), voiced: !!m.voiced, duration: a.durationSec, overruns: m.overruns ?? [] };
  }
  return out;
}
