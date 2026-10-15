/**
 * "Ulepsz głos" — podcast-style voice enhancement that keeps the speaker's own voice.
 *  - podcast: FFmpeg mastering (high-pass, gentle denoise, de-mud/presence EQ, compression, -16 LUFS)
 *  - isolator: ElevenLabs Voice Isolator (noise/echo removal) followed by the same mastering
 * The result is a separate audio asset with exactly the source's duration, so it can
 * replace the clip audio without changing any edit or subtitle timing. The original is untouched.
 */
import fsp from "node:fs/promises";
import path from "node:path";
import { prisma } from "./db";
import { makeTempDir, putFile, toLocalFile } from "./storage";
import { probe, run } from "./ffmpeg";
import { env } from "./env";
import { isolateVoice } from "./elevenlabs";

export type EnhanceMode = "podcast" | "isolator";
export type EnhanceStrength = "natural" | "podcast" | "radio";

/**
 * Broadcast-style voice chain. Order matters: denoise BEFORE compression/loudness so the
 * noise floor is not pumped up, de-mud/presence/air EQ, de-esser, compression, loudness
 * normalisation to -16 LUFS, then a soft downward expander that keeps pauses quiet
 * (range = how much the room is turned down between phrases — never full silence).
 */
const STRENGTH: Record<EnhanceStrength, { nr: number; mud: number; presence: number; air: number; ratio: number; range: number }> = {
  natural: { nr: 12, mud: -2, presence: 2, air: 1.5, ratio: 2.5, range: 0.3 },
  podcast: { nr: 24, mud: -3, presence: 3.5, air: 2.5, ratio: 4, range: 0.08 },
  radio: { nr: 30, mud: -4, presence: 5, air: 3.5, ratio: 6, range: 0.05 },
};

export function masteringChain(strength: EnhanceStrength): string {
  const s = STRENGTH[strength];
  return [
    "highpass=f=90",
    "lowpass=f=12500",
    `afftdn=nr=${s.nr}:nf=-32:tn=1`,
    `equalizer=f=300:t=q:w=1.0:g=${s.mud}`,
    "lowshelf=f=120:g=1.5",
    `equalizer=f=3500:t=q:w=1.2:g=${s.presence}`,
    `highshelf=f=9000:g=${s.air}`,
    "deesser=i=0.4",
    `acompressor=threshold=-24dB:ratio=${s.ratio}:attack=5:release=120:makeup=2`,
    "loudnorm=I=-16:TP=-1.5:LRA=7",
    `agate=threshold=0.015:ratio=4:attack=3:release=220:range=${s.range}`,
    "alimiter=limit=0.89",
  ].join(",");
}

// v3: lossless FLAC output — plays in every browser and has no encoder delay (exact lip sync)
const CHAIN_VERSION = "v3";

export async function enhanceAudio(sourceAssetId: string, mode: EnhanceMode, strength: EnhanceStrength = "podcast"): Promise<string> {
  const src = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: sourceAssetId } });
  const meta = (src.meta ?? {}) as Record<string, unknown> & { enhanced?: Record<string, string> };
  // cache per mode + strength + chain version (older, weaker versions are never reused)
  const cacheKey = `${mode}:${strength}:${CHAIN_VERSION}`;
  const cached = meta.enhanced?.[cacheKey];
  if (cached && (await prisma.mediaAsset.findUnique({ where: { id: cached } }))) return cached;
  if (!src.hasAudio) throw new Error("To nagranie nie ma ścieżki dźwiękowej");
  const duration = src.durationSec ?? (await probe((await toLocalFile(src.storageKey)).path)).duration;

  const dir = await makeTempDir("enhance");
  const local = await toLocalFile(src.storageKey);
  try {
    let input = local.path;
    if (mode === "isolator") {
      const mp3 = path.join(dir, "in.mp3");
      await run(env.ffmpeg, ["-hide_banner", "-y", "-i", local.path, "-vn", "-ac", "1", "-ar", "44100", "-c:a", "libmp3lame", "-b:a", "192k", mp3]);
      const iso = path.join(dir, "isolated.mp3");
      await fsp.writeFile(iso, await isolateVoice(mp3));
      input = iso;
    }
    const out = path.join(dir, "enhanced.flac");
    // pad/trim to the exact source duration so every edit decision keeps its timing
    await run(env.ffmpeg, [
      "-hide_banner", "-y", "-i", input, "-vn",
      "-af", `${masteringChain(strength)},aresample=48000,apad,atrim=0:${duration.toFixed(3)}`,
      "-ac", "1", "-ar", "48000", "-c:a", "flac", "-compression_level", "8", out,
    ]);
    const key = `projects/${src.projectId ?? "shared"}/enhanced/${src.id}-${mode}-${strength}-${CHAIN_VERSION}.flac`;
    const size = await putFile(key, out, "audio/flac");
    const asset = await prisma.mediaAsset.upsert({
      where: { storageKey: key },
      create: { kind: "AUDIO_ENHANCED", projectId: src.projectId, storageKey: key, mimeType: "audio/flac", sizeBytes: size, durationSec: duration, hasAudio: true, meta: { sourceAssetId: src.id, mode, strength } },
      update: { sizeBytes: size, durationSec: duration },
    });
    await prisma.mediaAsset.update({ where: { id: src.id }, data: { meta: { ...meta, enhanced: { ...(meta.enhanced ?? {}), [cacheKey]: asset.id } } } });
    return asset.id;
  } finally {
    await local.cleanup();
    await fsp.rm(dir, { recursive: true, force: true });
  }
}
