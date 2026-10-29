import { json, route } from "@/lib/server/http";
import { accessVia } from "@/lib/server/social/access";
import { contentAnalytics } from "@/lib/server/social/analytics";

export const GET = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  await accessVia("content", id, "analytics.view");
  return json({ posts: await contentAnalytics(id) });
});
