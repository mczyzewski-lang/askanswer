import { z } from "zod";
import { json, route } from "@/lib/server/http";
import { accessVia } from "@/lib/server/social/access";
import { reschedule } from "@/lib/server/social/publisher";
import { zonedToUtc } from "@/lib/social/tz";

/** move the date (calendar drag & drop). An approver's move of an approved post is approved at once; otherwise it needs approval. */
export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const a = await accessVia("post", id, "content.edit");
  const b = z.object({ scheduledAt: z.string().max(40), approve: z.boolean().default(false) }).parse(await req.json());
  const at = /Z|[+-]\d\d:?\d\d$/.test(b.scheduledAt) ? new Date(b.scheduledAt) : zonedToUtc(b.scheduledAt, a.project.timezone);
  const p = await reschedule(id, at, { id: a.user.id, canApprove: b.approve && a.perms.has("content.approve") });
  return json({ id: p.id, status: p.status, revision: p.revision });
});
