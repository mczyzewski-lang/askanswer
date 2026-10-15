import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";

type Ctx = { params: Promise<{ id: string; itemId: string }> };

export const PATCH = route(async (req: Request, ctx: Ctx) => {
  await requireAdmin();
  const { id, itemId } = await ctx.params;
  const { label } = z.object({ label: z.string().trim().max(80).nullable() }).parse(await req.json());
  await prisma.voiceCollectionItem.updateMany({ where: { id: itemId, collectionId: id }, data: { label: label || null } });
  return json({ ok: true });
});

export const DELETE = route(async (_req: Request, ctx: Ctx) => {
  await requireAdmin();
  const { id, itemId } = await ctx.params;
  await prisma.voiceCollectionItem.deleteMany({ where: { id: itemId, collectionId: id } });
  return json({ ok: true });
});
