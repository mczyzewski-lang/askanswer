/**
 * Publications and their approval workflow.
 *
 *   DRAFT → PENDING_APPROVAL → APPROVED → SCHEDULING → SCHEDULED → PUBLISHING → PUBLISHED
 *   (+ CHANGES_REQUESTED, REJECTED, SCHEDULING_FAILED, PUBLISH_FAILED, CANCELLED, REAUTH_REQUIRED)
 *
 * An approval covers one exact version: the content hash of texts, options, file, target account
 * (with its id at the platform), page and date. Changing any of them after the approval withdraws
 * it — and an order already at the provider is cancelled — so only what a person approved is sent.
 */
import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { HttpError } from "../errors";
import { checkPostText, normalizeHashtags, PLATFORM_RULES, type Issue } from "@/lib/social/rules";
import { PLATFORM_META, type Platform } from "@/lib/social/platforms";
import { canSubmit } from "@/lib/social/status";
import { audit } from "./audit";
import { notify } from "./notify";
import { enqueueSocial } from "./queue";

type PostRow = Prisma.PlatformPostGetPayload<{ include: { socialAccount: true; contentItem: { include: { media: true } } } }>;

const POST_WITH = { socialAccount: true, contentItem: { include: { media: true } } } as const;

/** stable JSON (sorted keys) so the same content always hashes the same */
function stable(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v as object).sort().filter((k) => !k.startsWith("_")).map((k) => [k, stable((v as Record<string, unknown>)[k])]));
  return v;
}

/** everything an approval covers */
export function contentHashOf(p: Pick<PostRow, "title" | "description" | "hashtags" | "cta" | "firstComment" | "coverTimestamp" | "options" | "mediaVariantId" | "scheduledAt" | "socialAccountId"> & { mediaId: string; account: { platformAccountId: string | null; pageId: string | null } }): string {
  const data = stable({
    title: p.title,
    description: p.description,
    hashtags: p.hashtags,
    cta: p.cta,
    firstComment: p.firstComment,
    cover: p.coverTimestamp,
    options: p.options ?? {},
    file: p.mediaVariantId ?? p.mediaId,
    account: p.socialAccountId,
    accountIdentity: p.account.platformAccountId,
    page: p.account.pageId,
    at: p.scheduledAt ? new Date(p.scheduledAt).toISOString() : null,
  });
  return crypto.createHash("sha256").update(JSON.stringify(data)).digest("hex");
}

const hashRow = (p: PostRow) => contentHashOf({ ...p, mediaId: p.contentItem.mediaId, account: p.socialAccount });

export async function loadPost(id: string) {
  return prisma.platformPost.findUniqueOrThrow({ where: { id }, include: POST_WITH });
}

function snapshot(p: PostRow) {
  return { title: p.title, description: p.description, hashtags: p.hashtags, cta: p.cta, firstComment: p.firstComment, coverTimestamp: p.coverTimestamp, options: p.options, mediaVariantId: p.mediaVariantId, scheduledAt: p.scheduledAt?.toISOString() ?? null, socialAccountId: p.socialAccountId, accountIdentity: p.socialAccount.platformAccountId, pageId: p.socialAccount.pageId };
}

/** a film's publications: one per target account */
export async function createContent(projectId: string, mediaId: string, accountIds: string[], actorId: string, o: { title?: string; goal?: string; isDemo?: boolean } = {}) {
  const media = await prisma.socialMedia.findFirst({ where: { id: mediaId, projectId } });
  if (!media) throw new HttpError(404, "Nie znaleziono filmu w tym projekcie");
  const accounts = await prisma.socialAccount.findMany({ where: { id: { in: accountIds }, projectId, connectionStatus: { not: "DISCONNECTED" } } });
  if (!accounts.length) throw new HttpError(400, "Wybierz co najmniej jedno połączone konto");
  const item = await prisma.contentItem.create({ data: { projectId, mediaId, title: o.title ?? media.title, goal: o.goal ?? "", createdById: actorId, isDemo: media.isDemo } });
  for (const a of accounts) await addTarget(item.id, a.id, actorId);
  await audit({ userId: actorId, projectId, action: "content.created", entityType: "ContentItem", entityId: item.id, data: { mediaId, accounts: accounts.map((a) => a.id) } });
  return item;
}

export async function addTarget(contentItemId: string, accountId: string, actorId: string) {
  const item = await prisma.contentItem.findUniqueOrThrow({ where: { id: contentItemId }, include: { media: true } });
  const account = await prisma.socialAccount.findFirst({ where: { id: accountId, projectId: item.projectId } });
  if (!account) throw new HttpError(404, "Nie znaleziono konta w tym projekcie");
  const exists = await prisma.platformPost.findUnique({ where: { contentItemId_socialAccountId: { contentItemId, socialAccountId: accountId } } });
  if (exists) return exists;
  const platform = account.platform as Platform;
  const options: Record<string, unknown> = platform === "YOUTUBE" ? { youtubePrivacy: "public", youtubeTags: [] } : platform === "TIKTOK" ? { tiktokPrivacy: "PUBLIC_TO_EVERYONE" } : platform === "INSTAGRAM" ? { shareToFeed: true } : platform === "FACEBOOK" ? { facebookMediaType: (item.media.durationSec ?? 0) > 90 ? "VIDEO" : "REELS" } : {};
  const base = { title: platform === "YOUTUBE" ? item.media.title.slice(0, 100) : "", description: item.media.description, hashtags: [] as string[], cta: "", firstComment: "", coverTimestamp: null, options, mediaVariantId: null, scheduledAt: null, socialAccountId: accountId };
  const hash = contentHashOf({ ...base, options: options as Prisma.JsonValue, mediaId: item.mediaId, account });
  const post = await prisma.platformPost.create({ data: { ...base, options: options as Prisma.InputJsonValue, contentItemId, projectId: item.projectId, platform, contentHash: hash, isDemo: item.isDemo } });
  await prisma.contentRevision.create({ data: { platformPostId: post.id, revision: 1, snapshot: { created: true } as Prisma.InputJsonValue, contentHash: hash, editedById: actorId, reason: "utworzenie" } });
  return post;
}

export interface PostPatch {
  title?: string;
  description?: string;
  hashtags?: string[];
  cta?: string;
  firstComment?: string;
  coverTimestamp?: number | null;
  options?: Record<string, unknown>;
  mediaVariantId?: string | null;
  scheduledAt?: Date | null;
}

/** edit a publication; a change after approval withdraws the approval (and holds the provider order) */
export async function updatePost(postId: string, patch: PostPatch, actorId: string, reason = "edycja") {
  const post = await loadPost(postId);
  if (post.status === "PUBLISHED" || post.status === "PUBLISHING") throw new HttpError(409, "Opublikowanej publikacji nie można już zmienić.");
  if (post.status === "SCHEDULING") throw new HttpError(409, "Publikacja jest właśnie przekazywana do dostawcy — spróbuj za chwilę.");
  const data: Prisma.PlatformPostUpdateInput = {};
  const rules = PLATFORM_RULES[post.platform as Platform];
  if (patch.title !== undefined) data.title = patch.title.slice(0, 500);
  if (patch.description !== undefined) data.description = patch.description.slice(0, 70_000);
  if (patch.hashtags !== undefined) data.hashtags = normalizeHashtags(patch.hashtags, rules.limits.hashtagsMax + 10);
  if (patch.cta !== undefined) data.cta = patch.cta.slice(0, 500);
  if (patch.firstComment !== undefined) data.firstComment = patch.firstComment.slice(0, 10_000);
  if (patch.coverTimestamp !== undefined) data.coverTimestamp = patch.coverTimestamp;
  if (patch.options !== undefined) data.options = { ...((post.options as object) ?? {}), ...patch.options } as Prisma.InputJsonValue;
  if (patch.mediaVariantId !== undefined) {
    if (patch.mediaVariantId) {
      const v = await prisma.socialMediaVariant.findFirst({ where: { id: patch.mediaVariantId, mediaId: post.contentItem.mediaId, status: "READY" } });
      if (!v) throw new HttpError(400, "Wybrana wersja pliku nie jest gotowa");
    }
    data.mediaVariantId = patch.mediaVariantId;
  }
  if (patch.scheduledAt !== undefined) data.scheduledAt = patch.scheduledAt;
  const next = await prisma.platformPost.update({ where: { id: postId }, data, include: POST_WITH });
  const hash = hashRow(next);
  if (hash === post.contentHash) return next;
  const revision = post.revision + 1;
  await prisma.platformPost.update({ where: { id: postId }, data: { contentHash: hash, revision } });
  await prisma.contentRevision.create({ data: { platformPostId: postId, revision, snapshot: snapshot(next) as unknown as Prisma.InputJsonValue, contentHash: hash, editedById: actorId, reason } });
  if (post.approvedHash) await invalidateApproval(postId, "Zmieniono publikację po akceptacji — wymaga ponownego zatwierdzenia.", actorId, { cancelAtProvider: true });
  return loadPost(postId);
}

/** withdraw the approval of a post (content / file / account / date changed) */
export async function invalidateApproval(postId: string, reason: string, actorId: string | null, o: { cancelAtProvider?: boolean; recompute?: boolean } = {}) {
  let post = await loadPost(postId);
  if (post.status === "PUBLISHED" || post.status === "PUBLISHING") return post;
  if (o.recompute) {
    const hash = hashRow(post);
    if (hash !== post.contentHash) post = await prisma.platformPost.update({ where: { id: postId }, data: { contentHash: hash, revision: post.revision + 1 }, include: POST_WITH });
  }
  const had = !!post.approvedHash;
  await prisma.approval.updateMany({ where: { platformPostId: postId, decision: "APPROVED", invalidatedAt: null }, data: { invalidatedAt: new Date(), invalidatedReason: reason } });
  const backToQueue = ["APPROVED", "SCHEDULING", "SCHEDULED", "SCHEDULING_FAILED", "PUBLISH_FAILED", "REAUTH_REQUIRED"].includes(post.status);
  await prisma.platformPost.update({ where: { id: postId }, data: { approvedHash: null, approvedRevision: null, approvedAt: null, approvedById: null, ...(backToQueue ? { status: "PENDING_APPROVAL", errorMessage: reason } : {}) } });
  if (o.cancelAtProvider) {
    const active = await prisma.scheduledPublication.findMany({ where: { platformPostId: postId, status: { in: ["SCHEDULING", "SCHEDULED", "UNKNOWN"] } } });
    for (const pub of active) {
      await prisma.scheduledPublication.update({ where: { id: pub.id }, data: { status: "CANCELLING" } });
      await enqueueSocial("social-cancel", { publicationId: pub.id, reason: "edit" }, { idempotencyKey: `cancel:${pub.id}` });
    }
  }
  if (had && backToQueue) {
    await notify({ projectId: post.projectId, type: "approval_requested", title: `Ponowna akceptacja: ${PLATFORM_META[post.platform as Platform].name}`, body: `${post.contentItem.title || post.contentItem.media.title} — ${reason}`, link: `/social/approvals?post=${postId}`, dedupeKey: `approval:${postId}:${post.revision}`, perm: "content.approve", excludeUserId: actorId });
  }
  await audit({ userId: actorId, projectId: post.projectId, action: "approval.invalidated", entityType: "PlatformPost", entityId: postId, data: { reason, revision: post.revision } });
  return loadPost(postId);
}

/** what blocks a publication from being sent for approval / approved */
export async function readiness(post: PostRow): Promise<Issue[]> {
  const platform = post.platform as Platform;
  const brand = await prisma.brandSettings.findUnique({ where: { projectId: post.projectId }, select: { forbiddenPhrases: true } });
  const issues = checkPostText(platform, { title: post.title, description: post.description, hashtags: post.hashtags, cta: post.cta, firstComment: post.firstComment, options: post.options as Record<string, unknown> }, brand?.forbiddenPhrases ?? []);
  if (post.contentItem.media.status !== "READY") issues.push({ level: "error", field: "media", message: "Film nie jest jeszcze gotowy (przetwarzanie)." });
  const check = (post.contentItem.media.checks as Record<string, { errors?: string[] }> | null)?.[platform];
  if (!post.mediaVariantId && check?.errors?.length) issues.push({ level: "error", field: "media", message: `Film nie spełnia wymagań platformy: ${check.errors.join(" ")}` });
  if (post.socialAccount.connectionStatus !== "CONNECTED") issues.push({ level: "error", field: "account", message: post.socialAccount.connectionStatus === "REAUTH_REQUIRED" ? "Konto wymaga ponownego połączenia." : "Konto jest rozłączone." });
  if (platform === "FACEBOOK" && !post.socialAccount.pageId) issues.push({ level: "error", field: "account", message: "Wybierz stronę Facebook, na której ma się ukazać publikacja." });
  if (!post.scheduledAt) issues.push({ level: "error", field: "scheduledAt", message: "Wybierz datę i godzinę publikacji." });
  else if (post.scheduledAt.getTime() < Date.now() + 60_000) issues.push({ level: "error", field: "scheduledAt", message: "Termin publikacji musi być w przyszłości." });
  return issues;
}

export async function submitForApproval(postIds: string[], actorId: string) {
  const out: Array<{ id: string; ok: boolean; errors: string[] }> = [];
  for (const id of postIds) {
    const post = await loadPost(id);
    if (post.status === "PENDING_APPROVAL") {
      out.push({ id, ok: true, errors: [] });
      continue;
    }
    if (!canSubmit(post.status)) {
      out.push({ id, ok: false, errors: [`Ta publikacja ma status „${post.status}” — nie można jej wysłać do akceptacji.`] });
      continue;
    }
    const errors = (await readiness(post)).filter((i) => i.level === "error").map((i) => i.message);
    if (errors.length) {
      out.push({ id, ok: false, errors });
      continue;
    }
    await prisma.platformPost.update({ where: { id }, data: { status: "PENDING_APPROVAL", errorMessage: null } });
    await notify({ projectId: post.projectId, type: "approval_requested", title: `Do akceptacji: ${post.contentItem.title || post.contentItem.media.title}`, body: `${PLATFORM_META[post.platform as Platform].name} · ${post.socialAccount.displayName ?? post.socialAccount.accountHandle ?? ""}`, link: `/social/approvals?post=${id}`, dedupeKey: `approval:${id}:${post.revision}`, perm: "content.approve", excludeUserId: actorId });
    await audit({ userId: actorId, projectId: post.projectId, action: "approval.requested", entityType: "PlatformPost", entityId: id, data: { revision: post.revision } });
    out.push({ id, ok: true, errors: [] });
  }
  return out;
}

export type Decision = "APPROVED" | "REJECTED" | "CHANGES_REQUESTED";

/**
 * The approver decides on the exact revision they saw. A stale revision (somebody edited meanwhile)
 * is refused, so an approval never covers text the approver did not read.
 */
export async function decide(items: Array<{ postId: string; revision: number }>, decision: Decision, comment: string, actorId: string) {
  const out: Array<{ id: string; ok: boolean; error?: string }> = [];
  for (const { postId, revision } of items) {
    const post = await loadPost(postId);
    if (post.status !== "PENDING_APPROVAL") {
      out.push({ id: postId, ok: false, error: "Ta publikacja nie czeka na akceptację." });
      continue;
    }
    if (post.revision !== revision || hashRow(post) !== post.contentHash) {
      out.push({ id: postId, ok: false, error: "Treść zmieniła się w międzyczasie — odśwież i sprawdź aktualną wersję." });
      continue;
    }
    if (decision === "APPROVED") {
      const errors = (await readiness(post)).filter((i) => i.level === "error").map((i) => i.message);
      if (errors.length) {
        out.push({ id: postId, ok: false, error: errors.join(" ") });
        continue;
      }
    }
    const approval = await prisma.approval.create({ data: { platformPostId: postId, revision: post.revision, contentHash: post.contentHash, decision, comment: comment.slice(0, 4000), userId: actorId } });
    if (decision === "APPROVED") {
      await prisma.platformPost.update({ where: { id: postId }, data: { status: "APPROVED", approvedHash: post.contentHash, approvedRevision: post.revision, approvedAt: new Date(), approvedById: actorId, errorMessage: null } });
      await enqueueSocial("social-schedule", { postId }, { idempotencyKey: `schedule:${postId}:${approval.id}` });
    } else {
      await prisma.platformPost.update({ where: { id: postId }, data: { status: decision, errorMessage: comment || null } });
      await notify({
        projectId: post.projectId,
        type: decision === "REJECTED" ? "post_rejected" : "changes_requested",
        title: `${decision === "REJECTED" ? "Odrzucono" : "Poproszono o poprawki"}: ${post.contentItem.title || post.contentItem.media.title}`,
        body: `${PLATFORM_META[post.platform as Platform].name}${comment ? ` — „${comment.slice(0, 200)}”` : ""}`,
        link: `/social/content/${post.contentItemId}?post=${postId}`,
        dedupeKey: `decision:${approval.id}`,
        perm: "content.edit",
        excludeUserId: actorId,
      });
    }
    await audit({ userId: actorId, projectId: post.projectId, action: `approval.${decision.toLowerCase()}`, entityType: "PlatformPost", entityId: postId, data: { revision: post.revision, contentHash: post.contentHash, comment } });
    out.push({ id: postId, ok: true });
  }
  return out;
}

/** the one rule the publisher enforces: the current version is the approved one */
export async function assertApproved(postId: string) {
  const post = await loadPost(postId);
  const hash = hashRow(post);
  const approval = await prisma.approval.findFirst({ where: { platformPostId: postId, decision: "APPROVED", invalidatedAt: null }, orderBy: { createdAt: "desc" } });
  const ok = !!approval && !!post.approvedHash && post.approvedHash === hash && hash === post.contentHash && approval.contentHash === hash && approval.revision === post.revision && post.approvedRevision === post.revision;
  if (!ok) throw new HttpError(409, "Publikacja nie ma aktualnej akceptacji — nie zostanie wysłana do dostawcy.");
  return { post, approval: approval! };
}

/** remove one target (account) of a film — cancels its order first when it is at the provider */
export async function removeTarget(postId: string, actorId: string) {
  const post = await loadPost(postId);
  if (post.status === "PUBLISHED" || post.status === "PUBLISHING") throw new HttpError(409, "Opublikowanej publikacji nie można usunąć z planu (usuń ją na platformie).");
  const { cancelPost } = await import("./publisher");
  await cancelPost(postId, actorId, "Usunięto konto docelowe", { sync: true });
  await prisma.platformPost.delete({ where: { id: postId } });
  await audit({ userId: actorId, projectId: post.projectId, action: "post.target_removed", entityType: "PlatformPost", entityId: postId, data: { account: post.socialAccountId } });
}

export type { PostRow };
