import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { ensureDiskFor } from "@/lib/server/chunked";

/** EduStudio videos, newest first. */
export const GET = route(async () => {
  await requireAdmin();
  const rows = await prisma.eduVideo.findMany({ orderBy: { createdAt: "desc" }, select: { id: true, name: true, status: true, step: true, error: true, sizeBytes: true, durationSec: true, cuts: true, createdAt: true, exportAssetId: true } });
  return json({ videos: rows.map(({ cuts, ...r }) => ({ ...r, cuts: Array.isArray(cuts) ? cuts.length : 0 })) });
});

/** Start a sliced upload of an educational video (it is processed by the worker afterwards). */
export const POST = route(async (req: Request) => {
  await requireAdmin();
  const b = z.object({ name: z.string().trim().min(1).max(200), size: z.number().int().min(1) }).parse(await req.json());
  const maxBytes = Number(process.env.ADS_MAX_UPLOAD_MB ?? 8192) * 1024 * 1024;
  if (b.size > maxBytes) return json({ error: `Plik jest za duży (max ${Math.round(maxBytes / 1024 / 1024 / 1024)} GB)` }, 413);
  await ensureDiskFor(b.size);
  const s = await prisma.uploadSession.create({ data: { projectId: "edu", purpose: "edu", name: b.name, sizeBytes: BigInt(b.size) } });
  const e = await prisma.eduVideo.create({ data: { name: b.name, sizeBytes: BigInt(b.size), uploadSessionId: s.id } });
  return json({ id: e.id, sessionId: s.id }, 201);
});
