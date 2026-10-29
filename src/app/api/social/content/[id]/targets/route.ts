import { z } from "zod";
import { json, route } from "@/lib/server/http";
import { accessVia } from "@/lib/server/social/access";
import { addTarget } from "@/lib/server/social/posts";

/** add another target account to the film */
export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const a = await accessVia("content", id, "content.edit");
  const b = z.object({ accountId: z.string().max(64) }).parse(await req.json());
  const p = await addTarget(id, b.accountId, a.user.id);
  return json({ id: p.id }, 201);
});
