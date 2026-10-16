import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { enqueue } from "@/lib/server/jobs";

/** Re-queue every failed recording of the project (e.g. after freeing disk space). */
export const POST = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireAdmin();
  const { id } = await ctx.params;
  const takes = await prisma.recordingTake.findMany({ where: { status: "FAILED", originalAssetId: { not: null }, recording: { projectId: id } }, select: { id: true } });
  for (const t of takes) {
    await prisma.recordingTake.update({ where: { id: t.id }, data: { status: "UPLOADED", processingError: null, processingStep: "W kolejce do przetworzenia" } });
    await enqueue("process-take", { takeId: t.id }, { idempotencyKey: `process:${t.id}:${Date.now()}` });
  }
  return json({ requeued: takes.length });
});
