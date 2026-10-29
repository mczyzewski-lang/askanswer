/** Views of films and publications for the UI, and applying AI output to publications. */
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { signedUrl } from "../storage";
import { checkPostText, normalizeHashtags, PLATFORM_RULES } from "@/lib/social/rules";
import type { Platform } from "@/lib/social/platforms";
import type { GeneratedPost } from "./ai";
import { accountView } from "./accounts";
import { updatePost } from "./posts";

/** AI drafts go only into publications that are not approved / at the provider (those are regenerated one by one) */
const AI_WRITABLE = ["DRAFT", "PENDING_APPROVAL", "CHANGES_REQUESTED", "REJECTED", "CANCELLED", "SCHEDULING_FAILED"];

export async function applyGenerated(contentItemId: string, r: { generationId: string; posts: GeneratedPost[] }, userId: string | null) {
  const item = await prisma.contentItem.findUniqueOrThrow({ where: { id: contentItemId }, include: { media: true, posts: true } });
  let applied = 0;
  for (const post of item.posts) {
    const g = r.posts.find((p) => p.platform === post.platform);
    if (!g || !AI_WRITABLE.includes(post.status)) continue;
    const opts = (post.options as Record<string, unknown>) ?? {};
    const dur = item.media.durationSec ?? 0;
    await updatePost(
      post.id,
      {
        title: g.title || post.title,
        description: g.description,
        hashtags: g.hashtags,
        cta: g.cta,
        firstComment: g.firstComment,
        coverTimestamp: g.coverSecond !== null && dur ? Math.max(0, Math.min(dur - 0.1, g.coverSecond)) : post.coverTimestamp,
        options: { ...opts, ...(post.platform === "YOUTUBE" ? { youtubeTags: g.youtubeTags } : {}), _ai: { generationId: r.generationId, altOpenings: g.altOpenings, coverReason: g.coverReason } },
      },
      userId ?? "system",
      "AI: przygotowanie publikacji",
    );
    applied++;
  }
  return { applied, generationId: r.generationId };
}

/** apply one regenerated publication (or only its hashtags) */
export async function applyRegenerated(postId: string, g: GeneratedPost, mode: string, userId: string) {
  const post = await prisma.platformPost.findUniqueOrThrow({ where: { id: postId } });
  const opts = (post.options as Record<string, unknown>) ?? {};
  if (mode === "hashtags") return updatePost(postId, { hashtags: g.hashtags, options: post.platform === "YOUTUBE" ? { youtubeTags: g.youtubeTags } : {} }, userId, "AI: hashtagi");
  return updatePost(
    postId,
    { title: g.title || post.title, description: g.description, hashtags: g.hashtags, cta: g.cta, firstComment: g.firstComment || post.firstComment, options: { ...(post.platform === "YOUTUBE" && g.youtubeTags.length ? { youtubeTags: g.youtubeTags } : {}), _ai: { ...((opts._ai as object) ?? {}), altOpenings: g.altOpenings } } },
    userId,
    `AI: ${mode}`,
  );
}

export async function mediaView(m: Prisma.SocialMediaGetPayload<{ include: { variants: true } }>, withUrl = false) {
  return {
    id: m.id,
    title: m.title,
    description: m.description,
    originalName: m.originalName,
    status: m.status,
    error: m.error,
    durationSec: m.durationSec,
    width: m.width,
    height: m.height,
    fps: m.fps,
    videoCodec: m.videoCodec,
    audioCodec: m.audioCodec,
    bitrate: m.bitrate,
    sizeBytes: Number(m.sizeBytes),
    checks: m.checks as Record<Platform, { ok: boolean; errors: string[]; warnings: string[]; conversion: string | null }> | null,
    transcript: m.transcript,
    transcriptStatus: m.transcriptStatus,
    isDemo: m.isDemo,
    createdAt: m.createdAt.toISOString(),
    thumbUrl: m.thumbnailKey ? await signedUrl(m.thumbnailKey, { ttlSec: 3600 }) : null,
    videoUrl: withUrl && m.status === "READY" ? await signedUrl(m.storageKey, { ttlSec: 3600, mime: m.mimeType }) : null,
    variants: await Promise.all(m.variants.map(async (v) => ({ id: v.id, kind: v.kind, status: v.status, width: v.width, height: v.height, durationSec: v.durationSec, error: v.error, url: withUrl && v.storageKey && v.status === "READY" ? await signedUrl(v.storageKey, { ttlSec: 3600, mime: "video/mp4" }) : null }))),
  };
}

export async function contentView(contentItemId: string) {
  const item = await prisma.contentItem.findUniqueOrThrow({
    where: { id: contentItemId },
    include: {
      media: { include: { variants: true } },
      posts: {
        include: {
          socialAccount: true,
          approvals: { orderBy: { createdAt: "desc" }, take: 10 },
          revisions: { orderBy: { revision: "desc" }, take: 15 },
          publications: { orderBy: { generation: "desc" }, take: 5, include: { attempts: { orderBy: { createdAt: "desc" }, take: 5 } } },
          generations: { orderBy: { createdAt: "desc" }, take: 10 },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  const brand = await prisma.brandSettings.findUnique({ where: { projectId: item.projectId }, select: { forbiddenPhrases: true } });
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(item.posts.flatMap((p) => [...p.approvals.map((a) => a.userId), ...p.revisions.map((r) => r.editedById ?? "")]))] } }, select: { id: true, name: true, email: true } });
  const who = (id: string | null) => (id ? (users.find((u) => u.id === id)?.name || users.find((u) => u.id === id)?.email || "—") : "system");
  return {
    id: item.id,
    projectId: item.projectId,
    title: item.title,
    goal: item.goal,
    isDemo: item.isDemo,
    createdAt: item.createdAt.toISOString(),
    media: await mediaView(item.media, true),
    posts: item.posts.map((p) => {
      const platform = p.platform as Platform;
      const ai = ((p.options as Record<string, unknown>)?._ai ?? {}) as { altOpenings?: string[]; coverReason?: string };
      const activePub = p.publications.find((x) => ["SCHEDULING", "SCHEDULED", "PUBLISHING", "UNKNOWN", "CANCELLING"].includes(x.status)) ?? null;
      return {
        id: p.id,
        platform,
        status: p.status,
        title: p.title,
        description: p.description,
        hashtags: p.hashtags,
        cta: p.cta,
        firstComment: p.firstComment,
        coverTimestamp: p.coverTimestamp,
        options: Object.fromEntries(Object.entries((p.options as Record<string, unknown>) ?? {}).filter(([k]) => !k.startsWith("_"))),
        altOpenings: ai.altOpenings ?? [],
        coverReason: ai.coverReason ?? "",
        mediaVariantId: p.mediaVariantId,
        scheduledAt: p.scheduledAt?.toISOString() ?? null,
        revision: p.revision,
        approvedRevision: p.approvedRevision,
        approvedAt: p.approvedAt?.toISOString() ?? null,
        approvedBy: p.approvedById ? who(p.approvedById) : null,
        publishedUrl: p.publishedUrl,
        publishedAt: p.publishedAt?.toISOString() ?? null,
        errorMessage: p.errorMessage,
        warnings: (p.warnings as string[] | null) ?? [],
        isDemo: p.isDemo,
        account: accountView(p.socialAccount),
        issues: checkPostText(platform, { title: p.title, description: p.description, hashtags: p.hashtags, cta: p.cta, firstComment: p.firstComment, options: p.options as Record<string, unknown> }, brand?.forbiddenPhrases ?? []),
        limits: PLATFORM_RULES[platform].limits,
        fields: PLATFORM_RULES[platform].fields,
        provider: activePub ? { status: activePub.status, jobId: activePub.providerJobId, requestId: activePub.providerRequestId, externalId: activePub.externalId, scheduledAt: activePub.scheduledAt.toISOString(), error: activePub.errorMessage } : null,
        publications: p.publications.map((x) => ({ id: x.id, generation: x.generation, status: x.status, jobId: x.providerJobId, requestId: x.providerRequestId, externalId: x.externalId, scheduledAt: x.scheduledAt.toISOString(), error: x.errorMessage, url: x.publishedUrl, attempts: x.attempts.map((a) => ({ kind: a.kind, ok: a.ok, httpStatus: a.httpStatus, error: a.error, at: a.createdAt.toISOString() })) })),
        approvals: p.approvals.map((a) => ({ id: a.id, decision: a.decision, revision: a.revision, comment: a.comment, by: who(a.userId), at: a.createdAt.toISOString(), invalidatedAt: a.invalidatedAt?.toISOString() ?? null, invalidatedReason: a.invalidatedReason })),
        revisions: p.revisions.map((r) => ({ revision: r.revision, reason: r.reason, by: who(r.editedById), at: r.createdAt.toISOString(), snapshot: r.snapshot })),
        generations: p.generations.map((g) => ({ id: g.id, kind: g.kind, at: g.createdAt.toISOString(), model: g.model, rulesVersion: g.rulesVersion, output: g.output, error: g.error })),
      };
    }),
  };
}

export function normalizeTags(platform: Platform, tags: string[]) {
  return normalizeHashtags(tags, PLATFORM_RULES[platform].limits.hashtagsMax);
}
