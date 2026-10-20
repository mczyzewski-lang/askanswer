import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";

/** Start a (chunked) upload of a raw footage file. */
export const POST = route(async (req: Request, ctx: { params: Promise<{ projectId: string }> }) => {
  await requireAdmin();
  const { projectId } = await ctx.params;
  const b = z.object({ name: z.string().trim().min(1).max(200), size: z.number().int().min(1) }).parse(await req.json());
  const maxBytes = Number(process.env.ADS_MAX_UPLOAD_MB ?? 8192) * 1024 * 1024;
  if (b.size > maxBytes) return json({ error: `Plik jest za duży (max ${Math.round(maxBytes / 1024 / 1024 / 1024)} GB)` }, 413);
  await prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { id: true } });
  const order = await prisma.adFootage.count({ where: { projectId } });
  const f = await prisma.adFootage.create({ data: { projectId, name: b.name, sizeBytes: BigInt(b.size), order } });
  return json({ id: f.id }, 201);
});
