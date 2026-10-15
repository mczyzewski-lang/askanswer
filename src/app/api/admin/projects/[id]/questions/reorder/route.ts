import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";

export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireAdmin();
  const { id: projectId } = await ctx.params;
  const { ids } = z.object({ ids: z.array(z.string()).max(1000) }).parse(await req.json());
  await prisma.$transaction(ids.map((id, order) => prisma.question.updateMany({ where: { id, projectId }, data: { order } })));
  return json({ ok: true });
});
