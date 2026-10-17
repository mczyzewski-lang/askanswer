import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { enqueue } from "@/lib/server/jobs";
import { rateLimit } from "@/lib/server/ratelimit";
import { openaiConfigured, openaiKeyDiagnostics } from "@/lib/server/env";
import type { EditorDocument } from "@/lib/editor/types";
import { assetInfo } from "@/lib/server/assets";

/** "Tło AI": queue background plates (variants) from OpenAI; the client polls /api/admin/jobs/[jobId]. */
export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireAdmin();
  const { id } = await ctx.params;
  const b = z.object({ idea: z.string().trim().max(600).nullable().optional() }).parse(await req.json().catch(() => ({})));
  if (!openaiConfigured()) return json({ error: `Tło AI wymaga klucza OpenAI. ${openaiKeyDiagnostics()}` }, 503);
  if (!rateLimit(`background:${user.id}`, { capacity: 6, perMinute: 3 })) return json({ error: "Zbyt wiele żądań — spróbuj za chwilę." }, 429);
  const comp = await prisma.videoComposition.findUniqueOrThrow({ where: { id }, select: { document: true } });
  const doc = comp.document as unknown as EditorDocument;
  const job = await enqueue("generate-background", { compositionId: id, idea: b.idea ?? null, width: doc.width, height: doc.height }, { maxAttempts: 2 });
  return json({ jobId: job.id }, 202);
});

/** Backgrounds generated earlier anywhere in this project — reusable in every video (newest first). */
export const GET = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireAdmin();
  const { id } = await ctx.params;
  const comp = await prisma.videoComposition.findUniqueOrThrow({ where: { id }, select: { projectId: true } });
  const rows = await prisma.mediaAsset.findMany({
    where: { projectId: comp.projectId, kind: "IMAGE", meta: { path: ["engine"], equals: "background" } },
    orderBy: { createdAt: "desc" },
    take: 60,
    select: { id: true },
  });
  const assets = (await Promise.all(rows.map((r) => assetInfo(r.id)))).filter(Boolean);
  return json({ assets });
});
