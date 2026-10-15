import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { deleteAssets } from "@/lib/server/assets";

export const GET = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireAdmin();
  const { id } = await ctx.params;
  const t = await prisma.recordingTake.findUniqueOrThrow({ where: { id }, include: { transcript: { include: { _count: { select: { words: true } } } }, compositions: { select: { id: true } }, silences: true } });
  const assets = await prisma.mediaAsset.findMany({ where: { id: { in: [t.originalAssetId, t.normalizedAssetId, t.analysisAssetId, t.narrationAssetId].filter(Boolean) as string[] } }, select: { id: true, kind: true, durationSec: true, width: true, height: true, hasAudio: true, sizeBytes: true } });
  return json({
    id: t.id,
    takeNumber: t.takeNumber,
    status: t.status,
    mode: t.mode,
    markers: t.markers,
    durationSec: t.durationSec,
    processingStep: t.processingStep,
    processingError: t.processingError,
    transcriptionError: t.transcriptionError,
    transcriptWords: t.transcript?._count.words ?? 0,
    transcriptModel: t.transcript?.model ?? null,
    silences: t.silences.map((s) => ({ start: s.start, end: s.end })),
    compositionIds: t.compositions.map((c) => c.id),
    assets,
  });
});

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
