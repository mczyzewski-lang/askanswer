import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";

async function photoOfProject(projectId: string, photoId: string) {
  const p = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { themeId: true } });
  return prisma.adwordsExpertPhoto.findFirstOrThrow({ where: { id: photoId, themeId: p.themeId ?? "-" } });
}

/** Name / role / alt / focal point, and the consent (date recorded when confirmed). */
export const PATCH = route(async (req: Request, ctx: { params: Promise<{ projectId: string; photoId: string }> }) => {
  await requireAdmin();
  const { projectId, photoId } = await ctx.params;
  const photo = await photoOfProject(projectId, photoId);
  const b = z
    .object({
      name: z.string().trim().min(1).max(120).optional(),
      role: z.string().trim().max(120).nullable().optional(),
      altText: z.string().trim().max(300).nullable().optional(),
      focalX: z.number().min(0).max(1).optional(),
      focalY: z.number().min(0).max(1).optional(),
      consentConfirmed: z.boolean().optional(),
      consentNote: z.string().trim().max(500).nullable().optional(),
    })
    .parse(await req.json());
  await prisma.adwordsExpertPhoto.update({
    where: { id: photo.id },
    data: { ...b, ...(b.consentConfirmed != null ? { consentAt: b.consentConfirmed ? new Date() : null } : {}) },
  });
  return json({ ok: true });
});

export const DELETE = route(async (_req: Request, ctx: { params: Promise<{ projectId: string; photoId: string }> }) => {
  await requireAdmin();
  const { projectId, photoId } = await ctx.params;
  const photo = await photoOfProject(projectId, photoId);
  await prisma.adwordsAsset.updateMany({ where: { projectId, expertPhotoId: photo.id }, data: { expertPhotoId: null } });
  await prisma.adwordsExpertPhoto.delete({ where: { id: photo.id } });
  return json({ ok: true });
});
