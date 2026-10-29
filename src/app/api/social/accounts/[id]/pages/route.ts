import { json, route } from "@/lib/server/http";
import { accessVia } from "@/lib/server/social/access";
import { listPages } from "@/lib/server/social/accounts";

export const GET = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  await accessVia("account", id, "accounts.manage");
  return json({ pages: await listPages(id) });
});
