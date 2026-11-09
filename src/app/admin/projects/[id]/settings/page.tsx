import { notFound } from "next/navigation";
import { prisma } from "@/lib/server/db";
import { currentUser, denyReason } from "@/lib/server/auth";
import { signedUrl } from "@/lib/server/storage";
import { projectData } from "@/lib/server/project-data";
import { AccessDenied } from "@/components/admin/access-denied";
import { ProjectSettings, type SettingsSection } from "@/components/admin/project-settings";

export const dynamic = "force-dynamic";

/** Projekt → Ustawienia: the project's theme, people (and experts), narrator voice and general settings. */
export default async function ProjectSettingsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ section?: string }> }) {
  const { id } = await params;
  const { section } = await searchParams;
  const me = await currentUser();
  const denied = me ? await denyReason(me, `/admin/projects/${id}`, "GET") : "Wymagane logowanie";
  if (denied) return <AccessDenied reason={denied} />;
  const p = await prisma.project.findUnique({ where: { id }, select: { id: true, format: true, autoReels: true, themeId: true } });
  if (!p) notFound();
  const ads = p.format === "ADS";
  const sections: SettingsSection[] = ads ? ["theme", "people", "general"] : ["theme", "people", "voice", "general"];
  const current = sections.includes(section as SettingsSection) ? (section as SettingsSection) : "theme";
  const row = p.themeId
    ? await prisma.theme.findUnique({ where: { id: p.themeId }, include: { projects: { where: { id }, select: { id: true, name: true, categories: { orderBy: { order: "asc" }, select: { id: true, name: true, brollStyle: true, expertId: true, _count: { select: { questions: true } } } } } } } })
    : null;
  const logo = row?.logoAssetId ? await prisma.mediaAsset.findUnique({ where: { id: row.logoAssetId } }) : null;
  // this project only, and only the categories it uses (or that have their own style / expert set)
  const rowOwn = row ? { ...row, projects: row.projects.map((pr) => ({ ...pr, categories: pr.categories.filter((c) => c._count.questions > 0 || c.brollStyle || c.expertId).map(({ _count, ...c }) => ({ ...c, questions: _count.questions })) })) } : null;
  const theme = rowOwn ? { ...rowOwn, createdAt: rowOwn.createdAt.toISOString(), updatedAt: rowOwn.updatedAt.toISOString(), logoUrl: logo ? await signedUrl(logo.storageKey) : null } : null;
  const experts = await prisma.expert.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });
  const data = await projectData(id);
  const back = p.autoReels ? `/admin/auto-reels/${id}` : ads ? `/admin/ads/${id}` : `/admin/projects/${id}`;
  return <ProjectSettings projectId={id} back={back} sections={sections} section={current} theme={theme} experts={experts} data={data} canEdit={me!.role === "ADMIN" || me!.role === "EDITOR"} />;
}
