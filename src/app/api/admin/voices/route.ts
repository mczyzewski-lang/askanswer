import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { listVoices, ElevenLabsError } from "@/lib/server/elevenlabs";
import { elevenLabsConfigured, env } from "@/lib/server/env";

let cache: { at: number; data: unknown } | null = null;

export const GET = route(async () => {
  await requireAdmin();
  if (!elevenLabsConfigured()) return json({ configured: false, voices: [], defaultVoiceId: env.defaultVoiceId, model: env.ttsModel });
  if (cache && Date.now() - cache.at < 10 * 60_000) return json(cache.data);
  try {
    const voices = await listVoices();
    const data = { configured: true, defaultVoiceId: env.defaultVoiceId, model: env.ttsModel, voices: voices.map((v) => ({ id: v.voice_id, name: v.name, labels: v.labels ?? {}, previewUrl: v.preview_url ?? null })) };
    cache = { at: Date.now(), data };
    return json(data);
  } catch (e) {
    if (e instanceof ElevenLabsError) return json({ configured: true, error: e.message, voices: [], defaultVoiceId: env.defaultVoiceId, model: env.ttsModel });
    throw e;
  }
});
