/**
 * Orders at the provider: one per publication target (account), so each can be edited, cancelled
 * and retried on its own.
 *
 * Reliability rules:
 *  - only an approved, current version is ordered (assertApproved), checked again right before sending;
 *  - each order has a stable externalId (correlation) and an Idempotency-Key (the provider collapses
 *    repeats of the same key into one post), so a timeout never becomes a second post;
 *  - an order in an unknown state is first looked up / re-sent with the SAME key, never with a new one;
 *  - a new key (generation) is used only after a confirmed cancel.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { HttpError } from "../errors";
import { toLocalFile } from "../storage";
import { composeCaption } from "@/lib/social/rules";
import { PLATFORM_META, type Platform } from "@/lib/social/platforms";
import { providerFor, ProviderError, type JobStatus } from "./provider";
import { assertApproved, invalidateApproval, loadPost } from "./posts";
import { audit } from "./audit";
import { notify } from "./notify";
import { enqueueSocial } from "./queue";

/** links from the provider are shown as hrefs: only http(s) */
const safeUrl = (u: string | null | undefined) => (u && /^https?:\/\//i.test(u) ? u.slice(0, 2000) : null);

/** the provider needs a date in the future; a very near one is moved a little */
const MIN_LEAD_MS = 2 * 60_000;

async function logAttempt(publicationId: string, kind: string, r: { idempotencyKey?: string; httpStatus?: number | null; ok: boolean; request?: unknown; response?: unknown; error?: string; t0: number }) {
  await prisma.publicationAttempt.create({
    data: { scheduledPublicationId: publicationId, kind, idempotencyKey: r.idempotencyKey, httpStatus: r.httpStatus ?? null, ok: r.ok, request: (r.request ?? undefined) as Prisma.InputJsonValue | undefined, response: (r.response ?? undefined) as Prisma.InputJsonValue | undefined, error: r.error?.slice(0, 2000), durationMs: Date.now() - r.t0 },
  });
}

/** schedule (order) an approved post at the provider — job "social-schedule" */
export async function schedulePost(postId: string) {
  const { post, approval } = await assertApproved(postId);
  const account = await prisma.socialAccount.findUniqueOrThrow({ where: { id: post.socialAccountId }, include: { providerProfile: true } });
  const provider = providerFor(account);

  // the target must still be the account that was approved
  const remote = await provider.getProfile(account.providerProfile.username);
  const live = remote?.accounts.find((a) => a.platform === account.platform);
  if (!live) {
    await prisma.platformPost.update({ where: { id: postId }, data: { status: "REAUTH_REQUIRED", errorMessage: "Konto nie jest połączone u dostawcy." } });
    return { state: "reauth" };
  }
  if (live.reauthRequired) {
    await prisma.socialAccount.update({ where: { id: account.id }, data: { connectionStatus: "REAUTH_REQUIRED", reauthRequired: true } });
    await prisma.platformPost.update({ where: { id: postId }, data: { status: "REAUTH_REQUIRED", errorMessage: "Konto wymaga ponownej autoryzacji." } });
    return { state: "reauth" };
  }
  if (account.platformAccountId && live.platformAccountId && live.platformAccountId !== account.platformAccountId) {
    const { syncProfile } = await import("./accounts");
    await syncProfile(account.providerProfileId);
    return { state: "identity_changed" };
  }

  // an order of this version that is already there (or may be) — reuse it, never a second one
  const last = await prisma.scheduledPublication.findFirst({ where: { platformPostId: postId }, orderBy: { generation: "desc" } });
  let pub = last && ["SCHEDULING", "SCHEDULED", "UNKNOWN", "PUBLISHING"].includes(last.status) && last.contentHash === post.contentHash ? last : null;
  if (last && !pub && ["SCHEDULING", "SCHEDULED", "UNKNOWN", "CANCELLING"].includes(last.status)) {
    // an older version is still at the provider: it has to be cancelled first
    if (last.status !== "CANCELLING") {
      await prisma.scheduledPublication.update({ where: { id: last.id }, data: { status: "CANCELLING" } });
      await enqueueSocial("social-cancel", { publicationId: last.id, reason: "replace" }, { idempotencyKey: `cancel:${last.id}` });
    }
    throw new Error("Poprzednie zlecenie jest anulowane — ponowię za chwilę.");
  }
  if (pub?.status === "SCHEDULED" && (pub.providerJobId || pub.providerRequestId)) {
    await prisma.platformPost.update({ where: { id: postId }, data: { status: "SCHEDULED" } });
    return { state: "already_scheduled", publicationId: pub.id };
  }
  const scheduledAt = new Date(Math.max(post.scheduledAt!.getTime(), Date.now() + MIN_LEAD_MS));
  if (!pub) {
    const generation = (last?.generation ?? 0) + 1;
    pub = await prisma.scheduledPublication.create({
      data: {
        platformPostId: postId,
        platform: post.platform,
        socialAccountId: account.id,
        providerProfileUsername: account.providerProfile.username,
        externalId: `smp_${postId}_${generation}`,
        idempotencyKey: `askby-${postId}-g${generation}-${post.contentHash.slice(0, 16)}`,
        generation,
        scheduledAt,
        status: "SCHEDULING",
        approvalId: approval.id,
        contentHash: post.contentHash,
        isDemo: account.isDemo,
      },
    });
  }
  await prisma.platformPost.update({ where: { id: postId }, data: { status: "SCHEDULING", errorMessage: null } });

  const media = post.contentItem.media;
  const variant = post.mediaVariantId ? await prisma.socialMediaVariant.findUnique({ where: { id: post.mediaVariantId } }) : null;
  const key = variant?.storageKey ?? media.storageKey;
  const caption = composeCaption({ title: post.title, description: post.description, hashtags: post.hashtags, cta: post.cta });
  const file = await toLocalFile(key);
  const t0 = Date.now();
  const request = { platform: post.platform, profile: account.providerProfile.username, scheduledAt: scheduledAt.toISOString(), externalId: pub.externalId, captionLength: caption.length, pageId: account.pageId, file: key.split("/").pop() };
  try {
    const r = await provider.upload({
      profile: account.providerProfile.username,
      platform: post.platform as Platform,
      file: { path: file.path, name: media.originalName || `${media.id}.mp4`, mime: media.mimeType },
      title: post.title,
      caption,
      firstComment: post.firstComment,
      scheduledAt,
      timezone: "UTC",
      idempotencyKey: pub.idempotencyKey,
      externalId: pub.externalId,
      pageId: account.pageId,
      options: post.options as Record<string, unknown>,
      coverTimestamp: post.coverTimestamp,
    });
    await logAttempt(pub.id, "SCHEDULE", { idempotencyKey: pub.idempotencyKey, httpStatus: r.httpStatus, ok: r.state !== "failed", request, response: r.raw, error: r.error ?? undefined, t0 });
    if (r.state === "failed") {
      await prisma.scheduledPublication.update({ where: { id: pub.id }, data: { status: "FAILED", errorMessage: r.error ?? "Dostawca odrzucił zlecenie", providerJobId: r.jobId, providerRequestId: r.requestId } });
      await failPost(postId, "SCHEDULING_FAILED", r.error ?? "Dostawca odrzucił zlecenie");
      return { state: "failed" };
    }
    await prisma.scheduledPublication.update({ where: { id: pub.id }, data: { status: r.state === "completed" ? "PUBLISHED" : "SCHEDULED", providerJobId: r.jobId, providerRequestId: r.requestId, warnings: (r.warnings?.length ? r.warnings : undefined) as Prisma.InputJsonValue | undefined, lastCheckedAt: new Date() } });
    // the version could have been withdrawn while the file was uploading: cancel right away
    const fresh = await loadPost(postId);
    if (fresh.approvedHash !== pub.contentHash) {
      await prisma.scheduledPublication.update({ where: { id: pub.id }, data: { status: "CANCELLING" } });
      await enqueueSocial("social-cancel", { publicationId: pub.id, reason: "edit" }, { idempotencyKey: `cancel:${pub.id}` });
      return { state: "withdrawn" };
    }
    if (r.state === "completed") return applyStatus(pub.id, { state: "completed", url: safeUrl(r.url), platformPostId: r.platformPostId, raw: r.raw });
    await prisma.platformPost.update({ where: { id: postId }, data: { status: "SCHEDULED", warnings: (r.warnings?.length ? r.warnings : undefined) as Prisma.InputJsonValue | undefined } });
    await notify({ projectId: post.projectId, type: "post_scheduled", title: `Zaplanowano: ${PLATFORM_META[post.platform as Platform].name}`, body: `${post.contentItem.title || media.title} · ${account.displayName ?? account.accountHandle ?? ""}`, link: `/social/content/${post.contentItemId}?post=${postId}`, dedupeKey: `scheduled:${pub.id}`, perm: "content.edit" });
    await audit({ projectId: post.projectId, action: "publication.scheduled", entityType: "ScheduledPublication", entityId: pub.id, data: { jobId: r.jobId, requestId: r.requestId, scheduledAt: scheduledAt.toISOString(), demo: account.isDemo } });
    return { state: "scheduled", publicationId: pub.id };
  } catch (e) {
    const err = e as Error;
    const pe = e instanceof ProviderError ? e : null;
    await logAttempt(pub.id, "SCHEDULE", { idempotencyKey: pub.idempotencyKey, httpStatus: pe?.status, ok: false, request, response: pe?.body, error: err.message, t0 });
    if (pe?.uncertain || (pe?.retryable ?? (e instanceof ProviderError ? false : true))) {
      // maybe received: keep the same key; the next try / the reconciler sorts it out
      await prisma.scheduledPublication.update({ where: { id: pub.id }, data: { status: pe?.uncertain ? "UNKNOWN" : "SCHEDULING", errorMessage: err.message } });
      throw err;
    }
    const reauth = pe && (pe.status === 401 || pe.status === 403) && /auth|token|reconnect|permission|expired/i.test(err.message);
    await prisma.scheduledPublication.update({ where: { id: pub.id }, data: { status: "FAILED", errorMessage: err.message } });
    await failPost(postId, reauth ? "REAUTH_REQUIRED" : "SCHEDULING_FAILED", err.message);
    return { state: "failed" };
  } finally {
    await file.cleanup();
  }
}

async function failPost(postId: string, status: "SCHEDULING_FAILED" | "PUBLISH_FAILED" | "REAUTH_REQUIRED", message: string) {
  const post = await prisma.platformPost.update({ where: { id: postId }, data: { status, errorMessage: message.slice(0, 2000) }, include: { contentItem: { include: { media: true } }, socialAccount: true } });
  await notify({
    projectId: post.projectId,
    type: status === "REAUTH_REQUIRED" ? "reauth_required" : "post_failed",
    title: `${status === "PUBLISH_FAILED" ? "Błąd publikacji" : status === "REAUTH_REQUIRED" ? "Połącz konto ponownie" : "Błąd planowania"}: ${PLATFORM_META[post.platform as Platform].name}`,
    body: `${post.contentItem.title || post.contentItem.media.title} — ${message.slice(0, 200)}`,
    link: `/social/content/${post.contentItemId}?post=${postId}`,
    dedupeKey: `failed:${postId}:${status}:${post.revision}`,
    perm: "content.edit",
  });
}

/** bring a publication in line with the provider's status (from a webhook hint or the reconciler) */
export async function applyStatus(publicationId: string, s: JobStatus) {
  const pub = await prisma.scheduledPublication.findUniqueOrThrow({ where: { id: publicationId }, include: { platformPost: { include: { contentItem: { include: { media: true } }, socialAccount: true } } } });
  const post = pub.platformPost;
  await prisma.scheduledPublication.update({ where: { id: pub.id }, data: { lastCheckedAt: new Date() } });
  if (pub.status === "CANCELLED" || pub.status === "CANCELLING") {
    if (s.state === "completed") {
      // a cancel came too late — the post is out
      await prisma.scheduledPublication.update({ where: { id: pub.id }, data: { status: "PUBLISHED", publishedUrl: safeUrl(s.url), platformPostId_native: s.platformPostId ?? null } });
      await prisma.platformPost.update({ where: { id: post.id }, data: { status: "PUBLISHED", publishedUrl: safeUrl(s.url), platformPostId: s.platformPostId ?? null, publishedAt: new Date(), errorMessage: "Anulowanie nie zdążyło — publikacja ukazała się.", nextMetricsAt: new Date(Date.now() + 3600e3), nextCommentsAt: new Date(Date.now() + 10 * 60e3) } });
    }
    return { state: pub.status };
  }
  switch (s.state) {
    case "completed": {
      if (pub.status === "PUBLISHED" && post.status === "PUBLISHED") return { state: "PUBLISHED" };
      const at = new Date();
      await prisma.scheduledPublication.update({ where: { id: pub.id }, data: { status: "PUBLISHED", publishedUrl: safeUrl(s.url), platformPostId_native: s.platformPostId ?? null, warnings: (s.warnings?.length ? s.warnings : undefined) as Prisma.InputJsonValue | undefined, errorMessage: null } });
      await prisma.platformPost.update({ where: { id: post.id }, data: { status: "PUBLISHED", publishedUrl: safeUrl(s.url), platformPostId: s.platformPostId ?? null, publishedAt: at, errorMessage: null, warnings: (s.warnings?.length ? s.warnings : undefined) as Prisma.InputJsonValue | undefined, nextMetricsAt: new Date(at.getTime() + 3600e3), nextCommentsAt: new Date(at.getTime() + 10 * 60e3) } });
      await notify({ projectId: post.projectId, type: "post_published", title: `Opublikowano: ${PLATFORM_META[post.platform as Platform].name}`, body: `${post.contentItem.title || post.contentItem.media.title} · ${post.socialAccount.displayName ?? ""}`, link: `/social/content/${post.contentItemId}?post=${post.id}`, dedupeKey: `published:${pub.id}`, perm: "content.edit" });
      await audit({ projectId: post.projectId, action: "publication.published", entityType: "ScheduledPublication", entityId: pub.id, data: { url: s.url, platformPostId: s.platformPostId } });
      return { state: "PUBLISHED" };
    }
    case "failed": {
      await prisma.scheduledPublication.update({ where: { id: pub.id }, data: { status: "FAILED", errorMessage: s.error ?? "Publikacja nie powiodła się" } });
      await failPost(post.id, "PUBLISH_FAILED", s.error ?? "Publikacja nie powiodła się");
      return { state: "FAILED" };
    }
    case "in_progress":
      await prisma.scheduledPublication.update({ where: { id: pub.id }, data: { status: "PUBLISHING" } });
      if (post.status !== "PUBLISHING") await prisma.platformPost.update({ where: { id: post.id }, data: { status: "PUBLISHING" } });
      return { state: "PUBLISHING" };
    case "cancelled":
      await prisma.scheduledPublication.update({ where: { id: pub.id }, data: { status: "CANCELLED" } });
      if (post.status === "SCHEDULED") await prisma.platformPost.update({ where: { id: post.id }, data: { status: "CANCELLED", errorMessage: "Zlecenie anulowane u dostawcy." } });
      return { state: "CANCELLED" };
    case "not_found": {
      // no trace at the provider: re-send under the SAME key (if it did arrive, the provider returns that order)
      if (Date.now() - pub.createdAt.getTime() > 3 * 86400e3) {
        await prisma.scheduledPublication.update({ where: { id: pub.id }, data: { status: "FAILED", errorMessage: "Dostawca nie zna tego zlecenia." } });
        await failPost(post.id, "SCHEDULING_FAILED", "Dostawca nie zna tego zlecenia — zaplanuj ponownie.");
        return { state: "FAILED" };
      }
      await prisma.scheduledPublication.update({ where: { id: pub.id }, data: { status: "UNKNOWN" } });
      return { state: "UNKNOWN" };
    }
    default:
      if (pub.status === "UNKNOWN" || pub.status === "SCHEDULING") await prisma.scheduledPublication.update({ where: { id: pub.id }, data: { status: "SCHEDULED" } });
      if (post.status === "SCHEDULING") await prisma.platformPost.update({ where: { id: post.id }, data: { status: "SCHEDULED" } });
      return { state: "SCHEDULED" };
  }
}

/** ask the provider (job "social-check") */
export async function checkPublication(publicationId: string) {
  const pub = await prisma.scheduledPublication.findUniqueOrThrow({ where: { id: publicationId } });
  if (!pub.providerJobId && !pub.providerRequestId) {
    // the response never came back: the reconciler re-sends with the same key
    if (pub.status === "UNKNOWN" || pub.status === "SCHEDULING") await enqueueSocial("social-schedule", { postId: pub.platformPostId }, { idempotencyKey: `schedule:${pub.platformPostId}:resend:${pub.id}:${Math.floor(Date.now() / 300_000)}` });
    return { state: pub.status };
  }
  const t0 = Date.now();
  const s = await providerFor(pub).status({ jobId: pub.providerJobId, requestId: pub.providerRequestId });
  await logAttempt(pub.id, "STATUS", { ok: true, response: s.raw, t0 });
  return applyStatus(pub.id, s);
}

/**
 * Cancel a post. An order at the provider is deleted there first (`sync` waits for it — used before
 * the post is removed); otherwise the post is just marked cancelled.
 */
export async function cancelPost(postId: string, actorId: string | null, reason = "Anulowano", o: { sync?: boolean } = {}) {
  const post = await loadPost(postId);
  if (post.status === "PUBLISHED") throw new HttpError(409, "Ta publikacja już się ukazała — usuń ją na platformie.");
  if (post.status === "PUBLISHING") throw new HttpError(409, "Publikacja właśnie trwa — nie można jej już anulować.");
  const active = await prisma.scheduledPublication.findMany({ where: { platformPostId: postId, status: { in: ["SCHEDULING", "SCHEDULED", "UNKNOWN", "CANCELLING"] } } });
  for (const pub of active) {
    await prisma.scheduledPublication.update({ where: { id: pub.id }, data: { status: "CANCELLING" } });
    if (o.sync) await cancelPublication(pub.id, "user");
    else await enqueueSocial("social-cancel", { publicationId: pub.id, reason: "user" }, { idempotencyKey: `cancel:${pub.id}` });
  }
  await prisma.platformPost.update({ where: { id: postId }, data: { status: active.length && !o.sync ? post.status : "CANCELLED", errorMessage: active.length && !o.sync ? "Anulowanie u dostawcy…" : reason } });
  await audit({ userId: actorId, projectId: post.projectId, action: "post.cancelled", entityType: "PlatformPost", entityId: postId, data: { reason, providerOrders: active.length } });
  return loadPost(postId);
}

/** delete the order at the provider (job "social-cancel"); `reason` edit = the post waits for a new approval */
export async function cancelPublication(publicationId: string, reason: "user" | "edit" | "replace") {
  const pub = await prisma.scheduledPublication.findUnique({ where: { id: publicationId } });
  if (!pub || pub.status === "CANCELLED" || pub.status === "PUBLISHED" || pub.status === "FAILED") return { state: pub?.status ?? "gone" };
  const provider = providerFor(pub);
  const t0 = Date.now();
  let cancelled = false;
  if (pub.providerJobId) {
    cancelled = await provider.cancelScheduled(pub.providerJobId);
    await logAttempt(pub.id, "CANCEL", { ok: cancelled, t0, response: { cancelled } });
    if (!cancelled) {
      // not cancellable any more: maybe it is out already
      const s = await provider.status({ jobId: pub.providerJobId });
      if (s.state === "completed" || s.state === "in_progress") return applyStatus(pub.id, s);
    }
  } else if (pub.providerRequestId) {
    // an immediate (non-scheduled) request cannot be cancelled
    const s = await provider.status({ requestId: pub.providerRequestId });
    return applyStatus(pub.id, s);
  }
  await prisma.scheduledPublication.update({ where: { id: pub.id }, data: { status: "CANCELLED" } });
  const post = await prisma.platformPost.findUnique({ where: { id: pub.platformPostId } });
  if (post && reason === "user") await prisma.platformPost.update({ where: { id: post.id }, data: { status: "CANCELLED", errorMessage: "Anulowano." } });
  if (post && reason === "replace" && post.approvedHash === post.contentHash) await enqueueSocial("social-schedule", { postId: post.id }, { idempotencyKey: `schedule:${post.id}:after-cancel:${pub.id}` });
  return { state: "CANCELLED" };
}

/**
 * Move an approved, scheduled post. By an approver it is approved right away and the order is
 * edited in place (PATCH); by anyone else the date change waits for a new approval.
 */
export async function reschedule(postId: string, at: Date, actor: { id: string; canApprove: boolean }) {
  const before = await loadPost(postId);
  if (at.getTime() < Date.now() + MIN_LEAD_MS) throw new HttpError(400, "Termin musi być co najmniej 2 minuty w przyszłości.");
  const { updatePost, decide } = await import("./posts");
  const pub = await prisma.scheduledPublication.findFirst({ where: { platformPostId: postId, status: "SCHEDULED" }, orderBy: { generation: "desc" } });
  const wasApproved = !!before.approvedHash && before.approvedHash === before.contentHash;
  if (!(actor.canApprove && wasApproved && pub?.providerJobId)) {
    // the edit withdraws the approval and holds the order at the provider
    return updatePost(postId, { scheduledAt: at }, actor.id, "zmiana terminu");
  }
  // approver: edit in place at the provider, then record the new version as approved by them
  await providerFor(pub).editScheduled(pub.providerJobId!, { scheduledAt: at });
  await logAttempt(pub.id, "EDIT", { ok: true, t0: Date.now(), request: { scheduledAt: at.toISOString() } });
  await prisma.scheduledPublication.update({ where: { id: pub.id }, data: { scheduledAt: at } });
  // record the new date as a new revision, then approve exactly that revision (the order keeps going)
  await prisma.platformPost.update({ where: { id: postId }, data: { scheduledAt: at } });
  const mid = await loadPost(postId);
  const { contentHashOf } = await import("./posts");
  const hash = contentHashOf({ ...mid, mediaId: mid.contentItem.mediaId, account: mid.socialAccount });
  const revision = mid.revision + 1;
  await prisma.approval.updateMany({ where: { platformPostId: postId, decision: "APPROVED", invalidatedAt: null }, data: { invalidatedAt: new Date(), invalidatedReason: "Zmiana terminu" } });
  await prisma.platformPost.update({ where: { id: postId }, data: { contentHash: hash, revision, status: "PENDING_APPROVAL", approvedHash: null, approvedRevision: null } });
  await prisma.contentRevision.create({ data: { platformPostId: postId, revision, snapshot: { scheduledAt: at.toISOString() } as Prisma.InputJsonValue, contentHash: hash, editedById: actor.id, reason: "zmiana terminu (zatwierdzona)" } });
  // the edited order now carries this version (before the approval queues its schedule check)
  await prisma.scheduledPublication.update({ where: { id: pub.id }, data: { contentHash: hash } });
  const [d] = await decide([{ postId, revision }], "APPROVED", "Zmiana terminu zatwierdzona przy przesunięciu", actor.id);
  if (!d?.ok) throw new HttpError(409, d?.error ?? "Nie udało się zatwierdzić nowego terminu");
  return loadPost(postId);
}

/** re-order after a failure (same approval) */
export async function retryPost(postId: string) {
  const post = await loadPost(postId);
  if (!["SCHEDULING_FAILED", "PUBLISH_FAILED"].includes(post.status)) throw new HttpError(409, "Ponowić można tylko nieudaną publikację.");
  const r = await assertApproved(postId).catch(() => null);
  if (!r) {
    await invalidateApproval(postId, "Po błędzie wymagane jest ponowne zatwierdzenie.", null);
    throw new HttpError(409, "Ta wersja nie ma ważnej akceptacji — wysłano ją ponownie do akceptacji.");
  }
  if (post.scheduledAt && post.scheduledAt.getTime() < Date.now() + MIN_LEAD_MS) throw new HttpError(409, "Termin minął — wybierz nowy termin (wymaga ponownej akceptacji).");
  await prisma.platformPost.update({ where: { id: postId }, data: { status: "APPROVED", errorMessage: null } });
  await enqueueSocial("social-schedule", { postId }, { idempotencyKey: `schedule:${postId}:retry:${Date.now()}` });
  return loadPost(postId);
}

/**
 * Reconciliation: webhooks can get lost. Orders whose state is uncertain or whose time has passed
 * are looked up at the provider; approved posts that never got an order get one.
 */
export async function reconcile(now = new Date()) {
  const stale = await prisma.scheduledPublication.findMany({
    where: {
      OR: [
        { status: { in: ["UNKNOWN", "SCHEDULING"] }, updatedAt: { lt: new Date(now.getTime() - 2 * 60e3) } },
        { status: "SCHEDULED", scheduledAt: { lt: new Date(now.getTime() - 60e3) }, OR: [{ lastCheckedAt: null }, { lastCheckedAt: { lt: new Date(now.getTime() - 4 * 60e3) } }] },
        { status: "PUBLISHING", OR: [{ lastCheckedAt: null }, { lastCheckedAt: { lt: new Date(now.getTime() - 4 * 60e3) } }] },
        { status: "CANCELLING", updatedAt: { lt: new Date(now.getTime() - 5 * 60e3) } },
      ],
    },
    take: 50,
    orderBy: { scheduledAt: "asc" },
  });
  const bucket = Math.floor(now.getTime() / 240_000);
  for (const p of stale) {
    if (p.status === "CANCELLING") await enqueueSocial("social-cancel", { publicationId: p.id, reason: "user" }, { idempotencyKey: `cancel:${p.id}:${bucket}` });
    else await enqueueSocial("social-check", { publicationId: p.id }, { idempotencyKey: `check:${p.id}:${bucket}` });
  }
  // approved but no order (e.g. the worker was down when it was approved)
  const orphans = await prisma.platformPost.findMany({ where: { status: "APPROVED", updatedAt: { lt: new Date(now.getTime() - 2 * 60e3) } }, select: { id: true, revision: true }, take: 50 });
  for (const o of orphans) await enqueueSocial("social-schedule", { postId: o.id }, { idempotencyKey: `schedule:${o.id}:${o.revision}:reconcile:${bucket}` });
  return { checked: stale.length, orphans: orphans.length };
}
