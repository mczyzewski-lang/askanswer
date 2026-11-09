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
export const ALL_COLUMNS = [...ADWORDS_COLUMNS, ...ADWORDS_V2_COLUMNS] as const;
export type AdwordsColumn = (typeof ALL_COLUMNS)[number];

export const ROW_TYPES = ["image", "image_clean", "video", "video_scene", "headline", "long_headline", "description", "experiment_plan", "historical_reference"] as const;
/** metadata of tests and the archive — never rendered as images nor exported to Google Ads */
export const META_ROW_TYPES = ["experiment_plan", "historical_reference"] as const;
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
    };
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
    for (const h of headers) if (!map[h] && rec[h]) extra[h] = rec[h];
    const sv = get("schema_version");
    if (sv) extra.schema_version = sv;
    counts[type]++;
    assets.push({ row, assetKey: key, rowType: type, projectSlug: str("project_slug"), data, extra });
  });
  // a pair must point to a record of the file (or one already imported)
  const keys = new Set(assets.map((a) => a.assetKey));
  for (const a of assets) if (a.data.pairedAssetId && !keys.has(a.data.pairedAssetId)) issues.push({ row: a.row, column: "paired_asset_id", message: `paired_asset_id „${a.data.pairedAssetId}” nie występuje w pliku.`, level: "warning" });
  return { delimiter, headers, mapping: map, preview: res.data.slice(0, 10), assets, issues, counts };
}

/** the stored record, as written back to the CSV */
export interface ExportableAsset extends Partial<Omit<ParsedAsset["data"], "approvalRequired">> {
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
};

/** The module's records as a CSV (`;`, UTF-8 with BOM for Excel) — the same columns as the import, extra columns appended. */
export function exportAdwordsCsv(assets: ExportableAsset[], projectSlug: string, schemaVersion = "1"): string {
  // v2 columns only when the records use them (a v1 set exports exactly as v1)
  const v2 = assets.some((a) => ADWORDS_V2_COLUMNS.some((c) => a[COL_OF[c] as keyof ExportableAsset] != null && a[COL_OF[c] as keyof ExportableAsset] !== ""));
  const cols: AdwordsColumn[] = v2 ? [...ALL_COLUMNS] : [...ADWORDS_COLUMNS];
  const extraCols = [...new Set(assets.flatMap((a) => Object.keys(a.extra ?? {}).filter((k) => k !== "schema_version")))];
  const rows = assets.map((a) => {
    const r: Record<string, string> = {};
    for (const c of cols) {
      const k = COL_OF[c];
      if (c === "schema_version") r[c] = a.extra?.schema_version ?? (v2 ? "2" : schemaVersion);
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
  return "﻿" + Papa.unparse({ fields: [...cols, ...extraCols], data: rows.map((r) => [...cols, ...extraCols].map((c) => r[c])) }, { delimiter: ";", newline: "\r\n", quotes: false });
}

/** A template: the header and one example of each row type. */
export function adwordsCsvTemplate(projectSlug = "moj-projekt"): string {
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
