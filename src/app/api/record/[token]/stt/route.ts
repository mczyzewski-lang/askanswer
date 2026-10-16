import { json, route } from "@/lib/server/http";
import { resolveToken } from "@/lib/server/invitations";
import { elevenLabsConfigured } from "@/lib/server/env";
import { rateLimit } from "@/lib/server/ratelimit";
import { ElevenLabsError, realtimeSttSession } from "@/lib/server/elevenlabs";

/** Teleprompter voice follow: a one-off Scribe v2 Realtime connection URL for this recording link. */
export const POST = route(async (_req: Request, ctx: { params: Promise<{ token: string }> }) => {
  const { token } = await ctx.params;
  const inv = await resolveToken(token);
  if (inv.project.format !== "PROMPTER") return json({ error: "Prompter nie jest włączony w tym projekcie." }, 400);
  if (!elevenLabsConfigured()) return json({ error: "Śledzenie głosu wymaga ElevenLabs — prompter przewija się w stałym tempie.", code: "not_configured" }, 503);
  if (!rateLimit(`stt-rt:${inv.id}`, { capacity: 30, perMinute: 15 })) return json({ error: "Zbyt wiele żądań — spróbuj za chwilę." }, 429);
  try {
    return json(await realtimeSttSession());
  } catch (e) {
    if (e instanceof ElevenLabsError) return json({ error: e.message, code: "stt_failed" }, 502);
    throw e;
  }
});
