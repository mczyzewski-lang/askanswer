import { z } from "zod";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/ratelimit";
import { draftVisual } from "@/lib/server/broll-draft";

/** A video prompt / infographic content written from the passage at a clicked moment. */
export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireAdmin();
  const { id } = await ctx.params;
  const b = z.object({ kind: z.enum(["video", "infographic"]), passage: z.string().max(6000).default(""), focus: z.string().max(2000).default("") }).parse(await req.json());
  if (!rateLimit(`broll-draft:${user.id}`, { capacity: 20, perMinute: 10 })) return json({ error: "Zbyt wiele zapytań — spróbuj za chwilę." }, 429);
  return json(await draftVisual(id, b));
});
