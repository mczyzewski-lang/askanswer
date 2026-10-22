import fsp from "node:fs/promises";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { ingestOverlayVideo, storeUpload } from "@/lib/server/uploads";
import { makeTempDir } from "@/lib/server/storage";
import { probe } from "@/lib/server/ffmpeg";
import { assetInfo } from "@/lib/server/assets";
import { brollLibrary } from "@/lib/server/broll-library";

export const runtime = "nodejs";
export const maxDuration = 300;

const VIDEO: Record<string, string> = { "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm" };
const IMAGE: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

export const GET = route(async (_req: Request, ctx: { params: Promise<{ projectId: string }> }) => {
  await requireAdmin();
  const { projectId } = await ctx.params;
  return json({ items: await brollLibrary(projectId) });
});

/** Add a cutaway (video up to 5 min / 300 MB, or a still image) to the campaign's B-roll library. */
export const POST = route(async (req: Request, ctx: { params: Promise<{ projectId: string }> }) => {
  await requireAdmin();
  const { projectId } = await ctx.params;
  await prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { id: true } });
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return json({ error: "Brak pliku" }, 400);
  if (file.size > 300 * 1024 * 1024) return json({ error: "Plik jest za duży (max 300 MB)" }, 413);
  if (VIDEO[file.type]) {
    const dir = await makeTempDir("broll");
    try {
      const p = path.join(dir, `src.${VIDEO[file.type]}`);
      await fsp.writeFile(p, Buffer.from(await file.arrayBuffer()));
      const info = await probe(p).catch(() => null);
      if (!info?.hasVideo) return json({ error: "Plik wideo jest uszkodzony lub ma nieprawidłowy format" }, 415);
      if (info.duration > 300) return json({ error: "Przebitka może mieć maksymalnie 5 minut" }, 413);
      const a = await ingestOverlayVideo(p, dir, projectId, file.name, { library: "broll" });
      return json(await assetInfo(a.id), 201);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  }
  if (IMAGE[file.type]) {
    const a = await storeUpload(file, "IMAGE", IMAGE[file.type], projectId);
    await prisma.mediaAsset.update({ where: { id: a.id }, data: { meta: { library: "broll" } as Prisma.InputJsonValue } });
    return json(await assetInfo(a.id), 201);
  }
  return json({ error: "Nieobsługiwany format. Dozwolone: MP4, MOV, WEBM, PNG, JPG, WEBP." }, 415);
});
