import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { storeUpload } from "@/lib/server/uploads";
import { assetInfo } from "@/lib/server/assets";

export const runtime = "nodejs";

const TYPES: Record<string, { kind: "MUSIC" | "IMAGE"; ext: string; max: number }> = {
  "audio/mpeg": { kind: "MUSIC", ext: "mp3", max: 60 },
  "audio/mp3": { kind: "MUSIC", ext: "mp3", max: 60 },
  "audio/wav": { kind: "MUSIC", ext: "wav", max: 100 },
  "audio/x-wav": { kind: "MUSIC", ext: "wav", max: 100 },
  "audio/mp4": { kind: "MUSIC", ext: "m4a", max: 60 },
  "audio/x-m4a": { kind: "MUSIC", ext: "m4a", max: 60 },
  "audio/aac": { kind: "MUSIC", ext: "aac", max: 60 },
  "audio/ogg": { kind: "MUSIC", ext: "ogg", max: 60 },
  "image/png": { kind: "IMAGE", ext: "png", max: 10 },
  "image/jpeg": { kind: "IMAGE", ext: "jpg", max: 10 },
  "image/webp": { kind: "IMAGE", ext: "webp", max: 10 },
};

/** Upload background music or an image for this composition's project. Validated by type, size and probing. */
export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireAdmin();
  const { id } = await ctx.params;
  const comp = await prisma.videoComposition.findUniqueOrThrow({ where: { id } });
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return json({ error: "Brak pliku" }, 400);
  const t = TYPES[file.type];
  if (!t) return json({ error: "Nieobsługiwany format. Dozwolone: MP3, WAV, M4A, AAC, OGG, PNG, JPG, WEBP." }, 415);
  if (file.size > t.max * 1024 * 1024) return json({ error: `Plik jest za duży (max ${t.max} MB)` }, 413);
  const asset = await storeUpload(file, t.kind, t.ext, comp.projectId);
  return json(await assetInfo(asset.id, false), 201);
});
