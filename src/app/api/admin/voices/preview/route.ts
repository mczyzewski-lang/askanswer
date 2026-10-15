import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { ensureNarration } from "@/lib/server/narration";
import { elevenLabsConfigured, env } from "@/lib/server/env";
import { signedUrl } from "@/lib/server/storage";
import { ElevenLabsError } from "@/lib/server/elevenlabs";
import { rateLimit } from "@/lib/server/ratelimit";

const SAMPLE = "Dzień dobry! Tak brzmi ten głos. Dlaczego warto zastrzec znak towarowy?";

/**
 * Polish voice sample for choosing a narrator. Cached per voice+model (generated once),
 * so listening again costs nothing.
 */
export const POST = route(async (req: Request) => {
  const user = await requireAdmin();
  if (!elevenLabsConfigured()) return json({ error: "Podgląd głosu wymaga konfiguracji ElevenLabs (ELEVENLABS_API_KEY)." }, 503);
  if (!rateLimit(`voice-preview:${user.id}`, { capacity: 20, perMinute: 20 })) return json({ error: "Zbyt wiele żądań — spróbuj za chwilę." }, 429);
  const body = z.object({ voiceId: z.string().max(100).optional().nullable(), modelId: z.string().max(100).optional().nullable(), text: z.string().trim().min(3).max(300).optional() }).parse(await req.json());
  try {
    const assetId = await ensureNarration(body.text || SAMPLE, { voiceId: body.voiceId || env.defaultVoiceId, modelId: body.modelId || env.ttsModel });
    const a = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: assetId } });
    return json({ url: await signedUrl(a.storageKey, { ttlSec: 3600 }) });
  } catch (e) {
    if (e instanceof ElevenLabsError) return json({ error: e.message }, 502);
    throw e;
  }
});
