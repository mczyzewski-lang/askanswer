import { prisma } from "./db";
import { invitationUrl } from "./invitations";
import { signedUrl } from "./storage";
import { elevenLabsConfigured } from "./env";

export async function dashboardData() {
  const projects = await prisma.project.findMany({
    orderBy: { updatedAt: "desc" },
    include: {
      questions: { select: { id: true, status: true, updatedAt: true, expert: { select: { name: true } }, recording: { select: { updatedAt: true, _count: { select: { takes: true } } } } } },
      compositions: { select: { id: true, status: true, updatedAt: true } },
      renderJobs: { where: { status: "SUCCEEDED" }, select: { compositionId: true, compositionIds: true, updatedAt: true } },
    },
  });
  return projects.map((p) => {
    const recorded = p.questions.filter((q) => (q.recording?._count.takes ?? 0) > 0).length;
    const exported = new Set(p.renderJobs.flatMap((r) => (r.compositionId ? [r.compositionId] : r.compositionIds)));
    const dates = [p.updatedAt, ...p.questions.map((q) => q.updatedAt), ...p.questions.map((q) => q.recording?.updatedAt), ...p.compositions.map((c) => c.updatedAt), ...p.renderJobs.map((r) => r.updatedAt)].filter(Boolean) as Date[];
    return {
      id: p.id,
      name: p.name,
      description: p.description,
      experts: [...new Set(p.questions.map((q) => q.expert?.name).filter(Boolean))] as string[],
      questionCount: p.questions.length,
      recorded,
      unanswered: p.questions.length - recorded,
      approved: p.questions.filter((q) => q.status === "APPROVED").length,
      edited: p.compositions.filter((c) => c.status === "EDITED" || c.status === "EXPORTED").length,
      exported: exported.size,
      updatedAt: new Date(Math.max(...dates.map((d) => d.getTime()))).toISOString(),
    };
  });
}

export async function projectData(id: string) {
  const p = await prisma.project.findUniqueOrThrow({
    where: { id },
    include: {
      theme: true,
      categories: { orderBy: { order: "asc" }, include: { subcategories: { orderBy: [{ order: "asc" }, { name: "asc" }] } } },
      invitations: { orderBy: { createdAt: "desc" }, include: { expert: true } },
      questions: {
        orderBy: [{ order: "asc" }, { createdAt: "asc" }],
        include: {
          category: true,
          subcategory: true,
          expert: true,
          recording: { include: { takes: { orderBy: { takeNumber: "desc" }, include: { transcript: { select: { id: true, text: true } } } } } },
          compositions: { orderBy: { updatedAt: "desc" }, select: { id: true, name: true, status: true, takeId: true, updatedAt: true } },
        },
      },
      renderJobs: { orderBy: { createdAt: "desc" }, take: 50 },
    },
  });
  const experts = await prisma.expert.findMany({ orderBy: { name: "asc" } });
  const renderOut = new Map<string, { url: string; at: string }>();
  for (const r of p.renderJobs) {
    if (r.status !== "SUCCEEDED" || !r.outputAssetId) continue;
    const a = await prisma.mediaAsset.findUnique({ where: { id: r.outputAssetId } });
    if (!a) continue;
    const url = await signedUrl(a.storageKey, { download: a.originalName ?? "wideo.mp4" });
    if (r.compositionId && !renderOut.has(r.compositionId)) renderOut.set(r.compositionId, { url, at: r.updatedAt.toISOString() });
    if (r.kind === "combined" && !renderOut.has(`combined:${r.id}`)) renderOut.set(`combined:${r.id}`, { url, at: r.updatedAt.toISOString() });
  }
  const questions = await Promise.all(
    p.questions.map(async (q) => ({
      id: q.id,
      text: q.text,
      instructions: q.instructions,
      maxDurationSec: q.maxDurationSec,
      order: q.order,
      status: q.status,
      categoryId: q.categoryId,
      categoryName: q.category?.name ?? null,
      subcategoryId: q.subcategoryId,
      subcategoryName: q.subcategory?.name ?? null,
      expertId: q.expertId,
      expertName: q.expert?.name ?? null,
      selectedTakeId: q.recording?.selectedTakeId ?? null,
      takes: await Promise.all(
        (q.recording?.takes ?? []).map(async (t) => {
          const norm = t.normalizedAssetId ? await prisma.mediaAsset.findUnique({ where: { id: t.normalizedAssetId } }) : null;
          const comp = q.compositions.find((c) => c.takeId === t.id);
          const proxyId = (norm?.meta as { proxyAssetId?: string } | null)?.proxyAssetId;
          const proxy = proxyId ? await prisma.mediaAsset.findUnique({ where: { id: proxyId } }) : null;
          return {
            id: t.id,
            takeNumber: t.takeNumber,
            status: t.status,
            mode: t.mode,
            durationSec: t.durationSec,
            processingStep: t.processingStep,
            processingError: t.processingError,
            transcriptionError: t.transcriptionError,
            hasTranscript: !!t.transcript,
            transcriptText: t.transcript?.text ?? null,
            createdAt: t.createdAt.toISOString(),
            previewUrl: norm ? await signedUrl(norm.storageKey) : null,
            proxyUrl: proxy ? await signedUrl(proxy.storageKey) : null,
            compositionId: comp?.id ?? null,
            compositionStatus: comp?.status ?? null,
            editedDownload: comp ? (renderOut.get(comp.id)?.url ?? null) : null,
          };
        }),
      ),
    })),
  );
  const combined = p.renderJobs
    .filter((r) => r.kind === "combined")
    .map((r) => ({ id: r.id, status: r.status, progress: r.progress, error: r.error, createdAt: r.createdAt.toISOString(), count: r.compositionIds.length, downloadUrl: renderOut.get(`combined:${r.id}`)?.url ?? null }));
  return {
    project: {
      id: p.id,
      name: p.name,
      description: p.description,
      recordingMode: p.recordingMode,
      sequential: p.sequential,
      dailyQuestionLimit: p.dailyQuestionLimit,
      questionVisibility: p.questionVisibility,
      questionSeconds: p.questionSeconds,
      voiceId: p.voiceId,
      ttsModel: p.ttsModel,
      themeId: p.themeId,
      themeName: p.theme?.name ?? null,
      theme: p.theme,
    },
    categories: p.categories.map((c) => ({ id: c.id, name: c.name, subcategories: c.subcategories.map((s) => ({ id: s.id, name: s.name })) })),
    experts: experts.map((e) => ({ id: e.id, name: e.name, email: e.email, title: e.title })),
    invitations: p.invitations.map((i) => ({
      id: i.id,
      expertId: i.expertId,
      expertName: i.expert.name,
      url: invitationUrl(i.tokenEnc),
      expiresAt: i.expiresAt.toISOString(),
      revoked: !!i.revokedAt,
      expired: i.expiresAt < new Date(),
      lastUsedAt: i.lastUsedAt?.toISOString() ?? null,
      consentAt: i.consentAt?.toISOString() ?? null,
    })),
    questions,
    combined,
    elevenLabs: elevenLabsConfigured(),
  };
}

export type ProjectData = Awaited<ReturnType<typeof projectData>>;
export type DashboardProject = Awaited<ReturnType<typeof dashboardData>>[number];
