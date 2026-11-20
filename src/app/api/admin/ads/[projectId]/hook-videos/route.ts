import fsp from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { makeTempDir } from "@/lib/server/storage";
import { attachHookVideo, hookCodeOf, ingestHookClip } from "@/lib/server/ads";

export const runtime = "nodejs";
export const maxDuration = 300;

const TYPES: Record<string, string> = { "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm" };

/**
 * A client clip for one hook: the file name starts with the reel's code (p01-h05_opis.mp4) and the
 * reel gets a separate hook version "[klient] P01-h05" next to the expert's own.
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
  const code = hookCodeOf(file.name);
  if (!code) return json({ error: `„${file.name}”: nazwa pliku musi zaczynać się od kodu reelsa i hooka, np. p01-h05_opis.mp4` }, 400);
  const reels = await prisma.adReel.findMany({ where: { projectId }, select: { code: true, compositionId: true } });
  const reel = reels.find((r) => r.code.toLowerCase().replace(/[\s._;]+/g, "-") === code);
  if (!reel) return json({ error: `„${file.name}”: w scenariuszu nie ma reelsa ${code.toUpperCase()}` }, 404);
  if (!reel.compositionId) return json({ error: `„${file.name}”: reels ${reel.code} nie jest jeszcze ułożony - najpierw ułóż reelsy` }, 409);
  const dir = await makeTempDir("hook-upload");
  try {
    const p = path.join(dir, `f.${ext}`);
    await fsp.writeFile(p, Buffer.from(await file.arrayBuffer()));
    const sound = form.get("sound") !== "0";
    const asset = await ingestHookClip(p, projectId, file.name);
    return json({ ...(await attachHookVideo(projectId, asset, file.name, { sound })), warning: sound ? asset.warning : null }, 201);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});
