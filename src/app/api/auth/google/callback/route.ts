import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/server/db";
import { env } from "@/lib/server/env";
import { SESSION_COOKIE, signSession } from "@/lib/server/session-token";
import { GOOGLE_STATE_COOKIE, googleIdentity, ownerEmails } from "@/lib/server/google-auth";

const back = (error: string) => NextResponse.redirect(`${env.appUrl}/login?error=${error}`);

/** Google sends the person back here: check the state, verify the ID token, sign in. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const jar = await cookies();
  let saved: { state?: string; next?: string } = {};
  try {
    saved = JSON.parse(jar.get(GOOGLE_STATE_COOKIE)?.value ?? "{}");
  } catch {
    /* no state */
  }
  if (url.searchParams.get("error")) return back("google_cancelled");
  const code = url.searchParams.get("code");
  if (!code || !saved.state || url.searchParams.get("state") !== saved.state) return back("google_state");
  let who: Awaited<ReturnType<typeof googleIdentity>>;
  try {
    who = await googleIdentity(code, `${env.appUrl}/api/auth/google/callback`);
  } catch (e) {
    console.warn("[google-login]", (e as Error).message);
    return back("google_failed");
  }
  const owner = ownerEmails().includes(who.email);
  let user = await prisma.user.findFirst({ where: { OR: [{ googleSub: who.sub }, { email: who.email }] } });
  // only people added by an administrator (and the owner) get in
  if (!user && !owner) return back("no_account");
  if (!user) user = await prisma.user.create({ data: { email: who.email, name: who.name, passwordHash: "", role: "ADMIN", googleSub: who.sub } });
  user = await prisma.user.update({
    where: { id: user.id },
    data: { googleSub: who.sub, lastLoginAt: new Date(), ...(owner && user.role !== "ADMIN" ? { role: "ADMIN" } : {}), ...(user.name ? {} : { name: who.name }) },
  });
  const token = await signSession({ uid: user.id, role: user.role });
  const next = saved.next && saved.next.startsWith("/") && !saved.next.startsWith("//") ? saved.next : user.role === "MEMBER" ? "/social" : "/admin";
  const res = NextResponse.redirect(`${env.appUrl}${next}`);
  res.cookies.set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 7 * 24 * 3600 });
  res.cookies.delete({ name: GOOGLE_STATE_COOKIE, path: "/api/auth/google" });
  return res;
}
