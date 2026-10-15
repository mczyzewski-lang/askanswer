import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";

/** Background job status overview (for the admin "Zadania" panel). */
export const GET = route(async () => {
  await requireAdmin();
  const jobs = await prisma.job.findMany({ orderBy: { updatedAt: "desc" }, take: 30 });
  const lastBeat = jobs.find((j) => j.lockedBy)?.lockedAt ?? null;
  return json({ jobs: jobs.map((j) => ({ id: j.id, type: j.type, status: j.status, attempts: j.attempts, error: j.error, updatedAt: j.updatedAt })), lastBeat });
});
