import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { QuestionInput } from "@/lib/server/schemas";

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
  return json(await prisma.question.update({ where: { id }, data }));
});

export const DELETE = route(async (_req: Request, ctx: Ctx) => {
  await requireAdmin();
  const { id } = await ctx.params;
  await prisma.question.delete({ where: { id } });
  return json({ ok: true });
});
