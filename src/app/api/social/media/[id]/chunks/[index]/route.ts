import fsp from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/server/db";
import { json, route } from "@/lib/server/http";
import { tmpDir } from "@/lib/server/storage";
import { accessVia } from "@/lib/server/social/access";

export const runtime = "nodejs";
const MAX_CHUNK = 16 * 1024 * 1024;

/** one slice of a film; re-sending a slice overwrites it */
export const PUT = route(async (req: Request, ctx: { params: Promise<{ id: string; index: string }> }) => {
  const { id, index } = await ctx.params;
  await accessVia("media", id, "content.edit");
  const i = Number(index);
  if (!Number.isInteger(i) || i < 0 || i > 100_000) return json({ error: "Nieprawidłowy numer części" }, 400);
  const m = await prisma.socialMedia.findUniqueOrThrow({ where: { id } });
  if (m.status !== "UPLOADING") return json({ ok: true, alreadyComplete: true });
  // no more slices than the declared size needs (8 MB slices; protects the disk)
  if (i > Math.ceil(Number(m.sizeBytes) / (8 * 1024 * 1024)) + 1) return json({ error: "Więcej części niż wynika z rozmiaru pliku" }, 400);
  const buf = Buffer.from(await req.arrayBuffer());
  if (!buf.length || buf.length > MAX_CHUNK) return json({ error: "Nieprawidłowy rozmiar części" }, 400);
  const dir = tmpDir("social-uploads", id);
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, `${String(i).padStart(6, "0")}.part`), buf);
  return json({ ok: true });
});
