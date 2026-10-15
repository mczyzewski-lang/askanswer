import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { ensureNarration } from "@/lib/server/narration";
import { assetInfo } from "@/lib/server/assets";
import { elevenLabsConfigured } from "@/lib/server/env";
import { ElevenLabsError } from "@/lib/server/elevenlabs";
import { rateLimit } from "@/lib/server/ratelimit";

/** Regenerate the question narration with another voice (cached per text+voice). */
export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireAdmin();
  const { id } = await ctx.params;
  if (!elevenLabsConfigured()) return json({ error: "Lektor wymaga konfiguracji ElevenLabs (ELEVENLABS_API_KEY)." }, 503);
  if (!rateLimit(`tts-admin:${user.id}`, { capacity: 30, perMinute: 30 })) return json({ error: "Zbyt wiele żądań" }, 429);
  const { voiceId, text, modelId } = z.object({ voiceId: z.string().min(1).max(100), text: z.string().min(1).max(1000).optional(), modelId: z.string().max(100).optional().nullable() }).parse(await req.json());
  const comp = await prisma.videoComposition.findUniqueOrThrow({ where: { id }, include: { question: true, project: true } });
  const t = text ?? comp.question?.text;
  if (!t) return json({ error: "Brak tekstu pytania" }, 400);
  try {
    const assetId = await ensureNarration(t, { voiceId, modelId: modelId || comp.project.ttsModel, projectId: comp.projectId });
    return json(await assetInfo(assetId));
  } catch (e) {
    if (e instanceof ElevenLabsError) return json({ error: e.message }, 502);
    throw e;
  }
});
