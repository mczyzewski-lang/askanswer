import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { deleteAssets } from "@/lib/server/assets";

/** Permanently delete a take: original + derived media, transcript and its compositions. */
export const DELETE = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireAdmin();
  const { id } = await ctx.params;
  const take = await prisma.recordingTake.findUniqueOrThrow({ where: { id }, include: { recording: true } });
  await prisma.videoComposition.deleteMany({ where: { takeId: id } });
  await prisma.recordingTake.delete({ where: { id } });
  await deleteAssets([take.originalAssetId, take.normalizedAssetId, take.analysisAssetId]);
  if (take.recording.selectedTakeId === id) {
    const other = await prisma.recordingTake.findFirst({ where: { recordingId: take.recordingId }, orderBy: { takeNumber: "desc" } });
    await prisma.recording.update({ where: { id: take.recordingId }, data: { selectedTakeId: other?.id ?? null } });
    if (!other) await prisma.question.update({ where: { id: take.recording.questionId }, data: { status: "TO_RECORD" } });
  }
  return json({ ok: true });
});
