import { route } from "@/lib/server/http";
import { landingExport } from "@/lib/server/adwords-landing";
import { shareHeaders, shareOf } from "@/lib/server/adwords-share";

/** a landing page variant for the agency — production export only (refused while blocked) */
export const GET = route(async (req: Request, ctx: { params: Promise<{ token: string }> }) => {
  const { token } = await ctx.params;
  const s = await shareOf(token);
  const q = new URL(req.url).searchParams;
  const fmt = (["csv", "md", "html", "json"] as const).find((f) => f === q.get("fmt")) ?? "html";
  const r = await landingExport(s.projectId, q.get("variant") ?? "LP_A_PLAN", fmt, "production");
  return new Response(r.body, { headers: { ...shareHeaders, "Content-Type": r.type, "Content-Disposition": `attachment; filename="${r.name}"` } });
});
