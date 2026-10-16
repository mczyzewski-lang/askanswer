import { spawn } from "node:child_process";
import fsp from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import { prisma } from "./db";
import { env } from "./env";
import { probe } from "./ffmpeg";
import { deleteObject, makeTempDir, putFile, toLocalFile } from "./storage";
import { encodeMaskFile, MASK_VERSION } from "../render/mask-format";

/**
 * Person segmentation for background blur. MediaPipe Selfie Segmenter (Apache 2.0) converted to ONNX
 * (models/selfie_segmenter.onnx, see models/README.md), run with onnxruntime-node on the CPU.
 *
 * The model only sees 256×256, so its raw mask is blocky at 1080p. Like video-call apps, the mask
 * is refined against the real picture: upsampled to ~640 px and passed through a guided filter
 * (He et al.) with the frame's luminance as the guide, so the edge follows hair and shoulders
 * instead of the model's pixel grid. 30 masks/s with motion-aware smoothing: steady edges don't
 * flicker, moving ones don't lag behind the person.
 */
const MODEL = path.resolve(process.cwd(), "models/selfie_segmenter.onnx");
const SIZE = 256;
export const MASK_FPS = 30;
/** long side of the stored (refined) mask */
const MASK_LONG = 640;

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

/** Size of the refined mask (and of the guide frame): long side MASK_LONG, even, never upscaled. */
export function maskSize(w: number, h: number) {
  const k = Math.min(1, MASK_LONG / Math.max(w, h));
  return { gw: Math.max(16, Math.round((w * k) / 2) * 2), gh: Math.max(16, Math.round((h * k) / 2) * 2) };
}

/** Soft threshold: removes the low-confidence haze, keeps a narrow anti-aliased edge. */
function shape(p: number) {
  const t = Math.min(1, Math.max(0, (p - 0.3) / 0.45));
  return t * t * (3 - 2 * t);
}

/** Separable box mean with radius r (edges clamped), in place via tmp. */
function boxMean(src: Float32Array, w: number, h: number, r: number, out: Float32Array, tmp: Float32Array) {
  const n = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let s = 0;
    for (let k = -r; k <= r; k++) s += src[row + Math.min(w - 1, Math.max(0, k))];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = s / n;
      s += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let k = -r; k <= r; k++) s += tmp[Math.min(h - 1, Math.max(0, k)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = s / n;
      s += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
}

/** Guided filter: refines `p` (coarse mask) so its edges follow the edges of guide `I`. */
export function guidedFilter(I: Float32Array, p: Float32Array, w: number, h: number, r: number, eps: number): Float32Array {
  const N = w * h;
  const tmp = new Float32Array(N);
  const mI = new Float32Array(N);
  const mP = new Float32Array(N);
  const mIP = new Float32Array(N);
  const mII = new Float32Array(N);
  const prod = new Float32Array(N);
  boxMean(I, w, h, r, mI, tmp);
  boxMean(p, w, h, r, mP, tmp);
  for (let i = 0; i < N; i++) prod[i] = I[i] * p[i];
  boxMean(prod, w, h, r, mIP, tmp);
  for (let i = 0; i < N; i++) prod[i] = I[i] * I[i];
  boxMean(prod, w, h, r, mII, tmp);
  // a, b per window (reuse buffers: mIP → a, mII → b)
  for (let i = 0; i < N; i++) {
    const varI = mII[i] - mI[i] * mI[i];
    const a = (mIP[i] - mI[i] * mP[i]) / (varI + eps);
    mIP[i] = a;
    mII[i] = mP[i] - a * mI[i];
  }
  boxMean(mIP, w, h, r, mI, tmp);
  boxMean(mII, w, h, r, mP, tmp);
  const q = new Float32Array(N);
  for (let i = 0; i < N; i++) q[i] = mI[i] * I[i] + mP[i];
  return q;
}

/** Bilinear resample of a w×h float image to W×H (pixel centres aligned). */
export function resize(src: Float32Array, w: number, h: number, W: number, H: number): Float32Array {
  const out = new Float32Array(W * H);
  const sx = w / W;
  const sy = h / H;
  for (let y = 0; y < H; y++) {
    const fy = Math.min(h - 1, Math.max(0, (y + 0.5) * sy - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(h - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < W; x++) {
      const fx = Math.min(w - 1, Math.max(0, (x + 0.5) * sx - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(w - 1, x0 + 1);
      const tx = fx - x0;
      const a = src[y0 * w + x0] * (1 - tx) + src[y0 * w + x1] * tx;
      const b = src[y1 * w + x0] * (1 - tx) + src[y1 * w + x1] * tx;
      out[y * W + x] = a * (1 - ty) + b * ty;
    }
  }
  return out;
}

/** One frame: coarse model mask (cw×ch, 0..1) + guide luminance (gw×gh, 0..1) → refined 8-bit mask. */
export function refineMask(coarse: Float32Array, cw: number, ch: number, luma: Float32Array, gw: number, gh: number): Uint8Array {
  const up = resize(coarse, cw, ch, gw, gh);
  const r = Math.max(2, Math.round(Math.max(gw, gh) / 64));
  const q = guidedFilter(luma, up, gw, gh, r, 0.004);
  const out = new Uint8Array(gw * gh);
  // away from the edge the filter returns the mask unchanged (flat input), so it applies everywhere
  // 64 levels: invisible on a soft edge, but the masks compress much better
  for (let i = 0; i < out.length; i++) out[i] = Math.round(Math.round(shape(q[i]) * 63) * 4.0477);
  return out;
}

/**
 * Temporal stabilisation of the refined mask: small frame-to-frame differences (sensor noise,
 * compression, the guided filter reacting to them) are pulled towards the previous frame, so a
 * still edge stays still; real movement (big differences) passes through at once, without lag.
 */
export function stabilize(cur: Uint8Array, prev: Uint8Array) {
  for (let i = 0; i < cur.length; i++) {
    const d = Math.abs(cur[i] - prev[i]);
    if (d === 0 || d > 90) continue;
    const keep = 0.7 * (1 - d / 90);
    cur[i] = Math.round(prev[i] * keep + cur[i] * (1 - keep));
  }
}

export async function segmentVideoFile(file: string, onProgress?: (done: number, total: number) => void): Promise<Uint8Array> {
  const info = await probe(file);
  if (!info.hasVideo || !info.width || !info.height) throw new Error("Nagranie nie ma obrazu");
  const { ort, s } = await model();
  const box = contentBox(info.width, info.height);
  const { gw, gh } = maskSize(info.width, info.height);
  const frameBytes = gw * gh * 3;
  const total = Math.max(1, Math.ceil(info.duration * MASK_FPS));
  const ff = spawn(env.ffmpeg, [
    "-hide_banner", "-loglevel", "error", "-i", file, "-an",
    "-vf", `fps=${MASK_FPS},scale=${gw}:${gh}:flags=area,format=rgb24`,
    "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
  ]);
  let err = "";
  ff.stderr.on("data", (d: Buffer) => (err += d.toString()));
  const input = new Float32Array(SIZE * SIZE * 3).fill(0.5);
  const luma = new Float32Array(gw * gh);
  const frames: Uint8Array[] = [];
  let prev: Float32Array | null = null;
  let prevOut: Uint8Array | null = null;
  let pending: Buffer = Buffer.alloc(0);
  const handle = async (raw: Buffer) => {
    for (let i = 0, j = 0; i < luma.length; i++, j += 3) luma[i] = (raw[j] * 0.299 + raw[j + 1] * 0.587 + raw[j + 2] * 0.114) / 255;
    // model input: the frame area-sampled into the letterbox (grey padding)
    const fx = gw / box.cw;
    const fy = gh / box.ch;
    for (let y = 0; y < box.ch; y++) {
      const ya = Math.floor(y * fy);
      const yb = Math.max(ya + 1, Math.min(gh, Math.floor((y + 1) * fy)));
      for (let x = 0; x < box.cw; x++) {
        const xa = Math.floor(x * fx);
        const xb = Math.max(xa + 1, Math.min(gw, Math.floor((x + 1) * fx)));
        let r = 0, g = 0, b = 0, n = 0;
        for (let yy = ya; yy < yb; yy++)
          for (let xx = xa; xx < xb; xx++) {
            const k = (yy * gw + xx) * 3;
            r += raw[k];
            g += raw[k + 1];
            b += raw[k + 2];
            n++;
          }
        const o = ((y + box.y) * SIZE + x + box.x) * 3;
        input[o] = r / n / 255;
        input[o + 1] = g / n / 255;
        input[o + 2] = b / n / 255;
      }
    }
    const out = await s.run({ input: new ort.Tensor("float32", input, [1, SIZE, SIZE, 3]) });
    const m = out.mask.data as Float32Array;
    const cur = new Float32Array(box.cw * box.ch);
    for (let y = 0; y < box.ch; y++) for (let x = 0; x < box.cw; x++) cur[y * box.cw + x] = m[(y + box.y) * SIZE + x + box.x];
    // motion-aware smoothing: blend with the previous mask only where little changed
    if (prev) {
      for (let i = 0; i < cur.length; i++) {
        const d = Math.abs(cur[i] - prev[i]);
        const keep = 0.45 * Math.max(0, 1 - d / 0.25);
        cur[i] = prev[i] * keep + cur[i] * (1 - keep);
      }
    }
    prev = cur;
    const refined = refineMask(cur, box.cw, box.ch, luma, gw, gh);
    if (prevOut) stabilize(refined, prevOut);
    prevOut = refined;
    frames.push(zlib.deflateRawSync(refined, { level: 6 }));
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
  return encodeMaskFile(gw, gh, MASK_FPS, frames);
}

/** Worker job: mask for one recording asset, stored once (asset meta.maskAssetId). */
export async function segmentAsset(assetId: string): Promise<{ maskAssetId: string }> {
  const asset = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: assetId } });
  const meta = (asset.meta ?? {}) as Record<string, unknown>;
  const old = typeof meta.maskAssetId === "string" ? meta.maskAssetId : null;
  if (old && meta.maskVersion === MASK_VERSION && (await prisma.mediaAsset.findUnique({ where: { id: old } }))) return { maskAssetId: old };
  const src = await toLocalFile(asset.storageKey);
  const dir = await makeTempDir("mask");
  try {
    const data = await segmentVideoFile(src.path);
    const out = path.join(dir, "mask.amsk");
    await fsp.writeFile(out, data);
    const key = asset.storageKey.replace(/\.[a-z0-9]+$/i, "") + `.mask${MASK_VERSION}.amsk`;
    const size = await putFile(key, out, "application/octet-stream");
    const mask = await prisma.mediaAsset.create({
      data: { kind: "SEGMENTATION_MASK", projectId: asset.projectId, storageKey: key, mimeType: "application/octet-stream", sizeBytes: size, durationSec: asset.durationSec, hasAudio: false, hasVideo: false, meta: { sourceAssetId: asset.id, fps: MASK_FPS, version: MASK_VERSION } },
    });
    await prisma.mediaAsset.update({ where: { id: asset.id }, data: { meta: { ...meta, maskAssetId: mask.id, maskVersion: MASK_VERSION } } });
    // the previous, coarser mask is no longer needed
    if (old && old !== mask.id) {
      const prevMask = await prisma.mediaAsset.findUnique({ where: { id: old } });
      if (prevMask) {
        await deleteObject(prevMask.storageKey).catch(() => {});
        await prisma.mediaAsset.delete({ where: { id: old } }).catch(() => {});
      }
    }
    return { maskAssetId: mask.id };
  } finally {
    await src.cleanup();
    await fsp.rm(dir, { recursive: true, force: true });
  }
}
