import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { env } from "@/lib/server/env";
import { GOOGLE_STATE_COOKIE, google, googleConfigured } from "@/lib/server/google-auth";

/** Start "Zaloguj przez Google": to Google's account chooser, back to /api/auth/google/callback. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const raw = url.searchParams.get("next") ?? "/admin";
  const next = raw.startsWith("/") && !raw.startsWith("//") ? raw : "/admin";
  if (!googleConfigured()) return NextResponse.redirect(`${env.appUrl}/login?error=google_config`);
  const state = crypto.randomBytes(24).toString("base64url");
  const target = new URL(google.authUrl);
  target.search = new URLSearchParams({
    client_id: google.clientId,
    redirect_uri: `${env.appUrl}/api/auth/google/callback`,
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  }).toString();
  const res = NextResponse.redirect(target.toString());
  res.cookies.set(GOOGLE_STATE_COOKIE, JSON.stringify({ state, next }), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/api/auth/google", maxAge: 600 });
  return res;
}
