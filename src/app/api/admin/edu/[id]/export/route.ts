import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { enqueue } from "@/lib/server/jobs";
import { ensureDiskFor } from "@/lib/server/chunked";

/** Prepare the MP4 to download: the cuts applied, compressed at the chosen quality / size. */
export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireAdmin();
  const { id } = await ctx.params;
  const b = z.object({ quality: z.enum(["small", "standard", "high"]).default("standard"), resolution: z.enum(["source", "1080", "720"]).default("source") }).parse(await req.json().catch(() => ({})));
  const e = await prisma.eduVideo.findUniqueOrThrow({ where: { id } });
  if (e.status !== "READY" && e.status !== "DONE") return json({ error: e.status === "EXPORTING" ? "Eksport już trwa" : "Wideo nie jest jeszcze gotowe" }, 409);
  await ensureDiskFor(Number(e.sizeBytes) / 2);
  await prisma.eduVideo.update({ where: { id }, data: { status: "EXPORTING", step: "Przygotowanie pliku", exportProgress: 0, error: null, exportSettings: b as unknown as Prisma.InputJsonValue } });
  await enqueue("edu-export", { eduId: id }, { idempotencyKey: `edu-export:${id}:${Date.now()}`, maxAttempts: 1 });
  return json({ ok: true }, 202);
});
