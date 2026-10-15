import { json, route } from "@/lib/server/http";
import { recordSession } from "@/lib/server/record-session";

export const GET = route(async (_req: Request, ctx: { params: Promise<{ token: string }> }) => {
  const { token } = await ctx.params;
  return json(await recordSession(token));
});
