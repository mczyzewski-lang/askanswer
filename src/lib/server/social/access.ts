/**
 * Tenancy and permissions. Every Social Media Studio endpoint goes through these helpers: a project
 * the person has no role in is reported as "not found" (its existence is not revealed), and every
 * query below them is scoped by projectId.
 */
import { prisma } from "../db";
import { HttpError, isStaff, requireUser } from "../auth";
import { can, permissionsOf, type OrgRole, type Permission } from "@/lib/social/rbac";

export type SocialUser = Awaited<ReturnType<typeof requireUser>>;

export interface ProjectAccess {
  user: SocialUser;
  project: { id: string; organizationId: string; name: string; timezone: string; language: string; isDemo: boolean };
  roles: OrgRole[];
  perms: Set<Permission>;
}

async function rolesIn(user: SocialUser, project: { id: string; organizationId: string }): Promise<OrgRole[]> {
  if (isStaff(user.role)) return ["OWNER"];
  const [om, pm] = await Promise.all([
    prisma.organizationMember.findUnique({ where: { organizationId_userId: { organizationId: project.organizationId, userId: user.id } }, select: { role: true } }),
    prisma.socialProjectMember.findUnique({ where: { projectId_userId: { projectId: project.id, userId: user.id } }, select: { role: true } }),
  ]);
  return [om?.role, pm?.role].filter((r): r is OrgRole => !!r);
}

/** the person's access to the project, or 404 */
export async function projectAccess(projectId: string, perm: Permission = "project.view", user?: SocialUser): Promise<ProjectAccess> {
  const u = user ?? (await requireUser());
  const project = await prisma.socialProject.findUnique({ where: { id: projectId }, select: { id: true, organizationId: true, name: true, timezone: true, language: true, isDemo: true } });
  if (!project) throw new HttpError(404, "Nie znaleziono projektu");
  const roles = await rolesIn(u, project);
  if (!roles.length) throw new HttpError(404, "Nie znaleziono projektu");
  if (!can(roles, perm)) throw new HttpError(403, "Twoja rola nie pozwala na tę operację");
  return { user: u, project, roles, perms: permissionsOf(roles) };
}

/** access through an object of the project (post, media, comment…): resolves its projectId first */
export async function accessVia(kind: "post" | "content" | "media" | "comment" | "account", id: string, perm: Permission = "project.view") {
  const row =
    kind === "post"
      ? await prisma.platformPost.findUnique({ where: { id }, select: { projectId: true } })
      : kind === "content"
        ? await prisma.contentItem.findUnique({ where: { id }, select: { projectId: true } })
        : kind === "media"
          ? await prisma.socialMedia.findUnique({ where: { id }, select: { projectId: true } })
          : kind === "comment"
            ? await prisma.socialComment.findUnique({ where: { id }, select: { projectId: true } })
            : await prisma.socialAccount.findUnique({ where: { id }, select: { projectId: true } });
  if (!row) throw new HttpError(404, "Nie znaleziono");
  return projectAccess(row.projectId, perm);
}

export interface OrgAccess {
  user: SocialUser;
  organization: { id: string; name: string; isDemo: boolean };
  role: OrgRole | null;
  perms: Set<Permission>;
}

export async function orgAccess(organizationId: string, perm: Permission = "project.view"): Promise<OrgAccess> {
  const u = await requireUser();
  const organization = await prisma.organization.findUnique({ where: { id: organizationId }, select: { id: true, name: true, isDemo: true } });
  if (!organization) throw new HttpError(404, "Nie znaleziono organizacji");
  let role: OrgRole | null = null;
  if (isStaff(u.role)) role = "OWNER";
  else role = (await prisma.organizationMember.findUnique({ where: { organizationId_userId: { organizationId, userId: u.id } }, select: { role: true } }))?.role ?? null;
  if (!role) throw new HttpError(404, "Nie znaleziono organizacji");
  if (!can([role], perm)) throw new HttpError(403, "Twoja rola nie pozwala na tę operację");
  return { user: u, organization, role, perms: permissionsOf([role]) };
}

/** projects the person can see, with their roles (for lists, the calendar, the inbox) */
export async function accessibleProjects(user: SocialUser): Promise<Array<{ id: string; name: string; organizationId: string; organizationName: string; timezone: string; isDemo: boolean; roles: OrgRole[] }>> {
  const projects = await prisma.socialProject.findMany({
    where: isStaff(user.role) ? {} : { OR: [{ organization: { members: { some: { userId: user.id } } } }, { members: { some: { userId: user.id } } }] },
    select: {
      id: true,
      name: true,
      organizationId: true,
      timezone: true,
      isDemo: true,
      organization: { select: { name: true, members: { where: { userId: user.id }, select: { role: true } } } },
      members: { where: { userId: user.id }, select: { role: true } },
    },
    orderBy: [{ organization: { name: "asc" } }, { name: "asc" }],
  });
  return projects.map((p) => ({
    id: p.id,
    name: p.name,
    organizationId: p.organizationId,
    organizationName: p.organization.name,
    timezone: p.timezone,
    isDemo: p.isDemo,
    roles: isStaff(user.role) ? ["OWNER"] : ([p.organization.members[0]?.role, p.members[0]?.role].filter(Boolean) as OrgRole[]),
  }));
}

/** project ids for a scoped query, optionally only those where the person has `perm` */
export async function accessibleProjectIds(user: SocialUser, perm: Permission = "project.view", only?: string | null): Promise<string[]> {
  const all = await accessibleProjects(user);
  return all.filter((p) => can(p.roles, perm) && (!only || p.id === only)).map((p) => p.id);
}

export async function accessibleOrganizations(user: SocialUser) {
  if (isStaff(user.role)) return (await prisma.organization.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, isDemo: true } })).map((o) => ({ ...o, role: "OWNER" as OrgRole }));
  const rows = await prisma.organizationMember.findMany({ where: { userId: user.id }, select: { role: true, organization: { select: { id: true, name: true, isDemo: true } } }, orderBy: { organization: { name: "asc" } } });
  return rows.map((r) => ({ ...r.organization, role: r.role as OrgRole }));
}
