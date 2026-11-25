import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { applyExplainers, sequenceData } from "@/lib/server/sequence";

export const GET = route(async (req: Request, ctx: { params: Promise<{ projectId: string }> }) => {
  await requireAdmin();
  const { projectId } = await ctx.params;
  // films whose clips arrived after their manifest (and explainers after their films) settle on the way
  await applyExplainers(projectId).catch(() => null);
  return json(await sequenceData(projectId, new URL(req.url).searchParams.get("kind") === "testimonial" ? "testimonial" : "sequence"));
});
