import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";

export const POST = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireAdmin();
  const { id } = await ctx.params;
  const q = await prisma.question.findUniqueOrThrow({ where: { id } });
  const copy = await prisma.$transaction(async (tx) => {
    await tx.question.updateMany({ where: { projectId: q.projectId, order: { gt: q.order } }, data: { order: { increment: 1 } } });
    return tx.question.create({
      data: { projectId: q.projectId, categoryId: q.categoryId, expertId: q.expertId, text: `${q.text}`, script: q.script, instructions: q.instructions, maxDurationSec: q.maxDurationSec, order: q.order + 1 },
    });
  });
  return json(copy, 201);
});
