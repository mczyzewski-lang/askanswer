import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";

export const DELETE = route(async (_req: Request, ctx: { params: Promise<{ projectId: string; importId: string }> }) => {
  await requireAdmin();
  const { projectId, importId } = await ctx.params;
  await prisma.adwordsHistoryImport.deleteMany({ where: { id: importId, projectId } });
  return json({ ok: true });
});
