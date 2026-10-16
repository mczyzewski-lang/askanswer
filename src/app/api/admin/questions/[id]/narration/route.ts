import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { questionNarration } from "@/lib/server/narration";
import { elevenLabsConfigured } from "@/lib/server/env";
import { signedUrl } from "@/lib/server/storage";
import { ElevenLabsError } from "@/lib/server/elevenlabs";
import { rateLimit } from "@/lib/server/ratelimit";

/** Preview (and cache) the ElevenLabs narration of a question. */
export const POST = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireAdmin();
  const { id } = await ctx.params;
  if (!elevenLabsConfigured()) return json({ error: "Lektor wymaga konfiguracji ElevenLabs (ELEVENLABS_API_KEY).", code: "not_configured" }, 503);
  if (!rateLimit(`tts-admin:${user.id}`, { capacity: 30, perMinute: 30 })) return json({ error: "Zbyt wiele żądań" }, 429);
  const q = await prisma.question.findUniqueOrThrow({ where: { id }, include: { project: true } });
  try {
    const assetId = await questionNarration(q.project, q);
    const a = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: assetId } });
    return json({ assetId, url: await signedUrl(a.storageKey), duration: a.durationSec });
  } catch (e) {
    if (e instanceof ElevenLabsError) return json({ error: e.message }, 502);
    throw e;
  }
});
