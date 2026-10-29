import { cookies } from "next/headers";
import { prisma } from "./db";
import { SESSION_COOKIE, verifySession } from "./session-token";

import { HttpError } from "./errors";
export { HttpError };

export async function currentUser() {
  const jar = await cookies();
  const s = await verifySession(jar.get(SESSION_COOKIE)?.value);
  if (!s) return null;
  return prisma.user.findUnique({ where: { id: s.uid }, select: { id: true, email: true, name: true, role: true } });
}

/** staff of the video studio (ADMIN / EDITOR); MEMBER accounts only see Social Media Studio */
export const isStaff = (role: string) => role === "ADMIN" || role === "EDITOR";

export async function requireAdmin() {
  const u = await currentUser();
  if (!u) throw new HttpError(401, "Wymagane logowanie");
  if (!isStaff(u.role)) throw new HttpError(403, "Brak dostępu");
  return u;
}

export async function requireUser() {
  const u = await currentUser();
  if (!u) throw new HttpError(401, "Wymagane logowanie");
  return u;
}
