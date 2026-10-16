import { prisma } from "@/lib/server/db";
import { signedUrl } from "@/lib/server/storage";
import { ThemesView } from "@/components/admin/themes-view";

export default async function ThemesPage({ searchParams }: { searchParams: Promise<{ theme?: string }> }) {
  const { theme } = await searchParams;
  const rows = await prisma.theme.findMany({ where: { isPreset: false }, orderBy: { updatedAt: "desc" }, include: { projects: { select: { id: true, name: true, categories: { orderBy: { order: "asc" }, select: { id: true, name: true, brollStyle: true, expertId: true } } } } } });
  const experts = await prisma.expert.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });
  const themes = await Promise.all(
    rows.map(async (t) => {
      const logo = t.logoAssetId ? await prisma.mediaAsset.findUnique({ where: { id: t.logoAssetId } }) : null;
      return { ...t, createdAt: t.createdAt.toISOString(), updatedAt: t.updatedAt.toISOString(), logoUrl: logo ? await signedUrl(logo.storageKey) : null };
    }),
  );
  return <ThemesView themes={themes} experts={experts} initialId={theme ?? themes[0]?.id ?? null} />;
}
