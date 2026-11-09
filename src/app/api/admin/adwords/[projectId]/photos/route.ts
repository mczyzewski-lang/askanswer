import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { storeUpload } from "@/lib/server/uploads";

export const runtime = "nodejs";
const TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const MAX = 15 * 1024 * 1024;

/**
 * Add a real photo of an expert to the project theme's library. The file is checked by its content
 * (ffprobe), stored privately under a random name and only shown through signed links.
 */
export const POST = route(async (req: Request, ctx: { params: Promise<{ projectId: string }> }) => {
  await requireAdmin();
  const { projectId } = await ctx.params;
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { themeId: true } });
  if (!project.themeId) return json({ error: "Projekt nie ma motywu" }, 400);
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return json({ error: "Brak pliku" }, 400);
  const ext = TYPES[file.type];
  if (!ext || !/\.(png|jpe?g|webp)$/i.test(file.name)) return json({ error: "Zdjęcie musi być w formacie JPG, PNG lub WEBP" }, 415);
  if (file.size > MAX) return json({ error: "Zdjęcie może mieć maksymalnie 15 MB" }, 413);
  const m = z
    .object({
      key: z.string().trim().min(1).max(60).regex(/^[\w.-]+$/, "Klucz: litery, cyfry, _ - ."),
      name: z.string().trim().min(1).max(120),
      role: z.string().trim().max(120).optional(),
      altText: z.string().trim().max(300).optional(),
      consentConfirmed: z.enum(["true", "false"]).default("false"),
      consentNote: z.string().trim().max(500).optional(),
    })
    .parse(Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string")));
  if (await prisma.adwordsExpertPhoto.findUnique({ where: { themeId_key: { themeId: project.themeId, key: m.key } } })) return json({ error: `Klucz „${m.key}” jest już używany` }, 409);
  const asset = await storeUpload(file, "IMAGE", ext, projectId);
  const consent = m.consentConfirmed === "true";
  const photo = await prisma.adwordsExpertPhoto.create({
    data: { themeId: project.themeId, key: m.key, name: m.name, role: m.role || null, altText: m.altText || null, assetId: asset.id, consentConfirmed: consent, consentNote: m.consentNote || null, consentAt: consent ? new Date() : null },
  });
  // components that waited for this key get it
  await prisma.adwordsAsset.updateMany({ where: { projectId, expertPhotoKey: m.key, expertPhotoId: null }, data: { expertPhotoId: photo.id } });
  return json(photo, 201);
});

/** Assign a library photo to every component with this expert_photo_key (from the CSV). */
export const PUT = route(async (req: Request, ctx: { params: Promise<{ projectId: string }> }) => {
  await requireAdmin();
  const { projectId } = await ctx.params;
  const b = z.object({ key: z.string().min(1).max(60), photoId: z.string().max(64).nullable() }).parse(await req.json());
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { themeId: true } });
  if (b.photoId) await prisma.adwordsExpertPhoto.findFirstOrThrow({ where: { id: b.photoId, themeId: project.themeId ?? "-" } });
  const r = await prisma.adwordsAsset.updateMany({ where: { projectId, expertPhotoKey: b.key }, data: { expertPhotoId: b.photoId } });
  return json({ ok: true, updated: r.count });
});
