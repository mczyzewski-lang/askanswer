import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { deleteQuestions } from "@/lib/server/question-delete";
import { ensureProjectExpert } from "@/lib/server/project-experts";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("delete"), ids: z.array(z.string()).min(1).max(1000) }),
  z.object({ action: z.literal("status"), ids: z.array(z.string()).min(1).max(1000), status: z.enum(["TO_RECORD", "IN_PROGRESS", "RECORDED", "NEEDS_FIX", "APPROVED"]) }),
  z.object({ action: z.literal("expert"), ids: z.array(z.string()).min(1).max(1000), expertId: z.string().nullable() }),
  z.object({ action: z.literal("category"), ids: z.array(z.string()).min(1).max(1000), categoryId: z.string().nullable() }),
  z.object({ action: z.literal("kind"), ids: z.array(z.string()).min(1).max(1000), kind: z.enum(["QUESTION", "PROMPTER", "QUESTION_PROMPTER"]) }),
]);

/** Bulk actions on selected questions / scripts of the project. */
export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireAdmin();
  const { id: projectId } = await ctx.params;
  const b = Body.parse(await req.json());
  const where = { id: { in: b.ids }, projectId };
  switch (b.action) {
    case "delete":
      return json({ count: await deleteQuestions(projectId, b.ids) });
    case "status":
      return json({ count: (await prisma.question.updateMany({ where, data: { status: b.status } })).count });
    case "expert":
      if (b.expertId) await ensureProjectExpert(projectId, b.expertId);
      return json({ count: (await prisma.question.updateMany({ where, data: { expertId: b.expertId } })).count });
    case "category": {
      if (b.categoryId && !(await prisma.category.findFirst({ where: { id: b.categoryId, projectId } }))) return json({ error: "Nieznana kategoria" }, 400);
      // the subcategory belongs to the old category, so it is cleared
      return json({ count: (await prisma.question.updateMany({ where, data: { categoryId: b.categoryId, subcategoryId: null } })).count });
    }
    case "kind":
      return json({ count: (await prisma.question.updateMany({ where, data: { kind: b.kind } })).count });
  }
});
