import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";

/** Add a voice (ElevenLabs voice id) to a collection; adding twice is harmless. */
export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireAdmin();
  const { id } = await ctx.params;
  const body = z.object({ voiceId: z.string().trim().min(3).max(100).regex(/^[A-Za-z0-9_-]+$/, "Nieprawidłowy identyfikator głosu"), label: z.string().trim().max(80).optional().nullable() }).parse(await req.json());
  const count = await prisma.voiceCollectionItem.count({ where: { collectionId: id } });
  const item = await prisma.voiceCollectionItem.upsert({
    where: { collectionId_voiceId: { collectionId: id, voiceId: body.voiceId } },
    create: { collectionId: id, voiceId: body.voiceId, label: body.label || null, order: count },
    update: body.label ? { label: body.label } : {},
  });
  return json(item, 201);
});
