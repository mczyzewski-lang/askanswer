import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { enqueue } from "@/lib/server/jobs";

/** All slices sent: the worker assembles and converts the file (a long job — not inside this request). */
export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireAdmin();
  const { id } = await ctx.params;
  const { totalChunks } = z.object({ totalChunks: z.number().int().min(1).max(100_000) }).parse(await req.json());
  const s = await prisma.uploadSession.findUniqueOrThrow({ where: { id } });
  if (s.status !== "UPLOADING") return json({ ok: true, status: s.status });
  const missing: number[] = [];
  for (let i = 0; i < totalChunks; i++) if (!s.receivedChunks.includes(i)) missing.push(i);
  if (missing.length) return json({ error: "Brakuje części pliku", missing }, 409);
  // only one "complete" moves it on (a retried request does not queue it twice)
  const moved = await prisma.uploadSession.updateMany({ where: { id, status: "UPLOADING" }, data: { status: "PROCESSING" } });
  if (moved.count) await enqueue("ads-broll", { sessionId: id, totalChunks }, { idempotencyKey: `ads-broll:${id}`, maxAttempts: 1 });
  return json({ ok: true, status: "PROCESSING" }, 202);
});

export const GET = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireAdmin();
  const { id } = await ctx.params;
  const s = await prisma.uploadSession.findUniqueOrThrow({ where: { id } });
  return json({ id: s.id, status: s.status, error: s.error, assetId: s.assetId });
});
