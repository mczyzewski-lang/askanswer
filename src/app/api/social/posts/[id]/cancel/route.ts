import { json, route } from "@/lib/server/http";
import { accessVia } from "@/lib/server/social/access";
import { cancelPost } from "@/lib/server/social/publisher";

export const POST = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const a = await accessVia("post", id, "content.schedule");
  const p = await cancelPost(id, a.user.id, "Anulowano przez użytkownika");
  return json({ id: p.id, status: p.status });
});
