import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { json, route } from "@/lib/server/http";
import { PermanentError } from "@/lib/server/pipeline";
import { accessVia } from "@/lib/server/social/access";
import { mediaView } from "@/lib/server/social/content";
import { deleteMedia } from "@/lib/server/social/media";
import { audit } from "@/lib/server/social/audit";

export const GET = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  await accessVia("media", id);
  const m = await prisma.socialMedia.findUniqueOrThrow({ where: { id }, include: { variants: true, contentItems: { select: { id: true, title: true, createdAt: true, posts: { select: { id: true, status: true, platform: true } } }, orderBy: { createdAt: "desc" } } } });
  return json({ media: await mediaView(m, true), content: m.contentItems });
});

export const PATCH = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  await accessVia("media", id, "content.edit");
  const b = z.object({ title: z.string().max(300).optional(), description: z.string().max(5000).optional() }).parse(await req.json());
  await prisma.socialMedia.update({ where: { id }, data: b });
  return json({ ok: true });
});

export const DELETE = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const a = await accessVia("media", id, "content.edit");
  try {
    await deleteMedia(id);
  } catch (e) {
    if (e instanceof PermanentError) return json({ error: e.message }, 409);
    throw e;
  }
  await audit({ userId: a.user.id, projectId: a.project.id, action: "media.deleted", entityType: "SocialMedia", entityId: id });
  return json({ ok: true });
});
