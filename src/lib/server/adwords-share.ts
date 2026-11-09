/**
 * Google Adwords — read-only links for an agency. The token in the URL is the capability (no login);
 * a link can expire and be revoked; every visit is counted. What an agency can download is only what
 * passed the gates (no "blokada" component, production landing pages only).
 */
import { randomBytes } from "node:crypto";
import { prisma } from "./db";
import { HttpError } from "./errors";

export const newShareToken = () => randomBytes(24).toString("base64url");

export async function createShare(projectId: string, label: string, days: number | null, createdBy: string | null) {
  return prisma.adwordsShare.create({ data: { projectId, token: newShareToken(), label, createdBy, expiresAt: days ? new Date(Date.now() + days * 86_400_000) : null } });
}

/** the project a share token opens — 404 for an unknown, revoked or expired link (never says which) */
export async function shareOf(token: string, opts: { count?: boolean } = {}) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) throw new HttpError(404, "Link nie istnieje albo wygasł");
  const s = await prisma.adwordsShare.findUnique({ where: { token } });
  if (!s || s.revokedAt || (s.expiresAt && s.expiresAt < new Date())) throw new HttpError(404, "Link nie istnieje albo wygasł");
  if (opts.count) await prisma.adwordsShare.update({ where: { id: s.id }, data: { lastAccessAt: new Date(), accessCount: { increment: 1 } } });
  return s;
}

export const shareHeaders = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": "no-referrer" } as const;
