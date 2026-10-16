import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { ensureProjectExpert } from "@/lib/server/project-experts";

type Ctx = { params: Promise<{ id: string }> };

/** Add an existing expert (from "Eksperci") to the project, or create a new one and add it. */
export const POST = route(async (req: Request, ctx: Ctx) => {
  await requireAdmin();
  const { id } = await ctx.params;
  const body = z
    .union([
      z.object({ expertId: z.string().min(1).max(64) }),
      z.object({ name: z.string().trim().min(2).max(120), title: z.string().trim().max(120).optional(), email: z.string().trim().email().max(200).optional().or(z.literal("")) }),
    ])
    .parse(await req.json());
  await prisma.project.findUniqueOrThrow({ where: { id }, select: { id: true } });
  const expert =
    "expertId" in body
      ? await prisma.expert.findUniqueOrThrow({ where: { id: body.expertId } })
      : await prisma.expert.create({ data: { name: body.name, title: body.title || null, email: body.email || null } });
  await ensureProjectExpert(id, expert.id);
  return json({ ok: true, expert }, 201);
});
