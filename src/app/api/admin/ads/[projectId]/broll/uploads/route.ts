import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import fsp from "node:fs/promises";
import { chunkDir, ensureDiskFor } from "@/lib/server/chunked";

/** Start a sliced upload of a B-roll video (any size the disk can take); it is converted by the worker. */
export const POST = route(async (req: Request, ctx: { params: Promise<{ projectId: string }> }) => {
  await requireAdmin();
  const { projectId } = await ctx.params;
  const b = z.object({ name: z.string().trim().min(1).max(200), size: z.number().int().min(1) }).parse(await req.json());
  const maxBytes = Number(process.env.ADS_MAX_UPLOAD_MB ?? 8192) * 1024 * 1024;
  if (b.size > maxBytes) return json({ error: `Plik jest za duży (max ${Math.round(maxBytes / 1024 / 1024 / 1024)} GB)` }, 413);
  await prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { id: true } });
  // slices of uploads abandoned more than a day ago free their disk space first
  const stale = await prisma.uploadSession.findMany({ where: { status: "UPLOADING", updatedAt: { lt: new Date(Date.now() - 86400e3) } }, select: { id: true } });
  for (const x of stale) await fsp.rm(chunkDir("uploads", x.id), { recursive: true, force: true });
  if (stale.length) await prisma.uploadSession.updateMany({ where: { id: { in: stale.map((x) => x.id) } }, data: { status: "FAILED", error: "Wysyłanie przerwane" } });
  await ensureDiskFor(b.size);
  const s = await prisma.uploadSession.create({ data: { projectId, purpose: "broll", name: b.name, sizeBytes: BigInt(b.size) } });
  return json({ id: s.id }, 201);
});
