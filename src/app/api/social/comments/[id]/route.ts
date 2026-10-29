import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { json, route } from "@/lib/server/http";
import { accessVia } from "@/lib/server/social/access";
import { audit } from "@/lib/server/social/audit";

/** handling status / read */
export const PATCH = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const a = await accessVia("comment", id, "comments.reply");
  const b = z.object({ status: z.enum(["NEW", "NEEDS_REPLY", "REPLIED", "IGNORED", "ESCALATED"]).optional(), read: z.boolean().optional() }).parse(await req.json());
  await prisma.socialComment.update({ where: { id }, data: { ...(b.status ? { status: b.status } : {}), ...(b.read !== undefined ? { readAt: b.read ? new Date() : null } : {}) } });
  if (b.status) await audit({ userId: a.user.id, projectId: a.project.id, action: "comment.status", entityType: "SocialComment", entityId: id, data: { status: b.status } });
  return json({ ok: true });
});
