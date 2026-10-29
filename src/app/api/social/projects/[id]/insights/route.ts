import { prisma } from "@/lib/server/db";
import { json, route } from "@/lib/server/http";
import { projectAccess } from "@/lib/server/social/access";
import { analystInsights } from "@/lib/server/social/ai";
import { analystRows } from "@/lib/server/social/analytics";

export const runtime = "nodejs";
export const maxDuration = 300;

/** the latest "Wnioski AI" */
export const GET = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  await projectAccess(id, "analytics.view");
  const g = await prisma.aiGeneration.findFirst({ where: { projectId: id, kind: "INSIGHTS", error: null }, orderBy: { createdAt: "desc" } });
  return json({ insights: g?.output ?? null });
});

export const POST = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const a = await projectAccess(id, "analytics.view");
  const rows = await analystRows(id, a.project.timezone);
  if (rows.length < 3) return json({ error: `Za mało danych do analizy (${rows.length} opublikowanych z wynikami) — wróć po kilku publikacjach.` }, 409);
  return json({ insights: await analystInsights(id, rows, a.user.id) });
});
