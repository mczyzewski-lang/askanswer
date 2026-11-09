/**
 * Google Adwords CSV: the concepts, scenes and texts of a PMax set in one file (`;` or `,`, UTF-8 with
 * or without BOM, quoted fields with `;` and line breaks). `asset_id` is the upsert key: importing the
 * same file twice changes nothing. Columns the module does not know are kept and exported back.
 */
import Papa from "papaparse";

export const ADWORDS_COLUMNS = [
  "schema_version",
  "row_type",
  "project_slug",
  "funnel",
  "campaign_code",
  "asset_group",
  "concept_id",
  "asset_id",
  "aspect_ratio",
  "width",
  "height",
  "duration_sec",
  "scene_index",
  "start_s",
  "end_s",
  "headline",
  "subheadline",
  "body",
  "cta",
  "ad_text",
  "spoken_text",
  "screen_text",
  "visual_brief",
  "expert_photo_key",
  "landing_url",
  "claim_source",
  "approval_required",
  "status",
  "score_seed",
  "score_note",
] as const;
/** schema_version 2: experiments (optional — a v1 file has none of them) */
export const ADWORDS_V2_COLUMNS = ["experiment_id", "variant", "paired_asset_id", "test_axis", "test_stage", "deploy_mode", "evidence_note"] as const;
/** schema_version 5: landing page content + the offer / proof fields of each ad (optional) */
export const ADWORDS_V5_COLUMNS = ["record_scope", "landing_variant_id", "test_priority"] as const;
/** v5 fields stored together (by column name) in `lp` */
export const LP_FIELDS = [
  "landing_section",
  "landing_order",
  "landing_eyebrow",
  "landing_h1",
  "landing_h2",
  "landing_bullets",
  "landing_primary_cta",
  "landing_secondary_cta",
  "landing_microcopy",
  "landing_visual_direction",
  "landing_target_step",
  "landing_event",
  "cta_extended_user_proposal",
  "cta_extended_safe",
  "cta_button_short",
  "offer_core",
  "message_match_angle",
  "proof_claim",
  "proof_source_required",
  "proof_status",
  "proof_scope",
  "experiment_note",
  "page_implementation_note",
  "user_visible_copy",
  "sitelink_description_1",
  "sitelink_description_2",
  "landing_social_proof",
] as const;
export type LpField = (typeof LP_FIELDS)[number];
/** v5 data by column name: the known fields + every other column of a v5 group (video_*, historical_*, comparison_*…) */
export type LpData = Partial<Record<LpField, string>> & Record<string, string | undefined>;

/**
 * CSV v5 groups: columns recognised by their NAME (never their position). A column of a group that the
 * module has no typed field for is still stored (in `lp`) and exported back — nothing is dropped.
 */
export const V5_GROUPS: Array<{ key: string; label: string; re: RegExp }> = [
  { key: "landing", label: "Treść landing page", re: /^landing_/ },
  { key: "cta", label: "CTA i oferta", re: /^(cta_|offer_)/ },
  { key: "proof", label: "Dowody / social proof", re: /^(proof_|social_proof)/ },
  { key: "match", label: "Message match", re: /^message_match/ },
  { key: "video", label: "Skrypt wideo (hook, wypowiedzi, napisy)", re: /^video_/ },
  { key: "comparison", label: "Grafiki porównawcze A/B", re: /^comparison_/ },
  { key: "sitelink", label: "Sitelinki", re: /^sitelink_/ },
  { key: "historical", label: "Dane historyczne", re: /^historical_/ },
  { key: "test", label: "Testy i priorytety", re: /^(test_|experiment_|priority)/ },
  { key: "score", label: "Scoring", re: /^score_/ },
  { key: "page", label: "Wdrożenie / układ", re: /^(page_|user_visible|implementation_|layout_id$|angle$)/ },
];
export const groupOf = (col: string) => V5_GROUPS.find((g) => g.re.test(col))?.key ?? null;
const colKey = (h: string) => h.trim().toLowerCase().replace(/\s+/g, "_");
export const ALL_COLUMNS = [...ADWORDS_COLUMNS, ...ADWORDS_V2_COLUMNS, ...ADWORDS_V5_COLUMNS, ...LP_FIELDS] as const;
export type AdwordsColumn = (typeof ALL_COLUMNS)[number];

export const ROW_TYPES = ["image", "image_clean", "video", "video_scene", "headline", "long_headline", "description", "sitelink", "experiment_plan", "historical_reference", "landing_page"] as const;
/** metadata of tests, the archive and the landing page content — never rendered as images nor exported to Google Ads */
export const META_ROW_TYPES = ["experiment_plan", "historical_reference", "landing_page"] as const;
export const isMetaRow = (t: string) => (META_ROW_TYPES as readonly string[]).includes(t);
export type RowType = (typeof ROW_TYPES)[number];
export const ROW_TYPE_LABEL: Record<RowType, string> = {
  image: "grafika",
  image_clean: "czyste zdjęcie",
  video: "wideo (wariant)",
  video_scene: "scena wideo",
  headline: "krótki nagłówek",
  long_headline: "długi nagłówek",
  description: "opis",
  sitelink: "link do podstrony (sitelink)",
  landing_page: "treść landing page",
  experiment_plan: "plan eksperymentu",
  historical_reference: "archiwum (historyczne)",
};

/** a header as typed by a person → the column name ("Asset ID" → asset_id, "Typ" → row_type) */
const SYNONYMS: Record<string, AdwordsColumn> = {
  typ: "row_type",
  type: "row_type",
  rowtype: "row_type",
  project: "project_slug",
  projekt: "project_slug",
  lejek: "funnel",
  kampania: "campaign_code",
  campaign: "campaign_code",
  grupa: "asset_group",
  assetgroup: "asset_group",
  koncept: "concept_id",
  concept: "concept_id",
  id: "asset_id",
  assetid: "asset_id",
  proporcje: "aspect_ratio",
  ratio: "aspect_ratio",
  szerokosc: "width",
  wysokosc: "height",
  czas: "duration_sec",
  duration: "duration_sec",
  scena: "scene_index",
  start: "start_s",
  koniec: "end_s",
  end: "end_s",
  naglowek: "headline",
  podtytul: "subheadline",
  tresc: "body",
  tekst: "ad_text",
  lektor: "spoken_text",
  napis: "screen_text",
  kadr: "visual_brief",
  ekspert: "expert_photo_key",
  url: "landing_url",
  landing: "landing_url",
  zrodlo: "claim_source",
  zatwierdzenie: "approval_required",
  ocena: "score_seed",
  priority: "test_priority",
  priorytet: "test_priority",
  testpriority: "test_priority",
  scope: "record_scope",
  lpvariant: "landing_variant_id",
  landingvariant: "landing_variant_id",
  sitelinkdescription1: "sitelink_description_1",
  sitelinkdescription2: "sitelink_description_2",
  sitelinkdesc1: "sitelink_description_1",
  sitelinkdesc2: "sitelink_description_2",
};

const FOLD: Record<string, string> = { ą: "a", ć: "c", ę: "e", ł: "l", ń: "n", ó: "o", ś: "s", ź: "z", ż: "z" };
const norm = (h: string) =>
  h
    .trim()
    .toLowerCase()
    .replace(/[ąćęłńóśźż]/g, (c) => FOLD[c])
    .replace(/[^a-z0-9]/g, "");

/** Automatic mapping: CSV header → module column (null = kept as an extra column). */
export function autoMapping(headers: string[]): Record<string, AdwordsColumn | null> {
  const out: Record<string, AdwordsColumn | null> = {};
  const taken = new Set<string>();
  for (const h of headers) {
    const n = norm(h);
    const direct = ALL_COLUMNS.find((c) => norm(c) === n);
    const col = direct ?? SYNONYMS[n] ?? null;
    out[h] = col && !taken.has(col) ? col : null;
    if (col) taken.add(col);
  }
  return out;
}

export interface CsvIssue {
  /** record number as in a spreadsheet (header = 1) */
  row: number;
  column?: string;
  message: string;
  level: "error" | "warning";
}

export interface ParsedAsset {
  row: number;
  assetKey: string;
  rowType: RowType;
  projectSlug: string | null;
  data: {
    funnel: string | null;
    campaignCode: string | null;
    assetGroup: string | null;
    conceptId: string | null;
    aspectRatio: string | null;
    width: number | null;
    height: number | null;
    durationSec: number | null;
    sceneIndex: number | null;
    startS: number | null;
    endS: number | null;
    headline: string | null;
    subheadline: string | null;
    body: string | null;
    cta: string | null;
    adText: string | null;
    spokenText: string | null;
    screenText: string | null;
    visualBrief: string | null;
    expertPhotoKey: string | null;
    landingUrl: string | null;
    claimSource: string | null;
    approvalRequired: boolean;
    status: string | null;
    scoreSeed: number | null;
    scoreNote: string | null;
    experimentId: string | null;
    variant: string | null;
    pairedAssetId: string | null;
    testAxis: string | null;
    testStage: string | null;
    deployMode: string | null;
    evidenceNote: string | null;
    recordScope: string | null;
    landingVariantId: string | null;
    /** v5: priority of the test / component (1 = first) */
    testPriority: number | null;
    /** v5 landing / offer / proof fields (only the filled ones), null when none */
    lp: LpData | null;
  };
  /** columns not mapped to the module (kept for the export), plus schema_version */
  extra: Record<string, string>;
}

export interface ParseResult {
  delimiter: string;
  headers: string[];
  mapping: Record<string, AdwordsColumn | null>;
  /** the first records as read (for the preview) */
  preview: Array<Record<string, string>>;
  assets: ParsedAsset[];
  issues: CsvIssue[];
  counts: Record<RowType, number>;
  /** v5: Google ad assets vs landing page content records */
  scopes: { adAssets: number; landingContent: number };
  /** v1 / v2 / v5 — from schema_version or the columns used */
  schema: "v1" | "v2" | "v5";
  /** how every header was understood: a module column, a v5 group, or kept as is */
  columns: { core: string[]; groups: Record<string, string[]>; unknown: string[] };
  /** fields a record of its kind should have but does not (by kind and field) */
  missing: Array<{ rowType: string; field: string; level: "error" | "warning"; rows: number[] }>;
}

const truthy = (v: string) => /^(true|1|tak|yes|y|t|x)$/i.test(v.trim());

/**
 * Read the file. `mapping` (from the column-mapping step) overrides the automatic one; a header mapped
 * to null is kept as an extra column. Errors carry the record number.
 */
export function parseAdwordsCsv(text: string, mapping?: Record<string, AdwordsColumn | null>): ParseResult {
  const clean = text.replace(/^﻿/, "");
  const first = clean.slice(0, clean.indexOf("\n") >= 0 ? clean.indexOf("\n") : clean.length);
  const delimiter = (first.match(/;/g)?.length ?? 0) >= (first.match(/,/g)?.length ?? 0) ? ";" : ",";
  const res = Papa.parse<Record<string, string>>(clean, { header: true, delimiter, skipEmptyLines: "greedy" });
  const headers = (res.meta.fields ?? []).map((h) => h.trim());
  const map = { ...autoMapping(headers), ...(mapping ?? {}) };
  const issues: CsvIssue[] = [];
  for (const e of res.errors) issues.push({ row: (e.row ?? 0) + 2, message: `Błąd składni CSV: ${e.message}`, level: "error" });
  const reverse = new Map<AdwordsColumn, string>();
  for (const [h, c] of Object.entries(map)) if (c) reverse.set(c, h);
  for (const need of ["row_type", "asset_id"] as const) if (!reverse.has(need)) issues.push({ row: 1, column: need, message: `Brak kolumny ${need} — przypisz ją w mapowaniu kolumn.`, level: "error" });

  const counts = Object.fromEntries(ROW_TYPES.map((t) => [t, 0])) as Record<RowType, number>;
  const assets: ParsedAsset[] = [];
  const seen = new Map<string, number>();
  res.data.forEach((raw, i) => {
    const row = i + 2;
    const rec: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) rec[k.trim()] = String(v ?? "").replace(/\r/g, "");
    const get = (c: AdwordsColumn) => {
      const h = reverse.get(c);
      return h ? (rec[h] ?? "").trim() : "";
    };
    const str = (c: AdwordsColumn) => get(c) || null;
    const num = (c: AdwordsColumn, opts: { int?: boolean; min?: number; max?: number } = {}) => {
      const v = get(c);
      if (!v) return null;
      const n = Number(v.replace(",", "."));
      if (!Number.isFinite(n) || (opts.int && !Number.isInteger(n)) || (opts.min != null && n < opts.min) || (opts.max != null && n > opts.max)) {
        issues.push({ row, column: c, message: `„${v}” to nie jest poprawna liczba${opts.min != null && opts.max != null ? ` (${opts.min}–${opts.max})` : ""}.`, level: "error" });
        return null;
      }
      return n;
    };
    const type = get("row_type").toLowerCase() as RowType;
    const key = get("asset_id");
    if (!ROW_TYPES.includes(type)) {
      issues.push({ row, column: "row_type", message: `Nieznany row_type „${get("row_type")}” (dozwolone: ${ROW_TYPES.join(", ")}).`, level: "error" });
      return;
    }
    if (!key) {
      issues.push({ row, column: "asset_id", message: "Brak asset_id — to klucz, po którym rekord jest aktualizowany.", level: "error" });
      return;
    }
    if (seen.has(key)) {
      issues.push({ row, column: "asset_id", message: `asset_id „${key}” powtarza się (pierwszy raz w wierszu ${seen.get(key)}).`, level: "error" });
      return;
    }
    seen.set(key, row);
    const data: ParsedAsset["data"] = {
      funnel: str("funnel"),
      campaignCode: str("campaign_code"),
      assetGroup: str("asset_group"),
      conceptId: str("concept_id"),
      aspectRatio: str("aspect_ratio"),
      width: num("width", { int: true, min: 1, max: 10000 }),
      height: num("height", { int: true, min: 1, max: 10000 }),
      durationSec: num("duration_sec", { min: 0, max: 3600 }),
      sceneIndex: num("scene_index", { int: true, min: 0, max: 999 }),
      startS: num("start_s", { min: 0, max: 3600 }),
      endS: num("end_s", { min: 0, max: 3600 }),
      headline: str("headline"),
      subheadline: str("subheadline"),
      body: str("body"),
      cta: str("cta"),
      adText: str("ad_text"),
      spokenText: str("spoken_text"),
      screenText: str("screen_text"),
      visualBrief: str("visual_brief"),
      expertPhotoKey: str("expert_photo_key"),
      landingUrl: str("landing_url"),
      claimSource: str("claim_source"),
      approvalRequired: truthy(get("approval_required")),
      status: str("status"),
      scoreSeed: num("score_seed", { min: 0, max: 100 }),
      scoreNote: str("score_note"),
      experimentId: str("experiment_id"),
      variant: str("variant")?.toUpperCase() ?? null,
      pairedAssetId: str("paired_asset_id"),
      testAxis: str("test_axis"),
      testStage: str("test_stage"),
      deployMode: str("deploy_mode")?.toLowerCase() ?? null,
      evidenceNote: str("evidence_note"),
      recordScope: str("record_scope")?.toLowerCase() ?? (type === "landing_page" ? "landing_content" : null),
      landingVariantId: str("landing_variant_id")?.toUpperCase() ?? null,
      testPriority: num("test_priority", { int: true, min: 0, max: 999 }),
      lp: null,
    };
    const lp: LpData = {};
    for (const f of LP_FIELDS) if (get(f)) lp[f] = get(f);
    // every other column of a v5 group, by name
    for (const h of headers) if (!map[h] && groupOf(colKey(h)) && rec[h]?.trim()) lp[colKey(h)] = rec[h].trim();
    data.lp = Object.keys(lp).length ? lp : null;
    // v5 scope: landing content is never a Google asset (and vice versa)
    if (data.recordScope && !/^(ad_asset|landing_content)$/.test(data.recordScope)) issues.push({ row, column: "record_scope", message: `record_scope „${data.recordScope}” — oczekiwane ad_asset albo landing_content.`, level: "error" });
    if (type === "landing_page" && data.recordScope !== "landing_content") issues.push({ row, column: "record_scope", message: "Wiersz landing_page musi mieć record_scope=landing_content (to nie jest asset Google).", level: "error" });
    if (type !== "landing_page" && data.recordScope === "landing_content") issues.push({ row, column: "record_scope", message: `record_scope=landing_content tylko dla row_type=landing_page (jest „${type}”).`, level: "error" });
    if (type === "landing_page") {
      if (!data.landingVariantId) issues.push({ row, column: "landing_variant_id", message: "Blok landing page bez landing_variant_id (np. LP_A_PLAN).", level: "error" });
      if (!lp.landing_section) issues.push({ row, column: "landing_section", message: "Blok landing page bez landing_section (hero, faq…).", level: "error" });
      if (lp.landing_order && !/^\d+$/.test(lp.landing_order)) issues.push({ row, column: "landing_order", message: `landing_order „${lp.landing_order}” — oczekiwana liczba całkowita.`, level: "error" });
    }
    if (type === "sitelink" && !data.adText) issues.push({ row, column: "ad_text", message: "Sitelink bez tekstu linku (ad_text).", level: "error" });
    // what each kind of row needs
    if ((type === "image" || type === "image_clean" || type === "video" || type === "video_scene") && !data.conceptId) issues.push({ row, column: "concept_id", message: "Brak concept_id — wiersz nie zostanie połączony z konceptem.", level: "error" });
    if ((type === "headline" || type === "long_headline" || type === "description") && !data.adText) issues.push({ row, column: "ad_text", message: "Brak treści w ad_text.", level: "error" });
    if (type === "video_scene" && data.sceneIndex == null) issues.push({ row, column: "scene_index", message: "Scena bez scene_index.", level: "error" });
    if (type === "video_scene" && data.startS != null && data.endS != null && data.endS <= data.startS) issues.push({ row, column: "end_s", message: "end_s musi być większe od start_s.", level: "error" });
    if (data.experimentId && data.variant && !/^[AB]$/.test(data.variant) && type !== "experiment_plan" && type !== "historical_reference") issues.push({ row, column: "variant", message: `variant „${data.variant}” — oczekiwane A lub B.`, level: "error" });
    if (data.deployMode && !/^(exploration|controlled)$/.test(data.deployMode)) issues.push({ row, column: "deploy_mode", message: `deploy_mode „${data.deployMode}” — oczekiwane exploration albo controlled.`, level: "warning" });
    if ((type === "image" || type === "video") && !data.aspectRatio && !(data.width && data.height)) issues.push({ row, column: "aspect_ratio", message: "Brak proporcji (aspect_ratio albo width/height).", level: "warning" });
    if (data.landingUrl && !/^https?:\/\//i.test(data.landingUrl)) issues.push({ row, column: "landing_url", message: "landing_url powinien zaczynać się od https://", level: "warning" });
    const extra: Record<string, string> = {};
    for (const h of headers) if (!map[h] && !groupOf(colKey(h)) && rec[h]) extra[h] = rec[h];
    const sv = get("schema_version");
    if (sv) extra.schema_version = sv;
    counts[type]++;
    assets.push({ row, assetKey: key, rowType: type, projectSlug: str("project_slug"), data, extra });
  });
  // a pair must point to a record of the file (or one already imported)
  const keys = new Set(assets.map((a) => a.assetKey));
  for (const a of assets) if (a.data.pairedAssetId && !keys.has(a.data.pairedAssetId)) issues.push({ row: a.row, column: "paired_asset_id", message: `paired_asset_id „${a.data.pairedAssetId}” nie występuje w pliku.`, level: "warning" });
  const landingContent = assets.filter((a) => a.data.recordScope === "landing_content").length;
  const adAssets = assets.filter((a) => a.data.recordScope === "ad_asset" || (!a.data.recordScope && !isMetaRow(a.rowType) && a.rowType !== "video_scene")).length;
  // how the headers were understood
  const groups: Record<string, string[]> = {};
  const core: string[] = [];
  const unknown: string[] = [];
  for (const h of headers) {
    const c = map[h];
    const g = groupOf(c ?? colKey(h));
    if (g && (!c || (LP_FIELDS as readonly string[]).includes(c))) (groups[g] ??= []).push(h);
    else if (c) core.push(h);
    else unknown.push(h);
  }
  const sv = assets.map((a) => a.extra.schema_version).find(Boolean);
  const schema: ParseResult["schema"] = sv === "5" || Object.keys(groups).length || reverse.has("record_scope") ? "v5" : sv === "2" || ADWORDS_V2_COLUMNS.some((c) => reverse.has(c)) ? "v2" : "v1";
  return { delimiter, headers, mapping: map, preview: res.data.slice(0, 10), assets, issues, counts, scopes: { adAssets, landingContent }, schema, columns: { core, groups, unknown }, missing: missingFields(assets) };
}

/** the file's headers as the module names them (a synonym → its column, a v5 group column → its key, anything else as written) */
export const canonicalHeaders = (r: Pick<ParseResult, "headers" | "mapping">) => r.headers.map((h) => r.mapping[h] ?? (groupOf(colKey(h)) ? colKey(h) : h));

/** what each kind of record should carry — reported per field with the record numbers */
export function missingFields(assets: ParsedAsset[]): ParseResult["missing"] {
  const out = new Map<string, { rowType: string; field: string; level: "error" | "warning"; rows: number[] }>();
  const miss = (a: ParsedAsset, field: string, level: "error" | "warning" = "warning") => {
    const k = `${a.rowType}|${field}`;
    const e = out.get(k) ?? { rowType: a.rowType, field, level, rows: [] };
    e.rows.push(a.row);
    out.set(k, e);
  };
  const scenes = new Set(assets.filter((a) => a.rowType === "video_scene").map((a) => a.data.conceptId));
  for (const a of assets) {
    const d = a.data;
    const lp = d.lp ?? {};
    if (a.rowType === "image") {
      if (!d.headline) miss(a, "headline");
      if (!d.cta) miss(a, "cta");
      if (!d.landingUrl) miss(a, "landing_url");
      if ((lp.layout_id === "comparison" || lp.comparison_left || lp.comparison_right) && !(lp.comparison_left && lp.comparison_right)) miss(a, "comparison_left / comparison_right");
    }
    if (a.rowType === "video") {
      if (d.durationSec == null) miss(a, "duration_sec");
      if (!scenes.has(d.conceptId) && !Object.keys(lp).some((k) => /^video_(hook|spoken)_\d+_\d+$/.test(k))) miss(a, "video_hook_* / video_spoken_* albo wiersze video_scene");
    }
    if (a.rowType === "sitelink") {
      if (!lp.sitelink_description_1 || !lp.sitelink_description_2) miss(a, "sitelink_description_1/2");
      if (!d.landingUrl) miss(a, "landing_url");
    }
    if (a.rowType === "landing_page") {
      if (!lp.landing_order) miss(a, "landing_order");
      if (lp.landing_section === "hero" && !lp.landing_h1) miss(a, "landing_h1", "error");
      if (lp.landing_section === "hero" && !lp.landing_primary_cta) miss(a, "landing_primary_cta");
    }
    if ((a.rowType === "image" || a.rowType === "video" || a.rowType === "headline" || a.rowType === "long_headline" || a.rowType === "description") && d.recordScope && !d.landingVariantId && !lp.landing_target_step) miss(a, "landing_variant_id");
  }
  return [...out.values()];
}

/** the stored record, as written back to the CSV */
export interface ExportableAsset extends Partial<Omit<ParsedAsset["data"], "approvalRequired" | "lp">> {
  lp?: LpData | null;
  assetKey: string;
  rowType: string;
  approvalRequired?: boolean | null;
  extra?: Record<string, string> | null;
}

const COL_OF: Record<AdwordsColumn, keyof ExportableAsset | null> = {
  schema_version: null,
  row_type: "rowType",
  project_slug: null,
  funnel: "funnel",
  campaign_code: "campaignCode",
  asset_group: "assetGroup",
  concept_id: "conceptId",
  asset_id: "assetKey",
  aspect_ratio: "aspectRatio",
  width: "width",
  height: "height",
  duration_sec: "durationSec",
  scene_index: "sceneIndex",
  start_s: "startS",
  end_s: "endS",
  headline: "headline",
  subheadline: "subheadline",
  body: "body",
  cta: "cta",
  ad_text: "adText",
  spoken_text: "spokenText",
  screen_text: "screenText",
  visual_brief: "visualBrief",
  expert_photo_key: "expertPhotoKey",
  landing_url: "landingUrl",
  claim_source: "claimSource",
  approval_required: "approvalRequired",
  status: "status",
  score_seed: "scoreSeed",
  score_note: "scoreNote",
  experiment_id: "experimentId",
  variant: "variant",
  paired_asset_id: "pairedAssetId",
  test_axis: "testAxis",
  test_stage: "testStage",
  deploy_mode: "deployMode",
  evidence_note: "evidenceNote",
  record_scope: "recordScope",
  landing_variant_id: "landingVariantId",
  test_priority: "testPriority",
  ...(Object.fromEntries(LP_FIELDS.map((f) => [f, null])) as Record<LpField, null>),
};

/** The module's records as a CSV (`;`, UTF-8 with BOM for Excel) — the same columns as the import, extra columns appended. */
export function exportAdwordsCsv(input: ExportableAsset[], projectSlug: string, schemaVersion = "1", columnOrder?: string[] | null): string {
  const assets = collapseDerivedScenes(input);
  // v2 columns only when the records use them (a v1 set exports exactly as v1)
  const v2 = assets.some((a) => ADWORDS_V2_COLUMNS.some((c) => a[COL_OF[c] as keyof ExportableAsset] != null && a[COL_OF[c] as keyof ExportableAsset] !== ""));
  const v5 = assets.some((a) => a.recordScope || a.landingVariantId || a.testPriority != null || (a.lp && Object.keys(a.lp).some((k) => !k.startsWith("_"))));
  const lpKeys = [...new Set(assets.flatMap((a) => Object.keys(a.lp ?? {}).filter((k) => !k.startsWith("_"))))];
  const usedLp = [...LP_FIELDS.filter((f) => lpKeys.includes(f)), ...lpKeys.filter((k) => !(LP_FIELDS as readonly string[]).includes(k)).sort()];
  let cols = [...ADWORDS_COLUMNS, ...(v2 ? ADWORDS_V2_COLUMNS : []), ...(v5 ? [...ADWORDS_V5_COLUMNS, ...usedLp] : [])] as AdwordsColumn[];
  let extraCols = [...new Set(assets.flatMap((a) => Object.keys(a.extra ?? {}).filter((k) => k !== "schema_version" && k !== "derived_from")))];
  // the column order of the imported file first (an agency's sheet stays as it was), then the rest
  if (columnOrder?.length) {
    // the file's columns in its order — every one stays, even an empty one — then anything new
    const fields: string[] = [];
    for (const c of [...columnOrder, ...cols, ...extraCols]) if (!fields.includes(c)) fields.push(c);
    const rows = buildRows(assets, fields.filter((c) => !extraCols.includes(c)), extraCols, projectSlug, v2, v5, schemaVersion);
    return "\uFEFF" + Papa.unparse({ fields, data: rows.map((r) => fields.map((c) => r[c] ?? "")) }, { delimiter: ";", newline: "\r\n", quotes: false });
  }
  const rows = buildRows(assets, cols, extraCols, projectSlug, v2, v5, schemaVersion);
  return "\uFEFF" + Papa.unparse({ fields: [...cols, ...extraCols], data: rows.map((r) => [...cols, ...extraCols].map((c) => r[c])) }, { delimiter: ";", newline: "\r\n", quotes: false });
}

function buildRows(assets: ExportableAsset[], cols: string[], extraCols: string[], projectSlug: string, v2: boolean, v5: boolean, schemaVersion: string) {
  return assets.map((a) => {
    const r: Record<string, string> = {};
    for (const c of cols) {
      const k = COL_OF[c as AdwordsColumn];
      if (c === "schema_version") r[c] = a.extra?.schema_version ?? (v5 ? "5" : v2 ? "2" : schemaVersion);
      else if (!(c in COL_OF) || (LP_FIELDS as readonly string[]).includes(c)) r[c] = a.lp?.[c] ?? "";
      else if (c === "project_slug") r[c] = projectSlug;
      else if (c === "approval_required") r[c] = a.approvalRequired ? "true" : "false";
      else {
        const v = k ? a[k] : null;
        r[c] = v == null ? "" : String(v);
      }
    }
    for (const c of extraCols) r[c] = a.extra?.[c] ?? "";
    return r;
  });
}

const SEG = /^video_(hook|spoken|screen|visual)_(\d+)_(\d+)$/;
/**
 * Scenes derived from a video row's script columns (CSV v3–v5) are edited as scenes, but exported back
 * into the script columns of the video rows they came from — the file keeps its v5 shape.
 */
export function collapseDerivedScenes(assets: ExportableAsset[]): ExportableAsset[] {
  const derived = assets.filter((a) => a.rowType === "video_scene" && a.extra?.derived_from);
  if (!derived.length) return assets;
  const byConcept = new Map<string, ExportableAsset[]>();
  for (const s of derived) byConcept.set(s.conceptId ?? "", [...(byConcept.get(s.conceptId ?? "") ?? []), s]);
  const scriptOf = (lp: LpData | null | undefined) => JSON.stringify(Object.entries(lp ?? {}).filter(([k]) => SEG.test(k)).sort(([x], [y]) => x.localeCompare(y)));
  const out: ExportableAsset[] = [];
  for (const a of assets) {
    if (a.rowType === "video_scene" && a.extra?.derived_from) continue;
    const scenes = a.rowType === "video" ? byConcept.get(a.conceptId ?? "") : undefined;
    const source = scenes ? assets.find((x) => x.assetKey === scenes[0].extra!.derived_from) : undefined;
    if (!scenes || !source || scriptOf(a.lp) !== scriptOf(source.lp)) {
      out.push(a);
      continue;
    }
    const lp: LpData = Object.fromEntries(Object.entries(a.lp ?? {}).filter(([k]) => !SEG.test(k)));
    const had = (kind: string, seg: string) => !!source.lp?.[`video_${kind}_${seg}`];
    for (const sc of [...scenes].sort((x, y) => (x.startS ?? 0) - (y.startS ?? 0))) {
      const seg = `${sc.startS ?? 0}_${sc.endS ?? 0}`;
      const spoken = sc.spokenText ?? "";
      const screen = sc.screenText ?? "";
      if (had("hook", seg) || (!had("spoken", seg) && (sc.startS ?? 0) === 0)) {
        lp[`video_hook_${seg}`] = spoken || screen;
        if (screen && (screen !== (spoken || screen) || had("screen", seg))) lp[`video_screen_${seg}`] = screen;
      } else {
        if (spoken) lp[`video_spoken_${seg}`] = spoken;
        if (screen && (screen !== spoken || had("screen", seg))) lp[`video_screen_${seg}`] = screen;
      }
      if (sc.visualBrief && (had("visual", seg) || sc.visualBrief !== source.visualBrief)) lp[`video_visual_${seg}`] = sc.visualBrief;
    }
    out.push({ ...a, lp });
  }
  return out;
}

/** CSV v5 — the full header (99 columns, in the order of the Nowy Etap v5 file) */
export const TEMPLATE_V5_COLUMNS = ["schema_version", "record_scope", "row_type", "project_slug", "funnel", "campaign_code", "asset_group", "concept_id", "asset_id", "aspect_ratio", "width", "height", "duration_sec", "headline", "subheadline", "body", "cta", "ad_text", "visual_brief", "expert_photo_key", "landing_url", "claim_source", "approval_required", "status", "score_seed", "score_note", "experiment_id", "variant", "paired_asset_id", "test_axis", "test_stage", "deploy_mode", "evidence_note", "test_priority", "test_hypothesis", "test_kpi", "test_min_weeks", "landing_variant_id", "layout_id", "comparison_title", "comparison_left_label", "comparison_left", "comparison_right_label", "comparison_right", "scene_index", "start_s", "end_s", "spoken_text", "screen_text", "video_hook_0_3", "video_spoken_3_9", "video_spoken_9_19", "video_spoken_19_27", "video_screen_0_3", "video_screen_3_9", "video_screen_9_19", "video_screen_19_27", "video_visual_0_3", "video_visual_3_9", "video_visual_9_19", "video_visual_19_27", "landing_section", "landing_order", "landing_eyebrow", "landing_h1", "landing_h2", "landing_bullets", "landing_social_proof", "landing_primary_cta", "landing_secondary_cta", "landing_microcopy", "landing_visual_direction", "landing_target_step", "landing_event", "cta_extended_user_proposal", "cta_extended_safe", "cta_button_short", "offer_core", "message_match_angle", "proof_claim", "proof_source_required", "proof_status", "proof_scope", "experiment_note", "page_implementation_note", "user_visible_copy", "sitelink_description_1", "sitelink_description_2", "historical_note", "historical_impressions", "historical_clicks", "historical_ctr", "historical_conversions", "historical_cost", "historical_period", "historical_source", "historical_asset_label", "score_clarity", "score_offer"];

/** A template: the header and one example of each row type — v5 (all columns, default) or the old v1 (30 columns). */
export function adwordsCsvTemplate(projectSlug = "moj-projekt", version: "v1" | "v5" = "v5"): string {
  if (version === "v1") return adwordsCsvTemplateV1(projectSlug);
  const base = { funnel: "sprzedaz", campaignCode: "PMAX-PLAN", assetGroup: "AG1", recordScope: "ad_asset", landingUrl: "https://twoja-domena.pl/plan/" };
  const ex: ExportableAsset[] = [
    { ...base, assetKey: "G01-L", rowType: "image", conceptId: "G01", aspectRatio: "1.91:1", width: 1200, height: 628, headline: "Rozwód bez walki w sądzie", subheadline: "Najpierw plan, potem pozew", body: "Plan i koszt naszej usługi przed decyzją", cta: "Odbierz bezpłatny plan", experimentId: "T01", variant: "A", pairedAssetId: "G02-L", testAxis: "hook", landingVariantId: "LP_A_PLAN", testPriority: 1, scoreSeed: 80, lp: { layout_id: "typographic", message_match_angle: "bez_walki", cta_button_short: "Odbierz bezpłatny plan", test_hypothesis: "konkretne hasło > ogólne", test_kpi: "CPL kwalifikowany", test_min_weeks: "4", historical_impressions: "920583", historical_clicks: "122016", historical_source: "raport komponentów Google Ads", score_clarity: "78" } },
    { ...base, assetKey: "G07-L", rowType: "image", conceptId: "G07", aspectRatio: "1.91:1", width: 1200, height: 628, headline: "Tradycyjnie czy z planem?", cta: "Odbierz bezpłatny plan", landingVariantId: "LP_A_PLAN", lp: { layout_id: "comparison", comparison_title: "Tradycyjnie vs z planem", comparison_left_label: "Tradycyjnie", comparison_left: "Najpierw pozew, potem spór", comparison_right_label: "Z planem", comparison_right: "Najpierw plan, potem pozew" } },
    { ...base, assetKey: "V01-916", rowType: "video", conceptId: "V01", aspectRatio: "9:16", width: 1080, height: 1920, durationSec: 27, headline: "Rozwód bez walki w sądzie?", cta: "Poznaj koszt i odbierz bezpłatny plan", landingVariantId: "LP_A_PLAN", lp: { video_hook_0_3: "Rozwód bez walki w sądzie?", video_spoken_3_9: "Najpierw siadamy do planu.", video_spoken_9_19: "Potem dokumenty i pozew.", video_spoken_19_27: "Odbierz bezpłatny Plan Rozwodu.", video_screen_0_3: "Bez walki w sądzie?", video_visual_0_3: "ekspert do kamery" } },
    { ...base, assetKey: "H01", rowType: "headline", adText: "Plan Rozwodu", landingVariantId: "LP_A_PLAN" },
    { ...base, assetKey: "LH01", rowType: "long_headline", adText: "Najpierw plan i ustalenia. Dopiero potem pozew o rozwód.", landingVariantId: "LP_A_PLAN" },
    { ...base, assetKey: "D01", rowType: "description", adText: "Plan Rozwodu: ustalenia, kolejne kroki i koszt naszej usługi.", landingVariantId: "LP_A_PLAN" },
    { ...base, assetKey: "S01", rowType: "sitelink", adText: "Jak działa mediacja", lp: { sitelink_description_1: "Spokojne ustalenia", sitelink_description_2: "Najpierw plan, potem pozew", historical_ctr: "8%", historical_note: "wynik dotyczy całej reklamy" } },
    { ...base, recordScope: "landing_content", landingUrl: null, assetKey: "LP_A_PLAN-hero", rowType: "landing_page", landingVariantId: "LP_A_PLAN", lp: { landing_section: "hero", landing_order: "10", landing_eyebrow: "Bezpłatny Plan Rozwodu", landing_h1: "Rozwód bez walki w sądzie? Najpierw plan, potem pozew.", landing_h2: "Poznaj ustalenia, kroki i koszt naszej usługi przed decyzją.", landing_social_proof: "Opinie klientów w Google", landing_primary_cta: "Poznaj koszt i odbierz bezpłatny plan", landing_event: "lp_hero_cta_click", proof_status: "needs_verification" } },
    { ...base, recordScope: null, landingUrl: null, assetKey: "T01-PLAN", rowType: "experiment_plan", experimentId: "T01", testAxis: "hook", deployMode: "controlled", headline: "Bez walki w sądzie vs bez wojny", testPriority: 1 },
  ];
  return exportAdwordsCsv(ex, projectSlug, "5", TEMPLATE_V5_COLUMNS);
}

function adwordsCsvTemplateV1(projectSlug: string): string {
  const ex: ExportableAsset[] = [
    { assetKey: "G01-L", rowType: "image", funnel: "sprzedaz", campaignCode: "PMAX-SPRZ", assetGroup: "AG1", conceptId: "G01", aspectRatio: "1.91:1", width: 1200, height: 628, headline: "Najpierw plan, potem pozew", subheadline: "Ustalenia przed sądem", body: "1. Rozmowa | 2. Plan | 3. Pozew", cta: "Umów konsultację", visualBrief: "Ekspert przy stole, ciepłe światło", expertPhotoKey: "ekspert_1" },
    { assetKey: "G90-SQ", rowType: "image_clean", funnel: "sprzedaz", campaignCode: "PMAX-SPRZ", assetGroup: "AG1", conceptId: "G90", aspectRatio: "1:1", width: 1200, height: 1200, visualBrief: "Portret eksperta bez tekstu", expertPhotoKey: "ekspert_1" },
    { assetKey: "V01-916", rowType: "video", funnel: "sprzedaz", campaignCode: "PMAX-SPRZ", assetGroup: "AG1", conceptId: "V01", aspectRatio: "9:16", width: 1080, height: 1920, durationSec: 25 },
    { assetKey: "V01-S1", rowType: "video_scene", conceptId: "V01", sceneIndex: 1, startS: 0, endS: 3, spokenText: "Czy rozwód musi być wojną?", screenText: "Rozwód bez wojny?", visualBrief: "Zbliżenie: ekspert patrzy w kamerę" },
    { assetKey: "H01", rowType: "headline", campaignCode: "PMAX-SPRZ", assetGroup: "AG1", adText: "Rozwód bez wojny" },
    { assetKey: "LH01", rowType: "long_headline", campaignCode: "PMAX-SPRZ", assetGroup: "AG1", adText: "Najpierw plan i ustalenia, dopiero potem pozew o rozwód" },
    { assetKey: "D01", rowType: "description", campaignCode: "PMAX-SPRZ", assetGroup: "AG1", adText: "Konsultacja z mediatorem: plan rozstania i cena znana z góry." },
  ];
  return exportAdwordsCsv(ex, projectSlug);
}

/** "Nowy Etap" → "nowy-etap" (to match project_slug from the file) */
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[ąćęłńóśźż]/g, (c) => FOLD[c])
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
