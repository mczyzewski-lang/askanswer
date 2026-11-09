/**
 * Google Adwords — "Historia PMax": the Google Ads asset details report (CSV). Two lines of title and
 * period, the header in line 3, `,` as the delimiter, Polish numbers ("8 825,39" with a non-breaking
 * space) and multi-line assets in quotes. The metrics are ATTRIBUTED to a component by Google: they are
 * not additive (one conversion can be credited to several assets) and not causal.
 */
import Papa from "papaparse";

export const HISTORY_FIELDS = ["Stan komponentu", "Komponent", "Poziom", "Stan", "Typ komponentu", "Ostatnia aktualizacja", "Konwersje", "Wartość konw.", "Wyświetlenia", "Kliknięcia", "Kod waluty", "Koszt", "Dodane przez:"] as const;
export type HistoryField = (typeof HISTORY_FIELDS)[number];

export const HISTORY_SOURCES = [
  { url: "https://support.google.com/google-ads/answer/16259414?hl=en", title: "Asset reporting in Performance Max — metrics are not additive" },
  { url: "https://support.google.com/google-ads/answer/15235796?hl=en", title: "Asset-level performance (attributed metrics)" },
  { url: "https://support.google.com/google-ads/answer/10725056?hl=en", title: "Performance Max reporting" },
  { url: "https://support.google.com/google-ads/answer/13872527?hl=en", title: "Asset performance metrics" },
];

/** what to get before any budget decision, in priority order */
export const MISSING_DATA = [
  "Zestawienie działań konwersji: nazwa, primary/secondary, sposób liczenia, wartość, model atrybucji.",
  "KPI z CRM: lead → dodzwonienie → kwalifikacja → sprzedaż → przychód.",
  "Raport kampanii i grup komponentów per tydzień / miesiąc.",
  "Kanały i miejsca emisji (placements).",
  "Raport kombinacji komponentów.",
  "Rzeczywiste projekty / miniatury obrazów i filmy (URL z eksportu nie pozwala ocenić estetyki i czytelności).",
];

const nbsp = (s: string) => s.replace(/[   ]/g, " ").replace(/\s+/g, " ").trim();

/** "8 825,39" / "920 583" / "1,00" / "--" / "329 606,47 zł" → number (null when empty) */
export function plNumber(v: string | null | undefined): number | null {
  const s = nbsp(String(v ?? "")).replace(/zł|pln|%/gi, "").trim();
  if (!s || s === "--" || s === "—" || s === "-") return null;
  const n = Number(s.replace(/\s/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

const MONTHS: Record<string, number> = { sty: 1, lut: 2, mar: 3, kwi: 4, maj: 5, cze: 6, lip: 7, sie: 8, wrz: 9, paz: 10, paź: 10, lis: 11, gru: 12 };
const monthOf = (w: string) => MONTHS[w.toLowerCase().slice(0, 3)] ?? MONTHS[w.toLowerCase().slice(0, 3).replace("ź", "z")] ?? null;

/** "4 lis 2026" / "4 listopada 2026" / "2026-11-04" / "04.11.2026" → a date (UTC midnight) */
export function plDate(v: string | null | undefined): Date | null {
  const s = nbsp(String(v ?? ""));
  if (!s || s === "--") return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(s);
  if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
  m = /^(\d{1,2})\s+([a-ząćęłńóśźż]+)\.?\s+(\d{4})/i.exec(s);
  if (m) {
    const mo = monthOf(m[2]);
    if (mo) return new Date(Date.UTC(+m[3], mo - 1, +m[1]));
  }
  return null;
}

/** "1 stycznia 2026 - 8 listopada 2026" (any dash) → the period */
export function plPeriod(line: string): { from: Date | null; to: Date | null } {
  const parts = nbsp(line.replace(/^"|"$/g, "")).split(/\s+[-–—]\s+|\s+do\s+/);
  return { from: plDate(parts[0]), to: plDate(parts[1] ?? "") };
}

export const TYPE_KEYS = ["headline", "long_headline", "description", "image_square", "image_landscape", "image_portrait", "video", "logo", "sitelink", "business_name", "other"] as const;
export type TypeKey = (typeof TYPE_KEYS)[number];
export const TYPE_LABEL: Record<TypeKey, string> = {
  headline: "Nagłówek",
  long_headline: "Długi nagłówek",
  description: "Tekst (opis)",
  image_square: "Obraz kwadratowy",
  image_landscape: "Obraz poziomy",
  image_portrait: "Obraz pionowy",
  video: "Film w YouTube",
  logo: "Logo",
  sitelink: "Link do podstrony",
  business_name: "Nazwa firmy",
  other: "Inne",
};

export function typeKeyOf(label: string): TypeKey {
  const t = nbsp(label).toLowerCase();
  if (t.startsWith("długi nagłówek")) return "long_headline";
  if (t.startsWith("nagłówek")) return "headline";
  if (t === "tekst" || t.startsWith("opis")) return "description";
  if (t.includes("obraz") && t.includes("kwadrat")) return "image_square";
  if (t.includes("obraz") && t.includes("poziom")) return "image_landscape";
  if (t.includes("obraz") && t.includes("pion")) return "image_portrait";
  if (t.startsWith("film") || t.includes("youtube")) return "video";
  if (t.startsWith("logo")) return "logo";
  if (t.startsWith("link do podstrony")) return "sitelink";
  if (t.startsWith("nazwa firmy")) return "business_name";
  return "other";
}

/** the communication angle of a text (for filtering and as a hypothesis source) */
export function angleOf(text: string): "bez_wojny" | "plan_pozew" | "koszt" | "szybkosc" | "inne" {
  const t = text.toLowerCase();
  if (/koszt|cen[ayę]|zł|tani|opłat/.test(t)) return "koszt";
  if (/szybk|\bdni\b|pierwszej rozpraw|skróć|w terminie|tydzie/.test(t)) return "szybkosc";
  if (/pozew|pozwu|plan|ustalen|zanim/.test(t)) return "plan_pozew";
  if (/wojn|walk|konflikt|spok|nerw|kłót/.test(t)) return "bez_wojny";
  return "inne";
}
export const ANGLE_LABEL = { bez_wojny: "bez wojny / walki", plan_pozew: "najpierw ustalenia, potem pozew", koszt: "przejrzysty koszt", szybkosc: "sprawny przebieg", inne: "inne" } as const;

export interface HistoryRowParsed {
  rowNumber: number;
  raw: Record<HistoryField, string>;
  assetState: string | null;
  component: string;
  level: string | null;
  status: string | null;
  assetType: string | null;
  typeKey: TypeKey;
  lastUpdated: Date | null;
  conversions: number | null;
  convValue: number | null;
  impressions: number | null;
  clicks: number | null;
  currency: string | null;
  cost: number | null;
  addedBy: string | null;
  angle: string;
}

/** a Google Ads asset report (title + period lines, header with "Stan komponentu") */
export function isHistoryReport(text: string): boolean {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).slice(0, 6);
  return lines.some((l) => /Stan komponentu/i.test(l) && /Typ komponentu/i.test(l));
}

export function parseHistory(text: string): { title: string | null; period: { from: Date | null; to: Date | null }; periodRaw: string | null; rows: HistoryRowParsed[]; issues: Array<{ row: number; message: string }> } {
  const clean = text.replace(/^﻿/, "");
  // the header line (usually line 3: after the title and the period)
  const lines = clean.split(/\r?\n/);
  const headerAt = lines.findIndex((l, i) => i < 10 && /Stan komponentu/i.test(l) && /Typ komponentu/i.test(l));
  if (headerAt < 0) throw new Error("To nie jest raport komponentów Google Ads (brak nagłówka „Stan komponentu”).");
  const title = headerAt > 0 ? nbsp(lines[0].replace(/^"|"$/g, "")) || null : null;
  const periodRaw = headerAt > 1 ? nbsp(lines[1].replace(/^"|"$/g, "")) || null : null;
  const body = lines.slice(headerAt).join("\n");
  const res = Papa.parse<Record<string, string>>(body, { header: true, delimiter: ",", skipEmptyLines: "greedy", transformHeader: (h) => nbsp(h) });
  const issues: Array<{ row: number; message: string }> = res.errors.map((e) => ({ row: (e.row ?? 0) + headerAt + 2, message: `Błąd składni CSV: ${e.message}` }));
  const rows: HistoryRowParsed[] = [];
  res.data.forEach((r, i) => {
    const get = (f: HistoryField) => String(r[f] ?? r[nbsp(f)] ?? "").replace(/\r/g, "");
    const raw = Object.fromEntries(HISTORY_FIELDS.map((f) => [f, get(f)])) as Record<HistoryField, string>;
    const component = raw["Komponent"].trim();
    // totals lines ("Łącznie…") are not components — and are never used
    if (!component || /^(łącznie|razem|suma)/i.test(nbsp(raw["Stan komponentu"]))) return;
    rows.push({
      rowNumber: i + 1,
      raw,
      assetState: nbsp(raw["Stan komponentu"]) || null,
      component,
      level: nbsp(raw["Poziom"]) || null,
      status: nbsp(raw["Stan"]) || null,
      assetType: nbsp(raw["Typ komponentu"]) || null,
      typeKey: typeKeyOf(raw["Typ komponentu"]),
      lastUpdated: plDate(raw["Ostatnia aktualizacja"]),
      conversions: plNumber(raw["Konwersje"]),
      convValue: plNumber(raw["Wartość konw."]),
      impressions: plNumber(raw["Wyświetlenia"]) == null ? null : Math.round(plNumber(raw["Wyświetlenia"])!),
      clicks: plNumber(raw["Kliknięcia"]) == null ? null : Math.round(plNumber(raw["Kliknięcia"])!),
      currency: nbsp(raw["Kod waluty"]) || null,
      cost: plNumber(raw["Koszt"]),
      addedBy: nbsp(raw["Dodane przez:"]) || null,
      angle: angleOf(component),
    });
  });
  return { title, period: periodRaw ? plPeriod(periodRaw) : { from: null, to: null }, periodRaw, rows, issues };
}

/** CTR as a directional signal only (components co-occur and run in different channels) */
export const directionalCtr = (r: { impressions: number | null; clicks: number | null }) => (r.impressions && r.clicks != null ? r.clicks / r.impressions : null);

const fold = (s: string) => nbsp(s).toLowerCase().replace(/[^\p{L}\p{N} ]/gu, "");
/** the historical text components that express the same message (exact, or most words shared) */
export function matchHistory<T extends { component: string; typeKey: string }>(text: string, rows: T[]): T[] {
  const w = new Set(fold(text).split(" ").filter((x) => x.length > 2));
  if (!w.size) return [];
  return rows
    .filter((r) => ["headline", "long_headline", "description"].includes(r.typeKey))
    .map((r) => {
      if (fold(r.component) === fold(text)) return { r, s: 1 };
      const v = new Set(fold(r.component).split(" ").filter((x) => x.length > 2));
      let n = 0;
      for (const x of w) if (v.has(x)) n++;
      return { r, s: n / Math.max(w.size, v.size) };
    })
    .filter((x) => x.s >= 0.5)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.r);
}
