/**
 * Postgres-backed background job queue. Jobs are claimed atomically with
 * FOR UPDATE SKIP LOCKED, so multiple workers can run safely. Enqueueing with
 * an idempotency key makes repeated requests (e.g. upload retries) harmless.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "./db";

export type JobType = "process-take" | "transcribe-take" | "render" | "enhance-audio" | "generate-broll" | "generate-infographic" | "segment-asset" | "auto-visuals" | "auto-polish" | "generate-background" | "generate-avatar" | "ads-footage" | "ads-build" | "ads-review";

export async function enqueue(type: JobType, payload: Record<string, unknown>, opts: { idempotencyKey?: string; maxAttempts?: number; runAt?: Date } = {}) {
  if (opts.idempotencyKey) {
    const existing = await prisma.job.findUnique({ where: { idempotencyKey: opts.idempotencyKey } });
    if (existing) {
      if (existing.status === "FAILED") {
        return prisma.job.update({ where: { id: existing.id }, data: { status: "QUEUED", attempts: 0, error: null, runAt: new Date(), payload: payload as Prisma.InputJsonValue } });
      }
      return existing;
    }
  }
  try {
    return await prisma.job.create({
      data: { type, payload: payload as Prisma.InputJsonValue, idempotencyKey: opts.idempotencyKey, maxAttempts: opts.maxAttempts ?? 3, runAt: opts.runAt ?? new Date() },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002" && opts.idempotencyKey) {
      return prisma.job.findUniqueOrThrow({ where: { idempotencyKey: opts.idempotencyKey } });
    }
    throw e;
  }
}

export const DIED_MESSAGE = "Proces przetwarzania został przerwany przez serwer (najczęściej z braku pamięci RAM). Spróbuj niższej jakości lub zwiększ pamięć usługi w Railway (Settings → Resources).";

/** Jobs whose worker died and that already used all attempts are marked FAILED (no endless crash loop). */
export async function reapDeadJobs() {
  const dead = await prisma.$queryRaw<Array<{ id: string; type: string; payload: unknown }>>`
    UPDATE "Job" SET status = 'FAILED', error = ${DIED_MESSAGE}, "lockedAt" = NULL, "updatedAt" = now()
    WHERE status = 'RUNNING' AND "lockedAt" < now() - interval '3 minutes' AND attempts >= "maxAttempts"
    RETURNING id, type, payload`;
  for (const j of dead) {
    if (j.type === "render") {
      const rid = (j.payload as { renderJobId?: string }).renderJobId;
      if (rid) await prisma.renderJob.update({ where: { id: rid }, data: { status: "FAILED", error: DIED_MESSAGE } }).catch(() => {});
    }
  }
  return dead.length;
}

/**
 * Jobs that mostly wait on AI APIs (OpenAI, Higgsfield, Claude): they run in their own lane, so an
 * expert's new recording gets its illustrations right away instead of queueing behind renders.
 */
export const AI_JOB_TYPES: JobType[] = ["auto-visuals", "generate-infographic", "generate-broll", "generate-background", "generate-avatar", "ads-review"];

/** `lane` "ai" claims only AI jobs, "media" everything else (CPU: FFmpeg, transcription, masks). */
export async function claimJob(workerId: string, lane?: "ai" | "media") {
  await reapDeadJobs();
  const ai = AI_JOB_TYPES as string[];
  const inLane = lane === "ai" ? Prisma.sql`AND type = ANY(${ai})` : lane === "media" ? Prisma.sql`AND NOT (type = ANY(${ai}))` : Prisma.empty;
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    UPDATE "Job" SET status = 'RUNNING', "lockedAt" = now(), "lockedBy" = ${workerId}, attempts = attempts + 1, "updatedAt" = now()
    WHERE id = (
      SELECT id FROM "Job"
      WHERE ((status = 'QUEUED' AND "runAt" <= now())
         OR (status = 'RUNNING' AND "lockedAt" < now() - interval '3 minutes')) ${inLane}
      ORDER BY "runAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id`;
  if (!rows.length) return null;
  return prisma.job.findUnique({ where: { id: rows[0].id } });
}

/** Keep a running job's lock fresh; a job without heartbeat for 3 minutes is considered dead and retried. */
export function startHeartbeat(id: string): () => void {
  const t = setInterval(() => {
    prisma.job.update({ where: { id }, data: { lockedAt: new Date() } }).catch(() => {});
  }, 30_000);
  return () => clearInterval(t);
}

export async function completeJob(id: string, result?: unknown) {
  await prisma.job.update({ where: { id }, data: { status: "SUCCEEDED", result: (result ?? undefined) as Prisma.InputJsonValue | undefined, error: null, lockedAt: null } });
}

export async function failJob(id: string, error: string, retryable: boolean) {
  const job = await prisma.job.findUniqueOrThrow({ where: { id } });
  const giveUp = !retryable || job.attempts >= job.maxAttempts;
  const backoff = Math.min(600, 15 * 2 ** (job.attempts - 1));
  await prisma.job.update({
    where: { id },
    data: { status: giveUp ? "FAILED" : "QUEUED", error: error.slice(0, 4000), lockedAt: null, runAt: new Date(Date.now() + backoff * 1000) },
  });
  return giveUp;
}
