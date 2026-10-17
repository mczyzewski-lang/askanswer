import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { QuestionInput } from "@/lib/server/schemas";
import { ensureProjectExpert } from "@/lib/server/project-experts";
import { deleteQuestions } from "@/lib/server/question-delete";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = route(async (req: Request, ctx: Ctx) => {
  await requireAdmin();
  const { id } = await ctx.params;
  const body = QuestionInput.partial().parse(await req.json());
  const { categoryName: _ignored, subcategoryName, ...data } = body;
  void _ignored;
  const current = await prisma.question.findUniqueOrThrow({ where: { id } });
  const categoryId = data.categoryId !== undefined ? data.categoryId : current.categoryId;
  // a subcategory must belong to the question's category; create one by name if requested
  if (subcategoryName && categoryId) {
    const n = await prisma.subcategory.count({ where: { categoryId } });
    const sc = await prisma.subcategory.upsert({ where: { categoryId_name: { categoryId, name: subcategoryName } }, create: { categoryId, name: subcategoryName, order: n }, update: {} });
    data.subcategoryId = sc.id;
  }
  const subId = data.subcategoryId !== undefined ? data.subcategoryId : current.subcategoryId;
  if (subId) {
    const ok = categoryId ? await prisma.subcategory.findFirst({ where: { id: subId, categoryId } }) : null;
    if (!ok) data.subcategoryId = null;
  }
  if (data.expertId) await ensureProjectExpert(current.projectId, data.expertId);
  // the expert accepted another version of the content: ask again
  const changed = (["text", "spokenText", "script"] as const).some((k) => data[k] !== undefined && (data[k] ?? null) !== (current[k] ?? null));
  if (changed) (data as Record<string, unknown>).contentApprovedAt = null;
  return json(await prisma.question.update({ where: { id }, data }));
});

export const DELETE = route(async (_req: Request, ctx: Ctx) => {
  await requireAdmin();
  const { id } = await ctx.params;
  const q = await prisma.question.findUniqueOrThrow({ where: { id }, select: { projectId: true } });
  await deleteQuestions(q.projectId, [id]);
  return json({ ok: true });
});
