import { z } from "zod";
import { json, route } from "@/lib/server/http";
import { assertQuestionAccess, resolveToken } from "@/lib/server/invitations";
import { questionNarration } from "@/lib/server/narration";
import { narrationUrl } from "@/lib/server/record-session";
import { elevenLabsConfigured } from "@/lib/server/env";
import { rateLimit } from "@/lib/server/ratelimit";
import { ElevenLabsError } from "@/lib/server/elevenlabs";

export const POST = route(async (req: Request, ctx: { params: Promise<{ token: string }> }) => {
  const { token } = await ctx.params;
  const inv = await resolveToken(token);
  const { questionId } = z.object({ questionId: z.string() }).parse(await req.json());
  const q = await assertQuestionAccess(inv, questionId);
  if (!elevenLabsConfigured()) return json({ error: "Lektor ElevenLabs nie jest skonfigurowany.", code: "not_configured" }, 503);
  if (!rateLimit(`tts:${inv.id}`, { capacity: 20, perMinute: 20 })) return json({ error: "Zbyt wiele żądań — spróbuj za chwilę." }, 429);
  try {
    const assetId = await questionNarration(inv.project, q);
    return json({ assetId, ...(await narrationUrl(assetId)) });
  } catch (e) {
    if (e instanceof ElevenLabsError) return json({ error: e.message, code: "tts_failed" }, 502);
    throw e;
  }
});
