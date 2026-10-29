import { json, route } from "@/lib/server/http";
import { accessVia } from "@/lib/server/social/access";
import { draftReply } from "@/lib/server/social/comments";

export const runtime = "nodejs";
export const maxDuration = 300;

/** "Wygeneruj odpowiedź AI" — a draft only, nothing is sent */
export const POST = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const a = await accessVia("comment", id, "comments.reply");
  const r = await draftReply(id, a.user.id);
  return json({ reply: { id: r.reply.id, text: r.reply.text, status: r.reply.status }, needsHuman: r.needsHuman, reason: r.reason });
});
