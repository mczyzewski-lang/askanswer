import { prisma } from "./db";
import { deleteAssets } from "./assets";

/**
 * Delete questions together with their recordings' files (original, normalized + preview proxy,
 * person mask, speech audio) so the volume does not fill up with orphans. Narration audio is
 * shared through the TTS cache and stays.
 */
export async function deleteQuestions(projectId: string, ids: string[]): Promise<number> {
  const qs = await prisma.question.findMany({
    where: { id: { in: ids }, projectId },
    select: { id: true, recording: { select: { takes: { select: { originalAssetId: true, normalizedAssetId: true, analysisAssetId: true } } } } },
  });
  const assets = qs.flatMap((q) => (q.recording?.takes ?? []).flatMap((t) => [t.normalizedAssetId, t.originalAssetId, t.analysisAssetId]));
  // rows first (takes and compositions cascade), then the files they pointed to
  const r = await prisma.question.deleteMany({ where: { id: { in: qs.map((q) => q.id) } } });
  await deleteAssets(assets).catch(() => {});
  return r.count;
}
