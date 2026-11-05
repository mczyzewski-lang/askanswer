import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { requireOwner } from "@/lib/server/auth";
import { hashPassword } from "@/lib/server/crypto";
import { json, route } from "@/lib/server/http";

const ROLES = ["ADMIN", "EDITOR", "EXPERT", "VIEWER"] as const;

/** People of the studio with the projects they may open (administrators only). */
export const GET = route(async () => {
  await requireOwner();
  const users = await prisma.user.findMany({
    orderBy: [{ role: "asc" }, { email: "asc" }],
    select: { id: true, email: true, name: true, role: true, googleSub: true, passwordHash: true, lastLoginAt: true, createdAt: true, projectAccess: { select: { projectId: true } } },
  });
  const projects = await prisma.project.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, format: true, adsRecording: true, autoReels: true } });
  return json({
    users: users.map(({ passwordHash, googleSub, projectAccess, ...u }) => ({ ...u, google: !!googleSub, password: !!passwordHash, projectIds: projectAccess.map((a) => a.projectId) })),
    projects: projects.map((p) => ({ id: p.id, name: p.name, kind: p.autoReels ? "Auto Reels" : p.format === "ADS" ? "Ads Studio" : p.adsRecording ? "Reklamy" : "Projekt" })),
  });
});

export const POST = route(async (req: Request) => {
  await requireOwner();
  const b = z
    .object({
      email: z.string().trim().toLowerCase().email(),
      name: z.string().trim().max(120).optional(),
      role: z.enum(ROLES),
      projectIds: z.array(z.string().max(64)).max(500).default([]),
      password: z.string().min(8).max(200).optional(),
    })
    .parse(await req.json());
  if (await prisma.user.findUnique({ where: { email: b.email } })) return json({ error: "Ta osoba ma już konto" }, 409);
  const user = await prisma.user.create({
    data: {
      email: b.email,
      name: b.name || b.email.split("@")[0],
      role: b.role,
      // without a password the person signs in with Google (the same e-mail)
      passwordHash: b.password ? await hashPassword(b.password) : "",
      projectAccess: { create: b.projectIds.map((projectId) => ({ projectId })) },
    },
  });
  return json({ id: user.id }, 201);
});
