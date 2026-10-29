/** cross-project lists (approval queue, calendar, publications, inbox) — always scoped to accessible projects */
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { signedUrl } from "../storage";
import type { SocialUser } from "./access";
import { accessibleProjects } from "./access";
import { can, type Permission } from "@/lib/social/rbac";

export async function scope(user: SocialUser, url: URL, perm: Permission = "project.view") {
  const all = await accessibleProjects(user);
  const want = url.searchParams.get("project");
  const projects = all.filter((p) => can(p.roles, perm) && (!want || p.id === want));
  return { ids: projects.map((p) => p.id), projects, all };
}

const thumbCache = new Map<string, { url: string; exp: number }>();
export async function thumb(key: string | null) {
  if (!key) return null;
  const c = thumbCache.get(key);
  if (c && c.exp > Date.now()) return c.url;
  const url = await signedUrl(key, { ttlSec: 3600 });
  thumbCache.set(key, { url, exp: Date.now() + 50 * 60e3 });
  return url;
}

export const postListInclude = {
  socialAccount: { select: { id: true, platform: true, displayName: true, accountHandle: true, isDemo: true } },
  contentItem: { select: { id: true, title: true, media: { select: { title: true, thumbnailKey: true, durationSec: true } } } },
  project: { select: { id: true, name: true, timezone: true } },
} satisfies Prisma.PlatformPostInclude;

export async function postRow(p: Prisma.PlatformPostGetPayload<{ include: typeof postListInclude }>) {
  return {
    id: p.id,
    contentItemId: p.contentItemId,
    project: p.project,
    platform: p.platform,
    status: p.status,
    title: p.contentItem.title || p.contentItem.media.title,
    description: p.description,
    hashtags: p.hashtags,
    cta: p.cta,
    firstComment: p.firstComment,
    options: Object.fromEntries(Object.entries((p.options as Record<string, unknown>) ?? {}).filter(([k]) => !k.startsWith("_"))),
    postTitle: p.title,
    scheduledAt: p.scheduledAt?.toISOString() ?? null,
    publishedAt: p.publishedAt?.toISOString() ?? null,
    publishedUrl: p.publishedUrl,
    errorMessage: p.errorMessage,
    revision: p.revision,
    isDemo: p.isDemo,
    account: { id: p.socialAccount.id, name: p.socialAccount.displayName ?? p.socialAccount.accountHandle ?? "", handle: p.socialAccount.accountHandle },
    thumbUrl: await thumb(p.contentItem.media.thumbnailKey),
    durationSec: p.contentItem.media.durationSec,
  };
}
