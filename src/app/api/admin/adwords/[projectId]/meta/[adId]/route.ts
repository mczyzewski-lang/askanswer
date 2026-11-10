import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { enqueue } from "@/lib/server/jobs";
import { openaiConfigured, openaiKeyDiagnostics } from "@/lib/server/env";
import { MetaBody } from "@/lib/server/meta-ads";

export const PATCH = route(async (req: Request, ctx: { params: Promise<{ projectId: string; adId: string }> }) => {
  await requireAdmin();
  const { projectId, adId } = await ctx.params;
  const raw = (await req.json()) as Record<string, unknown>;
  // only the fields sent (a partial schema would fill the others with their defaults)
  const parsed = MetaBody.partial().parse(raw);
  const b = Object.fromEntries(Object.entries(parsed).filter(([k]) => k in raw)) as typeof parsed;
  await prisma.metaAd.findFirstOrThrow({ where: { id: adId, projectId } });
  const { extra, ...rest } = b;
  const data = { ...rest, ...(extra !== undefined ? { extra: extra ?? Prisma.JsonNull } : {}), ...(rest.url !== undefined ? { url: rest.url || null } : {}), ...(rest.webinarAt !== undefined ? { webinarAt: rest.webinarAt ? new Date(rest.webinarAt) : null } : {}) };
  return json(await prisma.metaAd.update({ where: { id: adId }, data }));
});

export const DELETE = route(async (_req: Request, ctx: { params: Promise<{ projectId: string; adId: string }> }) => {
  await requireAdmin();
  const { projectId, adId } = await ctx.params;
  await prisma.metaAd.deleteMany({ where: { id: adId, projectId } });
  return json({ ok: true });
});

/** start the AI infographic version of this ad (background job) */
export const POST = route(async (_req: Request, ctx: { params: Promise<{ projectId: string; adId: string }> }) => {
  await requireAdmin();
  const { projectId, adId } = await ctx.params;
  await prisma.metaAd.findFirstOrThrow({ where: { id: adId, projectId }, select: { id: true } });
  if (!openaiConfigured()) return json({ error: `Infografiki wymagają klucza OpenAI. ${openaiKeyDiagnostics()}` }, 400);
  const job = await enqueue("meta-infographic", { projectId, adId }, { idempotencyKey: `meta-infographic:${adId}:${Date.now()}`, maxAttempts: 2 });
  return json({ jobId: job.id }, 202);
});
