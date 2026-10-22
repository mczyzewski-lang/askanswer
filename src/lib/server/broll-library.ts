import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { assetInfo } from "./assets";

/** B-roll library of a project (Ads Studio): uploaded cutaways, some picked for the Studio. */
export async function brollLibrary(projectId: string) {
  const rows = await prisma.mediaAsset.findMany({
    where: { projectId, kind: { in: ["OVERLAY_VIDEO", "IMAGE"] }, meta: { path: ["library"], equals: "broll" } },
    orderBy: { createdAt: "asc" },
  });
  const items = await Promise.all(
    rows.map(async (r) => {
      const info = await assetInfo(r.id);
      return info ? { ...info, name: r.originalName ?? "B-roll", picked: !!(r.meta as { picked?: boolean } | null)?.picked, isVideo: r.kind === "OVERLAY_VIDEO" } : null;
    }),
  );
  return items.filter((x): x is NonNullable<typeof x> => !!x);
}

export async function setPicked(assetId: string, picked: boolean) {
  const a = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: assetId } });
  const meta = (a.meta ?? {}) as Record<string, unknown>;
  if (meta.library !== "broll") throw new Error("To nie jest plik z biblioteki B-roll");
  await prisma.mediaAsset.update({ where: { id: assetId }, data: { meta: { ...meta, picked } as Prisma.InputJsonValue } });
}
