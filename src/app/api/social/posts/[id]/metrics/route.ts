import { json, route } from "@/lib/server/http";
import { accessVia } from "@/lib/server/social/access";
import { refreshMetrics } from "@/lib/server/social/analytics";

export const POST = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  await accessVia("post", id, "analytics.view");
  return json(await refreshMetrics(id));
});
