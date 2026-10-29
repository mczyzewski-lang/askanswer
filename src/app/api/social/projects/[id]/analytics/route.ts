import { json, route } from "@/lib/server/http";
import { projectAccess } from "@/lib/server/social/access";
import { projectAnalytics } from "@/lib/server/social/analytics";

export const GET = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const a = await projectAccess(id, "analytics.view");
  const d = Number(new URL(req.url).searchParams.get("days") ?? 30);
  const days = [7, 30, 90].includes(d) ? d : 30;
  return json(await projectAnalytics(id, days, a.project.timezone));
});
