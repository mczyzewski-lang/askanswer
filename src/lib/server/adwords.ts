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
import { landingMarkdown, landingPlan } from "../adwords/landing";
import { exportAdwordsCsv, parseAdwordsCsv, slugify, type AdwordsColumn, type LpData, type ParseResult, type ParsedAsset } from "../adwords/csv";
import { gateLpOf, isV5Project, landingContext, landingZipFiles, seedClaims } from "./adwords-landing";
import { drawCreative, type LayoutKey } from "../adwords/draw";
import { PMAX_SPEC, formatKeyOf } from "../adwords/spec";
import { gateImage, gateSitelink, gateText, gateVideo, scoreImageA, scoreImageB, scoreTextA, scoreTextB, scoreVideoA, scoreVideoB, type AdAsset, type BrandContext, type Measure } from "../adwords/score";
import { scenesToSrt, shotlistCsv, shotlistMarkdown, teleprompterScript, videoConcepts } from "../adwords/video";
import { experiments } from "../adwords/experiments";
import { ANGLE_LABEL, MISSING_DATA, matchHistory } from "../adwords/history";
import type { ThemeTokens } from "../editor/types";

export type { AssetEdit } from "../adwords/context";
import { brandContext, gateOptionsOf, layoutOf, type AssetEdit } from "../adwords/context";
export { brandContext, layoutOf };

export async function adwordsProject(projectId: string) {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, include: { theme: { include: { expertPhotos: { orderBy: { createdAt: "asc" } } } }, adwordsCampaigns: { orderBy: { createdAt: "asc" } } } });
  const theme: ThemeTokens = project.theme ? themeFromRow(project.theme) : DEFAULT_THEME;
  const assets = await prisma.adwordsAsset.findMany({ where: { projectId }, orderBy: [{ order: "asc" }, { createdAt: "asc" }] });
  return { project, theme, assets, photos: project.theme?.expertPhotos ?? [], campaigns: project.adwordsCampaigns };
}

export const toExportable = (a: Prisma.AdwordsAssetGetPayload<object>) => ({ ...a, extra: (a.extra ?? null) as Record<string, string> | null, lp: (a.lp ?? null) as LpData | null });

export const toAdAsset = (a: Prisma.AdwordsAssetGetPayload<object>): AdAsset => ({ ...a, approvedAt: a.approvedAt, edit: (a.edit ?? null) as AdAsset["edit"], lp: (a.lp ?? null) as Record<string, string> | null });

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
  derivedScenes?: number;
}

/** canonical JSON (jsonb stores object keys in its own order) */
const canon = (v: unknown): unknown => (Array.isArray(v) ? v.map(canon) : v && typeof v === "object" && !(v instanceof Date) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])])) : v);
const same = (a: unknown, b: unknown) => JSON.stringify(canon(a ?? null)) === JSON.stringify(canon(b ?? null));

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
    experiments: new Set(parsed.assets.map((a) => a.data.experimentId).filter(Boolean)).size,
    meta: parsed.assets.filter((a) => a.rowType === "experiment_plan" || a.rowType === "historical_reference").length,
    sitelinks: parsed.assets.filter((a) => a.rowType === "sitelink").length,
    landing: parsed.assets.filter((a) => a.rowType === "landing_page").length,
  };
  const base = { ...parsed, applied: false, created: 0, updated: 0, unchanged: 0, campaignsCreated: 0, projectSlugMismatch: mismatch, concepts };
  if (opts.dryRun || parsed.issues.some((i) => i.level === "error")) return base;

  const existing = new Map((await prisma.adwordsAsset.findMany({ where: { projectId } })).map((a) => [a.assetKey, a]));
  const photos = project.theme?.expertPhotos ?? [];
  const rows = [...parsed.assets, ...inlineScenes(parsed.assets)];
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
      for (const [i, a] of rows.entries()) {
        const photo = a.data.expertPhotoKey ? photos.find((p) => p.key === a.data.expertPhotoKey) : null;
        const prev = existing.get(a.assetKey);
        // the editor's own landing fields (_hidden, _photo_id…) survive a re-import
        const keepLp = Object.fromEntries(Object.entries((prev?.lp ?? {}) as Record<string, string>).filter(([k]) => k.startsWith("_")));
        const lpVal = a.data.lp || Object.keys(keepLp).length ? { ...(a.data.lp ?? {}), ...keepLp } : null;
        const data = { ...a.data, lp: lpVal ?? Prisma.JsonNull, rowType: a.rowType, extra: a.extra as Prisma.InputJsonValue, order: i };
        if (!prev) {
          const layoutId = a.extra.layout_id;
          await tx.adwordsAsset.create({ data: { projectId, assetKey: a.assetKey, ...data, ...(layoutId && LAYOUT_IDS.includes(layoutId) ? { layout: layoutId } : {}), expertPhotoId: photo?.id ?? null } });
          created++;
          continue;
        }
        const changed = Object.entries({ ...data, lp: lpVal }).some(([k, v]) => !same((prev as Record<string, unknown>)[k], v));
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
  await seedClaims(projectId);
  return { ...base, applied: true, created, updated, unchanged, campaignsCreated, derivedScenes: rows.length - parsed.assets.length };
}

const LAYOUT_IDS = ["typographic", "expert_split", "process_steps", "clean_photo"];

/**
 * CSV v3–v5 keep the video script in the video row (video_hook_0_3, video_spoken_3_9, video_screen_3_9…).
 * When a concept has no video_scene rows, its scenes are derived from the first variant that has them.
 */
export function inlineScenes(assets: ParsedAsset[]): ParsedAsset[] {
  const withScenes = new Set(assets.filter((a) => a.rowType === "video_scene").map((a) => a.data.conceptId));
  const out: ParsedAsset[] = [];
  const done = new Set<string>();
  for (const v of assets.filter((a) => a.rowType === "video" && a.data.conceptId)) {
    const c = v.data.conceptId!;
    if (withScenes.has(c) || done.has(c)) continue;
    const segs = new Map<string, { s: number; e: number; spoken?: string; screen?: string; visual?: string }>();
    for (const [k, val] of Object.entries(v.extra)) {
      const m = /^video_(hook|spoken|screen|visual)_(\d+)_(\d+)$/.exec(k);
      if (!m || !val.trim()) continue;
      const id = `${m[2]}_${m[3]}`;
      const seg = segs.get(id) ?? { s: +m[2], e: +m[3] };
      if (m[1] === "hook") {
        seg.spoken = seg.spoken ?? val;
        seg.screen = seg.screen ?? val;
      } else if (m[1] === "spoken") seg.spoken = val;
      else if (m[1] === "screen") seg.screen = val;
      else seg.visual = val;
      segs.set(id, seg);
    }
    if (!segs.size) continue;
    done.add(c);
    [...segs.values()]
      .sort((a, b) => a.s - b.s)
      .forEach((g, i) =>
        out.push({
          row: v.row,
          assetKey: `${c}-SC${i + 1}`,
          rowType: "video_scene",
          projectSlug: v.projectSlug,
          data: { ...v.data, aspectRatio: null, width: null, height: null, durationSec: null, sceneIndex: i + 1, startS: g.s, endS: g.e, spokenText: g.spoken ?? null, screenText: g.screen ?? g.spoken ?? null, visualBrief: g.visual ?? null, headline: null, subheadline: null, body: null, adText: null, recordScope: "ad_asset", lp: null },
          extra: { derived_from: v.assetKey },
        }),
      );
  }
  return out;
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
  const opts = gateOptionsOf(list, gateLpOf(isV5Project(assets), await landingContext(projectId)));
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
      return { id: a.id!, assetKey: a.assetKey, conceptId: a.conceptId, scoreA: a.rowType === "image" ? scoreImageA(a, ctx, m, photo) : null, scoreB: a.rowType === "image" ? scoreImageB(a, ctx, m, photo) : null, gate: gateImage(a, ctx, m, photo, sizes.get(a.id!) ?? null, opts) };
    });
  const videos = videoConcepts(list).map((v) => {
    const ctx = ctxOf(v.variants[0]?.campaignCode ?? null);
    return { conceptId: v.conceptId, scoreA: scoreVideoA(v, ctx), scoreB: scoreVideoB(v, ctx), gate: gateVideo(v, ctx, opts) };
  });
  const textsAll = list.filter((a) => a.rowType === "headline" || a.rowType === "long_headline" || a.rowType === "description");
  const texts = textsAll.map((t) => {
    const ctx = ctxOf(t.campaignCode ?? null);
    return { id: t.id!, assetKey: t.assetKey, scoreA: scoreTextA(t, textsAll, ctx), scoreB: scoreTextB(t, textsAll, ctx), gate: gateText(t, opts) };
  });
  const sitelinks = list.filter((a) => a.rowType === "sitelink").map((t) => ({ id: t.id!, assetKey: t.assetKey, gate: gateSitelink(t, opts) }));
  return { images, videos, texts, sitelinks };
}

// ------------------------------------------------------------------------------------------- brief

type HistRow = { component: string; typeKey: string; impressions: number | null; clicks: number | null; conversions: number | null; conceptId: string | null; angle: string | null };
const fmtN = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("pl-PL", { maximumFractionDigits: 2 }));

/** "Hipoteza oparta na: …" for a concept: a linked historical component, else one with the same message */
export function hypothesisLine(conceptId: string, headline: string, history: HistRow[], period: string) {
  const linked = history.filter((h) => h.conceptId === conceptId);
  const h = linked[0] ?? matchHistory(headline, history)[0];
  if (!h) return null;
  return `Hipoteza oparta na: „${h.component.split("\n")[0]}”, ${fmtN(h.clicks)} kliknięć / ${fmtN(h.impressions)} wyświetleń, ${period}; nie jest wynikiem testu kontrolowanego.`;
}

export function defaultBrief(p: { name: string }, data: { campaigns: Array<{ code: string; name: string; goal: string; landingUrl: string | null }>; assets: AdAsset[]; evaluation: Awaited<ReturnType<typeof evaluateProject>>; history?: HistRow[]; period?: string }): string {
  const list = data.assets;
  const history = data.history ?? [];
  const period = data.period ?? "okres raportu";
  const texts = (t: string) => list.filter((a) => a.rowType === t && !a.experimentId).map((a) => a.adText ?? "");
  const imageConcepts = [...new Set(list.filter((a) => a.rowType === "image" && !a.experimentId).map((a) => a.conceptId))];
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
  const ex = experiments(list);
  const exLine = (e: (typeof ex)[number]) => {
    const a = e.arms.A.texts.find((t) => t.rowType === "headline")?.adText ?? e.arms.A.images[0]?.headline ?? "A";
    const bb = e.arms.B.texts.find((t) => t.rowType === "headline")?.adText ?? e.arms.B.images[0]?.headline ?? "B";
    const hist = matchHistory(a, history)[0];
    return `- ${e.id} (${e.testAxis ?? e.axis}): A „${a}” vs B „${bb}”${hist ? ` — A w historii: ${fmtN(hist.clicks)} klik., ${fmtN(hist.impressions)} wyśw. (${period}, ekspozycja, nie wynik testu)` : ""}`;
  };
  const angles = (["bez_wojny", "plan_pozew", "koszt", "szybkosc"] as const).map((k) => {
    const top = history.filter((h) => h.angle === k && ["headline", "long_headline", "description"].includes(h.typeKey)).sort((x, y) => (y.clicks ?? 0) - (x.clicks ?? 0))[0];
    return `- ${ANGLE_LABEL[k]}${k === "szybkosc" ? " (kontrolny — bez obietnic czasowych)" : ""}${top ? `: w historii „${top.component.split("\n")[0]}” (${fmtN(top.clicks)} klik.)` : ""}`;
  });
  return [
    `${p.name.toUpperCase()} — PMAX | ${data.campaigns.map((c) => (c.goal === "poradnik" ? "PORADNIK" : "SPRZEDAŻ")).filter((v, i, a) => a.indexOf(v) === i).join(" / ") || "CEL DO USTALENIA"}`,
    `Kampanie: ${goals.join("; ") || "—"}`,
    "Angle'e:",
    ...angles,
    `Top koncepty: ${best.slice(0, 3).map((x) => `${x.c} „${x.h}” [A ${x.a} / B ${x.b}, ${x.st}]`).join(", ") || "—"}`,
    ...best.slice(0, 6).map((x) => (x.c ? hypothesisLine(x.c, x.h, history, period) : null) && `  ${x.c}: ${hypothesisLine(x.c!, x.h, history, period)}`).filter((l): l is string => !!l),
    `Materiały: ${imageConcepts.length} konceptów × ${Math.round(list.filter((a) => a.rowType === "image" && !a.experimentId).length / Math.max(1, imageConcepts.length))} grafiki + ${list.filter((a) => a.rowType === "image_clean").length} czyste zdjęcia; ${vids.length} wideo × 3 formaty.`,
    `Teksty: ${texts("headline").length} nagłówków / ${texts("long_headline").length} długich / ${texts("description").length} opisów (lista niżej).`,
    ...(ex.some((e) => e.mode === "controlled") ? ["Testy A/B (kontrolowane, eksperyment komponentów PMax, 4–6 tyg., jedna zmienna):", ...ex.filter((e) => e.mode === "controlled").map(exLine)] : []),
    ...(ex.some((e) => e.mode === "exploration") ? ["Eksploracja (B dodane do puli — bez izolowanego testu, bez wskazywania zwycięzcy):", ...ex.filter((e) => e.mode === "exploration").map(exLine)] : []),
    ...(ex.length ? [] : ["Test 1: branding + komunikat o planie vs obecne kreacje (CAC). Test 2: ekspert vs typografia. Test 3: konsultacja vs poradnik — osobna kampania i osobny cel."]),
    "Mierniki: lead kwalifikowany, koszt klienta, przychód, sprzedaż po 30/60/90 dniach — nie sam CPL. Metryki komponentów z Google są przypisane i nieaddytywne; ROAS niedostępny (wartość konwersji = 0).",
    `Uwagi: ${blocked.length ? blocked.slice(0, 6).join("; ") : "brak blokad"}. Ograniczenia Google (trudności w związkach): bez remarketingu i list klientów.`,
    "Brakujące dane (priorytet):",
    ...MISSING_DATA.map((m, i) => `${i + 1}. ${m}`),
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

export interface ZipSelection {
  /** image rows (database ids) */
  assetIds?: string[];
  /** whole concepts (images and / or videos) */
  conceptIds?: string[];
  /** one arm of an experiment */
  experimentId?: string;
  variant?: string;
  /** only these parts: images, videos, texts, report (CSV + brief), landing — empty = all */
  parts?: string[];
}

/**
 * The package for the agency: everything, or a selection (one concept, chosen images, one experiment
 * arm). Images are rendered now; texts for Google Ads never include the experiment plans or the archive.
 */
export async function adwordsZip(projectId: string, fmt: "png" | "jpg" = "png", sel: ZipSelection = {}) {
  const { project, assets, campaigns, photos } = await adwordsProject(projectId);
  const slug = slugify(project.name);
  const list = assets.map(toAdAsset);
  const whole = !sel.assetIds?.length && !sel.conceptIds?.length && !sel.experimentId;
  // what is in the selection
  const inArm = (a: (typeof assets)[number]) => {
    if (!sel.experimentId) return false;
    if (a.experimentId !== sel.experimentId) return false;
    if (!sel.variant) return true;
    if (a.variant) return a.variant === sel.variant;
    // a scene follows its video concept's arm
    return a.rowType === "video_scene" && assets.some((v) => v.rowType === "video" && v.conceptId === a.conceptId && v.variant === sel.variant);
  };
  const picked = (a: (typeof assets)[number]) => whole || inArm(a) || (sel.assetIds ?? []).includes(a.id) || (!!a.conceptId && (sel.conceptIds ?? []).includes(a.conceptId));
  const want = (k: string) => !sel.parts?.length || sel.parts.includes(k);
  const files: Record<string, Uint8Array> = {};
  const manifest: Array<Record<string, string | number>> = [];
  const measures = new Map<string, Measure>();
  const sizes = new Map<string, number>();
  const cache: { logo?: Image | null; photos: Map<string, Image | null> } = { photos: new Map() };
  const rendered: Array<{ a: (typeof assets)[number]; name: string; w: number; h: number; bytes: number }> = [];
  for (const a of assets.filter((x) => (x.rowType === "image" || x.rowType === "image_clean") && picked(x) && want("images"))) {
    const r = await renderAdwordsImage(a.id, fmt, cache);
    files[`grafiki/${r.fileName}`] = new Uint8Array(r.buf);
    measures.set(a.id, r.measure);
    sizes.set(a.id, r.buf.length);
    rendered.push({ a, name: r.fileName, w: r.width, h: r.height, bytes: r.buf.length });
  }
  const ev = await evaluateProject(projectId, measures, sizes);
  for (const r of rendered) {
    const e = ev.images.find((x) => x.id === r.a.id)!;
    manifest.push({
      experiment_id: r.a.experimentId ?? "",
      variant: r.a.variant ?? "",
      asset_id: r.a.assetKey,
      name: r.a.headline ?? r.a.visualBrief ?? r.a.assetKey,
      concept_id: r.a.conceptId ?? "",
      width: r.w,
      height: r.h,
      bytes: r.bytes,
      cta: r.a.cta ?? "",
      score_a: e.scoreA?.total ?? "",
      score_b: e.scoreB?.total ?? "",
      score_seed: r.a.scoreSeed ?? "",
      status: e.gate.status,
      warnings: e.gate.problems.map((p) => p.message).join(" | "),
      file: `grafiki/${r.name}`,
    });
  }
  const Papa = (await import("papaparse")).default;
  files["manifest.csv"] = strToU8("\uFEFF" + Papa.unparse(manifest.length ? manifest : [{ asset_id: "", file: "" }], { delimiter: ";" }));
  files["manifest.json"] = strToU8(JSON.stringify({ project: project.name, selection: whole ? "całość" : sel, generatedAt: new Date().toISOString(), spec: PMAX_SPEC.verifiedAt, files: manifest }, null, 2));
  // texts ready for Google Ads (never experiment plans or the archive)
  const texts = assets.filter((a) => (a.rowType === "headline" || a.rowType === "long_headline" || a.rowType === "description" || a.rowType === "sitelink") && (whole || inArm(a) || (sel.assetIds ?? []).includes(a.id)));
  if (texts.length && want("texts")) {
    const tEv = new Map([...ev.texts, ...ev.sitelinks].map((t) => [t.id, t]));
    files["teksty_google_ads.csv"] = strToU8("\uFEFF" + Papa.unparse(texts.map((t) => ({ experiment_id: t.experimentId ?? "", variant: t.variant ?? "", asset_id: t.assetKey, typ: t.rowType, tekst: t.adText ?? "", znaki: [...(t.adText ?? "")].length, opis_1: ((t.lp ?? {}) as Record<string, string>).sitelink_description_1 ?? "", opis_2: ((t.lp ?? {}) as Record<string, string>).sitelink_description_2 ?? "", url: t.landingUrl ?? "", landing_variant: t.landingVariantId ?? "", status: tEv.get(t.id)?.gate.status ?? "" })), { delimiter: ";" }));
  }
  if (whole && want("report")) files[`${slug}_google_adwords.csv`] = strToU8(exportAdwordsCsv(assets.map(toExportable), slug));
  // video: what to record (script, teleprompter, subtitles, shot list) + the MP4s already rendered
  const vids = videoConcepts(list.filter((a) => (a.rowType === "video" || a.rowType === "video_scene") && want("videos") && picked(assets.find((x) => x.id === a.id)!)));
  for (const v of vids) {
    files[`wideo/${v.conceptId}/napisy.srt`] = strToU8(scenesToSrt(v.scenes));
    files[`wideo/${v.conceptId}/teleprompter.txt`] = strToU8(teleprompterScript(v));
    for (const variant of v.variants) {
      const rid = ((variant.edit ?? {}) as { renderAssetId?: string }).renderAssetId;
      const m = rid ? await prisma.mediaAsset.findUnique({ where: { id: rid } }) : null;
      if (!m) continue;
      const f = await toLocalFile(m.storageKey);
      try {
        files[`wideo/${v.conceptId}/${m.originalName ?? `${variant.assetKey}.mp4`}`] = new Uint8Array(await fsp.readFile(f.path));
      } finally {
        await f.cleanup();
      }
    }
  }
  if (vids.length) {
    files["wideo/shotlista.csv"] = strToU8(shotlistCsv(vids));
    files["wideo/shotlista.md"] = strToU8(shotlistMarkdown(vids));
  }
  if (whole && want("landing") && assets.some((a) => a.rowType === "landing_page")) for (const [k, v] of Object.entries(await landingZipFiles(projectId))) files[k] = strToU8(v);
  else if (whole && want("landing")) {
    for (const c of campaigns.length ? campaigns : [null]) {
      const plan = landingPlan({ projectName: project.name, campaign: c, assets: list, photos: photos.map((p) => ({ id: p.id, key: p.key, name: p.name, role: p.role ?? null, consentConfirmed: !!p.consentConfirmed })) });
      files[`landing_page/${c?.code ?? "projekt"}.md`] = strToU8(landingMarkdown(plan, project.name, c?.name ?? null));
    }
  }
  if (whole && want("report")) files["brief.md"] = strToU8(project.adwordsBrief ?? defaultBrief(project, { campaigns, assets: list, evaluation: ev, history: (await prisma.adwordsHistoryRow.findMany({ where: { projectId } })) }));
  const label = whole ? (sel.parts?.length ? `_${sel.parts.join("-")}` : "") : sel.experimentId ? `_${sel.experimentId}${sel.variant ? `_${sel.variant}` : ""}` : sel.conceptIds?.length === 1 ? `_${sel.conceptIds[0]}` : "_wybor";
  return { zip: Buffer.from(zipSync(files, { level: 6 })), name: `${slug}_google_adwords${label}_${fmt}.zip`, count: rendered.length };
}

export async function photoUrl(assetId: string) {
  const a = await prisma.mediaAsset.findUnique({ where: { id: assetId } });
  return a ? signedUrl(a.storageKey, { ttlSec: 6 * 3600 }) : null;
}
