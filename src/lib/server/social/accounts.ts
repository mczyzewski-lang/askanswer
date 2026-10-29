/**
 * Provider profiles and connected accounts. Each project gets a stable profile at the provider
 * (project_<id>); one profile holds at most one account per platform, so a second Instagram of the
 * same project goes to a second profile (project_<id>_2). Clients connect on the provider's hosted
 * white-label page; passwords never pass through this app.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { env } from "../env";
import { PLATFORM_META, type Platform } from "@/lib/social/platforms";
import { providerFor, type ProviderAccount } from "./provider";
import { notify } from "./notify";
import { audit } from "./audit";
import { enqueueSocial } from "./queue";
import { invalidateApproval } from "./posts";

export const profileUsername = (projectId: string, slot: number) => (slot <= 1 ? `project_${projectId}` : `project_${projectId}_${slot}`);

/** the profile that still has a free place for every requested platform (or a new one) */
export async function profileForConnect(projectId: string, platforms: Platform[], wantSlot?: string | null) {
  const project = await prisma.socialProject.findUniqueOrThrow({ where: { id: projectId }, select: { id: true, isDemo: true, name: true } });
  const profiles = await prisma.providerProfile.findMany({ where: { projectId }, include: { accounts: { where: { connectionStatus: { not: "DISCONNECTED" } }, select: { platform: true } } }, orderBy: { createdAt: "asc" } });
  let profile = wantSlot ? profiles.find((p) => p.id === wantSlot) : profiles.find((p) => platforms.every((pl) => !p.accounts.some((a) => a.platform === pl)));
  if (!profile) {
    const slot = profiles.length + 1;
    const username = profileUsername(projectId, slot);
    await providerFor(project).createProfile(username);
    profile = { ...(await prisma.providerProfile.create({ data: { projectId, username, label: slot === 1 ? "Główny" : `Dodatkowy ${slot - 1}`, isDemo: project.isDemo } })), accounts: [] };
  } else {
    // creating twice is harmless (the id is stable)
    await providerFor(project).createProfile(profile.username);
  }
  return { project, profile };
}

/** URL of the provider's page where the client logs in to the platforms (OAuth) */
export async function startConnect(projectId: string, platforms: Platform[], userId: string, slot?: string | null) {
  const { project, profile } = await profileForConnect(projectId, platforms, slot);
  const back = new URL(`${env.appUrl}/social/projects/${projectId}/accounts/callback`);
  back.searchParams.set("profile", profile.id);
  const url = await providerFor(project).connectUrl(profile.username, {
    redirectUrl: back.toString(),
    platforms,
    title: `Połącz konta — ${project.name}`,
    description: "Zaloguj się na wybrane konta społecznościowe. Social Media Studio nie poznaje Twoich haseł.",
  });
  await audit({ userId, projectId, action: "accounts.connect_started", entityType: "ProviderProfile", entityId: profile.id, data: { platforms } });
  return { url, profileId: profile.id };
}

/**
 * Read the profile's accounts from the provider and bring ours in line: new accounts, changed
 * identity (another account connected on the same place), lost / restored authorization,
 * disconnected accounts.
 */
export async function syncProfile(profileId: string, actorId?: string | null) {
  const profile = await prisma.providerProfile.findUniqueOrThrow({ where: { id: profileId }, include: { accounts: true, project: { select: { id: true, name: true, isDemo: true } } } });
  const remote = await providerFor(profile).getProfile(profile.username);
  const now = new Date();
  const seen = new Set<Platform>();
  const changes: string[] = [];
  for (const a of remote?.accounts ?? []) {
    seen.add(a.platform);
    const cur = profile.accounts.find((x) => x.platform === a.platform);
    const data = {
      platformAccountId: a.platformAccountId,
      accountHandle: a.handle,
      displayName: a.displayName,
      profileImage: a.image,
      capabilities: a.capabilities as unknown as Prisma.InputJsonValue,
      reauthRequired: a.reauthRequired,
      connectionStatus: a.reauthRequired ? ("REAUTH_REQUIRED" as const) : ("CONNECTED" as const),
      lastSyncAt: now,
      disconnectedAt: null,
    };
    if (!cur) {
      // upsert: two syncs at once (callback + webhook) must not collide
      await prisma.socialAccount.upsert({ where: { providerProfileId_platform: { providerProfileId: profile.id, platform: a.platform } }, create: { ...data, projectId: profile.projectId, providerProfileId: profile.id, platform: a.platform, isDemo: profile.isDemo }, update: data });
      changes.push(`${PLATFORM_META[a.platform].name}: połączono ${a.handle ?? a.displayName ?? ""}`);
      continue;
    }
    const identityChanged = !!cur.platformAccountId && !!a.platformAccountId && cur.platformAccountId !== a.platformAccountId;
    await prisma.socialAccount.update({ where: { id: cur.id }, data: { ...data, ...(identityChanged ? { pageId: null, pageName: null } : {}) } });
    if (identityChanged) {
      changes.push(`${PLATFORM_META[a.platform].name}: na tym miejscu połączono INNE konto (${a.handle ?? a.platformAccountId})`);
      await onIdentityChanged(cur.id, actorId);
    }
    if (a.reauthRequired && cur.connectionStatus !== "REAUTH_REQUIRED") await onReauthRequired(cur.id);
    if (!a.reauthRequired && cur.connectionStatus === "REAUTH_REQUIRED") await onReauthRestored(cur.id);
  }
  for (const cur of profile.accounts) {
    if (seen.has(cur.platform) || cur.connectionStatus === "DISCONNECTED") continue;
    await prisma.socialAccount.update({ where: { id: cur.id }, data: { connectionStatus: "DISCONNECTED", disconnectedAt: now, lastSyncAt: now } });
    changes.push(`${PLATFORM_META[cur.platform].name}: konto rozłączone`);
    await onReauthRequired(cur.id, "disconnected");
  }
  await prisma.providerProfile.update({ where: { id: profile.id }, data: { lastSyncAt: now } });
  if (changes.length) await audit({ userId: actorId, projectId: profile.projectId, action: "accounts.synced", entityType: "ProviderProfile", entityId: profile.id, data: { changes } });
  return { changes };
}

export async function syncProject(projectId: string, actorId?: string | null) {
  const profiles = await prisma.providerProfile.findMany({ where: { projectId }, select: { id: true } });
  const out: string[] = [];
  for (const p of profiles) out.push(...(await syncProfile(p.id, actorId)).changes);
  return out;
}

/** publications on that account no longer go to the account that was approved: approve again */
async function onIdentityChanged(accountId: string, actorId?: string | null) {
  const posts = await prisma.platformPost.findMany({ where: { socialAccountId: accountId, status: { in: ["APPROVED", "SCHEDULING", "SCHEDULED", "PENDING_APPROVAL", "REAUTH_REQUIRED"] } }, select: { id: true } });
  for (const p of posts) await invalidateApproval(p.id, "Konto docelowe zmieniło identyfikator — sprawdź i zatwierdź ponownie.", actorId ?? null, { cancelAtProvider: true });
}

async function onReauthRequired(accountId: string, why: "reauth" | "disconnected" = "reauth") {
  const acc = await prisma.socialAccount.findUniqueOrThrow({ where: { id: accountId } });
  await prisma.platformPost.updateMany({ where: { socialAccountId: accountId, status: { in: ["APPROVED", "SCHEDULED", "SCHEDULING", "SCHEDULING_FAILED"] } }, data: { status: "REAUTH_REQUIRED", errorMessage: why === "disconnected" ? "Konto zostało rozłączone." : "Konto wymaga ponownej autoryzacji." } });
  await notify({
    projectId: acc.projectId,
    type: "reauth_required",
    title: `${PLATFORM_META[acc.platform].name}: ${why === "disconnected" ? "konto rozłączone" : "połącz konto ponownie"}`,
    body: `${acc.displayName ?? acc.accountHandle ?? ""} — publikacje na to konto czekają.`,
    link: `/social/projects/${acc.projectId}?tab=accounts`,
    dedupeKey: `reauth:${accountId}:${acc.updatedAt.toISOString().slice(0, 13)}`,
    perm: "accounts.manage",
  });
}

/** authorization is back: posts that waited return to the scheduler (their approval still counts) */
async function onReauthRestored(accountId: string) {
  const posts = await prisma.platformPost.findMany({ where: { socialAccountId: accountId, status: "REAUTH_REQUIRED" } });
  for (const p of posts) {
    const approved = !!p.approvedHash && p.approvedHash === p.contentHash;
    await prisma.platformPost.update({ where: { id: p.id }, data: { status: approved ? "APPROVED" : "PENDING_APPROVAL", errorMessage: null } });
    if (approved) await enqueueSocial("social-schedule", { postId: p.id }, { idempotencyKey: `schedule:${p.id}:${p.revision}:reauth:${Date.now()}` });
  }
}

/** Facebook page / LinkedIn page the posts of this account go to */
export async function setPage(accountId: string, page: { id: string; name: string } | null, actorId: string) {
  const acc = await prisma.socialAccount.update({ where: { id: accountId }, data: { pageId: page?.id ?? null, pageName: page?.name ?? null } });
  const posts = await prisma.platformPost.findMany({ where: { socialAccountId: accountId, status: { notIn: ["PUBLISHED", "CANCELLED"] } }, select: { id: true } });
  for (const p of posts) await invalidateApproval(p.id, "Zmieniono stronę docelową konta.", actorId, { cancelAtProvider: true, recompute: true });
  await audit({ userId: actorId, projectId: acc.projectId, action: "accounts.page_selected", entityType: "SocialAccount", entityId: accountId, data: { page } });
  return acc;
}

export async function listPages(accountId: string) {
  const acc = await prisma.socialAccount.findUniqueOrThrow({ where: { id: accountId }, include: { providerProfile: true } });
  if (acc.platform !== "FACEBOOK" && acc.platform !== "LINKEDIN") return [];
  return providerFor(acc).pages(acc.providerProfile.username, acc.platform);
}

/**
 * Disconnect: the account stops being used here, its pending orders are cancelled at the provider,
 * and when nothing else is connected on its profile the profile is deleted at the provider (which
 * removes the authorization there too).
 */
export async function disconnectAccount(accountId: string, actorId: string) {
  const acc = await prisma.socialAccount.findUniqueOrThrow({ where: { id: accountId }, include: { providerProfile: { include: { accounts: true } } } });
  const posts = await prisma.platformPost.findMany({ where: { socialAccountId: accountId, status: { in: ["SCHEDULING", "SCHEDULED", "APPROVED", "PENDING_APPROVAL", "REAUTH_REQUIRED"] } }, select: { id: true } });
  const { cancelPost } = await import("./publisher");
  for (const p of posts) await cancelPost(p.id, actorId, "Konto rozłączone");
  await prisma.socialAccount.update({ where: { id: accountId }, data: { connectionStatus: "DISCONNECTED", disconnectedAt: new Date() } });
  const others = acc.providerProfile.accounts.filter((a) => a.id !== accountId && a.connectionStatus !== "DISCONNECTED");
  if (!others.length) {
    await providerFor(acc).deleteProfile(acc.providerProfile.username).catch((e) => console.error("[social] delete profile", (e as Error).message));
  } else if (acc.isDemo) {
    const { demoDisconnect } = await import("./provider/mock");
    await demoDisconnect(acc.providerProfile.username, acc.platform);
  }
  await audit({ userId: actorId, projectId: acc.projectId, action: "accounts.disconnected", entityType: "SocialAccount", entityId: accountId, data: { platform: acc.platform, providerProfileDeleted: !others.length } });
}

export function accountView(a: { id: string; platform: string; accountHandle: string | null; displayName: string | null; profileImage: string | null; connectionStatus: string; reauthRequired: boolean; capabilities: unknown; pageId: string | null; pageName: string | null; isDemo: boolean; lastSyncAt: Date | null; providerProfileId: string }) {
  const caps = (Array.isArray(a.capabilities) ? a.capabilities : []) as string[];
  return {
    id: a.id,
    platform: a.platform as Platform,
    handle: a.accountHandle,
    displayName: a.displayName,
    image: a.profileImage,
    status: a.connectionStatus,
    reauthRequired: a.reauthRequired,
    capabilities: caps,
    commentsAvailable: a.platform !== "TIKTOK" || caps.includes("comments"),
    needsPage: (a.platform === "FACEBOOK" && !a.pageId) || false,
    pageId: a.pageId,
    pageName: a.pageName,
    isDemo: a.isDemo,
    lastSyncAt: a.lastSyncAt?.toISOString() ?? null,
    profileId: a.providerProfileId,
  };
}

export type { ProviderAccount };
