import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { requireOwner } from "@/lib/server/auth";
import { hashPassword } from "@/lib/server/crypto";
import { json, route } from "@/lib/server/http";

const ROLES = ["ADMIN", "EDITOR", "EXPERT", "VIEWER"] as const;

/** Change a person's role, name, password or the projects they may open. */
export const PATCH = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const me = await requireOwner();
  const { id } = await ctx.params;
  const b = z
    .object({ role: z.enum(ROLES).optional(), name: z.string().trim().min(1).max(120).optional(), projectIds: z.array(z.string().max(64)).max(500).optional(), password: z.string().min(8).max(200).optional() })
    .parse(await req.json());
  if (id === me.id && b.role && b.role !== "ADMIN") return json({ error: "Nie możesz odebrać sobie roli administratora" }, 400);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id }, data: { ...(b.role ? { role: b.role } : {}), ...(b.name ? { name: b.name } : {}), ...(b.password ? { passwordHash: await hashPassword(b.password) } : {}) } });
    if (b.projectIds) {
      await tx.projectAccess.deleteMany({ where: { userId: id, projectId: { notIn: b.projectIds } } });
      const have = new Set((await tx.projectAccess.findMany({ where: { userId: id }, select: { projectId: true } })).map((a) => a.projectId));
      const add = b.projectIds.filter((p) => !have.has(p));
      if (add.length) await tx.projectAccess.createMany({ data: add.map((projectId) => ({ userId: id, projectId })), skipDuplicates: true });
    }
  });
  return json({ ok: true });
});

export const DELETE = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const me = await requireOwner();
  const { id } = await ctx.params;
  if (id === me.id) return json({ error: "Nie możesz usunąć własnego konta" }, 400);
  try {
    await prisma.user.delete({ where: { id } });
  } catch {
    return json({ error: "Tego konta nie da się usunąć (jest powiązane z Social Media Studio) — zmień mu rolę na „Przeglądający” i odbierz projekty." }, 409);
  }
  return json({ ok: true });
});
