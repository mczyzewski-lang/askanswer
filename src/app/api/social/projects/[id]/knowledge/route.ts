import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { json, route } from "@/lib/server/http";
import { projectAccess } from "@/lib/server/social/access";

/** knowledge base documents (text / markdown) the AI may use as facts */
export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  await projectAccess(id, "brand.edit");
  const b = z.object({ name: z.string().trim().min(1).max(200), content: z.string().min(1).max(200_000) }).parse(await req.json());
  const d = await prisma.knowledgeDoc.create({ data: { projectId: id, name: b.name, content: b.content } });
  return json({ id: d.id }, 201);
});

export const DELETE = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  await projectAccess(id, "brand.edit");
  const docId = new URL(req.url).searchParams.get("doc") ?? "";
  await prisma.knowledgeDoc.deleteMany({ where: { id: docId, projectId: id } });
  return json({ ok: true });
});
