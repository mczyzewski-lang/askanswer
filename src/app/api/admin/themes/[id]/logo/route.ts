import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { storeUpload } from "@/lib/server/uploads";
import { assetInfo } from "@/lib/server/assets";

export const runtime = "nodejs";
const TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

/** Upload a logo (PNG with transparency recommended). SVG is rejected for safety. */
export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireAdmin();
  const { id } = await ctx.params;
  const theme = await prisma.theme.findUniqueOrThrow({ where: { id } });
  if (theme.isPreset) return json({ error: "Nie można zmienić motywu wbudowanego" }, 400);
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return json({ error: "Brak pliku" }, 400);
  const ext = TYPES[file.type];
  if (!ext) return json({ error: "Logo musi być w formacie PNG, JPG lub WEBP" }, 415);
  if (file.size > 5 * 1024 * 1024) return json({ error: "Logo może mieć maksymalnie 5 MB" }, 413);
  const project = await prisma.project.findFirst({ where: { themeId: id } });
  const asset = await storeUpload(file, "LOGO", ext, project?.id ?? null);
  await prisma.theme.update({ where: { id }, data: { logoAssetId: asset.id } });
  return json(await assetInfo(asset.id), 201);
});
