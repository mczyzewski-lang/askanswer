import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { startAutoReels } from "@/lib/server/auto-reels";

/** Settings: how many reels and how long. */
export const PATCH = route(async (req: Request, ctx: { params: Promise<{ projectId: string }> }) => {
  await requireAdmin();
  const { projectId } = await ctx.params;
  const b = z
    .object({ count: z.number().int().min(1).max(60).optional(), min: z.number().int().min(10).max(170).optional(), max: z.number().int().min(15).max(180).optional(), autoZooms: z.boolean().optional() })
    .parse(await req.json());
  const p = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  if (!p.autoReels) return json({ error: "To nie jest projekt Auto Reels" }, 400);
  const min = b.min ?? p.autoReelsMin;
  const max = b.max ?? p.autoReelsMax;
  if (max < min + 5) return json({ error: "Długość maksymalna musi być większa od minimalnej (o co najmniej 5 s)" }, 400);
  await prisma.project.update({ where: { id: projectId }, data: { autoReelsCount: b.count ?? p.autoReelsCount, autoReelsMin: min, autoReelsMax: max, ...(b.autoZooms != null ? { autoZooms: b.autoZooms } : {}) } });
  return json({ ok: true });
});

/** (Re)generate the reels from the transcribed recordings — replaces the earlier ones. */
export const POST = route(async (_req: Request, ctx: { params: Promise<{ projectId: string }> }) => {
  await requireAdmin();
  const { projectId } = await ctx.params;
  const p = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  if (!p.autoReels) return json({ error: "To nie jest projekt Auto Reels" }, 400);
  if (p.autoReelsStatus === "RUNNING" && Date.now() - p.updatedAt.getTime() < 30 * 60_000) return json({ error: "Reelsy są właśnie przygotowywane" }, 409);
  const ready = await prisma.adFootage.count({ where: { projectId, status: "READY" } });
  if (!ready) return json({ error: "Najpierw wgraj nagranie i poczekaj na transkrypcję" }, 400);
  await startAutoReels(projectId);
  return json({ ok: true }, 202);
});
