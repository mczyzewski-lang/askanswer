import { prisma } from "./db";
import { sha256 } from "./crypto";
import { env } from "./env";
import { synthesize, ttsCacheKey } from "./elevenlabs";
import { putBuffer, makeTempDir } from "./storage";
import { probe } from "./ffmpeg";
import fsp from "node:fs/promises";
import path from "node:path";

const inflight = new Map<string, Promise<string>>();

/**
 * Get (or generate once) the ElevenLabs narration for a text. Identical
 * text+voice+model combinations are cached by content hash, so repeated
 * playback never pays for synthesis twice. Returns the MediaAsset id.
 */
export async function ensureNarration(text: string, opts: { voiceId?: string | null; modelId?: string | null; projectId?: string | null } = {}): Promise<string> {
  const params = { text: text.trim(), voiceId: opts.voiceId || env.defaultVoiceId, modelId: opts.modelId || env.ttsModel };
  const hash = sha256(ttsCacheKey(params));
  const cached = await prisma.mediaAsset.findUnique({ where: { contentHash: hash } });
  if (cached) return cached.id;
  const running = inflight.get(hash);
  if (running) return running;
  const p = (async () => {
    const audio = await synthesize(params);
    const key = `narration/${hash.slice(0, 2)}/${hash}.mp3`;
    const size = await putBuffer(key, audio, "audio/mpeg");
    const dir = await makeTempDir("tts");
    let duration = 0;
    try {
      const f = path.join(dir, "a.mp3");
      await fsp.writeFile(f, audio);
      duration = (await probe(f)).duration;
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
    const asset = await prisma.mediaAsset.upsert({
      where: { contentHash: hash },
      create: {
        kind: "NARRATION",
        projectId: opts.projectId ?? null,
        storageKey: key,
        mimeType: "audio/mpeg",
        sizeBytes: size,
        durationSec: duration,
        hasAudio: true,
        contentHash: hash,
        meta: { voiceId: params.voiceId, modelId: params.modelId, text: params.text },
      },
      update: {},
    });
    return asset.id;
  })();
  inflight.set(hash, p);
  try {
    return await p;
  } finally {
    inflight.delete(hash);
  }
}
