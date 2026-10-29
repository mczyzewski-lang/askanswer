import { json, route } from "@/lib/server/http";
import { accessVia } from "@/lib/server/social/access";
import { retryPost } from "@/lib/server/social/publisher";

export const POST = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  await accessVia("post", id, "content.schedule");
  const p = await retryPost(id);
  return json({ id: p.id, status: p.status });
});
