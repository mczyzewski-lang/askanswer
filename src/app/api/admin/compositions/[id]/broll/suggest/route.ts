import { z } from "zod";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/ratelimit";
import { suggestBroll } from "@/lib/server/broll";

const Body = z.object({
  duration: z.number().min(0.5).max(3600),
  segments: z.array(z.object({ t0: z.number().min(0), t1: z.number().min(0), text: z.string().max(2000) })).max(2000),
});

/** AI proposals: where to cut away to generated B-roll, and what to generate (based on what the expert says). */
export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireAdmin();
  const { id } = await ctx.params;
  const body = Body.parse(await req.json());
  if (!rateLimit(`broll-suggest:${user.id}`, { capacity: 10, perMinute: 6 })) return json({ error: "Zbyt wiele żądań — spróbuj za chwilę." }, 429);
  try {
    return json(await suggestBroll(id, body.segments, body.duration));
  } catch (e) {
    return json({ error: (e as Error).message }, 502);
  }
});
