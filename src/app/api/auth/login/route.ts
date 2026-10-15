import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { verifyPassword } from "@/lib/server/crypto";
import { SESSION_COOKIE, signSession } from "@/lib/server/session-token";
import { json, route } from "@/lib/server/http";
import { clientIp, rateLimit } from "@/lib/server/ratelimit";

export const POST = route(async (req: Request) => {
  if (!rateLimit(`login:${clientIp(req)}`, { capacity: 10, perMinute: 10 })) return json({ error: "Zbyt wiele prób logowania. Spróbuj za chwilę." }, 429);
  const body = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(await req.json());
  const user = await prisma.user.findUnique({ where: { email: body.email.toLowerCase() } });
  if (!user || !(await verifyPassword(body.password, user.passwordHash))) return json({ error: "Nieprawidłowy e-mail lub hasło" }, 401);
  const token = await signSession({ uid: user.id, role: user.role });
  const res = json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 7 * 24 * 3600 });
  return res;
});
