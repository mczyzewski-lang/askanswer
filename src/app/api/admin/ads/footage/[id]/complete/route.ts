import fsp from "node:fs/promises";
import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { diskFullMessage, putFile } from "@/lib/server/storage";
import { assembleChunks, readHead, sniffVideo } from "@/lib/server/chunked";
import { enqueue } from "@/lib/server/jobs";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Assemble the chunks, store the original and queue processing (normalize → transcript). */
export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireAdmin();
  const { id } = await ctx.params;
  const { totalChunks } = z.object({ totalChunks: z.number().int().min(1).max(100_000) }).parse(await req.json());
  const f = await prisma.adFootage.findUniqueOrThrow({ where: { id } });
  if (f.status !== "UPLOADING" && f.originalAssetId) return json({ ok: true, status: f.status });
  const missing: number[] = [];
  for (let i = 0; i < totalChunks; i++) if (!f.receivedChunks.includes(i)) missing.push(i);
  if (missing.length) return json({ error: "Brakuje części pliku", missing }, 409);
  let assembled: string;
  let dir: string;
  try {
    ({ file: assembled, dir } = await assembleChunks("ads-uploads", id, totalChunks));
  } catch (e) {
    const full = diskFullMessage(e);
    if (full) return json({ error: full, code: "disk_full" }, 507);
    throw e;
  }
  const { head, size } = await readHead(assembled);
  const kind = sniffVideo(head);
  if (!kind) {
    await fsp.rm(dir, { recursive: true, force: true });
    await prisma.adFootage.update({ where: { id }, data: { status: "FAILED", error: "To nie jest plik wideo (MP4 / MOV / WEBM)" } });
    return json({ error: "To nie jest plik wideo (MP4 / MOV / WEBM)" }, 415);
  }
  const key = `projects/${f.projectId}/ads/${id}/original.${kind.ext}`;
  await putFile(key, assembled, kind.mime);
  await fsp.rm(dir, { recursive: true, force: true });
  const asset = await prisma.mediaAsset.upsert({
    where: { storageKey: key },
    create: { kind: "RECORDING_ORIGINAL", projectId: f.projectId, storageKey: key, mimeType: kind.mime, sizeBytes: size, hasVideo: true, originalName: f.name },
    update: { sizeBytes: size },
  });
  await prisma.adFootage.update({ where: { id }, data: { status: "PROCESSING", step: "W kolejce do przetworzenia", originalAssetId: asset.id, sizeBytes: BigInt(size) } });
  await enqueue("ads-footage", { footageId: id }, { idempotencyKey: `ads-footage:${id}`, maxAttempts: 2 });
  return json({ ok: true, status: "PROCESSING" });
});
