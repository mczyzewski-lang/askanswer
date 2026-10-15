import { prisma } from "./db";
import { decrypt, encrypt, randomToken, sha256 } from "./crypto";
import { env } from "./env";
import { HttpError } from "./errors";

export async function createInvitation(projectId: string, expertId: string, ttlDays = env.invitationTtlDays) {
  const token = randomToken(32);
  const inv = await prisma.invitation.create({
    data: { projectId, expertId, tokenHash: sha256(token), tokenEnc: encrypt(token), expiresAt: new Date(Date.now() + ttlDays * 86_400_000) },
  });
  return { invitation: inv, token, url: `${env.appUrl}/record/${token}` };
}

export function invitationUrl(tokenEnc: string): string | null {
  const t = decrypt(tokenEnc);
  return t ? `${env.appUrl}/record/${t}` : null;
}

/** Validate a recording token. Throws 404/410 for unknown, revoked or expired links. */
export async function resolveToken(token: string) {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) throw new HttpError(404, "Nieprawidłowy link nagrania");
  const inv = await prisma.invitation.findUnique({ where: { tokenHash: sha256(token) }, include: { project: { include: { theme: true } }, expert: true } });
  if (!inv) throw new HttpError(404, "Nieprawidłowy link nagrania");
  if (inv.revokedAt) throw new HttpError(410, "Ten link został unieważniony. Skontaktuj się z administratorem.");
  if (inv.expiresAt < new Date()) throw new HttpError(410, "Ten link wygasł. Poproś administratora o nowy.");
  return inv;
}

/** Questions the expert behind this invitation is allowed to see. */
export async function assignedQuestionIds(inv: { projectId: string; expertId: string }): Promise<string[]> {
  const qs = await prisma.question.findMany({ where: { projectId: inv.projectId, expertId: inv.expertId }, select: { id: true } });
  return qs.map((q) => q.id);
}

export async function assertQuestionAccess(inv: { projectId: string; expertId: string }, questionId: string) {
  const q = await prisma.question.findFirst({ where: { id: questionId, projectId: inv.projectId, expertId: inv.expertId } });
  if (!q) throw new HttpError(403, "To pytanie nie jest przypisane do Ciebie");
  return q;
}
