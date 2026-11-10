/**
 * Meta ads — server side: the banner of one format / version as PNG or JPG (the same drawing as the
 * preview), and the package for Ads Manager (every version × format + the texts CSV).
 */
import { z } from "zod";
import { createCanvas, type Image } from "@napi-rs/canvas";
import { strToU8, zipSync } from "fflate";
import { prisma } from "./db";
import { HttpError } from "./errors";
import { loadAssetImage } from "./adwords";
import { registerFonts } from "../render/server-render";
import { themeFromRow, DEFAULT_THEME } from "../themes";
import { drawCreative } from "../adwords/draw";
import type { Measure } from "../adwords/score";
import { slugify } from "../adwords/csv";
import { META_FORMATS, metaCreative, metaCsv, metaSlug, metaVersions, type MetaAdData, type MetaFormatKey } from "../adwords/meta";

export const metaData = (a: { photoIds: unknown; webinarAt: Date | null } & Omit<MetaAdData, "photoIds" | "webinarAt">): MetaAdData => ({ ...a, photoIds: Array.isArray(a.photoIds) ? (a.photoIds as string[]) : [], webinarAt: a.webinarAt });

export async function renderMetaImage(adId: string, format: MetaFormatKey, version: string, fmt: "png" | "jpg" = "png", cache?: { logo?: Image | null; photos: Map<string, Image | null> }) {
  const ad = await prisma.metaAd.findUniqueOrThrow({ where: { id: adId }, include: { project: { include: { theme: { include: { expertPhotos: true } } } } } });
  if (!META_FORMATS.some((f) => f.key === format)) throw new HttpError(400, "Nieznany format");
  const d = metaData(ad);
  if (version !== "none" && !d.photoIds.includes(version)) throw new HttpError(404, "Nie ma takiej wersji");
  registerFonts();
  const theme = ad.project.theme ? themeFromRow(ad.project.theme) : DEFAULT_THEME;
  const logo = cache && "logo" in cache ? cache.logo! : await loadAssetImage(ad.project.theme?.logoAssetId);
  if (cache && !("logo" in cache)) cache.logo = logo;
  const row = version !== "none" ? ad.project.theme?.expertPhotos.find((p) => p.id === version) : null;
  let img: Image | null = null;
  if (row) {
    img = cache?.photos.has(row.id) ? cache.photos.get(row.id)! : await loadAssetImage(row.assetId);
    cache?.photos.set(row.id, img);
  }
  const c = metaCreative(d, format, !!img);
  const canvas = createCanvas(c.width, c.height);
  const measure: Measure = drawCreative(canvas.getContext("2d") as never, { ...c, theme, logo, photo: img && row ? { image: img, focalX: row.focalX, focalY: row.focalY } : null });
  const buf = fmt === "png" ? await canvas.encode("png") : await canvas.encode("jpeg", 90);
  const label = row ? metaSlug(row.key) : "bez-eksperta";
  return { buf, measure, width: c.width, height: c.height, mime: fmt === "png" ? "image/png" : "image/jpeg", fileName: `${metaSlug(ad.name)}_${label}_${format}_${c.width}x${c.height}.${fmt}`, versionLabel: row ? row.name : "bez eksperta" };
}

/** every version × format of the chosen ads (all when none chosen) + meta_teksty.csv */
export async function metaZip(projectId: string, adIds: string[], fmt: "png" | "jpg" = "png") {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  const ads = await prisma.metaAd.findMany({ where: { projectId, ...(adIds.length ? { id: { in: adIds } } : {}) }, orderBy: [{ order: "asc" }, { createdAt: "asc" }] });
  if (!ads.length) throw new HttpError(404, "Brak reklam Meta");
  const files: Record<string, Uint8Array> = {};
  const rows: Parameters<typeof metaCsv>[0] = [];
  const cache = { photos: new Map<string, Image | null>() } as { logo?: Image | null; photos: Map<string, Image | null> };
  for (const ad of ads) {
    const d = metaData(ad);
    for (const v of metaVersions(d)) {
      const names: string[] = [];
      let label = "";
      for (const f of META_FORMATS) {
        const r = await renderMetaImage(ad.id, f.key, v, fmt, cache);
        const name = `meta/${metaSlug(ad.name)}/${r.fileName}`;
        files[name] = new Uint8Array(r.buf);
        names.push(name);
        label = r.versionLabel;
      }
      rows.push({ ad: d, version: v, versionLabel: label, files: names });
    }
  }
  files["meta_teksty.csv"] = strToU8(metaCsv(rows));
  return { zip: Buffer.from(zipSync(files, { level: 0 })), name: `${slugify(project.name)}_meta${ads.length === 1 ? `_${metaSlug(ads[0].name)}` : ""}_${fmt}.zip` };
}

/** what an ad accepts from the editor */
export const MetaBody = z.object({
  name: z.string().trim().min(1).max(120),
  primaryText: z.string().max(2000).default(""),
  metaHeadline: z.string().max(255).default(""),
  description: z.string().max(255).default(""),
  ctaButton: z.string().regex(/^[A-Z_]{3,30}$/).default("LEARN_MORE"),
  headline: z.string().max(200).default(""),
  ctaImage: z.string().max(80).default(""),
  destination: z.enum(["website", "webinar"]).default("website"),
  url: z.string().trim().max(500).nullable().optional(),
  webinarTitle: z.string().max(200).nullable().optional(),
  webinarAt: z.string().datetime().nullable().optional(),
  layout: z.enum(["typographic", "process_steps"]).default("typographic"),
  body: z.string().max(400).nullable().optional(),
  withoutExpert: z.boolean().default(true),
  photoIds: z.array(z.string().max(64)).max(12).default([]),
});

