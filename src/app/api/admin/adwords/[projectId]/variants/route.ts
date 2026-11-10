import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { comparisonVariants, expertVariants, startInfographics } from "@/lib/server/adwords-variants";

/** more creatives from the concepts: kind "expert" (real photos, at once) or "infographic" (OpenAI, background jobs) */
export const POST = route(async (req: Request, ctx: { params: Promise<{ projectId: string }> }) => {
  await requireAdmin();
  const { projectId } = await ctx.params;
  const b = z.object({ kind: z.enum(["expert", "infographic", "comparison"]), conceptIds: z.array(z.string().max(40)).max(50).optional(), photoIds: z.array(z.string().max(64)).max(30).optional() }).parse(await req.json());
  if (b.kind === "expert") return json(await expertVariants(projectId, b.conceptIds, b.photoIds));
  if (b.kind === "comparison") return json(await comparisonVariants(projectId, b.conceptIds));
  return json(await startInfographics(projectId, b.conceptIds ?? []), 202);
});

/** infographic jobs still running for this project */
export const GET = route(async (_req: Request, ctx: { params: Promise<{ projectId: string }> }) => {
  await requireAdmin();
  const { projectId } = await ctx.params;
  const jobs = await prisma.job.findMany({ where: { type: "adwords-infographic", status: { in: ["QUEUED", "RUNNING", "FAILED"] }, payload: { path: ["projectId"], equals: projectId } }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, status: true, payload: true, error: true, createdAt: true } });
  return json(jobs);
});
