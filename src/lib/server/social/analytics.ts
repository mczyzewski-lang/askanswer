/**
 * Monitoring after publication and the analytics dashboard.
 *  - snapshots at 1 h, 24 h, 72 h, 7 d and 30 d after publication (+ manual refresh), stored with
 *    capturedAt; a metric the platform does not report is null (never 0) and listed as unsupported;
 *  - followers per account once a day;
 *  - rate limits: a 429 moves the next checkpoint by Retry-After instead of hammering the API.
 */
import { prisma } from "../db";
import { HttpError } from "../errors";
import { dayKey, hourInTz, weekdayInTz } from "@/lib/social/tz";
import { PLATFORMS, type Platform } from "@/lib/social/platforms";
import { providerFor, ProviderError, type MetricsResult } from "./provider";

export const CHECKPOINTS: Array<{ key: string; afterMs: number }> = [
  { key: "1h", afterMs: 3600e3 },
  { key: "24h", afterMs: 24 * 3600e3 },
  { key: "72h", afterMs: 72 * 3600e3 },
  { key: "7d", afterMs: 7 * 86400e3 },
  { key: "30d", afterMs: 30 * 86400e3 },
];

/** engagement = interactions / views (or impressions); null when it cannot be computed honestly */
export function engagementRate(m: Pick<MetricsResult, "views" | "impressions" | "likes" | "comments" | "shares" | "saves">): number | null {
  const parts = [m.likes, m.comments, m.shares, m.saves].filter((x): x is number => typeof x === "number");
  if (!parts.length) return null;
  const base = m.views ?? m.impressions;
  if (!base) return null;
  return Math.round((parts.reduce((a, b) => a + b, 0) / base) * 10000) / 10000;
}

/** which checkpoint is due now, and when the next one is */
export function dueCheckpoint(publishedAt: Date, taken: string[], now = new Date()): { due: string | null; next: Date | null } {
  const age = now.getTime() - publishedAt.getTime();
  let due: string | null = null;
  for (const c of CHECKPOINTS) if (age >= c.afterMs && !taken.includes(c.key)) due = c.key;
  const upcoming = CHECKPOINTS.find((c) => age < c.afterMs);
  return { due, next: upcoming ? new Date(publishedAt.getTime() + upcoming.afterMs) : null };
}

/** job "social-metrics": one snapshot of one published post */
export async function collectMetrics(postId: string, checkpoint?: string) {
  const post = await prisma.platformPost.findUniqueOrThrow({ where: { id: postId }, include: { socialAccount: { include: { providerProfile: true } }, publications: { where: { status: "PUBLISHED" }, orderBy: { generation: "desc" }, take: 1 }, snapshots: { select: { checkpoint: true } } } });
  if (post.status !== "PUBLISHED" || !post.publishedAt) return { skipped: "not published" };
  const taken = post.snapshots.map((s) => s.checkpoint);
  const { due, next } = dueCheckpoint(post.publishedAt, taken);
  const key = checkpoint ?? due;
  if (!key) {
    await prisma.platformPost.update({ where: { id: postId }, data: { nextMetricsAt: next } });
    return { skipped: "nothing due" };
  }
  try {
    const m = await providerFor(post.socialAccount).postMetrics({ profile: post.socialAccount.providerProfile.username, platform: post.platform as Platform, platformPostId: post.platformPostId, requestId: post.publications[0]?.providerRequestId ?? null });
    await prisma.analyticsSnapshot.create({
      data: {
        projectId: post.projectId,
        platformPostId: post.id,
        socialAccountId: post.socialAccountId,
        platform: post.platform,
        checkpoint: key,
        views: m.views,
        reach: m.reach,
        impressions: m.impressions,
        likes: m.likes,
        comments: m.comments,
        shares: m.shares,
        saves: m.saves,
        watchTimeSec: m.watchTimeSec,
        avgViewDurationSec: m.avgViewDurationSec,
        engagementRate: engagementRate(m),
        unsupported: m.unsupported,
        raw: (m.raw ?? undefined) as never,
        isDemo: post.isDemo,
      },
    });
    if (!checkpoint) await prisma.platformPost.update({ where: { id: postId }, data: { nextMetricsAt: dueCheckpoint(post.publishedAt, [...taken, key]).next } });
    return { checkpoint: key };
  } catch (e) {
    if (e instanceof ProviderError && e.status === 429) {
      await prisma.platformPost.update({ where: { id: postId }, data: { nextMetricsAt: new Date(Date.now() + (e.retryAfterMs ?? 15 * 60e3)) } });
      return { rateLimited: true };
    }
    throw e;
  }
}

/** manual "Odśwież wyniki" — at most once per 10 minutes per post */
export async function refreshMetrics(postId: string) {
  const last = await prisma.analyticsSnapshot.findFirst({ where: { platformPostId: postId }, orderBy: { capturedAt: "desc" } });
  if (last && Date.now() - last.capturedAt.getTime() < 10 * 60e3) throw new HttpError(429, "Wyniki odświeżono przed chwilą — spróbuj za kilka minut.");
  return collectMetrics(postId, "refresh");
}

/** daily followers of connected accounts */
export async function collectFollowers(projectId?: string) {
  const since = new Date(Date.now() - 20 * 3600e3);
  const accounts = await prisma.socialAccount.findMany({ where: { connectionStatus: "CONNECTED", ...(projectId ? { projectId } : {}), snapshots: { none: { checkpoint: "account", capturedAt: { gt: since } } } }, include: { providerProfile: true }, take: 30 });
  let n = 0;
  for (const a of accounts) {
    try {
      const followers = await providerFor(a).accountFollowers(a.providerProfile.username, a.platform as Platform, a.pageId);
      await prisma.analyticsSnapshot.create({ data: { projectId: a.projectId, socialAccountId: a.id, platform: a.platform, checkpoint: "account", followers, unsupported: followers === null ? ["followers"] : [], isDemo: a.isDemo } });
      n++;
    } catch (e) {
      if (e instanceof ProviderError && e.status === 429) break;
      console.error("[social] followers", a.id, (e as Error).message);
    }
  }
  return n;
}

type Snap = { platformPostId: string | null; capturedAt: Date; views: number | null; reach: number | null; impressions: number | null; likes: number | null; comments: number | null; shares: number | null; saves: number | null; engagementRate: number | null; watchTimeSec: number | null; avgViewDurationSec: number | null; unsupported: string[] };

const sumOrNull = (xs: Array<number | null>) => (xs.some((x) => x !== null) ? xs.reduce<number>((a, b) => a + (b ?? 0), 0) : null);

/** latest snapshot of each post up to `at` */
function latestPerPost(snaps: Snap[], at = Infinity) {
  const m = new Map<string, Snap>();
  for (const s of snaps) {
    if (!s.platformPostId || s.capturedAt.getTime() > at) continue;
    const cur = m.get(s.platformPostId);
    if (!cur || cur.capturedAt < s.capturedAt) m.set(s.platformPostId, s);
  }
  return m;
}

/** dashboard of a project for the last `days` days (+ the previous period to compare) */
export async function projectAnalytics(projectId: string, days: number, tz: string) {
  const now = Date.now();
  const from = new Date(now - days * 86400e3);
  const prevFrom = new Date(now - 2 * days * 86400e3);
  const posts = await prisma.platformPost.findMany({
    where: { projectId, status: "PUBLISHED", publishedAt: { gte: prevFrom } },
    select: { id: true, platform: true, title: true, description: true, cta: true, hashtags: true, publishedAt: true, publishedUrl: true, contentItemId: true, socialAccountId: true, socialAccount: { select: { displayName: true, accountHandle: true } }, contentItem: { select: { title: true, media: { select: { title: true, thumbnailKey: true } } } } },
  });
  const snaps = (await prisma.analyticsSnapshot.findMany({ where: { projectId, platformPostId: { in: posts.map((p) => p.id) } }, orderBy: { capturedAt: "asc" } })) as Snap[];
  const latest = latestPerPost(snaps);
  const inPeriod = (p: (typeof posts)[number], a: Date, b: number) => p.publishedAt! >= a && p.publishedAt!.getTime() < b;
  const summarize = (list: typeof posts) => {
    const ls = list.map((p) => latest.get(p.id)).filter((x): x is Snap => !!x);
    const views = sumOrNull(ls.map((s) => s.views));
    const reach = sumOrNull(ls.map((s) => s.reach));
    const interactions = sumOrNull(ls.flatMap((s) => [s.likes, s.comments, s.shares, s.saves]));
    const er = ls.map((s) => s.engagementRate).filter((x): x is number => x !== null);
    return { published: list.length, measured: ls.length, views, reach, interactions, engagementRate: er.length ? Math.round((er.reduce((a, b) => a + b, 0) / er.length) * 10000) / 10000 : null };
  };
  const current = posts.filter((p) => inPeriod(p, from, now + 1));
  const previous = posts.filter((p) => inPeriod(p, prevFrom, from.getTime()));
  // views over time: for each day the sum of the latest known views of the period's posts
  const series: Array<{ day: string; views: number | null }> = [];
  for (let d = days - 1; d >= 0; d--) {
    const end = now - d * 86400e3;
    const lp = latestPerPost(snaps.filter((s) => current.some((p) => p.id === s.platformPostId)), end);
    series.push({ day: dayKey(new Date(end), tz), views: sumOrNull([...lp.values()].map((s) => s.views)) });
  }
  const byPlatform = PLATFORMS.map((pl) => ({ platform: pl, ...summarize(current.filter((p) => p.platform === pl)) })).filter((r) => r.published > 0);
  const top = current
    .map((p) => ({ p, s: latest.get(p.id) }))
    .filter((x) => x.s && x.s.views !== null)
    .sort((a, b) => (b.s!.views ?? 0) - (a.s!.views ?? 0))
    .slice(0, 10)
    .map(({ p, s }) => ({ postId: p.id, contentItemId: p.contentItemId, platform: p.platform, title: p.contentItem.title || p.contentItem.media.title, account: p.socialAccount.displayName ?? p.socialAccount.accountHandle, url: p.publishedUrl, publishedAt: p.publishedAt!.toISOString(), views: s!.views, likes: s!.likes, comments: s!.comments, shares: s!.shares, engagementRate: s!.engagementRate }));
  // followers growth per account (first vs last daily snapshot in the period)
  const fsnaps = await prisma.analyticsSnapshot.findMany({ where: { projectId, checkpoint: "account", capturedAt: { gte: from } }, orderBy: { capturedAt: "asc" }, select: { socialAccountId: true, platform: true, followers: true, capturedAt: true } });
  const growth = new Map<string, { platform: string; first: number | null; last: number | null }>();
  for (const s of fsnaps) {
    const g = growth.get(s.socialAccountId) ?? { platform: s.platform, first: null, last: null };
    if (s.followers !== null) {
      g.first ??= s.followers;
      g.last = s.followers;
    }
    growth.set(s.socialAccountId, g);
  }
  const lastUpdated = snaps.length ? snaps[snaps.length - 1].capturedAt.toISOString() : null;
  return {
    days,
    current: summarize(current),
    previous: summarize(previous),
    series,
    byPlatform,
    top,
    followers: [...growth.entries()].map(([accountId, g]) => ({ accountId, platform: g.platform, followers: g.last, change: g.first !== null && g.last !== null ? g.last - g.first : null })),
    lastUpdated,
  };
}

/** one film: every platform's latest numbers and the views curve */
export async function contentAnalytics(contentItemId: string) {
  const posts = await prisma.platformPost.findMany({ where: { contentItemId }, select: { id: true, platform: true, status: true, publishedUrl: true, publishedAt: true, socialAccount: { select: { displayName: true, accountHandle: true } }, _count: { select: { comments: true } } } });
  const snaps = await prisma.analyticsSnapshot.findMany({ where: { platformPostId: { in: posts.map((p) => p.id) } }, orderBy: { capturedAt: "asc" } });
  return posts.map((p) => {
    const mine = snaps.filter((s) => s.platformPostId === p.id);
    const last = mine[mine.length - 1] ?? null;
    return {
      postId: p.id,
      platform: p.platform,
      status: p.status,
      account: p.socialAccount.displayName ?? p.socialAccount.accountHandle,
      url: p.publishedUrl,
      publishedAt: p.publishedAt?.toISOString() ?? null,
      comments: p._count.comments,
      latest: last && { capturedAt: last.capturedAt.toISOString(), checkpoint: last.checkpoint, views: last.views, reach: last.reach, impressions: last.impressions, likes: last.likes, comments: last.comments, shares: last.shares, saves: last.saves, watchTimeSec: last.watchTimeSec, avgViewDurationSec: last.avgViewDurationSec, engagementRate: last.engagementRate, unsupported: last.unsupported },
      curve: mine.filter((s) => s.views !== null).map((s) => ({ at: s.capturedAt.toISOString(), checkpoint: s.checkpoint, views: s.views })),
    };
  });
}

/** rows for the AI analyst */
export async function analystRows(projectId: string, tz: string) {
  const posts = await prisma.platformPost.findMany({ where: { projectId, status: "PUBLISHED" }, orderBy: { publishedAt: "desc" }, take: 120, select: { id: true, platform: true, description: true, cta: true, hashtags: true, publishedAt: true, contentItem: { select: { title: true } }, snapshots: { orderBy: { capturedAt: "desc" }, take: 1 } } });
  return posts.map((p) => {
    const s = p.snapshots[0];
    return { platform: p.platform, publishedAt: p.publishedAt!.toISOString(), hourLocal: hourInTz(p.publishedAt!, tz), weekday: weekdayInTz(p.publishedAt!, tz), title: p.contentItem.title, opening: p.description.split(/\n|(?<=[.!?])\s/)[0].slice(0, 160), cta: p.cta.slice(0, 120), hashtags: p.hashtags.slice(0, 6), views: s?.views ?? null, likes: s?.likes ?? null, comments: s?.comments ?? null, shares: s?.shares ?? null, saves: s?.saves ?? null, engagementRate: s?.engagementRate ?? null };
  });
}

/**
 * Suggested posting times for an account: its own history first (enough posts), then the
 * provider's audience activity (when the platform reports it), then configurable heuristics.
 * Never presented as a guaranteed optimum.
 */
export async function suggestTimes(accountId: string, tz: string) {
  const { HEURISTIC_HOURS } = await import("@/lib/social/rules");
  const acc = await prisma.socialAccount.findUniqueOrThrow({ where: { id: accountId } });
  const posts = await prisma.platformPost.findMany({ where: { socialAccountId: accountId, status: "PUBLISHED" }, select: { publishedAt: true, snapshots: { where: { checkpoint: { in: ["24h", "72h"] } }, orderBy: { capturedAt: "desc" }, take: 1, select: { views: true } } } });
  const scored = posts.filter((p) => p.publishedAt && p.snapshots[0]?.views != null);
  if (scored.length >= 10) {
    const buckets = new Map<string, { weekday: number; hour: number; views: number[] }>();
    for (const p of scored) {
      const weekday = weekdayInTz(p.publishedAt!, tz);
      const hour = hourInTz(p.publishedAt!, tz);
      const k = `${weekday}:${hour}`;
      const b = buckets.get(k) ?? { weekday, hour, views: [] };
      b.views.push(p.snapshots[0].views!);
      buckets.set(k, b);
    }
    const slots = [...buckets.values()]
      .filter((b) => b.views.length >= 2)
      .map((b) => ({ weekday: b.weekday, hour: b.hour, score: Math.round(b.views.reduce((a, c) => a + c, 0) / b.views.length), samples: b.views.length }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
    if (slots.length) return { source: "history" as const, note: `Na podstawie ${scored.length} publikacji tego konta (średnie wyświetlenia po 24–72 h). To wskazówka, nie gwarancja.`, slots };
  }
  const h = HEURISTIC_HOURS[acc.platform as Platform];
  return { source: "heuristic" as const, note: `Za mało danych tego konta — ${h.note}. Traktuj jako punkt wyjścia do testów.`, slots: h.weekdays.flatMap((weekday) => h.hours.slice(0, 1).map((hour) => ({ weekday, hour, score: null as number | null, samples: 0 }))) };
}
