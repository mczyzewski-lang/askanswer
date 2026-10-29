import { json, route } from "@/lib/server/http";
import { accessVia } from "@/lib/server/social/access";
import { assertApproved } from "@/lib/server/social/posts";
import { enqueueSocial } from "@/lib/server/social/queue";

/**
 * Send to the provider now. Refused (409) unless the CURRENT version is approved — approval normally
 * queues this by itself; the endpoint exists for "Zaplanuj teraz" and is the guard tests probe.
 */
export const POST = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  await accessVia("post", id, "content.schedule");
  const { post } = await assertApproved(id);
  const job = await enqueueSocial("social-schedule", { postId: id, projectId: post.projectId }, { idempotencyKey: `schedule:${id}:${post.revision}:manual` });
  return json({ jobId: job.id }, 202);
});
