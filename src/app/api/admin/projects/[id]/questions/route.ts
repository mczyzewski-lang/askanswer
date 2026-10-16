import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { QuestionInput } from "@/lib/server/schemas";

/** Add one question or many at once (paste / CSV import). Unknown category names are created. */
export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireAdmin();
  const { id: projectId } = await ctx.params;
  const raw = await req.json();
  const items = z.array(QuestionInput).min(1).max(500).parse(Array.isArray(raw?.items) ? raw.items : [raw]);
  const created = await prisma.$transaction(async (tx) => {
    const max = await tx.question.aggregate({ where: { projectId }, _max: { order: true } });
    let order = (max._max.order ?? -1) + 1;
    const out = [];
    for (const it of items) {
      let categoryId = it.categoryId ?? null;
      if (!categoryId && it.categoryName) {
        const count = await tx.category.count({ where: { projectId } });
        const c = await tx.category.upsert({
          where: { projectId_name: { projectId, name: it.categoryName } },
          create: { projectId, name: it.categoryName, order: count },
          update: {},
        });
        categoryId = c.id;
      }
      let defaultExpertId: string | null = null;
      if (categoryId) {
        const ok = await tx.category.findFirst({ where: { id: categoryId, projectId } });
        if (!ok) categoryId = null;
        // a category can name its usual expert (e.g. Growth → Marek Czyżewski)
        defaultExpertId = ok?.expertId ?? null;
      }
      // thematic subcategory (e.g. "[dzieci]" when pasting), always inside the chosen category
      let subcategoryId: string | null = null;
      if (categoryId && it.subcategoryId) {
        const sc = await tx.subcategory.findFirst({ where: { id: it.subcategoryId, categoryId } });
        subcategoryId = sc?.id ?? null;
      } else if (categoryId && it.subcategoryName) {
        const n = await tx.subcategory.count({ where: { categoryId } });
        const sc = await tx.subcategory.upsert({
          where: { categoryId_name: { categoryId, name: it.subcategoryName } },
          create: { categoryId, name: it.subcategoryName, order: n },
          update: {},
        });
        subcategoryId = sc.id;
      }
      out.push(
        await tx.question.create({
          data: { projectId, text: it.text, categoryId, subcategoryId, instructions: it.instructions ?? null, maxDurationSec: it.maxDurationSec ?? null, expertId: it.expertId ?? defaultExpertId, order: order++ },
        }),
      );
    }
    return out;
  });
  return json({ created: created.length, items: created }, 201);
});
