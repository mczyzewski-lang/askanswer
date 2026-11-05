import { currentUser, denyReason } from "@/lib/server/auth";
import { AccessDenied } from "@/components/admin/access-denied";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/server/db";
import { projectData } from "@/lib/server/project-data";
import { ProjectView } from "@/components/admin/project-view";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await currentUser();
  const denied = me ? await denyReason(me, `/admin/projects/${id}`, "GET") : "Wymagane logowanie";
  if (denied) return <AccessDenied reason={denied} />;
  if (!(await prisma.project.findUnique({ where: { id }, select: { id: true } }))) notFound();
  const data = await projectData(id);
  return <ProjectView data={data} />;
}
