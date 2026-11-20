import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { storeUpload } from "@/lib/server/uploads";
import { attachHookVideo, hookCodeOf } from "@/lib/server/ads";

export const runtime = "nodejs";
export const maxDuration = 300;

const TYPES: Record<string, string> = { "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm" };

/**
 * One video for one hook version: the file name starts with the reel's code (p01-h05_opis.mp4) and
 * the clip becomes a layer over the start of that reel, shown in this hook version only.
 */
export const POST = route(async (req: Request, ctx: { params: Promise<{ projectId: string }> }) => {
  await requireAdmin();
  const { projectId } = await ctx.params;
  await prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { id: true } });
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return json({ error: "Brak pliku" }, 400);
  const ext = TYPES[file.type];
  if (!ext) return json({ error: `„${file.name}”: dozwolone są pliki MP4, MOV i WEBM.` }, 415);
  if (file.size > 300 * 1024 * 1024) return json({ error: `„${file.name}”: plik jest za duży (max 300 MB)` }, 413);
  // checked before the file is stored, so a wrong name leaves nothing behind
  if (!hookCodeOf(file.name)) return json({ error: `„${file.name}”: nazwa pliku musi zaczynać się od kodu reelsa i hooka, np. p01-h05_opis.mp4` }, 400);
  const asset = await storeUpload(file, "OVERLAY_VIDEO", ext, projectId);
  return json(await attachHookVideo(projectId, asset, file.name, { sound: form.get("sound") === "1", hideSubtitles: form.get("hideSubtitles") === "1" }), 201);
});
