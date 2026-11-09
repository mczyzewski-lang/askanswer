import { requireAdmin } from "@/lib/server/auth";
import { route } from "@/lib/server/http";
import { landingExport } from "@/lib/server/adwords-landing";

/** one landing variant as CSV / Markdown / HTML / JSON — ?variant=LP_A_PLAN&fmt=html&mode=production|preview */
export const GET = route(async (req: Request, ctx: { params: Promise<{ projectId: string }> }) => {
  await requireAdmin();
  const { projectId } = await ctx.params;
  const q = new URL(req.url).searchParams;
  const fmt = (["csv", "md", "html", "json"] as const).find((f) => f === q.get("fmt")) ?? "html";
  const r = await landingExport(projectId, q.get("variant") ?? "LP_A_PLAN", fmt, q.get("mode") === "preview" ? "preview" : "production");
  return new Response(r.body, { headers: { "Content-Type": r.type, "Content-Disposition": `attachment; filename="${r.name}"`, "Cache-Control": "no-store" } });
});
