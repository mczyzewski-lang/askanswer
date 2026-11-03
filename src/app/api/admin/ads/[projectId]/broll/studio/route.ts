import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { brollStudio } from "@/lib/server/ads";

/** Open (or create) the Studio edit where the campaign's B-roll videos are cut into cutaways. */
export const POST = route(async (_req: Request, ctx: { params: Promise<{ projectId: string }> }) => {
  await requireAdmin();
  const { projectId } = await ctx.params;
  return json({ compositionId: await brollStudio(projectId) });
});
