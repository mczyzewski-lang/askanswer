import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";

/**
 * Lightweight change feed for the admin UI: a `version` fingerprint of recordings/questions
 * (any change → the page refreshes itself) and recordings uploaded since `since` (→ notification).
 */
export const GET = route(async (req: Request) => {
  await requireAdmin();
  const now = new Date();
  const sinceParam = new URL(req.url).searchParams.get("since");
  const since = sinceParam ? new Date(sinceParam) : null;

  const [takes, questions] = await Promise.all([
    prisma.recordingTake.aggregate({ _count: true, _max: { updatedAt: true } }),
    prisma.question.aggregate({ _count: true, _max: { updatedAt: true } }),
  ]);
  const version = [takes._count, takes._max.updatedAt?.getTime() ?? 0, questions._count, questions._max.updatedAt?.getTime() ?? 0].join(":");

  let uploads: Array<{ takeId: string; projectId: string; projectName: string; questionText: string; expertName: string; takeNumber: number }> = [];
  if (since && !Number.isNaN(since.getTime())) {
    // an upload is complete once its original file asset exists and is linked to the take;
    // the window overlaps the previous poll (clients de-duplicate by takeId) so a take linked
    // just after its asset was created is not missed
    const assets = await prisma.mediaAsset.findMany({
      where: { kind: "RECORDING_ORIGINAL", createdAt: { gt: new Date(since.getTime() - 20_000), lte: now } },
      select: { id: true },
      take: 20,
    });
    if (assets.length) {
      const rows = await prisma.recordingTake.findMany({
        where: { originalAssetId: { in: assets.map((a) => a.id) }, status: { not: "UPLOADING" } },
        include: { recording: { include: { question: { select: { text: true } }, project: { select: { id: true, name: true } }, expert: { select: { name: true } } } } },
        orderBy: { createdAt: "asc" },
      });
      uploads = rows.map((t) => ({
        takeId: t.id,
        projectId: t.recording.project.id,
        projectName: t.recording.project.name,
        questionText: t.recording.question.text,
        expertName: t.recording.expert.name,
        takeNumber: t.takeNumber,
      }));
    }
  }
  return json({ now: now.toISOString(), version, uploads });
});
