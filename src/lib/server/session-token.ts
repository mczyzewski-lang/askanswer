// Edge-compatible session token helpers (used by middleware and server code).
import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "askby_session";

function secret(): Uint8Array {
  let s = process.env.APP_SECRET ?? "";
  if (s.length < 32) s = "insecure-development-secret-change-me-please-0123456789";
  return new TextEncoder().encode(`session:${s}`);
}

export async function signSession(payload: { uid: string; role: string }, days = 7): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${days}d`)
    .sign(secret());
}

export async function verifySession(token: string | undefined): Promise<{ uid: string; role: string } | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    if (typeof payload.uid !== "string") return null;
    return { uid: payload.uid, role: String(payload.role ?? "ADMIN") };
  } catch {
    return null;
  }
}
