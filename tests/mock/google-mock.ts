/**
 * MOCK Google sign-in (OpenID Connect) for tests: the account chooser answers at once with the
 * identity set by POST /google/next {email, name}; the token endpoint returns an ID token signed
 * with a key generated at start (published at /google/certs). Never the real Google.
 */
import type http from "node:http";
import { SignJWT, exportJWK, generateKeyPair } from "jose";

const ISSUER = "http://127.0.0.1:4010/google";
const keys = generateKeyPair("RS256");
let next = { email: "mczyzewski@epravna.pl", name: "Właściciel", verified: true };
const codes = new Map<string, typeof next>();

function body(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let s = "";
    req.on("data", (c) => (s += c));
    req.on("end", () => resolve(s));
    req.on("error", reject);
  });
}

export async function googleMock(req: http.IncomingMessage, res: http.ServerResponse, url: URL, json: (code: number, data: unknown) => void) {
  const p = url.pathname.slice("/google".length);
  if (req.method === "POST" && p === "/next") {
    const b = JSON.parse((await body(req)) || "{}");
    next = { email: b.email, name: b.name ?? b.email, verified: b.verified !== false };
    return json(200, { ok: true });
  }
  if (req.method === "GET" && p === "/auth") {
    const code = `code_${Math.random().toString(36).slice(2)}`;
    codes.set(code, { ...next, aud: url.searchParams.get("client_id") } as typeof next);
    const back = new URL(url.searchParams.get("redirect_uri")!);
    back.searchParams.set("code", code);
    back.searchParams.set("state", url.searchParams.get("state") ?? "");
    res.writeHead(302, { location: back.toString() });
    return res.end();
  }
  if (req.method === "POST" && p === "/token") {
    const form = new URLSearchParams(await body(req));
    const who = codes.get(form.get("code") ?? "") as (typeof next & { aud?: string }) | undefined;
    if (!who || form.get("client_secret") !== "mock-google-secret") return json(400, { error: "invalid_grant" });
    codes.delete(form.get("code")!);
    const { privateKey } = await keys;
    const id_token = await new SignJWT({ email: who.email, email_verified: who.verified, name: who.name })
      .setProtectedHeader({ alg: "RS256", kid: "mock" })
      .setIssuer(ISSUER)
      .setAudience(form.get("client_id")!)
      .setSubject(`sub-${who.email}`)
      .setIssuedAt()
      .setExpirationTime("10m")
      .sign(privateKey);
    return json(200, { access_token: "mock", id_token, token_type: "Bearer", expires_in: 600 });
  }
  if (req.method === "GET" && p === "/certs") {
    const jwk = await exportJWK((await keys).publicKey);
    return json(200, { keys: [{ ...jwk, kid: "mock", alg: "RS256", use: "sig" }] });
  }
  return json(404, { error: "not found" });
}
