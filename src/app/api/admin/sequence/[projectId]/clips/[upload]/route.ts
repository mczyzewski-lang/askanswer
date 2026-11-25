import fsp from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { assembleChunks, chunkDir, readHead, sniffVideo } from "@/lib/server/chunked";
import { HttpError } from "@/lib/server/errors";
import { ingestSequenceClip } from "@/lib/server/sequence";

export const runtime = "nodejs";
export const maxDuration = 300;

/** All slices are there: join them and take the clip into the sequence's library (the same name again replaces it). */
export const POST = route(async (req: Request, ctx: { params: Promise<{ projectId: string; upload: string }> }) => {
  await requireAdmin();
  const { projectId, upload } = await ctx.params;
  if (!/^[a-z0-9]{8,40}$/.test(upload)) throw new HttpError(400, "Nieprawidłowy identyfikator wysyłki");
  const b = z.object({ name: z.string().trim().min(1).max(200), totalChunks: z.number().int().min(1).max(200) }).parse(await req.json());
  await prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { id: true } });
  const id = `${projectId}-${upload}`;
  const name = path.basename(b.name);
  try {
    const { file } = await assembleChunks("seq-uploads", id, b.totalChunks).catch(() => {
      throw new HttpError(409, `„${name}”: brakuje części pliku - wyślij go ponownie`);
    });
    const { head } = await readHead(file);
    if (!sniffVideo(head)) return json({ error: `„${name}”: to nie jest plik wideo (MP4 / MOV / WEBM)` }, 415);
    return json(await ingestSequenceClip(projectId, file, name), 201);
  } finally {
    await fsp.rm(chunkDir("seq-uploads", id), { recursive: true, force: true });
  }
});
