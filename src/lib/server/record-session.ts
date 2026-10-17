import { prisma } from "./db";
import { signedUrl } from "./storage";
import { elevenLabsConfigured } from "./env";
import { resolveToken } from "./invitations";
import { dailyPlan, startOfDay } from "../daily-plan";
import { effectiveKind } from "../question-kinds";

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
    // per item: the narrator for the question kinds, the voice-following prompter for the prompter kinds
    narrationAvailable: elevenLabsConfigured(),
    voiceFollow: elevenLabsConfigured(),
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
      kind: effectiveKind(q.kind, inv.project.format),
      takes: q.recording?.takes ?? [],
    })),
    // "Przejrzyj treści": every item of the expert (not only today's list), to read, edit and accept
    review: questions.map((q) => ({
      id: q.id,
      kind: effectiveKind(q.kind, inv.project.format),
      category: q.category?.name ?? "Ogólne",
      subcategory: q.subcategory?.name ?? null,
      text: q.text,
      spokenText: q.spokenText,
      script: q.script,
      approved: !!q.contentApprovedAt,
      recorded: (q.recording?.takes ?? []).length > 0,
    })),
    // films in editing / approved (watched on demand: GET /api/record/[token]/videos/[questionId])
    videos: questions
      .filter((q) => (q.status === "IN_PROGRESS" || q.status === "TO_ACCEPT" || q.status === "APPROVED") && (q.recording?.takes ?? []).some((t) => t.status === "READY"))
      .map((q) => ({ questionId: q.id, text: q.text, category: q.category?.name ?? "Ogólne", status: q.status })),
  };
}

export async function narrationUrl(assetId: string) {
  const a = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: assetId } });
  return { url: await signedUrl(a.storageKey, { ttlSec: 3600 }), duration: a.durationSec ?? 0 };
}
