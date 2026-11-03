import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/ratelimit";
import { effectiveKind, kindHasNarration } from "@/lib/question-kinds";
import { reviewInputOf } from "@/lib/server/question-review";
import { openaiConfigured } from "@/lib/server/env";

type Ctx = { params: Promise<{ id: string }> };

async function load(id: string) {
  const comp = await prisma.videoComposition.findUniqueOrThrow({ where: { id }, include: { question: true, project: { select: { format: true, adsBrief: true } } } });
  const q = comp.question;
  const kind = q ? effectiveKind(q.kind, comp.project.format) : null;
  return { comp, q, kind };
}

/**
 * Hooks for an A/B test of this video: the alternatives the content review proposed (GET), or new ones
 * written for it now (POST). `narrated`: the narrator reads the hook, so each version gets its own narration.
 */
export const GET = route(async (_req: Request, ctx: Ctx) => {
  await requireAdmin();
  const { q, kind } = await load((await ctx.params).id);
  const review = (q?.review ?? null) as { altHooks?: Array<{ mechanism: string; text: string }>; newVersion?: { hook?: string } } | null;
  const ideas = [
    ...(review?.altHooks ?? []).map((h) => ({ mechanism: h.mechanism, text: h.text, source: "ocena" as const })),
    ...(review?.newVersion?.hook ? [{ mechanism: "nowa wersja", text: review.newVersion.hook, source: "ocena" as const }] : []),
  ].filter((h) => h.text?.trim());
  return json({ kind, narrated: kind ? kindHasNarration(kind) : false, ideas, canGenerate: openaiConfigured() && !!q });
});

export const POST = route(async (req: Request, ctx: Ctx) => {
  const user = await requireAdmin();
  if (!rateLimit(`hook-ideas:${user.id}`, { capacity: 10, perMinute: 6 })) return json({ error: "Zbyt wiele żądań — spróbuj za chwilę" }, 429);
  const { count } = z.object({ count: z.number().int().min(1).max(6).default(3) }).parse(await req.json().catch(() => ({})));
  const { comp, q, kind } = await load((await ctx.params).id);
  if (!q || !kind) return json({ error: "To wideo nie jest powiązane z treścią projektu" }, 400);
  if (!openaiConfigured()) return json({ error: "Propozycje hooków wymagają klucza OpenAI (OPENAI_API_KEY)." }, 503);
  const { suggestHooks } = await import("@/lib/server/reel-review");
  // a free answer (narrator only) has no script: the hook is written from the question alone
  const input = kind === "QUESTION" ? { title: q.text, parts: [{ role: "hook (pytanie klienta, czyta lektor)", text: q.spokenText?.trim() || q.text }], format: "[PYTANIE KLIENTA]" } : reviewInputOf(q, kind);
  const ideas = await suggestHooks({ ...input, brief: comp.project.adsBrief }, count);
  return json({ ideas: ideas.map((h) => ({ ...h, source: "nowe" as const })) });
});
