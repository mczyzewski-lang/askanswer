import { prisma } from "@/lib/server/db";
import { json, route } from "@/lib/server/http";
import { accessVia } from "@/lib/server/social/access";
import { enqueueSocial } from "@/lib/server/social/queue";

/** derived vertical 1080×1920 H.264 version (the original stays as it is) */
export const POST = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const a = await accessVia("media", id, "content.edit");
  const v = await prisma.socialMediaVariant.upsert({ where: { mediaId_kind: { mediaId: id, kind: "vertical-1080" } }, create: { mediaId: id, kind: "vertical-1080", status: "PROCESSING" }, update: { status: "PROCESSING", error: null } });
  const job = await enqueueSocial("social-convert", { variantId: v.id, projectId: a.project.id }, { idempotencyKey: `convert:${v.id}:${Date.now()}`, maxAttempts: 2 });
  return json({ variantId: v.id, jobId: job.id }, 202);
});
