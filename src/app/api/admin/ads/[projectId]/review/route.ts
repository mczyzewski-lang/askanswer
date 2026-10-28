import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { enqueue } from "@/lib/server/jobs";
import { openaiConfigured, openaiKeyDiagnostics } from "@/lib/server/env";

/** Score the scripts (chosen reels, the ones without a score, or all) — runs in the background. */
export const POST = route(async (req: Request, ctx: { params: Promise<{ projectId: string }> }) => {
  await requireAdmin();
  const { projectId } = await ctx.params;
  const b = z.object({ reelIds: z.array(z.string().max(64)).max(1000).optional(), onlyMissing: z.boolean().optional() }).parse(await req.json().catch(() => ({})));
  if (!openaiConfigured()) return json({ error: `Ocena treści wymaga klucza OpenAI. ${openaiKeyDiagnostics()}` }, 503);
  let reelIds = b.reelIds;
  if (!reelIds?.length && b.onlyMissing) reelIds = (await prisma.adReel.findMany({ where: { projectId, reviewedAt: null }, select: { id: true } })).map((r) => r.id);
  if (b.onlyMissing && !reelIds?.length) return json({ jobId: null, reels: 0 });
  const job = await enqueue("ads-review", { projectId, reelIds }, { maxAttempts: 1 });
  return json({ jobId: job.id, reels: reelIds?.length ?? (await prisma.adReel.count({ where: { projectId } })) }, 202);
});
