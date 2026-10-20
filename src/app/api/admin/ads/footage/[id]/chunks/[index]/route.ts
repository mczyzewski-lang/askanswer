import fsp from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { tmpDir } from "@/lib/server/storage";

export const runtime = "nodejs";
const MAX_CHUNK = 16 * 1024 * 1024;

/** One slice of a footage file. Idempotent: re-sending a chunk overwrites it. */
export const PUT = route(async (req: Request, ctx: { params: Promise<{ id: string; index: string }> }) => {
  await requireAdmin();
  const { id, index } = await ctx.params;
  const i = Number(index);
  if (!Number.isInteger(i) || i < 0 || i > 100_000) return json({ error: "Nieprawidłowy numer części" }, 400);
  const f = await prisma.adFootage.findUniqueOrThrow({ where: { id } });
  if (f.status !== "UPLOADING") return json({ ok: true, alreadyComplete: true });
  const buf = Buffer.from(await req.arrayBuffer());
  if (!buf.length || buf.length > MAX_CHUNK) return json({ error: "Nieprawidłowy rozmiar części" }, 400);
  const dir = tmpDir("ads-uploads", id);
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, `${String(i).padStart(6, "0")}.part`), buf);
  await prisma.$executeRaw`UPDATE "AdFootage" SET "receivedChunks" = (SELECT ARRAY(SELECT DISTINCT unnest("receivedChunks" || ${i}::int) ORDER BY 1)), "updatedAt" = now() WHERE id = ${id}`;
  return json({ ok: true });
});
