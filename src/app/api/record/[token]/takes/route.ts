import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/server/db";
import { json, route } from "@/lib/server/http";
import { assertQuestionAccess, resolveToken } from "@/lib/server/invitations";
import { rateLimit } from "@/lib/server/ratelimit";

const ALLOWED_MIME = /^video\/(webm|mp4|quicktime|x-matroska)(;.*)?$/;

const Body = z.object({
  questionId: z.string(),
  clientId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  mimeType: z.string().max(120),
  mode: z.enum(["CONTINUOUS", "ANSWER_ONLY"]),
  narrationAssetId: z.string().nullable().optional(),
  markers: z.object({ narrationStart: z.number().nullable().optional(), narrationEnd: z.number().nullable().optional() }).optional(),
  durationSec: z.number().optional(),
});

/** Create (or resume, idempotently by clientId) an upload for a new take. */
export const POST = route(async (req: Request, ctx: { params: Promise<{ token: string }> }) => {
  const { token } = await ctx.params;
  const inv = await resolveToken(token);
  if (!rateLimit(`take:${inv.id}`, { capacity: 30, perMinute: 30 })) return json({ error: "Zbyt wiele żądań" }, 429);
  const body = Body.parse(await req.json());
  if (!ALLOWED_MIME.test(body.mimeType)) return json({ error: "Nieobsługiwany format nagrania" }, 415);
  const q = await assertQuestionAccess(inv, body.questionId);
  const existing = await prisma.recordingTake.findUnique({ where: { clientId: body.clientId }, include: { recording: true } });
  if (existing) {
    if (existing.recording.questionId !== q.id) return json({ error: "Konflikt identyfikatora nagrania" }, 409);
    return json({ takeId: existing.id, takeNumber: existing.takeNumber, status: existing.status, receivedChunks: existing.receivedChunks });
  }
  if (body.narrationAssetId) {
    const n = await prisma.mediaAsset.findFirst({ where: { id: body.narrationAssetId, kind: "NARRATION" } });
    if (!n) body.narrationAssetId = null;
  }
  const take = await prisma.$transaction(async (tx) => {
    const rec = await tx.recording.upsert({
      where: { questionId: q.id },
      create: { projectId: inv.projectId, questionId: q.id, expertId: inv.expertId },
      update: {},
    });
    const last = await tx.recordingTake.aggregate({ where: { recordingId: rec.id }, _max: { takeNumber: true } });
    return tx.recordingTake.create({
      data: {
        recordingId: rec.id,
        clientId: body.clientId,
        takeNumber: (last._max.takeNumber ?? 0) + 1,
        mode: body.mode,
        mimeType: body.mimeType,
        narrationAssetId: body.narrationAssetId ?? null,
        markers: (body.markers ?? {}) as Prisma.InputJsonValue,
        durationSec: body.durationSec,
      },
    });
  });
  if (q.status === "TO_RECORD") await prisma.question.update({ where: { id: q.id }, data: { status: "IN_PROGRESS" } });
  return json({ takeId: take.id, takeNumber: take.takeNumber, status: take.status, receivedChunks: [] }, 201);
});
