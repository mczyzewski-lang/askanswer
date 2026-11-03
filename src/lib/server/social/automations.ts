import { prisma } from "../db";
import { audit } from "./audit";
import { notify } from "./notify";
import { enqueueSocial } from "./queue";
import { fillReply, isShortTrigger, matchesKeyword } from "@/lib/social/automation";

/** at most this many automatic keyword replies per project per hour (a burst is left for a person) */
export const KEYWORD_REPLIES_PER_HOUR = 60;

/**
 * A new comment with an automation's keyword gets that automation's ready reply — under the comment and/or
 * (Instagram) as a private message. The texts are written by a person, so they may carry a link.
 * Never for our own comments, a comment that already has a reply, a long comment, or the same author
 * twice in a day for the same keyword.
 */
export async function runKeywordAutomations(commentId: string) {
  const c = await prisma.socialComment.findUniqueOrThrow({ where: { id: commentId }, include: { replies: true } });
  if (c.isOwn || c.replies.length) return { skipped: "own or replied" };
  const rules = await prisma.commentAutomation.findMany({ where: { projectId: c.projectId, enabled: true }, orderBy: { createdAt: "asc" } });
  const rule = rules.find((r) => matchesKeyword(c.text, r.keyword) && (!r.platforms.length || r.platforms.includes(c.platform)));
  if (!rule) return { skipped: "no keyword" };
  if (!isShortTrigger(c.text)) {
    await prisma.socialComment.update({ where: { id: c.id }, data: { aiReason: `Zawiera słowo ${rule.keyword}, ale to dłuższy komentarz — automatyzacja pominięta, przeczytaj go.`, status: "NEEDS_REPLY" } });
    return { skipped: "long comment" };
  }
  const who = c.authorId ? { authorId: c.authorId } : c.authorHandle ? { authorHandle: c.authorHandle } : null;
  if (who && (await prisma.commentReply.count({ where: { automationId: rule.id, createdAt: { gt: new Date(Date.now() - 86400e3) }, comment: { socialAccountId: c.socialAccountId, ...who } } })))
    return { skipped: "same author today" };
  const hour = await prisma.commentReply.count({ where: { source: "KEYWORD", createdAt: { gt: new Date(Date.now() - 3600e3) }, comment: { projectId: c.projectId } } });
  if (hour >= KEYWORD_REPLIES_PER_HOUR) {
    await notify({ projectId: c.projectId, type: "important_comment", title: "Limit automatycznych odpowiedzi", body: `Ponad ${KEYWORD_REPLIES_PER_HOUR} komentarzy ze słowem w ciągu godziny — kolejne czekają w skrzynce na odpowiedź.`, link: `/social/comments?project=${c.projectId}`, dedupeKey: `kw-limit:${c.projectId}:${new Date().toISOString().slice(0, 13)}`, perm: "comments.reply" });
    return { skipped: "hourly limit" };
  }
  const sends: Array<{ visibility: "PUBLIC" | "PRIVATE"; text: string }> = [];
  if (rule.dmReply.trim() && c.platform === "INSTAGRAM") sends.push({ visibility: "PRIVATE", text: fillReply(rule.dmReply, c.authorName) });
  if (rule.publicReply.trim()) sends.push({ visibility: "PUBLIC", text: fillReply(rule.publicReply, c.authorName) });
  if (!sends.length) return { skipped: "nothing to send on this platform" };
  for (const s of sends) {
    const reply = await prisma.commentReply.create({ data: { commentId: c.id, text: s.text.slice(0, 2000), source: "KEYWORD", automationId: rule.id, status: "APPROVED", visibility: s.visibility, decidedAt: new Date(), idempotencyKey: `kw:${c.id}:${s.visibility}` } });
    await enqueueSocial("social-reply", { replyId: reply.id }, { idempotencyKey: `send:${reply.id}`, maxAttempts: 3 });
  }
  await prisma.commentAutomation.update({ where: { id: rule.id }, data: { sentCount: { increment: 1 }, lastSentAt: new Date() } });
  await audit({ projectId: c.projectId, action: "comment.keyword_reply", entityType: "SocialComment", entityId: c.id, data: { automationId: rule.id, keyword: rule.keyword, sends: sends.map((s) => s.visibility) } });
  return { sent: sends.length, keyword: rule.keyword };
}
