import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/server/db";
import { json, route } from "@/lib/server/http";
import { resolveToken } from "@/lib/server/invitations";
import { diskFullMessage, putFile, tmpDir } from "@/lib/server/storage";
import { enqueue } from "@/lib/server/jobs";
import { env } from "@/lib/server/env";

export const runtime = "nodejs";

const Body = z.object({
  totalChunks: z.number().int().min(1).max(10_000),
  durationSec: z.number().optional(),
  markers: z.object({ narrationStart: z.number().nullable().optional(), narrationEnd: z.number().nullable().optional(), mirrored: z.boolean().optional() }).optional(),
});

function sniff(head: Buffer): "webm" | "mp4" | null {
  if (head.length >= 4 && head.readUInt32BE(0) === 0x1a45dfa3) return "webm";
  if (head.length >= 8 && head.subarray(4, 8).toString("latin1") === "ftyp") return "mp4";
  return null;
}

/** Assemble uploaded chunks, store the untouched original and queue processing. Safe to retry. */
export const POST = route(async (req: Request, ctx: { params: Promise<{ token: string; takeId: string }> }) => {
  const { token, takeId } = await ctx.params;
  const inv = await resolveToken(token);
  const body = Body.parse(await req.json());
  const take = await prisma.recordingTake.findUnique({ where: { id: takeId }, include: { recording: true } });
  if (!take || take.recording.expertId !== inv.expertId || take.recording.projectId !== inv.projectId) return json({ error: "Nie znaleziono nagrania" }, 404);
  if (take.status !== "UPLOADING" && take.originalAssetId) return json({ ok: true, status: take.status });
  const missing: number[] = [];
  for (let i = 0; i < body.totalChunks; i++) if (!take.receivedChunks.includes(i)) missing.push(i);
  if (missing.length) return json({ error: "Brakuje części nagrania", missing }, 409);

  const dir = tmpDir("uploads", take.id);
  const assembled = path.join(dir, "assembled.bin");
  const parts = Array.from({ length: body.totalChunks }, (_, i) => path.join(dir, `${String(i).padStart(5, "0")}.part`));
  try {
    const out = fs.createWriteStream(assembled);
    for (const part of parts) await pipeline(fs.createReadStream(part), out, { end: false });
    await new Promise<void>((r, j) => out.end((e?: Error | null) => (e ? j(e) : r())));
  } catch (e) {
    await fsp.rm(assembled, { force: true });
    const full = diskFullMessage(e);
    // the chunks are kept, so the phone can simply retry later
    if (full) return json({ error: full, code: "disk_full" }, 507);
    throw e;
  }
  // the parts are no longer needed — free the space before storing the original
  await Promise.all(parts.map((p) => fsp.rm(p, { force: true })));
  const fd = await fsp.open(assembled, "r");
  const head = Buffer.alloc(16);
  await fd.read(head, 0, 16, 0);
  const size = (await fd.stat()).size;
  await fd.close();
  const kind = sniff(head);
  if (!kind) {
    await prisma.recordingTake.update({ where: { id: take.id }, data: { status: "FAILED", processingError: "Plik nie jest prawidłowym nagraniem wideo" } });
    return json({ error: "Plik nie jest prawidłowym nagraniem wideo (WebM/MP4)" }, 415);
  }
  if (size > env.maxUploadBytes) return json({ error: "Nagranie przekracza maksymalny rozmiar" }, 413);

  const key = `projects/${take.recording.projectId}/takes/${take.id}/original.${kind}`;
  await putFile(key, assembled, kind === "webm" ? "video/webm" : "video/mp4");
  const asset = await prisma.mediaAsset.upsert({
    where: { storageKey: key },
    create: { kind: "RECORDING_ORIGINAL", projectId: take.recording.projectId, storageKey: key, mimeType: kind === "webm" ? "video/webm" : "video/mp4", sizeBytes: size, hasVideo: true, originalName: `nagranie-${take.takeNumber}.${kind}` },
    update: { sizeBytes: size },
  });
  await prisma.recordingTake.update({
    where: { id: take.id },
    data: {
      status: "UPLOADED",
      originalAssetId: asset.id,
      totalChunks: body.totalChunks,
      durationSec: body.durationSec ?? take.durationSec,
      ...(body.markers ? { markers: body.markers as Prisma.InputJsonValue } : {}),
      processingStep: "W kolejce do przetworzenia",
    },
  });
  await prisma.recording.update({ where: { id: take.recordingId }, data: { selectedTakeId: take.id } });
  const q = await prisma.question.findUnique({ where: { id: take.recording.questionId } });
  if (q && ["TO_RECORD", "IN_PROGRESS", "NEEDS_FIX"].includes(q.status)) await prisma.question.update({ where: { id: q.id }, data: { status: "RECORDED" } });
  await enqueue("process-take", { takeId: take.id }, { idempotencyKey: `process:${take.id}`, maxAttempts: 3 });
  await fsp.rm(dir, { recursive: true, force: true });
  return json({ ok: true, status: "UPLOADED", assetId: asset.id });
});
