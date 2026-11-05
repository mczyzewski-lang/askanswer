import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { ownTheme } from "@/lib/server/ads";

/** Auto Reels projects (a long recording → many reels). */
export const GET = route(async () => {
  await requireAdmin();
  const projects = await prisma.project.findMany({
    where: { format: "ADS", autoReels: true },
    orderBy: { updatedAt: "desc" },
    select: { id: true, name: true, updatedAt: true, autoReelsStatus: true, autoReelsStep: true, autoReelsCount: true, _count: { select: { adFootage: true, adReels: true } } },
  });
  return json({ projects });
});

export const POST = route(async (req: Request) => {
  await requireAdmin();
  const b = z
    .object({
      name: z.string().trim().min(2).max(120),
      preset: z.string().max(40).optional(),
      themeId: z.string().max(64).nullable().optional(),
      count: z.number().int().min(1).max(60).default(25),
      min: z.number().int().min(10).max(170).default(20),
      max: z.number().int().min(15).max(180).default(120),
    })
    .refine((x) => x.max >= x.min + 5, { message: "Długość maksymalna musi być większa od minimalnej" })
    .parse(await req.json());
  const theme = await ownTheme(b.name, { themeId: b.themeId, presetKey: b.preset });
  // finishing of every reel: zooms for pace and AI graphics; the sound stays as recorded
  const project = await prisma.project.create({
    data: {
      name: b.name,
      format: "ADS",
      autoReels: true,
      autoReelsCount: b.count,
      autoReelsMin: b.min,
      autoReelsMax: b.max,
      themeId: theme.id,
      questionVisibility: "FULL",
      questionSeconds: 3,
      autoInfographics: true,
      autoZooms: true,
      autoVoice: false,
      autoBlur: false,
      autoImageEnhance: false,
      adsBrollPerReel: 0,
    },
  });
  return json(project, 201);
});
