import { prisma } from "@/lib/server/db";
import { HttpError } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { accessVia } from "@/lib/server/social/access";
import { rejectReply } from "@/lib/server/social/comments";

export const POST = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const r = await prisma.commentReply.findUnique({ where: { id }, select: { commentId: true } });
  if (!r) throw new HttpError(404, "Nie znaleziono");
  const a = await accessVia("comment", r.commentId, "comments.reply");
  await rejectReply(id, a.user.id);
  return json({ ok: true });
});
