import { z } from "zod";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { applyQuestionReview } from "@/lib/server/question-review";

/** Swap the item's text for the proposal (whole new version, or one alternative hook). */
export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireAdmin();
  const { id } = await ctx.params;
  const b = z.union([z.object({ mode: z.literal("all") }), z.object({ mode: z.literal("hook"), text: z.string().trim().min(2).max(2000) })]).parse(await req.json());
  return json(await applyQuestionReview(id, b));
});
