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

export async function requireAdmin() {
  const u = await currentUser();
  if (!u) throw new HttpError(401, "Wymagane logowanie");
  return u;
}
