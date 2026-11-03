import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { chunkIndex, saveChunk } from "@/lib/server/chunked";

export const runtime = "nodejs";

/** One slice of a footage file. Idempotent: re-sending a chunk overwrites it. */
export const PUT = route(async (req: Request, ctx: { params: Promise<{ id: string; index: string }> }) => {
  await requireAdmin();
  const { id, index } = await ctx.params;
  const i = chunkIndex(index);
  const f = await prisma.adFootage.findUniqueOrThrow({ where: { id } });
  if (f.status !== "UPLOADING") return json({ ok: true, alreadyComplete: true });
  await saveChunk("ads-uploads", id, i, req);
  await prisma.$executeRaw`UPDATE "AdFootage" SET "receivedChunks" = (SELECT ARRAY(SELECT DISTINCT unnest("receivedChunks" || ${i}::int) ORDER BY 1)), "updatedAt" = now() WHERE id = ${id}`;
  return json({ ok: true });
});
