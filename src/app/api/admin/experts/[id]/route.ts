import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = route(async (req: Request, ctx: Ctx) => {
  await requireAdmin();
  const { id } = await ctx.params;
  const body = z
    .object({ name: z.string().trim().min(2).max(120).optional(), email: z.string().trim().max(200).nullable().optional(), title: z.string().trim().max(160).nullable().optional() })
    .parse(await req.json());
  return json(await prisma.expert.update({ where: { id }, data: body }));
});

export const DELETE = route(async (_req: Request, ctx: Ctx) => {
  await requireAdmin();
  const { id } = await ctx.params;
  await prisma.expert.delete({ where: { id } });
  return json({ ok: true });
});
