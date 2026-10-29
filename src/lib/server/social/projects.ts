/** Organizations, projects, team and invitations of Social Media Studio. */
import crypto from "node:crypto";
import { prisma } from "../db";
import { env } from "../env";
import { HttpError } from "../errors";
import { deleteObject } from "../storage";
import type { OrgRole } from "@/lib/social/rbac";
import { demoMode, providerFor } from "./provider";
import { audit } from "./audit";

export function slugify(s: string) {
  return (
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/ł/g, "l")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50) || "projekt"
  );
}

async function uniqueSlug<T>(base: string, exists: (s: string) => Promise<T | null>) {
  let s = base;
  for (let i = 2; await exists(s); i++) s = `${base}-${i}`;
  return s;
}

export async function createOrganization(name: string, ownerId: string, o: { isDemo?: boolean } = {}) {
  const slug = await uniqueSlug(slugify(name), (s) => prisma.organization.findUnique({ where: { slug: s } }));
  const org = await prisma.organization.create({ data: { name: name.trim(), slug, isDemo: o.isDemo ?? false, members: { create: { userId: ownerId, role: "OWNER" } } } });
  await audit({ userId: ownerId, organizationId: org.id, action: "org.created", entityType: "Organization", entityId: org.id, data: { name } });
  return org;
}

/** a project is DEMO when the studio runs without an Upload-Post key (or inside a demo organization) */
export async function createProject(organizationId: string, name: string, actorId: string, o: { timezone?: string; language?: string; isDemo?: boolean } = {}) {
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
  const slug = await uniqueSlug(slugify(name), (s) => prisma.socialProject.findUnique({ where: { organizationId_slug: { organizationId, slug: s } } }));
  const isDemo = o.isDemo ?? (org.isDemo || demoMode());
  const project = await prisma.socialProject.create({ data: { organizationId, name: name.trim(), slug, timezone: o.timezone ?? "Europe/Warsaw", language: o.language ?? "pl", isDemo, brand: { create: {} } } });
  await audit({ userId: actorId, organizationId, projectId: project.id, action: "project.created", entityType: "SocialProject", entityId: project.id, data: { name, isDemo } });
  return project;
}

/**
 * Delete a project with all its data: orders at the provider are cancelled, provider profiles
 * deleted (removing the authorizations there), media files removed, then every row (cascade).
 */
export async function deleteProject(projectId: string, actorId: string) {
  const p = await prisma.socialProject.findUniqueOrThrow({ where: { id: projectId }, include: { providerProfiles: true, media: { include: { variants: true } } } });
  const active = await prisma.scheduledPublication.findMany({ where: { platformPost: { projectId }, status: { in: ["SCHEDULED", "SCHEDULING", "UNKNOWN", "CANCELLING"] } } });
  const { cancelPublication } = await import("./publisher");
  for (const pub of active) await cancelPublication(pub.id, "user").catch((e) => console.error("[social] cancel on delete", (e as Error).message));
  for (const prof of p.providerProfiles) await providerFor(prof).deleteProfile(prof.username).catch((e) => console.error("[social] delete profile", (e as Error).message));
  const keys = p.media.flatMap((m) => [m.storageKey, m.thumbnailKey, ...m.variants.map((v) => v.storageKey)]).filter((k): k is string => !!k && !k.startsWith("pending/"));
  await prisma.socialProject.delete({ where: { id: projectId } });
  for (const k of keys) await deleteObject(k).catch(() => {});
  await prisma.auditLog.create({ data: { userId: actorId, organizationId: p.organizationId, action: "project.deleted", entityType: "SocialProject", entityId: projectId, data: { name: p.name, mediaFiles: keys.length, providerProfiles: p.providerProfiles.length } } });
}

/** invitation link (the person sets their own password); nothing is e-mailed yet */
export async function invite(o: { email: string; name?: string; role: OrgRole; organizationId?: string | null; projectId?: string | null; invitedById: string }) {
  if (!o.organizationId && !o.projectId) throw new HttpError(400, "Zaproszenie musi dotyczyć organizacji albo projektu");
  const email = o.email.trim().toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    // a person with an account gets the role at once
    if (o.projectId) await prisma.socialProjectMember.upsert({ where: { projectId_userId: { projectId: o.projectId, userId: existing.id } }, create: { projectId: o.projectId, userId: existing.id, role: o.role }, update: { role: o.role } });
    else await prisma.organizationMember.upsert({ where: { organizationId_userId: { organizationId: o.organizationId!, userId: existing.id } }, create: { organizationId: o.organizationId!, userId: existing.id, role: o.role }, update: { role: o.role } });
    await audit({ userId: o.invitedById, organizationId: o.organizationId, projectId: o.projectId, action: "member.added", entityType: "User", entityId: existing.id, data: { role: o.role } });
    return { added: true as const, url: null };
  }
  const token = crypto.randomBytes(32).toString("base64url");
  await prisma.userInvite.create({ data: { email, name: o.name ?? "", tokenHash: crypto.createHash("sha256").update(token).digest("hex"), organizationId: o.organizationId ?? null, projectId: o.projectId ?? null, role: o.role, invitedById: o.invitedById, expiresAt: new Date(Date.now() + 14 * 86400e3) } });
  await audit({ userId: o.invitedById, organizationId: o.organizationId, projectId: o.projectId, action: "member.invited", entityType: "UserInvite", data: { email, role: o.role } });
  return { added: false as const, url: `${env.appUrl}/invite/${token}` };
}

export async function findInvite(token: string) {
  const inv = await prisma.userInvite.findUnique({ where: { tokenHash: crypto.createHash("sha256").update(token).digest("hex") } });
  if (!inv || inv.acceptedAt || inv.expiresAt < new Date()) return null;
  return inv;
}
