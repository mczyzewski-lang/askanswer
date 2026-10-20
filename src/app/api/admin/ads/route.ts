import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";

/** Ads Studio projects. */
export const GET = route(async () => {
  await requireAdmin();
  const projects = await prisma.project.findMany({
    where: { format: "ADS" },
    orderBy: { updatedAt: "desc" },
    select: { id: true, name: true, updatedAt: true, _count: { select: { adFootage: true, adReels: true, compositions: true } } },
  });
  return json({ projects });
});

export const POST = route(async (req: Request) => {
  await requireAdmin();
  const b = z.object({ name: z.string().trim().min(2).max(120), themeId: z.string().max(64).nullable().optional() }).parse(await req.json());
  const theme = b.themeId ? await prisma.theme.findUnique({ where: { id: b.themeId } }) : await prisma.theme.findFirst({ orderBy: { createdAt: "asc" } });
  // 110 reels: no automatic AI illustrations by default (they can be added per reel in the Studio)
  const project = await prisma.project.create({ data: { name: b.name, format: "ADS", themeId: theme?.id ?? null, autoInfographics: false, questionVisibility: "FIRST_SECONDS", questionSeconds: 3 } });
  return json(project, 201);
});
