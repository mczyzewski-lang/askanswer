import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { json, route } from "@/lib/server/http";
import { accessVia } from "@/lib/server/social/access";
import { updatePost } from "@/lib/server/social/posts";

/** bring back the texts of an earlier revision (as a new revision) */
export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const a = await accessVia("post", id, "content.edit");
  const b = z.object({ revision: z.number().int().min(1) }).parse(await req.json());
  const r = await prisma.contentRevision.findUnique({ where: { platformPostId_revision: { platformPostId: id, revision: b.revision } } });
  const s = r?.snapshot as { title?: string; description?: string; hashtags?: string[]; cta?: string; firstComment?: string } | undefined;
  if (!s || s.description === undefined) return json({ error: "Ta wersja nie zawiera tekstów do przywrócenia" }, 404);
  const p = await updatePost(id, { title: s.title, description: s.description, hashtags: s.hashtags, cta: s.cta, firstComment: s.firstComment }, a.user.id, `przywrócono wersję ${b.revision}`);
  return json({ id: p.id, revision: p.revision });
});
