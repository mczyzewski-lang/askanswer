/**
 * Google Adwords (PMax) — server side: the project's data (theme, logo, expert photos, campaigns,
 * components), the idempotent CSV import, rendering the image creatives to PNG / JPG with the shared
 * drawing code and the theme's real fonts, and the ZIP package for the agency.
 */
import fsp from "node:fs/promises";
import { Prisma } from "@prisma/client";
import { createCanvas, loadImage, type Image } from "@napi-rs/canvas";
import { strToU8, zipSync } from "fflate";
import { prisma } from "./db";
import { HttpError } from "./errors";
import { signedUrl, toLocalFile } from "./storage";
import { registerFonts } from "../render/server-render";
import { themeFromRow, DEFAULT_THEME } from "../themes";
import { exportAdwordsCsv, parseAdwordsCsv, slugify, type AdwordsColumn, type ParseResult } from "../adwords/csv";
import { drawCreative, type LayoutKey } from "../adwords/draw";
import { PMAX_SPEC, formatKeyOf } from "../adwords/spec";
import { gateImage, gateText, gateVideo, scoreImageA, scoreImageB, scoreTextA, scoreTextB, scoreVideoA, scoreVideoB, type AdAsset, type BrandContext, type Measure } from "../adwords/score";
import { scenesToSrt, shotlistCsv, shotlistMarkdown, teleprompterScript, videoConcepts } from "../adwords/video";
import type { ThemeTokens } from "../editor/types";

export type AssetEdit = {
  photoHidden?: boolean;
  zoom?: number;
  offsetX?: number;
  offsetY?: number;
  cleanPhoto?: boolean;
};

export async function adwordsProject(projectId: string) {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, include: { theme: { include: { expertPhotos: { orderBy: { createdAt: "asc" } } } }, adwordsCampaigns: { orderBy: { createdAt: "asc" } } } });
  const theme: ThemeTokens = project.theme ? themeFromRow(project.theme) : DEFAULT_THEME;
  const assets = await prisma.adwordsAsset.findMany({ where: { projectId }, orderBy: [{ order: "asc" }, { createdAt: "asc" }] });
  return { project, theme, assets, photos: project.theme?.expertPhotos ?? [], campaigns: project.adwordsCampaigns };
}

/** words of the offer: project name + campaign names + brief, for relevance checks */
export function brandContext(p: { name: string; description: string | null; adwordsBrief: string | null }, landingUrl: string | null, hasLogo: boolean): BrandContext {
  const stop = new Set(["oraz", "jest", "dla", "the", "and", "lub", "bez", "nie", "się", "jak", "aby", "czy", "przez", "które", "który"]);
  const text = `${p.name} ${p.description ?? ""} ${p.adwordsBrief ?? ""}`.toLowerCase();
  const keywords = [...new Set(text.split(/[^a-ząćęłńóśźż0-9]+/).filter((w) => w.length > 3 && !stop.has(w)))].slice(0, 40);
  return { brandName: p.name, keywords: [...keywords, "rozwód", "rozstanie", "mediator", "mediacja", "plan", "konsultacja"].filter((v, i, a) => a.indexOf(v) === i), landingUrl, hasLogo };
}

/** the layout of an image row: chosen in the editor, else from the CSV art direction, else by photo */
export function layoutOf(a: { rowType: string; layout: string | null; visualBrief: string | null; expertPhotoKey: string | null; expertPhotoId: string | null; edit: unknown }): LayoutKey {
  const e = (a.edit ?? {}) as AssetEdit;
  if (a.rowType === "image_clean" || e.cleanPhoto) return "clean_photo";
  if (a.layout === "typographic" || a.layout === "expert_split" || a.layout === "process_steps") return a.layout;
  const m = /^(typographic|expert_split|process_steps)\b/.exec((a.visualBrief ?? "").trim());
  if (m) return m[1] as LayoutKey;
  return a.expertPhotoKey || a.expertPhotoId ? "expert_split" : "typographic";
}

export const toAdAsset = (a: Prisma.AdwordsAssetGetPayload<object>): AdAsset => ({ ...a, approvedAt: a.approvedAt, edit: (a.edit ?? null) as AdAsset["edit"] });

// ------------------------------------------------------------------------------------------- import

export interface ImportOutcome extends Omit<ParseResult, "preview"> {
  preview: ParseResult["preview"];
  applied: boolean;
  created: number;
  updated: number;
  unchanged: number;
  campaignsCreated: number;
  projectSlugMismatch: string[];
  concepts: { images: number; cleanPhotos: number; videos: number; scenes: number; texts: number };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Read the CSV and (unless `dryRun`) upsert by asset_id. Nothing is written when the file has errors.
 * The editor's work (layout, photo crop, approvals) is kept on update.
 */
export async function importAdwordsCsv(projectId: string, text: string, opts: { mapping?: Record<string, AdwordsColumn | null>; dryRun?: boolean } = {}): Promise<ImportOutcome> {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, include: { theme: { include: { expertPhotos: true } } } });
  const parsed = parseAdwordsCsv(text, opts.mapping);
  const slug = slugify(project.name);
  const mismatch = [...new Set(parsed.assets.map((a) => a.projectSlug).filter((s): s is string => !!s && s !== slug))];
  const concepts = {
    images: new Set(parsed.assets.filter((a) => a.rowType === "image").map((a) => a.data.conceptId)).size,
    cleanPhotos: parsed.assets.filter((a) => a.rowType === "image_clean").length,
    videos: new Set(parsed.assets.filter((a) => a.rowType === "video").map((a) => a.data.conceptId)).size,
    scenes: parsed.assets.filter((a) => a.rowType === "video_scene").length,
    texts: parsed.assets.filter((a) => a.rowType === "headline" || a.rowType === "long_headline" || a.rowType === "description").length,
  };
  const base = { ...parsed, applied: false, created: 0, updated: 0, unchanged: 0, campaignsCreated: 0, projectSlugMismatch: mismatch, concepts };
  if (opts.dryRun || parsed.issues.some((i) => i.level === "error")) return base;

  const existing = new Map((await prisma.adwordsAsset.findMany({ where: { projectId } })).map((a) => [a.assetKey, a]));
  const photos = project.theme?.expertPhotos ?? [];
  let created = 0;
  let updated = 0;
  let unchanged = 0;
  let campaignsCreated = 0;
  await prisma.$transaction(
    async (tx) => {
      // campaigns from the codes in the file (sales / educational by the funnel)
      const codes = new Map<string, string | null>();
      for (const a of parsed.assets) if (a.data.campaignCode && !codes.has(a.data.campaignCode)) codes.set(a.data.campaignCode, a.data.funnel);
      for (const [code, funnel] of codes) {
        const had = await tx.adwordsCampaign.findUnique({ where: { projectId_code: { projectId, code } } });
        if (!had) {
          await tx.adwordsCampaign.create({ data: { projectId, code, name: code, goal: funnel === "poradnik" ? "poradnik" : "sprzedaz" } });
          campaignsCreated++;
        }
      }
      for (const [i, a] of parsed.assets.entries()) {
        const photo = a.data.expertPhotoKey ? photos.find((p) => p.key === a.data.expertPhotoKey) : null;
        const data = { ...a.data, rowType: a.rowType, extra: a.extra as Prisma.InputJsonValue, order: i };
        const prev = existing.get(a.assetKey);
        if (!prev) {
          await tx.adwordsAsset.create({ data: { projectId, assetKey: a.assetKey, ...data, expertPhotoId: photo?.id ?? null } });
          created++;
          continue;
        }
        const changed = Object.entries(data).some(([k, v]) => !same((prev as Record<string, unknown>)[k], v));
        if (!changed) {
          unchanged++;
          continue;
        }
        await tx.adwordsAsset.update({ where: { id: prev.id }, data: { ...data, expertPhotoId: prev.expertPhotoId ?? photo?.id ?? null } });
        updated++;
      }
    },
    { timeout: 60_000 },
  );
  return { ...base, applied: true, created, updated, unchanged, campaignsCreated };
}

// ------------------------------------------------------------------------------------------- render

async function loadAssetImage(assetId: string | null | undefined): Promise<Image | null> {
  if (!assetId) return null;
  const a = await prisma.mediaAsset.findUnique({ where: { id: assetId } });
  if (!a) return null;
  const f = await toLocalFile(a.storageKey);
  try {
    return await loadImage(await fsp.readFile(f.path));
  } finally {
    await f.cleanup();
  }
}

export const orientationName = (w: number, h: number) => (formatKeyOf(null, w, h) ?? "image");
export const fileNameOf = (slug: string, a: { conceptId: string | null; assetKey: string }, w: number, h: number, ext: string) => `${slug}_${a.conceptId ?? a.assetKey}_${orientationName(w, h)}_${w}x${h}.${ext}`;

/** Render one image row at its format's size (the recommended pixels when the row has none). */
export async function renderAdwordsImage(assetDbId: string, fmt: "png" | "jpg" = "png", cache?: { logo?: Image | null; photos?: Map<string, Image | null> }) {
  const a = await prisma.adwordsAsset.findUniqueOrThrow({ where: { id: assetDbId }, include: { project: { include: { theme: { include: { expertPhotos: true } } } } } });
  if (a.rowType !== "image" && a.rowType !== "image_clean") throw new HttpError(400, "To nie jest grafika");
  const key = formatKeyOf(a.aspectRatio, a.width, a.height);
  const spec = PMAX_SPEC.images.formats.find((f) => f.key === key);
  if (!spec) throw new HttpError(400, `Nieznany format ${a.aspectRatio ?? ""}`);
  const W = a.width && a.height && Math.abs(a.width / a.height - spec.width / spec.height) < 0.02 ? a.width : spec.width;
  const H = a.width && a.height && Math.abs(a.width / a.height - spec.width / spec.height) < 0.02 ? a.height : spec.height;
  registerFonts();
  const theme = a.project.theme ? themeFromRow(a.project.theme) : DEFAULT_THEME;
  const logo = cache && "logo" in cache ? cache.logo : await loadAssetImage(a.project.theme?.logoAssetId);
  if (cache && !("logo" in cache)) cache.logo = logo;
  const photoRow = a.expertPhotoId ? a.project.theme?.expertPhotos.find((p) => p.id === a.expertPhotoId) : a.expertPhotoKey ? a.project.theme?.expertPhotos.find((p) => p.key === a.expertPhotoKey) : null;
  const edit = (a.edit ?? {}) as AssetEdit;
  let photoImg: Image | null = null;
  if (photoRow && !edit.photoHidden) {
    if (cache?.photos?.has(photoRow.id)) photoImg = cache.photos.get(photoRow.id) ?? null;
    else {
      photoImg = await loadAssetImage(photoRow.assetId);
      cache?.photos?.set(photoRow.id, photoImg);
    }
  }
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  const measure: Measure = drawCreative(ctx as never, {
    width: W,
    height: H,
    layout: layoutOf(a),
    copy: { headline: a.headline ?? "", subheadline: a.subheadline, body: a.body, cta: a.cta },
    theme,
    logo,
    photo: photoImg && photoRow ? { image: photoImg, focalX: photoRow.focalX, focalY: photoRow.focalY, zoom: edit.zoom, offsetX: edit.offsetX, offsetY: edit.offsetY } : null,
    safeMargin: PMAX_SPEC.images.safeMargin,
  });
  let buf: Buffer;
  if (fmt === "png") buf = await canvas.encode("png");
  else {
    let q = 92;
    buf = await canvas.encode("jpeg", q);
    while (buf.length > PMAX_SPEC.images.maxFileBytes && q > 50) buf = await canvas.encode("jpeg", (q -= 8));
  }
  return { buf, width: W, height: H, measure, photo: photoRow ?? null, mime: fmt === "png" ? "image/png" : "image/jpeg", fileName: fileNameOf(slugify(a.project.name), a, W, H, fmt) };
}

// ------------------------------------------------------------------------------------------- evaluation

/** Scores (A and B) and the gate of every component, as the page and the exports show them. */
export async function evaluateProject(projectId: string, measures: Map<string, Measure> = new Map(), sizes: Map<string, number> = new Map()) {
  const { project, assets, photos, campaigns, theme } = await adwordsProject(projectId);
  const landing = campaigns.find((c) => c.landingUrl)?.landingUrl ?? null;
  const ctxOf = (code: string | null) => brandContext(project, campaigns.find((c) => c.code === code)?.landingUrl ?? landing, !!theme.logoAssetId || !!project.theme?.logoAssetId);
  const list = assets.map(toAdAsset);
  const photoOf = (a: AdAsset) => {
    const p = a.expertPhotoId ? photos.find((x) => x.id === a.expertPhotoId) : a.expertPhotoKey ? photos.find((x) => x.key === a.expertPhotoKey) : null;
    return p ? { id: p.id, consentConfirmed: p.consentConfirmed } : null;
  };
  const images = list
    .filter((a) => a.rowType === "image" || a.rowType === "image_clean")
    .map((a) => {
      const m = measures.get(a.id!) ?? null;
      const ctx = ctxOf(a.campaignCode ?? null);
      const photo = photoOf(a);
      return { id: a.id!, assetKey: a.assetKey, conceptId: a.conceptId, scoreA: a.rowType === "image" ? scoreImageA(a, ctx, m, photo) : null, scoreB: a.rowType === "image" ? scoreImageB(a, ctx, m, photo) : null, gate: gateImage(a, ctx, m, photo, sizes.get(a.id!) ?? null) };
    });
  const videos = videoConcepts(list).map((v) => {
    const ctx = ctxOf(v.variants[0]?.campaignCode ?? null);
    return { conceptId: v.conceptId, scoreA: scoreVideoA(v, ctx), scoreB: scoreVideoB(v, ctx), gate: gateVideo(v, ctx) };
  });
  const textsAll = list.filter((a) => a.rowType === "headline" || a.rowType === "long_headline" || a.rowType === "description");
  const texts = textsAll.map((t) => {
    const ctx = ctxOf(t.campaignCode ?? null);
    return { id: t.id!, assetKey: t.assetKey, scoreA: scoreTextA(t, textsAll, ctx), scoreB: scoreTextB(t, textsAll, ctx), gate: gateText(t) };
  });
  return { images, videos, texts };
}

// ------------------------------------------------------------------------------------------- brief

export function defaultBrief(p: { name: string }, data: { campaigns: Array<{ code: string; name: string; goal: string; landingUrl: string | null }>; assets: AdAsset[]; evaluation: Awaited<ReturnType<typeof evaluateProject>> }): string {
  const list = data.assets;
  const texts = (t: string) => list.filter((a) => a.rowType === t).map((a) => a.adText ?? "");
  const imageConcepts = [...new Set(list.filter((a) => a.rowType === "image").map((a) => a.conceptId))];
  const best = imageConcepts
    .map((c) => {
      const ev = data.evaluation.images.filter((e) => e.conceptId === c && e.scoreA);
      const a = Math.round(ev.reduce((n, e) => n + (e.scoreA?.total ?? 0), 0) / Math.max(1, ev.length));
      const b = Math.round(ev.reduce((n, e) => n + (e.scoreB?.total ?? 0), 0) / Math.max(1, ev.length));
      const st = ev.some((e) => e.gate.status === "blokada") ? "blokada" : ev.some((e) => e.gate.status === "do_poprawy") ? "do poprawy" : "gotowe";
      const h = list.find((x) => x.conceptId === c)?.headline ?? "";
      return { c, a, b, st, h };
    })
    .sort((x, y) => y.a + y.b - (x.a + x.b));
  const vids = data.evaluation.videos;
  const goals = data.campaigns.map((c) => `${c.name} (${c.goal === "poradnik" ? "poradnik" : "sprzedaż"})${c.landingUrl ? ` → ${c.landingUrl}` : " — URL do uzupełnienia"}`);
  const blocked = [...data.evaluation.images, ...data.evaluation.texts].filter((e) => e.gate.status === "blokada").map((e) => `${e.assetKey}: ${e.gate.problems.find((p) => p.level === "blokada")?.message ?? ""}`);
  return [
    `${p.name.toUpperCase()} — PMAX | ${data.campaigns.map((c) => (c.goal === "poradnik" ? "PORADNIK" : "SPRZEDAŻ")).filter((v, i, a) => a.indexOf(v) === i).join(" / ") || "CEL DO USTALENIA"}`,
    `Kampanie: ${goals.join("; ") || "—"}`,
    `Strategia: ${best.slice(0, 3).map((x) => `„${x.h}”`).join("; ") || "—"}`,
    `Top koncepty: ${best.slice(0, 3).map((x) => `${x.c} [A ${x.a} / B ${x.b}, ${x.st}]`).join(", ") || "—"}`,
    `Materiały: ${imageConcepts.length} konceptów × ${Math.round(list.filter((a) => a.rowType === "image").length / Math.max(1, imageConcepts.length))} grafiki + ${list.filter((a) => a.rowType === "image_clean").length} czyste zdjęcia; ${vids.length} wideo × 3 formaty.`,
    `Teksty: ${texts("headline").length} nagłówków / ${texts("long_headline").length} długich / ${texts("description").length} opisów (lista niżej).`,
    "Test 1: branding + komunikat o planie vs obecne kreacje (CAC).",
    "Test 2: ekspert vs typografia. Test 3: konsultacja vs poradnik — osobna kampania i osobny cel.",
    "Mierniki: lead kwalifikowany, koszt klienta, przychód, sprzedaż po 30/60/90 dniach — nie sam CPL.",
    `Uwagi: ${blocked.length ? blocked.slice(0, 6).join("; ") : "brak blokad"}. Ograniczenia Google (trudności w związkach): bez remarketingu i list klientów.`,
    "",
    "NAGŁÓWKI:",
    ...texts("headline").map((t) => `- ${t}`),
    "DŁUGIE NAGŁÓWKI:",
    ...texts("long_headline").map((t) => `- ${t}`),
    "OPISY:",
    ...texts("description").map((t) => `- ${t}`),
  ].join("\n");
}

// ------------------------------------------------------------------------------------------- ZIP

export async function adwordsZip(projectId: string, fmt: "png" | "jpg" = "png") {
  const { project, assets, campaigns } = await adwordsProject(projectId);
  const slug = slugify(project.name);
  const files: Record<string, Uint8Array> = {};
  const manifest: Array<Record<string, string | number>> = [];
  const measures = new Map<string, Measure>();
  const sizes = new Map<string, number>();
  const cache: { logo?: Image | null; photos: Map<string, Image | null> } = { photos: new Map() };
  const rendered: Array<{ a: (typeof assets)[number]; name: string; w: number; h: number; bytes: number }> = [];
  for (const a of assets.filter((x) => x.rowType === "image" || x.rowType === "image_clean")) {
    const r = await renderAdwordsImage(a.id, fmt, cache);
    files[`grafiki/${r.fileName}`] = new Uint8Array(r.buf);
    measures.set(a.id, r.measure);
    sizes.set(a.id, r.buf.length);
    rendered.push({ a, name: r.fileName, w: r.width, h: r.height, bytes: r.buf.length });
  }
  const ev = await evaluateProject(projectId, measures, sizes);
  for (const r of rendered) {
    const e = ev.images.find((x) => x.id === r.a.id)!;
    manifest.push({ asset_id: r.a.assetKey, name: r.a.headline ?? r.a.visualBrief ?? r.a.assetKey, concept_id: r.a.conceptId ?? "", width: r.w, height: r.h, bytes: r.bytes, score_a: e.scoreA?.total ?? "", score_b: e.scoreB?.total ?? "", score_seed: r.a.scoreSeed ?? "", status: e.gate.status, warnings: e.gate.problems.map((p) => p.message).join(" | "), file: `grafiki/${r.name}` });
  }
  const Papa = (await import("papaparse")).default;
  files["manifest.csv"] = strToU8("﻿" + Papa.unparse(manifest, { delimiter: ";" }));
  files["manifest.json"] = strToU8(JSON.stringify({ project: project.name, generatedAt: new Date().toISOString(), spec: PMAX_SPEC.verifiedAt, files: manifest }, null, 2));
  files[`${slug}_google_adwords.csv`] = strToU8(exportAdwordsCsv(assets.map((a) => ({ ...a, extra: (a.extra ?? null) as Record<string, string> | null })), slug));
  const list = assets.map(toAdAsset);
  for (const v of videoConcepts(list)) {
    files[`wideo/${v.conceptId}/napisy.srt`] = strToU8(scenesToSrt(v.scenes));
    files[`wideo/${v.conceptId}/teleprompter.txt`] = strToU8(teleprompterScript(v));
  }
  files["wideo/shotlista.csv"] = strToU8(shotlistCsv(videoConcepts(list)));
  files["wideo/shotlista.md"] = strToU8(shotlistMarkdown(videoConcepts(list)));
  files["brief.md"] = strToU8(project.adwordsBrief ?? defaultBrief(project, { campaigns, assets: list, evaluation: ev }));
  return { zip: Buffer.from(zipSync(files, { level: 6 })), name: `${slug}_google_adwords_${fmt}.zip`, count: rendered.length };
}

export async function photoUrl(assetId: string) {
  const a = await prisma.mediaAsset.findUnique({ where: { id: assetId } });
  return a ? signedUrl(a.storageKey, { ttlSec: 6 * 3600 }) : null;
}
