/**
 * Server-side renderer: FFmpeg decodes source frames, the shared compositor
 * (compositor.ts) draws every output frame with @napi-rs/canvas (Skia), and FFmpeg
 * encodes H.264/AAC MP4. Audio is mixed by FFmpeg from the same clip decisions.
 * Licensing: uses only FFmpeg (LGPL/GPL build) and Skia — no Remotion licence required.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { createCanvas, GlobalFonts, ImageData, loadImage, type SKRSContext2D, type Canvas, type Image } from "@napi-rs/canvas";
import type { EditorDocument } from "../editor/types";
import { clipAt, clipEnd, docDuration } from "../editor/timeline";
import { drawFrame, type Ctx, type FrameSource } from "./compositor";
import { run } from "../server/ffmpeg";
import { env } from "../server/env";

export interface RenderAsset {
  id: string;
  path: string;
  width: number | null;
  height: number | null;
  hasAudio: boolean;
  hasVideo: boolean;
  kind: string;
}

export interface RenderOptions {
  width: number;
  height: number;
  quality: "draft" | "standard" | "high";
  onProgress?: (p: number) => void | Promise<void>;
}

let fontsRegistered = false;
export function registerFonts() {
  if (fontsRegistered) return;
  const dir = path.resolve(process.cwd(), "public/fonts");
  for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    if (!f.endsWith(".ttf")) continue;
    const family = f.replace(/-\d+\.ttf$/, "").replace(/^DMSans$/, "DM Sans");
    GlobalFonts.registerFromPath(path.join(dir, f), family);
  }
  fontsRegistered = true;
}

/** Reads fixed-size raw RGBA frames from an FFmpeg process. */
class FrameReader {
  private proc: ChildProcessWithoutNullStreams;
  private chunks: Buffer[] = [];
  private buffered = 0;
  private ended = false;
  private waiter: (() => void) | null = null;
  index = -1;
  last: Buffer | null = null;
  constructor(
    file: string,
    sourceIn: number,
    length: number,
    private frameBytes: number,
  ) {
    this.proc = spawn(env.ffmpeg, [
      "-hide_banner",
      "-v",
      "error",
      "-ss",
      sourceIn.toFixed(4),
      "-i",
      file,
      "-t",
      (length + 0.1).toFixed(4),
      "-an",
      "-vf",
      "fps=30",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgba",
      "-",
    ]);
    this.proc.stdout.on("data", (d: Buffer) => {
      this.chunks.push(d);
      this.buffered += d.length;
      if (this.buffered > frameBytes * 4) this.proc.stdout.pause();
      this.wake();
    });
    this.proc.stdout.on("end", () => {
      this.ended = true;
      this.wake();
    });
    this.proc.stderr.on("data", () => {});
  }
  private wake() {
    const w = this.waiter;
    this.waiter = null;
    w?.();
  }
  private async readFrame(): Promise<Buffer | null> {
    while (this.buffered < this.frameBytes) {
      if (this.ended) return null;
      this.proc.stdout.resume();
      await new Promise<void>((r) => (this.waiter = r));
    }
    const all = this.chunks.length === 1 ? this.chunks[0] : Buffer.concat(this.chunks);
    const frame = all.subarray(0, this.frameBytes);
    const rest = all.subarray(this.frameBytes);
    this.chunks = rest.length ? [rest] : [];
    this.buffered = rest.length;
    if (this.buffered <= this.frameBytes * 4) this.proc.stdout.resume();
    return Buffer.from(frame);
  }
  /** Advance to frame n (0-based within the clip). Repeats the last frame if the stream ended early. */
  async frameAt(n: number): Promise<Buffer | null> {
    while (this.index < n) {
      const f = await this.readFrame();
      if (!f) break;
      this.last = f;
      this.index++;
    }
    return this.last;
  }
  close() {
    this.proc.stdout.destroy();
    this.proc.kill("SIGKILL");
  }
}

function qualityArgs(q: RenderOptions["quality"]) {
  if (q === "high") return ["-preset", "medium", "-crf", "18"];
  if (q === "draft") return ["-preset", "ultrafast", "-crf", "27"];
  return ["-preset", "veryfast", "-crf", "21"];
}

/** Build the FFmpeg audio mix (expert audio, narration, music) following the same clip decisions. */
export async function mixAudio(doc: EditorDocument, assets: Map<string, RenderAsset>, out: string): Promise<void> {
  const duration = Math.max(0.1, docDuration(doc));
  const inputs: string[] = [];
  const inputIdx = new Map<string, number>();
  const parts: string[] = [];
  const labels: string[] = [];
  const addInput = (id: string) => {
    if (!inputIdx.has(id)) {
      inputIdx.set(id, inputs.length);
      inputs.push(assets.get(id)!.path);
    }
    return inputIdx.get(id)!;
  };
  let k = 0;
  const addClip = (assetId: string, sourceIn: number, sourceOut: number, start: number, volume: number, fadeIn = 0.01, fadeOut = 0.01) => {
    const a = assets.get(assetId);
    if (!a || !a.hasAudio || volume <= 0) return;
    const i = addInput(assetId);
    const len = sourceOut - sourceIn;
    const delay = Math.max(0, Math.round(start * 1000));
    // short fades on every edit point avoid clicks at cuts
    const fi = Math.max(0.005, Math.min(fadeIn, len / 2));
    const fo = Math.max(0.005, Math.min(fadeOut, len / 2));
    parts.push(
      `[${i}:a]atrim=start=${sourceIn.toFixed(4)}:end=${sourceOut.toFixed(4)},asetpts=PTS-STARTPTS,aformat=sample_rates=48000:channel_layouts=stereo,` +
        `afade=t=in:st=0:d=${fi.toFixed(3)},afade=t=out:st=${Math.max(0, len - fo).toFixed(3)}:d=${fo.toFixed(3)},volume=${volume.toFixed(3)},adelay=delays=${delay}:all=1[a${k}]`,
    );
    labels.push(`[a${k}]`);
    k++;
  };
  for (const c of doc.clips) if (!c.muted) addClip(c.audioAssetId ?? c.assetId, c.sourceIn, c.sourceOut, c.start, c.volume);
  for (const c of doc.narration) if (!c.muted) addClip(c.assetId, c.sourceIn, c.sourceOut, c.start, c.volume, c.fadeIn, c.fadeOut);
  for (const c of doc.music) {
    if (c.muted) continue;
    const end = Math.min(clipEnd(c), duration);
    if (end <= c.start) continue;
    addClip(c.assetId, c.sourceIn, c.sourceIn + (end - c.start), c.start, c.volume, c.fadeIn, c.fadeOut);
  }
  const base = `anullsrc=r=48000:cl=stereo,atrim=0:${duration.toFixed(4)}[base]`;
  const filter = [base, ...parts, `[base]${labels.join("")}amix=inputs=${labels.length + 1}:normalize=0:dropout_transition=0:duration=first,alimiter=limit=0.97,atrim=0:${duration.toFixed(4)}[out]`].join(";");
  const args = ["-hide_banner", "-y", ...inputs.flatMap((p) => ["-i", p]), "-filter_complex", filter, "-map", "[out]", "-ac", "2", "-ar", "48000", "-c:a", "pcm_s16le", out];
  await run(env.ffmpeg, args);
}

export interface SegmentJob {
  doc: EditorDocument;
  assets: RenderAsset[];
  out: string;
  fromFrame: number;
  toFrame: number;
  width: number;
  height: number;
  quality: RenderOptions["quality"];
}

/** Render a frame range [fromFrame, toFrame) as a video-only H.264 segment. */
export async function renderVideoSegment(job: SegmentJob, onFrame?: (done: number) => void | Promise<void>): Promise<void> {
  registerFonts();
  const doc: EditorDocument = { ...job.doc, width: job.width, height: job.height };
  const assets = new Map(job.assets.map((a) => [a.id, a]));
  const fps = doc.fps || 30;
  const canvas = createCanvas(job.width, job.height);
  const ctx = canvas.getContext("2d") as unknown as SKRSContext2D;
  const srcCanvases = new Map<string, Canvas>();
  const images = new Map<string, Image>();
  for (const o of doc.overlays) {
    const id = o.kind === "image" || o.kind === "logo" ? (o.assetId ?? (o.kind === "logo" ? doc.theme.logoAssetId : null)) : null;
    if (id && assets.has(id) && !images.has(id)) images.set(id, await loadImage(await fsp.readFile(assets.get(id)!.path)));
  }
  const encoder = spawn(env.ffmpeg, [
    "-hide_banner", "-v", "error", "-y",
    "-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${job.width}x${job.height}`, "-r", String(fps), "-i", "-",
    "-an", "-c:v", "libx264", ...qualityArgs(job.quality), "-threads", "2",
    "-pix_fmt", "yuv420p", "-profile:v", "high", "-r", String(fps), job.out,
  ]);
  let encErr = "";
  encoder.stderr.on("data", (d: Buffer) => (encErr += d.toString()));
  const encDone = new Promise<void>((resolve, reject) => {
    encoder.on("error", reject);
    encoder.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`Encoder failed (${code}): ${encErr.slice(-1500)}`))));
  });
  let reader: { clipId: string; n0: number; r: FrameReader } | null = null;
  try {
    for (let i = job.fromFrame; i < job.toFrame; i++) {
      const t = i / fps;
      const clip = clipAt(doc, t + 1e-6);
      let frame: FrameSource | null = null;
      if (clip) {
        const a = assets.get(clip.assetId);
        if (a && a.hasVideo && a.width && a.height) {
          const n = Math.max(0, Math.round((t - clip.start) * fps));
          if (!reader || reader.clipId !== clip.id) {
            reader?.r.close();
            const offset = n / fps;
            reader = { clipId: clip.id, n0: n, r: new FrameReader(a.path, clip.sourceIn + offset, clip.sourceOut - clip.sourceIn - offset, a.width * a.height * 4) };
          }
          const buf = await reader.r.frameAt(n - reader.n0);
          if (buf) {
            const key = `${a.width}x${a.height}`;
            let sc = srcCanvases.get(key);
            if (!sc) {
              sc = createCanvas(a.width, a.height);
              srcCanvases.set(key, sc);
            }
            sc.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(buf.buffer, buf.byteOffset, buf.byteLength), a.width, a.height), 0, 0);
            frame = { image: sc as unknown as CanvasImageSource, width: a.width, height: a.height };
          }
        }
      }
      drawFrame(ctx as unknown as Ctx, doc, t, {
        getFrame: () => frame,
        getImage: (id) => {
          const img = images.get(id);
          return img ? { image: img as unknown as CanvasImageSource, width: img.width, height: img.height } : null;
        },
        includeSuggestedZooms: false,
      });
      const px = ctx.getImageData(0, 0, job.width, job.height).data;
      const ok = encoder.stdin.write(Buffer.from(px.buffer, px.byteOffset, px.byteLength));
      if (!ok) await new Promise<void>((r) => encoder.stdin.once("drain", () => r()));
      if ((i - job.fromFrame) % 10 === 0) await onFrame?.(i - job.fromFrame);
    }
  } finally {
    reader?.r.close();
    encoder.stdin.end();
  }
  await encDone;
  await onFrame?.(job.toFrame - job.fromFrame);
}

/** Run a segment in a child process (rendering is CPU-bound and synchronous in Skia). */
function renderSegmentInChild(job: SegmentJob, onFrame: (done: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const jobFile = `${job.out}.json`;
    fs.writeFileSync(jobFile, JSON.stringify(job));
    const script = path.resolve(process.cwd(), "src/lib/render/segment-cli.ts");
    const tsxCli = path.resolve(process.cwd(), "node_modules/tsx/dist/cli.mjs");
    const child = spawn(process.execPath, [tsxCli, script, jobFile], { stdio: ["ignore", "pipe", "pipe"] });
    let err = "";
    child.stdout.on("data", (d: Buffer) => {
      for (const line of d.toString().split("\n")) {
        const m = /^progress (\d+)/.exec(line.trim());
        if (m) onFrame(Number(m[1]));
      }
    });
    child.stderr.on("data", (d: Buffer) => (err += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      fs.rmSync(jobFile, { force: true });
      if (code === 0) resolve();
      else reject(new Error(`Segment renderer failed (${code}): ${err.slice(-1500)}`));
    });
  });
}

export async function renderComposition(
  docIn: EditorDocument,
  assets: Map<string, RenderAsset>,
  outFile: string,
  opts: RenderOptions & { parallel?: number },
): Promise<{ frames: number; duration: number }> {
  const doc: EditorDocument = { ...docIn, width: opts.width, height: opts.height };
  const fps = doc.fps || 30;
  const duration = docDuration(doc);
  if (duration <= 0) throw new Error("Kompozycja jest pusta — brak klipów na osi czasu");
  const totalFrames = Math.max(1, Math.round(duration * fps));
  const workDir = await fsp.mkdtemp(path.join(path.dirname(outFile), "render-"));
  try {
    const mixPath = path.join(workDir, "mix.wav");
    await mixAudio(doc, assets, mixPath);
    await opts.onProgress?.(0.03);
    const parallel = Math.max(1, Math.min(opts.parallel ?? 1, Math.ceil(totalFrames / 90)));
    const per = Math.ceil(totalFrames / parallel);
    const jobs: SegmentJob[] = [];
    for (let k = 0; k < parallel; k++) {
      const a = k * per;
      const b = Math.min(totalFrames, a + per);
      if (b > a) jobs.push({ doc, assets: [...assets.values()], out: path.join(workDir, `seg-${k}.mp4`), fromFrame: a, toFrame: b, width: opts.width, height: opts.height, quality: opts.quality });
    }
    const done = new Array(jobs.length).fill(0);
    let lastReport = 0;
    const report = async () => {
      const p = 0.03 + 0.93 * (done.reduce((x, y) => x + y, 0) / totalFrames);
      if (p - lastReport > 0.01) {
        lastReport = p;
        await opts.onProgress?.(p);
      }
    };
    if (jobs.length === 1) {
      await renderVideoSegment(jobs[0], async (n) => {
        done[0] = n;
        await report();
      });
    } else {
      await Promise.all(
        jobs.map((j, k) =>
          renderSegmentInChild(j, (n) => {
            done[k] = n;
            void report();
          }),
        ),
      );
    }
    const list = path.join(workDir, "segments.txt");
    await fsp.writeFile(list, jobs.map((j) => `file '${j.out}'`).join("\n"));
    await run(env.ffmpeg, [
      "-hide_banner", "-y", "-f", "concat", "-safe", "0", "-i", list, "-i", mixPath,
      "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
      "-t", duration.toFixed(4), "-movflags", "+faststart", outFile,
    ]);
    await opts.onProgress?.(1);
    return { frames: totalFrames, duration };
  } finally {
    await fsp.rm(workDir, { recursive: true, force: true });
  }
}

/** Concatenate already-rendered MP4s (identical encoder settings) into one interview. */
export async function concatRenders(files: string[], out: string): Promise<void> {
  const list = path.join(path.dirname(out), `concat-${Date.now()}.txt`);
  await fsp.writeFile(list, files.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n"));
  try {
    await run(env.ffmpeg, ["-hide_banner", "-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", out]);
  } finally {
    await fsp.rm(list, { force: true });
  }
}
