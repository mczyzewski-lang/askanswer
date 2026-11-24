import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { sequenceData } from "@/lib/server/sequence";

export const GET = route(async (_req: Request, ctx: { params: Promise<{ projectId: string }> }) => {
  await requireAdmin();
  const { projectId } = await ctx.params;
  return json(await sequenceData(projectId));
});
