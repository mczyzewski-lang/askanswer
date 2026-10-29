/**
 * Upload-Post webhook receiver.
 *
 *  - authenticity: HMAC SHA-256 of the raw body (or of "<timestamp>.<body>") with
 *    UPLOAD_POST_WEBHOOK_SECRET, compared in constant time; and/or a secret token in the URL;
 *  - freshness: a timestamp header older / newer than 5 minutes is refused (replay);
 *  - once only: the delivery id (or the body hash) is unique — a replay is acknowledged, not redone;
 *  - fast: the event is stored raw and processed by a background job;
 *  - not trusted: the payload only says WHICH order / profile / post changed — its state is read
 *    back from the provider's API before anything is updated.
 *
 * The provider's exact header names are configurable (UPLOAD_POST_*_HEADER) — they could not be
 * confirmed from its public client library.
 */
import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { env, uploadPostLive } from "../env";
import { enqueueSocial } from "./queue";

export const MAX_WEBHOOK_BYTES = 1024 * 1024;
const TOLERANCE_SEC = 300;

function safeEq(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** the signature header may carry "sha256=<hex>", "<hex>", "<base64>" or "t=…,v1=<hex>" */
export function signatureCandidates(header: string): { ts: string | null; sigs: string[] } {
  const h = header.trim();
  if (/(^|,)\s*v1=/.test(h)) {
    const parts = Object.fromEntries(h.split(",").map((kv) => kv.trim().split("=", 2) as [string, string]));
    return { ts: parts.t ?? null, sigs: h.split(",").filter((x) => x.trim().startsWith("v1=")).map((x) => x.trim().slice(3)) };
  }
  return { ts: null, sigs: [h.replace(/^sha256=/i, "")] };
}

export function verifySignature(raw: string, header: string | null, timestamp: string | null, secret: string): boolean {
  if (!header || !secret) return false;
  const { ts, sigs } = signatureCandidates(header);
  const stamp = ts ?? timestamp;
  const signed = [raw, ...(stamp ? [`${stamp}.${raw}`] : [])];
  for (const body of signed) {
    const mac = crypto.createHmac("sha256", secret).update(body).digest();
    const hex = mac.toString("hex");
    const b64 = mac.toString("base64");
    for (const s of sigs) if (safeEq(s.toLowerCase(), hex) || safeEq(s, b64)) return true;
  }
  return false;
}

/** seconds / milliseconds / ISO → epoch seconds */
export function parseTimestamp(v: string | null): number | null {
  if (!v) return null;
  const n = Number(v);
  if (Number.isFinite(n)) return n > 1e12 ? n / 1000 : n;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t / 1000 : null;
}

export type ReceiveResult = { status: number; body: Record<string, unknown> };

export async function receiveWebhook(raw: string, headers: Headers, url: URL): Promise<ReceiveResult> {
  if (Buffer.byteLength(raw) > MAX_WEBHOOK_BYTES) return { status: 413, body: { error: "too large" } };
  const secret = env.uploadPostWebhookSecret;
  const token = env.uploadPostWebhookToken;
  if (!secret && !token) return { status: uploadPostLive() ? 503 : 404, body: { error: "webhook not configured" } };
  const sigHeader = headers.get(env.uploadPostSignatureHeader);
  const tsHeader = headers.get(env.uploadPostTimestampHeader);
  const sigOk = secret ? verifySignature(raw, sigHeader, tsHeader, secret) : false;
  const tokenOk = token ? safeEq(url.searchParams.get("token") ?? "", token) : false;
  // with a secret the signature is required; a token alone is accepted only when no secret is set
  if (secret ? !sigOk : !tokenOk) return { status: 401, body: { error: "invalid signature" } };
  if (secret && token && !tokenOk) return { status: 401, body: { error: "invalid token" } };
  const fromSig = sigHeader ? signatureCandidates(sigHeader).ts : null;
  const ts = parseTimestamp(fromSig ?? tsHeader);
  if (ts !== null && Math.abs(Date.now() / 1000 - ts) > TOLERANCE_SEC) return { status: 401, body: { error: "stale timestamp" } };

  let payload: unknown = null;
  try {
    payload = JSON.parse(raw);
  } catch {
    return { status: 400, body: { error: "invalid json" } };
  }
  const deliveryId = headers.get(env.uploadPostDeliveryHeader) || pickStr(payload, ["delivery_id", "event_id", "id"]) || crypto.createHash("sha256").update(raw).digest("hex");
  const eventType = normalizeEvent(pickStr(payload, ["event", "type", "event_type"]) ?? "");
  try {
    const ev = await prisma.webhookEvent.create({
      data: { deliveryId: deliveryId.slice(0, 200), eventType, signatureValid: true, rawBody: raw, headers: Object.fromEntries([...headers.entries()].filter(([k]) => !/authorization|cookie/i.test(k))) as Prisma.InputJsonValue },
    });
    await enqueueSocial("social-webhook", { eventId: ev.id }, { idempotencyKey: `webhook:${ev.id}` });
    return { status: 200, body: { ok: true } };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { status: 200, body: { ok: true, duplicate: true } };
    throw e;
  }
}

export function normalizeEvent(e: string): string {
  return e.trim().toLowerCase().replace(/[.\s-]+/g, "_");
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
function pickStr(o: unknown, keys: string[]): string | null {
  if (!isObj(o)) return null;
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v;
    if (typeof v === "number") return String(v);
  }
  for (const nest of ["data", "payload", "result"]) if (isObj(o[nest])) {
    const r = pickStr(o[nest], keys);
    if (r) return r;
  }
  return null;
}

/** job "social-webhook": find what the event is about and re-read its state from the provider */
export async function processWebhookEvent(eventId: string) {
  const ev = await prisma.webhookEvent.findUniqueOrThrow({ where: { id: eventId } });
  if (ev.status === "PROCESSED" || ev.status === "IGNORED") return { state: ev.status };
  const payload = JSON.parse(ev.rawBody) as unknown;
  const done = (status: "PROCESSED" | "IGNORED", error?: string) => prisma.webhookEvent.update({ where: { id: ev.id }, data: { status, error: error ?? null, processedAt: new Date() } });
  try {
    switch (ev.eventType) {
      case "upload_completed":
      case "post_published":
      case "upload_failed": {
        const jobId = pickStr(payload, ["job_id", "jobId"]);
        const requestId = pickStr(payload, ["request_id", "requestId"]);
        const externalId = pickStr(payload, ["external_id", "externalId"]);
        const pub = await prisma.scheduledPublication.findFirst({ where: { OR: [...(jobId ? [{ providerJobId: jobId }] : []), ...(requestId ? [{ providerRequestId: requestId }] : []), ...(externalId ? [{ externalId }] : [])] } });
        if (!pub) {
          await done("IGNORED", "Nie znaleziono publikacji dla tego zdarzenia");
          return { state: "IGNORED" };
        }
        const { checkPublication } = await import("./publisher");
        const r = await checkPublication(pub.id);
        await done("PROCESSED");
        return r;
      }
      case "social_account_connected":
      case "social_account_disconnected":
      case "social_account_reauth_required": {
        const username = pickStr(payload, ["profile_username", "username", "user", "profile"]);
        const profile = username ? await prisma.providerProfile.findUnique({ where: { username } }) : null;
        if (!profile) {
          await done("IGNORED", "Nieznany profil");
          return { state: "IGNORED" };
        }
        const { syncProfile } = await import("./accounts");
        const r = await syncProfile(profile.id);
        await done("PROCESSED");
        return r;
      }
      case "comment_received": {
        const postId = pickStr(payload, ["post_id", "platform_post_id", "media_id", "video_id"]);
        const post = postId ? await prisma.platformPost.findFirst({ where: { platformPostId: postId } }) : null;
        if (!post) {
          await done("IGNORED", "Nieznana publikacja");
          return { state: "IGNORED" };
        }
        await enqueueSocial("social-comments", { postId: post.id }, { idempotencyKey: `comments:${post.id}:hook:${ev.id}` });
        await done("PROCESSED");
        return { state: "PROCESSED" };
      }
      default:
        await done("IGNORED", `Nieobsługiwane zdarzenie: ${ev.eventType || "(brak)"}`);
        return { state: "IGNORED" };
    }
  } catch (e) {
    await prisma.webhookEvent.update({ where: { id: ev.id }, data: { status: "FAILED", error: (e as Error).message.slice(0, 2000) } });
    throw e;
  }
}

/** DEMO: the mock provider "delivers" upload_completed through the same processing path */
export async function deliverDemoWebhooks() {
  const { dueDemoJobs } = await import("./provider/mock");
  const due = await dueDemoJobs();
  for (const j of due) {
    const raw = JSON.stringify({ event: "upload_completed", job_id: j.id, demo: true });
    try {
      const ev = await prisma.webhookEvent.create({ data: { provider: "demo", deliveryId: `demo:${j.id}`, eventType: "upload_completed", signatureValid: true, rawBody: raw } });
      await enqueueSocial("social-webhook", { eventId: ev.id }, { idempotencyKey: `webhook:${ev.id}` });
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
    }
  }
  return due.length;
}
