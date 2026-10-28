import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { enqueue } from "@/lib/server/jobs";
import { openaiConfigured, openaiKeyDiagnostics } from "@/lib/server/env";
import { reviewable } from "@/lib/server/question-review";

/**
 * Score the prompter scripts of the project (chosen items, or the ones still to record that have no
 * score yet) — runs in the background.
 */
export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireAdmin();
  const { id: projectId } = await ctx.params;
  const b = z.object({ questionIds: z.array(z.string().max(64)).max(2000).optional(), onlyMissing: z.boolean().optional() }).parse(await req.json().catch(() => ({})));
  if (!openaiConfigured()) return json({ error: `Ocena treści wymaga klucza OpenAI. ${openaiKeyDiagnostics()}` }, 503);
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { format: true } });
  const items = await prisma.question.findMany({
    where: { projectId, ...(b.questionIds?.length ? { id: { in: b.questionIds } } : b.onlyMissing ? { reviewedAt: null, status: "TO_RECORD" } : { status: "TO_RECORD" }) },
    select: { id: true, text: true, spokenText: true, script: true, kind: true },
  });
  const ids = items.filter((q) => reviewable(q, project.format)).map((q) => q.id);
  if (!ids.length) return json({ jobId: null, items: 0 });
  const job = await enqueue("question-review", { projectId, questionIds: ids }, { maxAttempts: 1 });
  return json({ jobId: job.id, items: ids.length }, 202);
});
