import { z } from "zod";
import { json, route } from "@/lib/server/http";
import { projectAccess } from "@/lib/server/social/access";
import { createContent } from "@/lib/server/social/posts";
import { enqueueSocial } from "@/lib/server/social/queue";

/** a film's publications on the chosen accounts (+ "Przygotuj publikacje z AI" right away) */
export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const a = await projectAccess(id, "content.edit");
  const b = z.object({ mediaId: z.string().max(64), accountIds: z.array(z.string().max(64)).min(1).max(20), title: z.string().max(300).optional(), goal: z.string().max(2000).optional(), generate: z.boolean().default(true) }).parse(await req.json());
  const item = await createContent(id, b.mediaId, b.accountIds, a.user.id, { title: b.title, goal: b.goal });
  const job = b.generate ? await enqueueSocial("social-generate", { contentItemId: item.id, projectId: id, userId: a.user.id }, { idempotencyKey: `generate:${item.id}:initial`, maxAttempts: 2 }) : null;
  return json({ id: item.id, jobId: job?.id ?? null }, 201);
});
