import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { storeUpload } from "@/lib/server/uploads";
import { assetInfo } from "@/lib/server/assets";
import { assertSafeSvg, svgTone, svgToPng, swapTone } from "@/lib/server/svg-logo";

export const runtime = "nodejs";
const TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

/**
 * Upload a logo for light (`variant=light`, default) or dark backgrounds (`variant=dark`). PNG / JPG
 * / WEBP as they are; an SVG is checked, drawn to a PNG (never stored as SVG) and, when the theme
 * lacks the other version, that one is made from it too (white ↔ the theme's dark colour).
 */
export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireAdmin();
  const { id } = await ctx.params;
  const theme = await prisma.theme.findUniqueOrThrow({ where: { id } });
  if (theme.isPreset) return json({ error: "Nie można zmienić motywu wbudowanego" }, 400);
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return json({ error: "Brak pliku" }, 400);
  const variant = form.get("variant") === "dark" ? "dark" : "light";
  if (file.size > 5 * 1024 * 1024) return json({ error: "Logo może mieć maksymalnie 5 MB" }, 413);
  const project = await prisma.project.findFirst({ where: { themeId: id } });
  const field = variant === "dark" ? "logoDarkAssetId" : "logoAssetId";
  const isSvg = file.type === "image/svg+xml" || /\.svg$/i.test(file.name);
  if (isSvg) {
    const svg = Buffer.from(await file.arrayBuffer()).toString("utf8");
    assertSafeSvg(svg);
    const png = (s: string, name: string) => svgToPng(s).then((b) => new File([new Uint8Array(b)], name, { type: "image/png" }));
    const asset = await storeUpload(await png(svg, file.name.replace(/\.svg$/i, ".png")), "LOGO", "png", project?.id ?? null);
    const data: Record<string, string> = { [field]: asset.id };
    // the other version, when the theme has none: the SVG's light and dark colours swapped
    const otherField = variant === "dark" ? "logoAssetId" : "logoDarkAssetId";
    let counterpart = false;
    if (!theme[otherField]) {
      const darkColor = /^#[0-9a-f]{6}$/i.test(theme.backgroundColor) && lumOf(theme.backgroundColor) < 0.2 ? theme.backgroundColor : /^#[0-9a-f]{6}$/i.test(theme.primaryColor) && lumOf(theme.primaryColor) < 0.2 ? theme.primaryColor : "#1F2A2A";
      const tone = svgTone(svg);
      if ((variant === "dark") === (tone === "dark")) {
        const other = await storeUpload(await png(swapTone(svg, darkColor), `${variant === "dark" ? "jasne" : "ciemne"}-${file.name.replace(/\.svg$/i, ".png")}`), "LOGO", "png", project?.id ?? null);
        data[otherField] = other.id;
        counterpart = true;
      }
    }
    await prisma.theme.update({ where: { id }, data });
    return json({ ...(await assetInfo(asset.id)), counterpart }, 201);
  }
  const ext = TYPES[file.type];
  if (!ext) return json({ error: "Logo musi być w formacie SVG, PNG, JPG lub WEBP" }, 415);
  const asset = await storeUpload(file, "LOGO", ext, project?.id ?? null);
  await prisma.theme.update({ where: { id }, data: { [field]: asset.id } });
  return json(await assetInfo(asset.id), 201);
});

function lumOf(hex: string) {
  const n = parseInt(hex.slice(1, 7), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
