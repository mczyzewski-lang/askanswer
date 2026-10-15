import { prisma } from "@/lib/server/db";
import { json, route } from "@/lib/server/http";
import { resolveToken } from "@/lib/server/invitations";
import { HttpError } from "@/lib/server/errors";

async function load(token: string, takeId: string) {
  const inv = await resolveToken(token);
  const take = await prisma.recordingTake.findUnique({ where: { id: takeId }, include: { recording: true } });
  if (!take || take.recording.expertId !== inv.expertId || take.recording.projectId !== inv.projectId) throw new HttpError(404, "Nie znaleziono nagrania");
  return take;
}

export const GET = route(async (_req: Request, ctx: { params: Promise<{ token: string; takeId: string }> }) => {
  const { token, takeId } = await ctx.params;
  const t = await load(token, takeId);
  return json({ id: t.id, status: t.status, receivedChunks: t.receivedChunks, processingStep: t.processingStep, error: t.processingError });
});

/** Experts may discard their own takes (e.g. a failed attempt). Originals are kept for admins once processed. */
export const DELETE = route(async (_req: Request, ctx: { params: Promise<{ token: string; takeId: string }> }) => {
  const { token, takeId } = await ctx.params;
  const t = await load(token, takeId);
  if (t.status === "UPLOADING") await prisma.recordingTake.delete({ where: { id: t.id } });
  return json({ ok: true });
});
