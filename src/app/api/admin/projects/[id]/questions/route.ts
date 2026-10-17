import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { QuestionInput } from "@/lib/server/schemas";
import { ensureProjectExpert } from "@/lib/server/project-experts";

const norm = (t: string) => t.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Add one question or many at once (paste / CSV import). Unknown category names are created.
 * `upsert: true` (CSV import): an item whose title already exists in the project is UPDATED
 * (type, narrator's question, content) instead of added again — so a corrected file can be re-imported.
 */
export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireAdmin();
  const { id: projectId } = await ctx.params;
  const raw = await req.json();
  const items = z.array(QuestionInput).min(1).max(500).parse(Array.isArray(raw?.items) ? raw.items : [raw]);
  // who gets items that name no expert: the category's default expert, else the project's only expert
  const members = await prisma.projectExpert.findMany({ where: { projectId }, select: { expertId: true } });
  const soleMember = members.length === 1 ? members[0].expertId : null;
  const names = [...new Set(items.map((i) => i.expertName?.toLowerCase()).filter(Boolean))] as string[];
  const byName = new Map<string, string>();
  if (names.length) {
    for (const e of await prisma.expert.findMany({ select: { id: true, name: true } })) if (names.includes(e.name.trim().toLowerCase())) byName.set(e.name.trim().toLowerCase(), e.id);
  }
  // re-import: existing items by title (first unmatched one wins when titles repeat)
  const existing = new Map<string, Array<{ id: string; text: string; spokenText: string | null; script: string | null; kind: string | null; instructions: string | null }>>();
  if (raw?.upsert === true) {
    for (const q of await prisma.question.findMany({ where: { projectId }, orderBy: { order: "asc" }, select: { id: true, text: true, spokenText: true, script: true, kind: true, instructions: true } })) {
      const k = norm(q.text);
      existing.set(k, [...(existing.get(k) ?? []), q]);
    }
  }
  let updated = 0;
  const created = await prisma.$transaction(async (tx) => {
    const max = await tx.question.aggregate({ where: { projectId }, _max: { order: true } });
    let order = (max._max.order ?? -1) + 1;
    const out = [];
    for (const it of items) {
      const same = existing.get(norm(it.text))?.shift();
      if (same) {
        const next = { kind: it.kind ?? same.kind, spokenText: it.spokenText || null, script: it.script ?? null, instructions: it.instructions ?? same.instructions };
        const contentChanged = next.spokenText !== same.spokenText || next.script !== same.script;
        if (contentChanged || next.kind !== same.kind || next.instructions !== same.instructions) {
          // content changed → the expert's approval no longer applies
          await tx.question.update({ where: { id: same.id }, data: { ...next, ...(contentChanged ? { contentApprovedAt: null } : {}) } });
          updated++;
        }
        continue;
      }
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
          data: { projectId, text: it.text, script: it.script ?? null, kind: it.kind ?? null, spokenText: it.spokenText || null, categoryId, subcategoryId, instructions: it.instructions ?? null, maxDurationSec: it.maxDurationSec ?? null, expertId: it.expertId ?? (it.expertName ? byName.get(it.expertName.toLowerCase()) : undefined) ?? defaultExpertId ?? soleMember, order: order++ },
        }),
      );
    }
    return out;
  });
  for (const e of new Set(created.map((q) => q.expertId).filter((x): x is string => !!x))) await ensureProjectExpert(projectId, e);
  return json({ created: created.length, updated, items: created }, 201);
});
