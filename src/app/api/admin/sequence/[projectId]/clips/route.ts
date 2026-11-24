import fsp from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { makeTempDir } from "@/lib/server/storage";
import { ingestSequenceClip } from "@/lib/server/sequence";

export const runtime = "nodejs";
export const maxDuration = 300;

const TYPES: Record<string, string> = { "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm" };

/** One clip of the package (the films refer to it by its file name; the same name again replaces it). */
export const POST = route(async (req: Request, ctx: { params: Promise<{ projectId: string }> }) => {
  await requireAdmin();
  const { projectId } = await ctx.params;
  await prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { id: true } });
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return json({ error: "Brak pliku" }, 400);
  const ext = TYPES[file.type];
  if (!ext) return json({ error: `„${file.name}”: dozwolone są pliki MP4, MOV i WEBM.` }, 415);
  if (file.size > 400 * 1024 * 1024) return json({ error: `„${file.name}”: plik jest za duży (max 400 MB)` }, 413);
  const name = path.basename(file.name).slice(0, 200);
  const dir = await makeTempDir("seq-upload");
  try {
    const p = path.join(dir, `f.${ext}`);
    await fsp.writeFile(p, Buffer.from(await file.arrayBuffer()));
    return json(await ingestSequenceClip(projectId, p, name), 201);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});
