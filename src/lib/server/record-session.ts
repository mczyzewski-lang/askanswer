import { prisma } from "./db";
import { signedUrl } from "./storage";
import { elevenLabsConfigured } from "./env";
import { resolveToken } from "./invitations";

/** Everything the expert recorder needs — limited strictly to questions assigned to this expert. */
export async function recordSession(token: string) {
  const inv = await resolveToken(token);
  await prisma.invitation.update({ where: { id: inv.id }, data: { lastUsedAt: new Date() } });
  const questions = await prisma.question.findMany({
    where: { projectId: inv.projectId, expertId: inv.expertId },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    include: {
      category: true,
      recording: { include: { takes: { where: { status: { not: "UPLOADING" } }, orderBy: { takeNumber: "asc" }, select: { id: true, takeNumber: true, status: true, durationSec: true, createdAt: true } } } },
    },
  });
  return {
    project: { id: inv.project.id, name: inv.project.name, description: inv.project.description, mode: inv.project.recordingMode, sequential: inv.project.sequential },
    expert: { name: inv.expert.name },
    consentGiven: !!inv.consentAt,
    expiresAt: inv.expiresAt.toISOString(),
    narrationAvailable: elevenLabsConfigured(),
    theme: inv.project.theme ? { primary: inv.project.theme.primaryColor, accent: inv.project.theme.accentColor, font: inv.project.theme.questionFont } : null,
    questions: questions.map((q) => ({
      id: q.id,
      text: q.text,
      instructions: q.instructions,
      maxDurationSec: q.maxDurationSec,
      category: q.category?.name ?? "Ogólne",
      status: q.status,
      takes: q.recording?.takes ?? [],
    })),
  };
}

export async function narrationUrl(assetId: string) {
  const a = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: assetId } });
  return { url: await signedUrl(a.storageKey, { ttlSec: 3600 }), duration: a.durationSec ?? 0 };
}
