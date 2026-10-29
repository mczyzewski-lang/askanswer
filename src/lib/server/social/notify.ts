/**
 * In-app notifications. One per person and event (dedupeKey), so a webhook replayed or a job retried
 * never notifies twice. E-mail is a later channel: rows keep `emailedAt` for it.
 */
import { prisma } from "../db";
import { can, type OrgRole, type Permission } from "@/lib/social/rbac";

export type NotificationType =
  | "approval_requested"
  | "post_rejected"
  | "changes_requested"
  | "post_scheduled"
  | "post_published"
  | "post_failed"
  | "reauth_required"
  | "important_comment"
  | "lead_comment"
  | "sync_failed";

/** people of the project with `perm` (organization and project members; staff are not auto-subscribed) */
export async function projectRecipients(projectId: string, perm: Permission): Promise<string[]> {
  const p = await prisma.socialProject.findUnique({
    where: { id: projectId },
    select: { members: { select: { userId: true, role: true } }, organization: { select: { members: { select: { userId: true, role: true } } } } },
  });
  if (!p) return [];
  const roles = new Map<string, OrgRole[]>();
  for (const m of [...p.organization.members, ...p.members]) roles.set(m.userId, [...(roles.get(m.userId) ?? []), m.role as OrgRole]);
  return [...roles.entries()].filter(([, r]) => can(r, perm)).map(([u]) => u);
}

export async function notify(n: { projectId: string; type: NotificationType; title: string; body?: string; link?: string; dedupeKey: string; perm?: Permission; userIds?: string[]; excludeUserId?: string | null }) {
  const project = await prisma.socialProject.findUnique({ where: { id: n.projectId }, select: { organizationId: true } });
  if (!project) return 0;
  const users = (n.userIds ?? (await projectRecipients(n.projectId, n.perm ?? "project.view"))).filter((u) => u !== n.excludeUserId);
  if (!users.length) return 0;
  const r = await prisma.notification.createMany({
    data: users.map((userId) => ({ userId, organizationId: project.organizationId, projectId: n.projectId, type: n.type, title: n.title, body: n.body ?? "", link: n.link ?? null, dedupeKey: n.dedupeKey })),
    skipDuplicates: true,
  });
  return r.count;
}
