import { prisma } from "./db";
import { signedUrl } from "./storage";
import { elevenLabsConfigured } from "./env";
import { resolveToken } from "./invitations";
import { dailyPlan, startOfDay } from "../daily-plan";

/** Everything the expert recorder needs — limited strictly to questions assigned to this expert. */
export async function recordSession(token: string) {
  const inv = await resolveToken(token);
  await prisma.invitation.update({ where: { id: inv.id }, data: { lastUsedAt: new Date() } });
  const questions = await prisma.question.findMany({
    where: { projectId: inv.projectId, expertId: inv.expertId },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    include: {
      category: true,
      subcategory: true,
      recording: { include: { takes: { where: { status: { not: "UPLOADING" } }, orderBy: { takeNumber: "asc" }, select: { id: true, takeNumber: true, status: true, durationSec: true, createdAt: true } } } },
    },
  });
  // many questions → today's list mixes categories evenly (see lib/daily-plan.ts)
  const dayStart = startOfDay(new Date());
  const plan = dailyPlan(
    questions.map((q) => {
      const takes = q.recording?.takes ?? [];
      return {
        id: q.id,
        categoryKey: q.categoryId ?? "",
        categoryOrder: q.category?.order ?? -1,
        order: q.order,
        recorded: takes.length > 0 && q.status !== "NEEDS_FIX",
        recordedToday: takes.some((t) => t.createdAt >= dayStart),
        needsFix: q.status === "NEEDS_FIX",
      };
    }),
    inv.project.dailyQuestionLimit,
  );
  const byId = new Map(questions.map((q) => [q.id, q]));
  const listed = plan.ids.map((id) => byId.get(id)!).filter(Boolean);
  return {
    project: { id: inv.project.id, name: inv.project.name, description: inv.project.description, mode: inv.project.recordingMode, sequential: inv.project.sequential, format: inv.project.format },
    dailyPlan: plan.applied ? { limit: inv.project.dailyQuestionLimit, pendingTotal: plan.pendingTotal, totalQuestions: questions.length } : null,
    expert: { name: inv.expert.name },
    consentGiven: !!inv.consentAt,
    expiresAt: inv.expiresAt.toISOString(),
    narrationAvailable: elevenLabsConfigured() && inv.project.format !== "PROMPTER",
    voiceFollow: elevenLabsConfigured() && inv.project.format === "PROMPTER",
    theme: inv.project.theme ? { primary: inv.project.theme.primaryColor, accent: inv.project.theme.accentColor, font: inv.project.theme.questionFont } : null,
    questions: listed.map((q) => ({
      id: q.id,
      text: q.text,
      script: q.script,
      instructions: q.instructions,
      maxDurationSec: q.maxDurationSec,
      category: q.category?.name ?? "Ogólne",
      subcategory: q.subcategory?.name ?? null,
      status: q.status,
      takes: q.recording?.takes ?? [],
    })),
    // videos being edited / approved: the expert can watch them (all of them, not only today's list)
    videos: await expertVideos(questions.filter((q) => q.status === "IN_PROGRESS" || q.status === "APPROVED")),
  };
}

/**
 * The film of a question for the expert to watch: the latest exported MP4 when there is one,
 * otherwise the recording itself (the chosen take, else the newest ready one).
 */
async function expertVideos(qs: Array<{ id: string; text: string; status: string; category: { name: string } | null; recording: { selectedTakeId: string | null; takes: Array<{ id: string; status: string; takeNumber: number }> } | null }>) {
  const out = [];
  for (const q of qs) {
    const comps = await prisma.videoComposition.findMany({ where: { questionId: q.id }, select: { id: true } });
    const render = comps.length
      ? await prisma.renderJob.findFirst({ where: { compositionId: { in: comps.map((c) => c.id) }, status: "SUCCEEDED", outputAssetId: { not: null } }, orderBy: { updatedAt: "desc" } })
      : null;
    let asset = render?.outputAssetId ? await prisma.mediaAsset.findUnique({ where: { id: render.outputAssetId } }) : null;
    let kind: "export" | "recording" = "export";
    if (!asset) {
      const takes = (q.recording?.takes ?? []).filter((t) => t.status === "READY");
      const take = takes.find((t) => t.id === q.recording?.selectedTakeId) ?? takes.sort((a, b) => b.takeNumber - a.takeNumber)[0];
      const full = take ? await prisma.recordingTake.findUnique({ where: { id: take.id }, select: { normalizedAssetId: true } }) : null;
      asset = full?.normalizedAssetId ? await prisma.mediaAsset.findUnique({ where: { id: full.normalizedAssetId } }) : null;
      kind = "recording";
    }
    if (!asset) continue;
    out.push({ questionId: q.id, text: q.text, category: q.category?.name ?? "Ogólne", status: q.status, kind, url: await signedUrl(asset.storageKey, { ttlSec: 6 * 3600 }) });
  }
  return out;
}

export async function narrationUrl(assetId: string) {
  const a = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: assetId } });
  return { url: await signedUrl(a.storageKey, { ttlSec: 3600 }), duration: a.durationSec ?? 0 };
}
