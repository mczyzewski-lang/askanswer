import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";

/** Link a historical component to a new concept — the source of a hypothesis, not a cause. */
export const PATCH = route(async (req: Request, ctx: { params: Promise<{ projectId: string; rowId: string }> }) => {
  await requireAdmin();
  const { projectId, rowId } = await ctx.params;
  const { conceptId } = z.object({ conceptId: z.string().trim().max(80).nullable() }).parse(await req.json());
  await prisma.adwordsHistoryRow.updateMany({ where: { id: rowId, projectId }, data: { conceptId: conceptId || null } });
  return json({ ok: true });
});
