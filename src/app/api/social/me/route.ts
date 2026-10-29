import { prisma } from "@/lib/server/db";
import { isStaff, requireUser } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { accessibleOrganizations, accessibleProjects } from "@/lib/server/social/access";
import { demoMode } from "@/lib/server/social/provider";
import { permissionsOf } from "@/lib/social/rbac";

/** who I am, where I can go, what I may do there */
export const GET = route(async () => {
  const user = await requireUser();
  const [orgs, projects, unread] = await Promise.all([accessibleOrganizations(user), accessibleProjects(user), prisma.notification.count({ where: { userId: user.id, readAt: null } })]);
  return json({
    user: { id: user.id, email: user.email, name: user.name, staff: isStaff(user.role) },
    organizations: orgs,
    projects: projects.map((p) => ({ ...p, permissions: [...permissionsOf(p.roles)] })),
    unread,
    demoMode: demoMode(),
  });
});
