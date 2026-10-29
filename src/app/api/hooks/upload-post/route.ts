import { json } from "@/lib/server/http";
import { MAX_WEBHOOK_BYTES, receiveWebhook } from "@/lib/server/social/webhooks";
import { clientIp, rateLimit } from "@/lib/server/ratelimit";

export const runtime = "nodejs";

/** Upload-Post webhook: verified (HMAC / token, timestamp), stored, acknowledged fast, processed in the background */
export async function POST(req: Request) {
  if (!rateLimit(`hook:${clientIp(req)}`, { capacity: 120, perMinute: 120 })) return json({ error: "rate limited" }, 429);
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_WEBHOOK_BYTES) return json({ error: "too large" }, 413);
  const raw = await req.text();
  try {
    const r = await receiveWebhook(raw, req.headers, new URL(req.url));
    return json(r.body, r.status);
  } catch (e) {
    console.error("[webhook]", (e as Error).message);
    return json({ error: "internal" }, 500);
  }
}
