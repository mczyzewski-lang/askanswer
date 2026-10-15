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

const MASTERING = [
  "highpass=f=80",
  "lowpass=f=14000",
  "afftdn=nr=10:nf=-40:tn=1",
  "equalizer=f=250:t=q:w=1.2:g=-2",
  "equalizer=f=3200:t=q:w=1.0:g=2.5",
  "acompressor=threshold=-21dB:ratio=3:attack=8:release=180:makeup=3",
  "loudnorm=I=-16:TP=-1.5:LRA=9",
].join(",");

export async function enhanceAudio(sourceAssetId: string, mode: EnhanceMode): Promise<string> {
  const src = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: sourceAssetId } });
  const meta = (src.meta ?? {}) as Record<string, unknown> & { enhanced?: Record<string, string> };
  const cached = meta.enhanced?.[mode];
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
    const out = path.join(dir, "enhanced.m4a");
    // pad/trim to the exact source duration so every edit decision keeps its timing
    await run(env.ffmpeg, [
      "-hide_banner", "-y", "-i", input, "-vn",
      "-af", `${MASTERING},aresample=48000,apad,atrim=0:${duration.toFixed(3)}`,
      "-ac", "2", "-ar", "48000", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", out,
    ]);
    const key = `projects/${src.projectId ?? "shared"}/enhanced/${src.id}-${mode}.m4a`;
    const size = await putFile(key, out, "audio/mp4");
    const asset = await prisma.mediaAsset.upsert({
      where: { storageKey: key },
      create: { kind: "AUDIO_ENHANCED", projectId: src.projectId, storageKey: key, mimeType: "audio/mp4", sizeBytes: size, durationSec: duration, hasAudio: true, meta: { sourceAssetId: src.id, mode } },
      update: { sizeBytes: size, durationSec: duration },
    });
    await prisma.mediaAsset.update({ where: { id: src.id }, data: { meta: { ...meta, enhanced: { ...(meta.enhanced ?? {}), [mode]: asset.id } } } });
    return asset.id;
  } finally {
    await local.cleanup();
    await fsp.rm(dir, { recursive: true, force: true });
  }
}
