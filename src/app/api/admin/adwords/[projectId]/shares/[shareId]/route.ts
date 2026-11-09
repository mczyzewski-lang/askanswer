import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";

/** revoke a link — it stops working at once */
export const DELETE = route(async (_req: Request, ctx: { params: Promise<{ projectId: string; shareId: string }> }) => {
  await requireAdmin();
  const { projectId, shareId } = await ctx.params;
  await prisma.adwordsShare.updateMany({ where: { id: shareId, projectId, revokedAt: null }, data: { revokedAt: new Date() } });
  return json({ ok: true });
});
