import fsp from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/server/db";
import { json, route } from "@/lib/server/http";
import { resolveToken } from "@/lib/server/invitations";
import { tmpDir } from "@/lib/server/storage";
import { rateLimit } from "@/lib/server/ratelimit";

export const runtime = "nodejs";
const MAX_CHUNK = 8 * 1024 * 1024;

/** Upload one slice of a take. Idempotent: re-sending a chunk overwrites it. */
export const PUT = route(async (req: Request, ctx: { params: Promise<{ token: string; takeId: string; index: string }> }) => {
  const { token, takeId, index } = await ctx.params;
  const inv = await resolveToken(token);
  if (!rateLimit(`chunk:${inv.id}`, { capacity: 600, perMinute: 600 })) return json({ error: "Zbyt wiele żądań" }, 429);
  const i = Number(index);
  if (!Number.isInteger(i) || i < 0 || i > 10_000) return json({ error: "Nieprawidłowy numer części" }, 400);
  const take = await prisma.recordingTake.findUnique({ where: { id: takeId }, include: { recording: true } });
  if (!take || take.recording.expertId !== inv.expertId || take.recording.projectId !== inv.projectId) return json({ error: "Nie znaleziono nagrania" }, 404);
  if (take.status !== "UPLOADING") return json({ ok: true, alreadyComplete: true, receivedChunks: take.receivedChunks });
  const len = Number(req.headers.get("content-length") ?? "0");
  if (len > MAX_CHUNK) return json({ error: "Część pliku jest za duża" }, 413);
  const buf = Buffer.from(await req.arrayBuffer());
  if (buf.length === 0 || buf.length > MAX_CHUNK) return json({ error: "Nieprawidłowy rozmiar części" }, 400);
  if (take.bytesReceived + buf.length > Number(process.env.MAX_UPLOAD_MB ?? 1024) * 1024 * 1024) return json({ error: "Nagranie przekracza maksymalny rozmiar" }, 413);
  const dir = tmpDir("uploads", take.id);
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, `${String(i).padStart(5, "0")}.part`), buf);
  const updated = await prisma.$queryRaw<Array<{ receivedChunks: number[] }>>`
    UPDATE "RecordingTake"
    SET "receivedChunks" = (SELECT ARRAY(SELECT DISTINCT unnest("receivedChunks" || ${i}::int) ORDER BY 1)),
        "bytesReceived" = "bytesReceived" + ${buf.length}, "updatedAt" = now()
    WHERE id = ${take.id}
    RETURNING "receivedChunks"`;
  return json({ ok: true, receivedChunks: updated[0]?.receivedChunks ?? [] });
});
