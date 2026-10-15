import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { assetInfo } from "@/lib/server/assets";

/** Status of a background job; for voice enhancement also returns the resulting assets. */
export const GET = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireAdmin();
  const { id } = await ctx.params;
  const job = await prisma.job.findUniqueOrThrow({ where: { id } });
  const result = (job.result ?? null) as { map?: Record<string, string> } | null;
  const assets = job.status === "SUCCEEDED" && result?.map ? (await Promise.all(Object.values(result.map).map((a) => assetInfo(a)))).filter(Boolean) : [];
  return json({ id: job.id, type: job.type, status: job.status, attempts: job.attempts, error: job.error, result, assets });
});
