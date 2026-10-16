import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { enqueue } from "@/lib/server/jobs";
import { autoVisualsState } from "@/lib/server/composition";

/** State of the automatic infographics for this composition. */
export const GET = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireAdmin();
  const { id } = await ctx.params;
  return json(await autoVisualsState(id));
});

/**
 * "Osadź infografiki automatycznie": run the automatic placement now — also for videos processed
 * before it existed, or after a failed run (e.g. a key added later).
 */
export const POST = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireAdmin();
  const { id } = await ctx.params;
  await prisma.videoComposition.findUniqueOrThrow({ where: { id }, select: { id: true } });
  const key = `auto-visuals:${id}`;
  const existing = await prisma.job.findUnique({ where: { idempotencyKey: key } });
  if (existing && (existing.status === "QUEUED" || existing.status === "RUNNING")) return json(await autoVisualsState(id), 202);
  const payload = { compositionId: id, force: true } as Prisma.InputJsonValue;
  if (existing) await prisma.job.update({ where: { id: existing.id }, data: { status: "QUEUED", attempts: 0, error: null, result: Prisma.DbNull, runAt: new Date(), lockedAt: null, payload } });
  else await enqueue("auto-visuals", { compositionId: id, force: true }, { idempotencyKey: key, maxAttempts: 2 });
  return json(await autoVisualsState(id), 202);
});
