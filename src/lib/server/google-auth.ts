/**
 * "Zaloguj przez Google" (OpenID Connect, authorization code flow). The ID token is checked against
 * Google's signing keys; only verified e-mails of people added by an administrator get in (plus the
 * owner accounts in OWNER_EMAILS, made administrators at their first sign-in).
 */
import { createRemoteJWKSet, jwtVerify } from "jose";
import { cleanSecret } from "./env";

const str = (name: string, def = "") => {
  const v = process.env[name];
  return v === undefined || v === "" ? def : v;
};

export const google = {
  get clientId() {
    return cleanSecret(str("GOOGLE_CLIENT_ID"), "GOOGLE_CLIENT_ID");
  },
  get clientSecret() {
    return cleanSecret(str("GOOGLE_CLIENT_SECRET"), "GOOGLE_CLIENT_SECRET");
  },
  // overridable only for the tests' mock
  get authUrl() {
    return str("GOOGLE_AUTH_URL", "https://accounts.google.com/o/oauth2/v2/auth");
  },
  get tokenUrl() {
    return str("GOOGLE_TOKEN_URL", "https://oauth2.googleapis.com/token");
  },
  get jwksUrl() {
    return str("GOOGLE_JWKS_URL", "https://www.googleapis.com/oauth2/v3/certs");
  },
  get issuers() {
    return str("GOOGLE_ISSUER", "https://accounts.google.com,accounts.google.com").split(",");
  },
};

export const googleConfigured = () => !!(google.clientId && google.clientSecret);

/** e-mails that are always administrators (the owner of the studio) */
export function ownerEmails(): string[] {
  return str("OWNER_EMAILS", "mczyzewski@epravna.pl")
    .split(/[,;\s]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export const GOOGLE_STATE_COOKIE = "askby_google_state";

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
let jwksFor = "";

/** Exchange the code for tokens and return the verified identity. */
export async function googleIdentity(code: string, redirectUri: string): Promise<{ sub: string; email: string; name: string }> {
  const res = await fetch(google.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: google.clientId, client_secret: google.clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" }),
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await res.json().catch(() => ({}))) as { id_token?: string; error?: string; error_description?: string };
  if (!res.ok || !data.id_token) throw new Error(`Google: ${data.error_description ?? data.error ?? `HTTP ${res.status}`}`);
  if (!jwks || jwksFor !== google.jwksUrl) {
    jwks = createRemoteJWKSet(new URL(google.jwksUrl));
    jwksFor = google.jwksUrl;
  }
  const { payload } = await jwtVerify(data.id_token, jwks, { audience: google.clientId, issuer: google.issuers });
  const email = String(payload.email ?? "").toLowerCase();
  if (!email || payload.email_verified !== true) throw new Error("Google nie potwierdził adresu e-mail tego konta.");
  return { sub: String(payload.sub), email, name: String(payload.name ?? email.split("@")[0]) };
}
