import { z } from "zod";
import { json, route } from "@/lib/server/http";
import { accessVia } from "@/lib/server/social/access";
import { approveReply } from "@/lib/server/social/comments";

/** accept (and maybe edit) a draft, or write one's own reply — then it is sent once */
export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const a = await accessVia("comment", id, "comments.reply");
  const b = z.object({ text: z.string().trim().min(2).max(2000), replyId: z.string().max(64).nullish(), visibility: z.enum(["PUBLIC", "PRIVATE"]).default("PUBLIC") }).parse(await req.json());
  const r = await approveReply({ commentId: id, replyId: b.replyId, text: b.text, visibility: b.visibility, userId: a.user.id });
  return json({ id: r.id, status: r.status }, 202);
});
