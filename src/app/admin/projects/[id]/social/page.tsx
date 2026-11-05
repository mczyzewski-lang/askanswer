import { currentUser, denyReason } from "@/lib/server/auth";
import { AccessDenied } from "@/components/admin/access-denied";
import { ProjectSocial } from "@/components/admin/project-social";

export default async function ProjectSocialPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await currentUser();
  const denied = me ? await denyReason(me, `/admin/projects/${id}`, "GET") : "Wymagane logowanie";
  if (denied) return <AccessDenied reason={denied} />;
  return <ProjectSocial id={id} canEdit={me!.role === "ADMIN" || me!.role === "EDITOR"} />;
}
