import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { ownTheme } from "@/lib/server/ads";

/** Ads Studio projects. */
export const GET = route(async () => {
  await requireAdmin();
  const projects = await prisma.project.findMany({
    where: { format: "ADS" },
    orderBy: { updatedAt: "desc" },
    select: { id: true, name: true, updatedAt: true, adsBrollCompositionId: true, _count: { select: { adFootage: true, adReels: true, compositions: true } } },
  });
  // the B-roll cutting edit is not a reel
  return json({ projects: projects.map(({ adsBrollCompositionId, ...p }) => ({ ...p, _count: { ...p._count, compositions: p._count.compositions - (adsBrollCompositionId ? 1 : 0) } })) });
});

export const POST = route(async (req: Request) => {
  await requireAdmin();
  const b = z.object({ name: z.string().trim().min(2).max(120), themeId: z.string().max(64).nullable().optional(), preset: z.string().max(40).optional() }).parse(await req.json());
  const theme = await ownTheme(b.name, { themeId: b.themeId, presetKey: b.preset });
  // 110 reels: no automatic AI illustrations by default (they can be added per reel in the Studio)
  const project = await prisma.project.create({ data: { name: b.name, format: "ADS", themeId: theme?.id ?? null, autoInfographics: false, questionVisibility: "FULL", questionSeconds: 3 } });
  return json(project, 201);
});
