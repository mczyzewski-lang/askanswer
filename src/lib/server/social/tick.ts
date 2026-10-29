/**
 * Runs every minute as a queued job: the worker enqueues "social-tick" with an idempotency key per
 * time bucket, so with any number of workers it runs once per bucket. It only looks for due work and
 * queues jobs — the jobs themselves are idempotent and retried by the queue.
 */
import { prisma } from "../db";
import { reconcile } from "./publisher";
import { deliverDemoWebhooks } from "./webhooks";
import { collectFollowers } from "./analytics";
import { purgeOldComments } from "./comments";
import { enqueueSocial } from "./queue";

let lastHourly = 0;
let lastDaily = 0;

/** the worker calls this on an interval: one tick job per bucket, whatever the number of workers */
export async function scheduleTick(everyMs: number, now = Date.now()) {
  const { enqueue } = await import("../jobs");
  await enqueue("social-tick", {}, { idempotencyKey: `social-tick:${Math.floor(now / everyMs)}`, maxAttempts: 1 });
}

export async function socialTick(now = new Date()) {
  {
    const r = await reconcile(now);
    const demo = await deliverDemoWebhooks();
    const metrics = await prisma.platformPost.findMany({ where: { status: "PUBLISHED", nextMetricsAt: { lte: now } }, select: { id: true, nextMetricsAt: true }, take: 40, orderBy: { nextMetricsAt: "asc" } });
    for (const p of metrics) await enqueueSocial("social-metrics", { postId: p.id }, { idempotencyKey: `metrics:${p.id}:${p.nextMetricsAt!.getTime()}` });
    const comments = await prisma.platformPost.findMany({ where: { status: "PUBLISHED", nextCommentsAt: { lte: now } }, select: { id: true, nextCommentsAt: true }, take: 40, orderBy: { nextCommentsAt: "asc" } });
    for (const p of comments) await enqueueSocial("social-comments", { postId: p.id }, { idempotencyKey: `comments:${p.id}:${p.nextCommentsAt!.getTime()}` });
    // a webhook stored but never processed (worker restarted between the two)
    const stuck = await prisma.webhookEvent.findMany({ where: { status: "RECEIVED", receivedAt: { lt: new Date(now.getTime() - 3 * 60e3) } }, select: { id: true }, take: 50 });
    for (const w of stuck) await enqueueSocial("social-webhook", { eventId: w.id }, { idempotencyKey: `webhook:${w.id}:retry:${Math.floor(now.getTime() / 600e3)}` });
    const sending = await prisma.commentReply.findMany({ where: { status: "SENDING", updatedAt: { lt: new Date(now.getTime() - 5 * 60e3) } }, select: { id: true } });
    for (const s of sending) await enqueueSocial("social-reply", { replyId: s.id }, { idempotencyKey: `send:${s.id}:stuck` });
    if (now.getTime() - lastHourly > 3600e3) {
      lastHourly = now.getTime();
      await collectFollowers().catch((e) => console.error("[social] followers", (e as Error).message));
    }
    if (now.getTime() - lastDaily > 86400e3) {
      lastDaily = now.getTime();
      await purgeOldComments().catch((e) => console.error("[social] retention", (e as Error).message));
    }
    // finished tick jobs are not worth keeping
    await prisma.job.deleteMany({ where: { type: "social-tick", status: { in: ["SUCCEEDED", "FAILED"] }, updatedAt: { lt: new Date(now.getTime() - 3600e3) } } });
    return { ...r, demo, metrics: metrics.length, comments: comments.length };
  }
}
