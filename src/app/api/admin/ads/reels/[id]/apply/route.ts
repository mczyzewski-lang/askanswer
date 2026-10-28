import { z } from "zod";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { applyReview } from "@/lib/server/ads";

/** Swap the reel's script for the proposal (whole new version, or one alternative hook). */
export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireAdmin();
  const { id } = await ctx.params;
  const b = z.union([z.object({ mode: z.literal("all") }), z.object({ mode: z.literal("hook"), text: z.string().trim().min(2).max(2000) })]).parse(await req.json());
  return json(await applyReview(id, b));
});
