import { prisma } from "./db";

/** Make sure the expert is a member of the project (assigning questions or sending a link implies it). */
export async function ensureProjectExpert(projectId: string, expertId: string | null | undefined) {
  if (!expertId) return;
  await prisma.projectExpert.upsert({ where: { projectId_expertId: { projectId, expertId } }, create: { projectId, expertId }, update: {} });
}
