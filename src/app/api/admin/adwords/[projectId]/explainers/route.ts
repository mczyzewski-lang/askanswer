import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { enqueue } from "@/lib/server/jobs";
import { elevenLabsConfigured } from "@/lib/server/env";
import { explainerRenders } from "@/lib/server/explainers";
import { reelById } from "@/lib/explainers";

/** the latest MP4 of every reel + the render jobs still running */
export const GET = route(async (_req: Request, ctx: { params: Promise<{ projectId: string }> }) => {
  await requireAdmin();
  const { projectId } = await ctx.params;
  const jobs = await prisma.job.findMany({ where: { type: "explainer-render", status: { in: ["QUEUED", "RUNNING", "FAILED"] }, payload: { path: ["projectId"], equals: projectId } }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, status: true, payload: true, error: true, createdAt: true } });
  return json({ renders: await explainerRenders(projectId), jobs: jobs.map((j) => ({ id: j.id, status: j.status, error: j.error, reelId: (j.payload as { reelId?: string }).reelId ?? null, createdAt: j.createdAt })), voiceAvailable: elevenLabsConfigured() });
});

/** render a reel to MP4 (a background job); `vo` = the narration text per beat, when edited */
export const POST = route(async (req: Request, ctx: { params: Promise<{ projectId: string }> }) => {
  await requireAdmin();
  const { projectId } = await ctx.params;
  const b = z.object({ reelId: z.string().max(60), voice: z.boolean().default(true), vo: z.record(z.string().max(40), z.string().max(600)).optional() }).parse(await req.json());
  const reel = reelById(b.reelId);
  if (!reel) return json({ error: "Nie ma takiego reelsa" }, 404);
  if (!reel.draw) return json({ error: "Ten reels ma gotowy scenariusz, ale jeszcze nie ma sceny do renderu." }, 400);
  const job = await enqueue("explainer-render", { projectId, reelId: b.reelId, voice: b.voice, vo: b.vo ?? {} }, { idempotencyKey: `explainer:${projectId}:${b.reelId}:${Date.now()}`, maxAttempts: 1 });
  return json({ jobId: job.id }, 202);
});
