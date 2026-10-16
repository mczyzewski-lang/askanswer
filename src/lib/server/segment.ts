import { spawn } from "node:child_process";
import fsp from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import { prisma } from "./db";
import { env } from "./env";
import { probe } from "./ffmpeg";
import { makeTempDir, putFile, toLocalFile } from "./storage";
import { encodeMaskFile } from "../render/mask-format";

/**
 * Person segmentation for background blur. MediaPipe Selfie Segmenter (Apache 2.0) converted to ONNX
 * (models/selfie_segmenter.onnx, see models/README.md), run with onnxruntime-node on the CPU.
 * The frame is letterboxed into the model's 256×256 input, so the mask keeps the true aspect ratio.
 */
const MODEL = path.resolve(process.cwd(), "models/selfie_segmenter.onnx");
const SIZE = 256;
export const MASK_FPS = 15;

type Ort = typeof import("onnxruntime-node");
let session: Promise<{ ort: Ort; s: import("onnxruntime-node").InferenceSession }> | null = null;
function model() {
  session ??= (async () => {
    const ort = await import("onnxruntime-node");
    const s = await ort.InferenceSession.create(MODEL, { intraOpNumThreads: Number(process.env.SEGMENT_THREADS ?? 2), graphOptimizationLevel: "all" });
    return { ort, s };
  })();
  return session;
}

/** Area of the frame inside the 256×256 letterbox. */
export function contentBox(w: number, h: number) {
  const cw = w >= h ? SIZE : Math.max(16, Math.round((SIZE * w) / h / 2) * 2);
  const ch = h >= w ? SIZE : Math.max(16, Math.round((SIZE * h) / w / 2) * 2);
  return { cw, ch, x: (SIZE - cw) >> 1, y: (SIZE - ch) >> 1 };
}

/** Soft threshold that keeps hair/edges smooth but removes the low-confidence haze around the person. */
function shape(p: number) {
  const t = Math.min(1, Math.max(0, (p - 0.35) / 0.45));
  return t * t * (3 - 2 * t);
}

export async function segmentVideoFile(file: string, onProgress?: (done: number, total: number) => void): Promise<Uint8Array> {
  const info = await probe(file);
  if (!info.hasVideo || !info.width || !info.height) throw new Error("Nagranie nie ma obrazu");
  const { ort, s } = await model();
  const box = contentBox(info.width, info.height);
  const frameBytes = SIZE * SIZE * 3;
  const total = Math.max(1, Math.ceil(info.duration * MASK_FPS));
  const ff = spawn(env.ffmpeg, [
    "-hide_banner", "-loglevel", "error", "-i", file, "-an",
    "-vf", `fps=${MASK_FPS},scale=${box.cw}:${box.ch}:flags=area,pad=${SIZE}:${SIZE}:${box.x}:${box.y}:color=0x808080,format=rgb24`,
    "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
  ]);
  let err = "";
  ff.stderr.on("data", (d: Buffer) => (err += d.toString()));
  const input = new Float32Array(frameBytes);
  const frames: Uint8Array[] = [];
  let ema: Float32Array | null = null;
  let pending: Buffer = Buffer.alloc(0);
  const handle = async (raw: Buffer) => {
    for (let i = 0; i < frameBytes; i++) input[i] = raw[i] / 255;
    const out = await s.run({ input: new ort.Tensor("float32", input, [1, SIZE, SIZE, 3]) });
    const m = out.mask.data as Float32Array;
    // crop the letterbox and smooth over time (less flicker at the edges)
    const cur = new Float32Array(box.cw * box.ch);
    for (let y = 0; y < box.ch; y++) for (let x = 0; x < box.cw; x++) cur[y * box.cw + x] = m[(y + box.y) * SIZE + x + box.x];
    if (ema) for (let i = 0; i < cur.length; i++) ema[i] = ema[i] * 0.35 + cur[i] * 0.65;
    else ema = cur;
    const gray = new Uint8Array(cur.length);
    // 32 levels are plenty for a soft edge and compress ~2× better
    for (let i = 0; i < cur.length; i++) gray[i] = Math.min(255, Math.round(shape(ema[i]) * 31) * 8.226) | 0;
    frames.push(zlib.deflateRawSync(gray, { level: 6 }));
    onProgress?.(frames.length, total);
  };
  for await (const chunk of ff.stdout as AsyncIterable<Buffer>) {
    pending = (pending.length ? Buffer.concat([pending, chunk]) : chunk) as Buffer;
    while (pending.length >= frameBytes) {
      const raw = pending.subarray(0, frameBytes);
      pending = pending.subarray(frameBytes) as Buffer;
      await handle(Buffer.from(raw));
    }
  }
  const code: number = await new Promise((r) => (ff.exitCode !== null ? r(ff.exitCode) : ff.on("close", r)));
  if (code !== 0) throw new Error(`Segmentacja: FFmpeg ${code}: ${err.slice(-500)}`);
  if (!frames.length) throw new Error("Segmentacja: brak klatek");
  return encodeMaskFile(box.cw, box.ch, MASK_FPS, frames);
}

/** Worker job: mask for one recording asset, stored once (asset meta.maskAssetId). */
export async function segmentAsset(assetId: string): Promise<{ maskAssetId: string }> {
  const asset = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: assetId } });
  const meta = (asset.meta ?? {}) as Record<string, unknown>;
  if (typeof meta.maskAssetId === "string" && (await prisma.mediaAsset.findUnique({ where: { id: meta.maskAssetId } }))) return { maskAssetId: meta.maskAssetId };
  const src = await toLocalFile(asset.storageKey);
  const dir = await makeTempDir("mask");
  try {
    const data = await segmentVideoFile(src.path);
    const out = path.join(dir, "mask.amsk");
    await fsp.writeFile(out, data);
    const key = asset.storageKey.replace(/\.[a-z0-9]+$/i, "") + ".mask.amsk";
    const size = await putFile(key, out, "application/octet-stream");
    const mask = await prisma.mediaAsset.create({
      data: { kind: "SEGMENTATION_MASK", projectId: asset.projectId, storageKey: key, mimeType: "application/octet-stream", sizeBytes: size, durationSec: asset.durationSec, hasAudio: false, hasVideo: false, meta: { sourceAssetId: asset.id, fps: MASK_FPS } },
    });
    await prisma.mediaAsset.update({ where: { id: asset.id }, data: { meta: { ...meta, maskAssetId: mask.id } } });
    return { maskAssetId: mask.id };
  } finally {
    await src.cleanup();
    await fsp.rm(dir, { recursive: true, force: true });
  }
}
