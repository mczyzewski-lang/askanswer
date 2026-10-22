import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { ownTheme } from "@/lib/server/ads";

/** Use another theme (copied, so the source project is not affected) or a colour preset for the campaign. */
export const POST = route(async (req: Request, ctx: { params: Promise<{ projectId: string }> }) => {
  await requireAdmin();
  const { projectId } = await ctx.params;
  const b = z.object({ themeId: z.string().max(64).optional(), preset: z.string().max(40).optional() }).parse(await req.json());
  const p = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { id: true, name: true, themeId: true } });
  const t = await ownTheme(p.name, { themeId: b.themeId ?? null, presetKey: b.preset ?? null });
  await prisma.project.update({ where: { id: p.id }, data: { themeId: t.id } });
  // the previous own theme, if nothing else uses it
  if (p.themeId && p.themeId !== t.id && !(await prisma.project.count({ where: { themeId: p.themeId } }))) await prisma.theme.deleteMany({ where: { id: p.themeId, isPreset: false } });
  return json({ themeId: t.id });
});
