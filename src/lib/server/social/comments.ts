/**
 * Unified comments inbox.
 *  - polling per published post: every 15 min in the first day, hourly in the first week, every 6 h
 *    up to 30 days, daily up to 90 days; platforms with comment webhooks (Instagram, TikTok, LinkedIn
 *    pages) are polled half as often as a fallback; paging, dedup by the comment's native id;
 *  - TikTok needs the "comments" capability (granted at connect time) — without it nothing is
 *    pretended: the account shows "reconnect";
 *  - new comments are classified (personal data removed first); leads and sensitive ones notify;
 *  - replies: AI draft → a person accepts / edits / rejects → sent once (idempotency + no blind resend);
 *  - optional automatic replies: off by default, only for safe categories the owner allowed, never
 *    for complaints, legal / medical matters, personal data, conflicts, unusual or unverified things;
 *    limited per hour, never the same text twice, never in a thread with our own reply.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { HttpError } from "../errors";
import { PLATFORM_META, type Platform } from "@/lib/social/platforms";
import { providerFor, ProviderError } from "./provider";
import { classifyComments, redactPersonal, replyDraft, SENSITIVE } from "./ai";
import { notify } from "./notify";
import { audit } from "./audit";
import { enqueueSocial } from "./queue";

const WEBHOOK_PLATFORMS: Platform[] = ["INSTAGRAM", "TIKTOK", "LINKEDIN"];

export function nextPollAt(publishedAt: Date, platform: Platform, now = new Date()): Date | null {
  const age = now.getTime() - publishedAt.getTime();
  const base = age < 86400e3 ? 15 * 60e3 : age < 7 * 86400e3 ? 3600e3 : age < 30 * 86400e3 ? 6 * 3600e3 : age < 90 * 86400e3 ? 24 * 3600e3 : null;
  if (base === null) return null;
  return new Date(now.getTime() + (WEBHOOK_PLATFORMS.includes(platform) ? base * 2 : base));
}

export const commentsAvailable = (a: { platform: string; capabilities: unknown }) => a.platform !== "TIKTOK" || (Array.isArray(a.capabilities) && (a.capabilities as string[]).includes("comments"));

const hasPersonal = (t: string) => redactPersonal(t) !== t.replace(/https?:\/\/\S+/g, "[link]").replace(/@[\w.]{2,}/g, "@[użytkownik]");

/** job "social-comments": fetch the post's comments (all pages), store new ones, classify them */
export async function pollComments(postId: string) {
  const post = await prisma.platformPost.findUniqueOrThrow({ where: { id: postId }, include: { socialAccount: { include: { providerProfile: true } }, contentItem: { include: { media: true } } } });
  if (post.status !== "PUBLISHED" || !post.publishedAt) return { skipped: "not published" };
  const acc = post.socialAccount;
  if (!commentsAvailable(acc)) {
    await prisma.platformPost.update({ where: { id: postId }, data: { nextCommentsAt: null } });
    return { skipped: "capability" };
  }
  const provider = providerFor(acc);
  const fresh: string[] = [];
  let after: string | null = null;
  try {
    for (let page = 0; page < 5; page++) {
      const r = await provider.comments({ profile: acc.providerProfile.username, platform: post.platform as Platform, postId: post.platformPostId, postUrl: post.publishedUrl, after });
      for (const c of r.comments) {
        const own = !!c.authorId && (c.authorId === acc.platformAccountId || c.authorId === "me") || (!!c.authorHandle && !!acc.accountHandle && c.authorHandle.toLowerCase() === acc.accountHandle.toLowerCase()) || (await prisma.commentReply.count({ where: { nativeId: c.id } })) > 0;
        try {
          const row = await prisma.socialComment.create({
            data: { projectId: post.projectId, socialAccountId: acc.id, platformPostId: post.id, platform: post.platform, nativeId: c.id, parentNativeId: c.parentId, authorName: c.authorName, authorHandle: c.authorHandle, authorId: c.authorId, text: c.text.slice(0, 10_000), likeCount: c.likeCount, postedAt: c.createdAt, isOwn: own, status: own ? "REPLIED" : "NEW", isDemo: acc.isDemo, raw: (c.raw ?? undefined) as Prisma.InputJsonValue | undefined },
          });
          if (!own) fresh.push(row.id);
        } catch (e) {
          if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
            await prisma.socialComment.updateMany({ where: { socialAccountId: acc.id, nativeId: c.id }, data: { likeCount: c.likeCount } });
            continue;
          }
          throw e;
        }
      }
      if (!r.next) break;
      after = r.next;
    }
  } catch (e) {
    if (e instanceof ProviderError && e.status === 429) {
      await prisma.platformPost.update({ where: { id: postId }, data: { nextCommentsAt: new Date(Date.now() + (e.retryAfterMs ?? 30 * 60e3)) } });
      return { rateLimited: true };
    }
    if (e instanceof ProviderError && (e.status === 401 || e.status === 403)) {
      await prisma.platformPost.update({ where: { id: postId }, data: { nextCommentsAt: new Date(Date.now() + 6 * 3600e3) } });
      return { skipped: "unauthorized" };
    }
    throw e;
  }
  await prisma.platformPost.update({ where: { id: postId }, data: { nextCommentsAt: nextPollAt(post.publishedAt, post.platform as Platform) } });
  if (fresh.length) await classifyNew(post.projectId, fresh);
  return { new: fresh.length };
}

/** classify + set the handling status; notify about leads and sensitive comments */
export async function classifyNew(projectId: string, ids: string[]) {
  const rows = await prisma.socialComment.findMany({ where: { id: { in: ids } }, include: { platformPost: { select: { description: true, contentItem: { select: { title: true } } } } } });
  let classes: Awaited<ReturnType<typeof classifyComments>> = [];
  try {
    classes = await classifyComments(projectId, rows.map((r) => ({ id: r.id, text: r.text, postContext: r.platformPost?.contentItem.title ?? "", hadPersonalData: hasPersonal(r.text) })));
  } catch (e) {
    // no AI (or it failed): comments still arrive, unclassified
    console.error("[social] classify", (e as Error).message);
    return 0;
  }
  for (const c of classes) {
    const row = rows.find((r) => r.id === c.id);
    if (!row) continue;
    const needsHuman = c.needsHuman || c.category === "needs_human" || c.sensitive.length > 0;
    const status = needsHuman ? "ESCALATED" : c.category === "question" || c.category === "purchase_intent" || c.category === "contact_request" ? "NEEDS_REPLY" : "NEW";
    await prisma.socialComment.update({ where: { id: row.id }, data: { category: c.category, sentiment: c.sentiment, isQuestion: c.isQuestion || c.category === "question", isLead: c.isLead || c.category === "purchase_intent" || c.category === "contact_request", needsHuman, language: c.language, aiReason: [c.reason, c.sensitive.length ? `wrażliwe: ${c.sensitive.join(", ")}` : ""].filter(Boolean).join(" · ").slice(0, 500), classifiedAt: new Date(), status } });
    if (c.isLead || c.category === "purchase_intent" || c.category === "contact_request")
      await notify({ projectId, type: "lead_comment", title: `Potencjalny lead (${PLATFORM_META[row.platform as Platform].name})`, body: redactPersonal(row.text).slice(0, 200), link: `/social/comments?comment=${row.id}`, dedupeKey: `lead:${row.id}`, perm: "comments.reply" });
    else if (needsHuman || c.sentiment === "negative")
      await notify({ projectId, type: "important_comment", title: `Komentarz wymaga uwagi (${PLATFORM_META[row.platform as Platform].name})`, body: redactPersonal(row.text).slice(0, 200), link: `/social/comments?comment=${row.id}`, dedupeKey: `important:${row.id}`, perm: "comments.reply" });
    if (!needsHuman) await maybeAutoReply(row.id).catch((e) => console.error("[social] auto-reply", (e as Error).message));
  }
  return classes.length;
}

/** "Wygeneruj odpowiedź AI": a draft for a person to accept, edit or reject */
export async function draftReply(commentId: string, userId: string) {
  const c = await prisma.socialComment.findUniqueOrThrow({ where: { id: commentId } });
  if (c.isOwn) throw new HttpError(400, "To komentarz Twojego konta.");
  const d = await replyDraft(commentId, userId);
  const reply = await prisma.commentReply.create({ data: { commentId, text: d.reply.slice(0, 2000), source: "AI", status: "DRAFT", aiGenerationId: d.generationId, createdById: userId, idempotencyKey: `reply:${commentId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}` } });
  if (d.needsHuman && !c.needsHuman) await prisma.socialComment.update({ where: { id: commentId }, data: { needsHuman: true, status: "ESCALATED", aiReason: d.reason.slice(0, 500) } });
  return { reply, needsHuman: d.needsHuman, reason: d.reason };
}

/** a person's own reply, or an accepted (maybe edited) AI draft — sent by job "social-reply" */
export async function approveReply(o: { commentId: string; replyId?: string | null; text: string; visibility?: "PUBLIC" | "PRIVATE"; userId: string }) {
  const c = await prisma.socialComment.findUniqueOrThrow({ where: { id: o.commentId } });
  if (o.visibility === "PRIVATE" && c.platform !== "INSTAGRAM") throw new HttpError(400, "Prywatna odpowiedź (DM) jest dostępna tylko na Instagramie.");
  const text = o.text.trim();
  if (text.length < 2) throw new HttpError(400, "Odpowiedź jest pusta.");
  let reply;
  if (o.replyId) {
    const r = await prisma.commentReply.findFirst({ where: { id: o.replyId, commentId: o.commentId } });
    if (!r) throw new HttpError(404, "Nie znaleziono projektu odpowiedzi");
    if (r.status !== "DRAFT" && r.status !== "FAILED") throw new HttpError(409, "Ta odpowiedź została już obsłużona.");
    reply = await prisma.commentReply.update({ where: { id: r.id }, data: { text: text.slice(0, 2000), status: "APPROVED", visibility: o.visibility ?? "PUBLIC", decidedById: o.userId, decidedAt: new Date(), source: r.source === "AI" && r.text !== text ? "AI_EDITED" : r.source } });
  } else {
    reply = await prisma.commentReply.create({ data: { commentId: o.commentId, text: text.slice(0, 2000), source: "HUMAN", status: "APPROVED", visibility: o.visibility ?? "PUBLIC", createdById: o.userId, decidedById: o.userId, decidedAt: new Date(), idempotencyKey: `reply:${o.commentId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}` } });
  }
  await enqueueSocial("social-reply", { replyId: reply.id }, { idempotencyKey: `send:${reply.id}`, maxAttempts: 3 });
  await audit({ userId: o.userId, projectId: c.projectId, action: "comment.reply_approved", entityType: "CommentReply", entityId: reply.id, data: { source: reply.source, visibility: reply.visibility } });
  return reply;
}

export async function rejectReply(replyId: string, userId: string) {
  const r = await prisma.commentReply.findUniqueOrThrow({ where: { id: replyId }, include: { comment: true } });
  if (r.status !== "DRAFT") throw new HttpError(409, "Tę odpowiedź już obsłużono.");
  await prisma.commentReply.update({ where: { id: replyId }, data: { status: "REJECTED", decidedById: userId, decidedAt: new Date() } });
  await audit({ userId, projectId: r.comment.projectId, action: "comment.reply_rejected", entityType: "CommentReply", entityId: replyId });
}

/**
 * job "social-reply": send once. A reply caught in SENDING (crash mid-request) is NOT re-sent
 * blindly — it would duplicate a public comment; it is marked failed for a person to check.
 */
export async function sendReply(replyId: string) {
  const r = await prisma.commentReply.findUniqueOrThrow({ where: { id: replyId }, include: { comment: { include: { socialAccount: { include: { providerProfile: true } }, platformPost: true } } } });
  if (r.status === "SENT") return { state: "SENT" };
  if (r.status === "SENDING") {
    await prisma.commentReply.update({ where: { id: replyId }, data: { status: "FAILED", error: "Wysyłka została przerwana — sprawdź na platformie, czy odpowiedź się ukazała, zanim wyślesz ponownie." } });
    return { state: "FAILED" };
  }
  if (r.status !== "APPROVED") return { state: r.status };
  const c = r.comment;
  await prisma.commentReply.update({ where: { id: replyId }, data: { status: "SENDING" } });
  try {
    const provider = providerFor(c.socialAccount);
    const res =
      r.visibility === "PRIVATE"
        ? await provider.privateReply({ profile: c.socialAccount.providerProfile.username, commentId: c.nativeId, message: r.text })
        : await provider.reply({ profile: c.socialAccount.providerProfile.username, platform: c.platform as Platform, message: r.text, commentId: c.nativeId, postId: c.platformPost?.platformPostId ?? null, postUrl: c.platformPost?.publishedUrl ?? null });
    await prisma.commentReply.update({ where: { id: replyId }, data: { status: "SENT", sentAt: new Date(), nativeId: res.id, error: null } });
    await prisma.socialComment.update({ where: { id: c.id }, data: { status: "REPLIED", readAt: c.readAt ?? new Date() } });
    if (res.id && r.visibility === "PUBLIC")
      await prisma.socialComment
        .create({ data: { projectId: c.projectId, socialAccountId: c.socialAccountId, platformPostId: c.platformPostId, platform: c.platform, nativeId: res.id, parentNativeId: c.nativeId, authorName: c.socialAccount.displayName ?? "Twoje konto", authorHandle: c.socialAccount.accountHandle, text: r.text, postedAt: new Date(), isOwn: true, status: "REPLIED", isDemo: c.isDemo } })
        .catch(() => {});
    return { state: "SENT" };
  } catch (e) {
    await prisma.commentReply.update({ where: { id: replyId }, data: { status: "FAILED", error: (e as Error).message.slice(0, 1000) } });
    if (e instanceof ProviderError && e.retryable && !e.uncertain) {
      await prisma.commentReply.update({ where: { id: replyId }, data: { status: "APPROVED" } });
      throw e;
    }
    return { state: "FAILED" };
  }
}

const norm = (t: string) => t.toLowerCase().replace(/\s+/g, " ").replace(/[^\p{L}\p{N} ]/gu, "").trim();

/** optional automatic reply (only when the owner turned it on, only for allowed safe categories) */
export async function maybeAutoReply(commentId: string) {
  const c = await prisma.socialComment.findUniqueOrThrow({ where: { id: commentId }, include: { project: { include: { brand: true } }, replies: true } });
  const b = c.project.brand;
  if (!b?.autoReplyEnabled || c.isOwn || c.needsHuman || !c.category) return { skipped: "off" };
  const allowed = b.autoReplyCategories.filter((x) => ["positive", "question"].includes(x));
  if (!allowed.includes(c.category)) return { skipped: "category" };
  if (c.replies.length) return { skipped: "has reply" };
  if (SENSITIVE.some((s) => (c.aiReason ?? "").includes(s))) return { skipped: "sensitive" };
  // loop protection: never inside a thread where we already answered
  if (c.parentNativeId && (await prisma.socialComment.count({ where: { socialAccountId: c.socialAccountId, OR: [{ nativeId: c.parentNativeId, isOwn: true }, { parentNativeId: c.parentNativeId, isOwn: true }] } }))) return { skipped: "thread" };
  const hour = new Date(Date.now() - 3600e3);
  const sentLastHour = await prisma.commentReply.count({ where: { source: "AUTO", createdAt: { gt: hour }, comment: { projectId: c.projectId } } });
  if (sentLastHour >= b.autoReplyMaxPerHour) return { skipped: "limit" };
  const sameAuthor = c.authorId ? await prisma.commentReply.count({ where: { source: "AUTO", createdAt: { gt: new Date(Date.now() - 86400e3) }, comment: { projectId: c.projectId, authorId: c.authorId } } }) : 0;
  if (sameAuthor) return { skipped: "author" };
  const d = await replyDraft(commentId, null);
  if (d.needsHuman) {
    await prisma.socialComment.update({ where: { id: commentId }, data: { needsHuman: true, status: "ESCALATED", aiReason: d.reason.slice(0, 500) } });
    return { skipped: "needs human" };
  }
  // an automatic reply never carries a link or contact data (a comment could try to steer the AI)
  if (redactPersonal(d.reply) !== d.reply) return { skipped: "link or contact data in reply" };
  const recent = await prisma.commentReply.findMany({ where: { createdAt: { gt: new Date(Date.now() - 86400e3) }, comment: { projectId: c.projectId } }, select: { text: true } });
  if (recent.some((r) => norm(r.text) === norm(d.reply))) return { skipped: "duplicate text" };
  const reply = await prisma.commentReply.create({ data: { commentId, text: d.reply.slice(0, 1000), source: "AUTO", status: "APPROVED", aiGenerationId: d.generationId, decidedAt: new Date(), idempotencyKey: `auto:${commentId}` } });
  await enqueueSocial("social-reply", { replyId: reply.id }, { idempotencyKey: `send:${reply.id}`, maxAttempts: 3 });
  await audit({ projectId: c.projectId, action: "comment.auto_reply", entityType: "CommentReply", entityId: reply.id, data: { category: c.category } });
  return { sent: true };
}

/** GDPR retention: comments older than the project's retention are removed */
export async function purgeOldComments() {
  const brands = await prisma.brandSettings.findMany({ select: { projectId: true, commentRetentionDays: true } });
  let n = 0;
  for (const b of brands) {
    const r = await prisma.socialComment.deleteMany({ where: { projectId: b.projectId, postedAt: { lt: new Date(Date.now() - b.commentRetentionDays * 86400e3) } } });
    n += r.count;
  }
  return n;
}
