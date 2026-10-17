import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { json, route } from "@/lib/server/http";
import { resolveToken } from "@/lib/server/invitations";

const Body = z.object({
  text: z.string().trim().min(3, "Tytuł jest za krótki").max(400).optional(),
  spokenText: z.string().trim().max(1000).nullable().optional(),
  script: z.string().trim().max(8000).nullable().optional(),
  /** true = accept the content, false = take the acceptance back */
  approve: z.boolean().optional(),
});

/** The expert reviews their own items: small edits and acceptance ("Przejrzyj treści"). */
export const PATCH = route(async (req: Request, ctx: { params: Promise<{ token: string; questionId: string }> }) => {
  const { token, questionId } = await ctx.params;
  const inv = await resolveToken(token);
  const q = await prisma.question.findFirst({ where: { id: questionId, projectId: inv.projectId, expertId: inv.expertId } });
  if (!q) return json({ error: "Nie znaleziono pozycji." }, 404);
  const b = Body.parse(await req.json());
  const data: Record<string, unknown> = {};
  if (b.text !== undefined) data.text = b.text;
  if (b.spokenText !== undefined) data.spokenText = b.spokenText || null;
  if (b.script !== undefined) data.script = b.script || null;
  if (b.approve !== undefined) data.contentApprovedAt = b.approve ? new Date() : null;
  const u = await prisma.question.update({ where: { id: q.id }, data, select: { id: true, text: true, spokenText: true, script: true, contentApprovedAt: true } });
  return json({ ...u, approved: !!u.contentApprovedAt });
});
