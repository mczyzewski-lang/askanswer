import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { enqueue } from "@/lib/server/jobs";

/** Lay out the reels from the footage (all, or the chosen ones; `rebuild` replaces existing edits). */
export const POST = route(async (req: Request, ctx: { params: Promise<{ projectId: string }> }) => {
  await requireAdmin();
  const { projectId } = await ctx.params;
  const b = z.object({ reelIds: z.array(z.string().max(64)).max(1000).optional(), rebuild: z.boolean().optional() }).parse(await req.json().catch(() => ({})));
  await prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { id: true } });
  const job = await enqueue("ads-build", { projectId, reelIds: b.reelIds, rebuild: !!b.rebuild }, { maxAttempts: 1 });
  return json({ jobId: job.id }, 202);
});
