import { z } from "zod";
import { json, route } from "@/lib/server/http";
import { accessVia } from "@/lib/server/social/access";
import { disconnectAccount, setPage } from "@/lib/server/social/accounts";

/** choose the Facebook / LinkedIn page the posts go to */
export const PATCH = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const a = await accessVia("account", id, "accounts.manage");
  const b = z.object({ page: z.object({ id: z.string().min(1).max(200), name: z.string().max(200) }).nullable() }).parse(await req.json());
  await setPage(id, b.page, a.user.id);
  return json({ ok: true });
});

/** disconnect the account (pending orders cancelled; the provider profile removed when empty) */
export const DELETE = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const a = await accessVia("account", id, "accounts.manage");
  await disconnectAccount(id, a.user.id);
  return json({ ok: true });
});
