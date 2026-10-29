import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { effectiveKind, type QuestionKind } from "@/lib/question-kinds";

/**
 * Script scoring for the items of a regular project that the expert reads from the prompter
 * (PROMPTER: hook = the title + the script; QUESTION_PROMPTER: the narrator's question is the hook,
 * the expert reads the answer). Same reel editor guidelines as Ads Studio (reel-review.ts).
 */
type Item = { text: string; spokenText: string | null; script: string | null; kind: string | null };

export const reviewable = (q: Item, format: string) => effectiveKind(q.kind, format) !== "QUESTION" && !!q.script?.trim();

export function reviewInputOf(q: Item, kind: QuestionKind) {
  const parts =
    kind === "QUESTION_PROMPTER"
      ? [
          { role: "hook (pytanie klienta, czyta lektor)", text: q.spokenText?.trim() || q.text },
          { role: "body (odpowiedź eksperta)", text: q.script ?? "" },
        ]
      : [
          { role: "hook", text: q.text },
          { role: "body", text: q.script ?? "" },
        ];
  return { title: q.text, parts, format: kind === "QUESTION_PROMPTER" ? "[PYTANIE KLIENTA]" : "[EKSPERT]" };
}

export async function reviewQuestions(projectId: string, questionIds?: string[]) {
  const { reviewReel } = await import("./reel-review");
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { adsBrief: true, format: true } });
  const items = await prisma.question.findMany({ where: { projectId, ...(questionIds?.length ? { id: { in: questionIds } } : {}) }, orderBy: { order: "asc" } });
  let done = 0;
  let failed = 0;
  let error: string | null = null;
  for (const q of items) {
    if (!reviewable(q, project.format)) continue;
    try {
      const review = await reviewReel({ ...reviewInputOf(q, effectiveKind(q.kind, project.format)), brief: project.adsBrief });
      await prisma.question.update({ where: { id: q.id }, data: { review: review as unknown as Prisma.InputJsonValue, reviewedAt: new Date() } });
      done++;
    } catch (e) {
      failed++;
      error ??= (e as Error).message;
      await prisma.question.update({ where: { id: q.id }, data: { review: { error: (e as Error).message.slice(0, 500) } as Prisma.InputJsonValue } });
      if (/klucza|klucz API|brak środków|dostępu do modelu|API key|quota|billing|credit/i.test((e as Error).message)) break;
    }
  }
  return { reviewed: done, failed, error };
}

/**
 * Swap the item's text for the proposal. The hook goes to the title (PROMPTER) or to what the narrator
 * reads (QUESTION_PROMPTER: spokenText when set, else the title); body + CTA become the script.
 * The expert's acceptance of the content is withdrawn — they see the new text in "Przejrzyj treści".
 */
export async function applyQuestionReview(id: string, what: { mode: "all" } | { mode: "hook"; text: string }) {
  const q = await prisma.question.findUniqueOrThrow({ where: { id }, include: { project: { select: { format: true } } } });
  const kind = effectiveKind(q.kind, q.project.format);
  const hookData = (text: string): Prisma.QuestionUpdateInput => {
    const t = text.trim().slice(0, 500);
    if (!t) return {};
    return kind === "QUESTION_PROMPTER" && q.spokenText ? { spokenText: t } : { text: t };
  };
  if (what.mode === "hook") {
    await prisma.question.update({ where: { id }, data: { ...hookData(what.text), contentApprovedAt: null } });
    return { changed: 1 };
  }
  const nv = (q.review as unknown as { newVersion?: { hook: string; body: string; cta: string } } | null)?.newVersion;
  if (!nv) throw new Error("Brak propozycji do podmiany — najpierw oceń treść.");
  const script = [nv.body, nv.cta].map((x) => x?.trim()).filter(Boolean).join("\n\n");
  await prisma.question.update({ where: { id }, data: { ...hookData(nv.hook), ...(script ? { script } : {}), contentApprovedAt: null } });
  return { changed: 1 };
}
