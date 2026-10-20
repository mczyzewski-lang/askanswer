import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { diskFullMessage, putFile, tmpDir } from "@/lib/server/storage";
import { enqueue } from "@/lib/server/jobs";

export const runtime = "nodejs";
export const maxDuration = 300;

function sniff(head: Buffer): { ext: string; mime: string } | null {
  if (head.length >= 4 && head.readUInt32BE(0) === 0x1a45dfa3) return { ext: "webm", mime: "video/webm" };
  if (head.length >= 8 && head.subarray(4, 8).toString("latin1") === "ftyp") {
    const brand = head.subarray(8, 12).toString("latin1");
    return brand === "qt  " ? { ext: "mov", mime: "video/quicktime" } : { ext: "mp4", mime: "video/mp4" };
  }
  return null;
}

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
  const dir = tmpDir("ads-uploads", id);
  const assembled = path.join(dir, "assembled.bin");
  const parts = Array.from({ length: totalChunks }, (_, i) => path.join(dir, `${String(i).padStart(6, "0")}.part`));
  try {
    const out = fs.createWriteStream(assembled);
    for (const part of parts) await pipeline(fs.createReadStream(part), out, { end: false });
    await new Promise<void>((r, j) => out.end((e?: Error | null) => (e ? j(e) : r())));
  } catch (e) {
    await fsp.rm(assembled, { force: true });
    const full = diskFullMessage(e);
    if (full) return json({ error: full, code: "disk_full" }, 507);
    throw e;
  }
  await Promise.all(parts.map((p) => fsp.rm(p, { force: true })));
  const fd = await fsp.open(assembled, "r");
  const head = Buffer.alloc(16);
  await fd.read(head, 0, 16, 0);
  const size = (await fd.stat()).size;
  await fd.close();
  const kind = sniff(head);
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
