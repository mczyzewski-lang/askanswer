import { json, route } from "@/lib/server/http";
import { accessVia } from "@/lib/server/social/access";
import { suggestTimes } from "@/lib/server/social/analytics";

export const GET = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const a = await accessVia("account", id);
  return json(await suggestTimes(id, a.project.timezone));
});
