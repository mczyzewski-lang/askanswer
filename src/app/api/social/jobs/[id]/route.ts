import { prisma } from "@/lib/server/db";
import { HttpError } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { projectAccess } from "@/lib/server/social/access";

/** status of a background job of a project I can see (AI generation, conversion…) */
export const GET = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const job = await prisma.job.findUnique({ where: { id } });
  const projectId = (job?.payload as { projectId?: string } | undefined)?.projectId;
  if (!job || !job.type.startsWith("social-") || !projectId) throw new HttpError(404, "Nie znaleziono");
  await projectAccess(projectId);
  return json({ id: job.id, type: job.type, status: job.status, error: job.error, result: job.result });
});
