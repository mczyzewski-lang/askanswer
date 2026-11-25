import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { applyExplainers } from "@/lib/server/sequence";

/** Put the explainers that were uploaded since the last time into the films (as layers at their moments). */
export const POST = route(async (_req: Request, ctx: { params: Promise<{ projectId: string }> }) => {
  await requireAdmin();
  const { projectId } = await ctx.params;
  return json(await applyExplainers(projectId));
});
