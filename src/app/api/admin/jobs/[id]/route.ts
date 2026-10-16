import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { assetInfo } from "@/lib/server/assets";

/** Status of a background job; for voice enhancement / AI clips also returns the resulting assets. */
export const GET = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireAdmin();
  const { id } = await ctx.params;
  const job = await prisma.job.findUniqueOrThrow({ where: { id } });
  const result = (job.result ?? null) as { map?: Record<string, string>; assetId?: string; variantIds?: string[] } | null;
  const ids = job.status === "SUCCEEDED" && result ? [...new Set([...Object.values(result.map ?? {}), ...(result.assetId ? [result.assetId] : []), ...(result.variantIds ?? [])])] : [];
  const assets = (await Promise.all(ids.map((a) => assetInfo(a)))).filter(Boolean);
  return json({ id: job.id, type: job.type, status: job.status, attempts: job.attempts, error: job.error, result, assets, warning: (job.result as { warning?: string } | null)?.warning ?? null });
});
