import { prisma } from "@/lib/server/db";
import { invitationUrl } from "@/lib/server/invitations";
import { ExpertsView } from "@/components/admin/experts-view";

export default async function ExpertsPage() {
  const experts = await prisma.expert.findMany({
    orderBy: { name: "asc" },
    include: {
      questions: { select: { id: true, projectId: true, project: { select: { name: true } }, recording: { select: { _count: { select: { takes: true } } } } } },
      invitations: { where: { revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" }, include: { project: { select: { name: true } } } },
    },
  });
  return (
    <ExpertsView
      experts={experts.map((e) => {
        const projects = new Map<string, { id: string; name: string; total: number; recorded: number }>();
        for (const q of e.questions) {
          const p = projects.get(q.projectId) ?? { id: q.projectId, name: q.project.name, total: 0, recorded: 0 };
          p.total++;
          if ((q.recording?._count.takes ?? 0) > 0) p.recorded++;
          projects.set(q.projectId, p);
        }
        return {
          id: e.id,
          name: e.name,
          email: e.email,
          title: e.title,
          projects: [...projects.values()],
          links: e.invitations.map((i) => ({ id: i.id, project: i.project.name, url: invitationUrl(i.tokenEnc), expiresAt: i.expiresAt.toISOString() })),
        };
      })}
    />
  );
}
