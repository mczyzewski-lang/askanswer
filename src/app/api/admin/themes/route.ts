import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { signedUrl } from "@/lib/server/storage";

export const GET = route(async () => {
  await requireAdmin();
  const themes = await prisma.theme.findMany({ orderBy: [{ isPreset: "desc" }, { name: "asc" }] });
  return json(
    await Promise.all(
      themes.map(async (t) => {
        const logo = t.logoAssetId ? await prisma.mediaAsset.findUnique({ where: { id: t.logoAssetId } }) : null;
        return { ...t, logoUrl: logo ? await signedUrl(logo.storageKey) : null };
      }),
    ),
  );
});
