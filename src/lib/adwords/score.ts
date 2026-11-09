/**
 * Google Adwords — two independent scorings of a creative and a hard compliance gate.
 *
 * Scoring A ("operacyjny") follows the brief's rubric. Scoring B ("autorski") is this module's own
 * methodology with weights and sources (official Google guidance kept apart from heuristics). They are
 * never averaged, and neither is a forecast of conversions: Google does not publish how Ad Strength is
 * calculated. The gate does not depend on any score — a high score never lifts a block.
 */
import { PMAX_SPEC, formatKeyOf, type TextKind } from "./spec";

export interface AdAsset {
  id?: string;
  assetKey: string;
  rowType: string;
  conceptId?: string | null;
  campaignCode?: string | null;
  assetGroup?: string | null;
  funnel?: string | null;
  aspectRatio?: string | null;
  width?: number | null;
  height?: number | null;
  durationSec?: number | null;
  sceneIndex?: number | null;
  startS?: number | null;
  endS?: number | null;
  headline?: string | null;
  subheadline?: string | null;
  body?: string | null;
  cta?: string | null;
  adText?: string | null;
  spokenText?: string | null;
  screenText?: string | null;
  visualBrief?: string | null;
  expertPhotoKey?: string | null;
  expertPhotoId?: string | null;
  landingUrl?: string | null;
  claimSource?: string | null;
  approvalRequired?: boolean | null;
  approvedAt?: string | Date | null;
  status?: string | null;
  scoreSeed?: number | null;
  scoreNote?: string | null;
  layout?: string | null;
  edit?: { photoHidden?: boolean } | null;
  experimentId?: string | null;
  variant?: string | null;
  pairedAssetId?: string | null;
  testAxis?: string | null;
  testStage?: string | null;
  deployMode?: string | null;
  evidenceNote?: string | null;
}

export interface ScoreItem {
  key: string;
  label: string;
  max: number;
  points: number;
  why: string;
  /** scoring B: official Google guidance or a heuristic of this module */
  basis?: "oficjalne" | "heurystyka";
  sources?: string[];
}
export interface Score {
  total: number;
  items: ScoreItem[];
  version: string;
}

export interface BrandContext {
  /** project / brand name and words of the offer (from the project and the campaign) */
  brandName: string;
  keywords: string[];
  /** the campaign's final URL (a component may have its own) */
  landingUrl: string | null;
  hasLogo: boolean;
}

/** what the renderer measured for an image variant (see draw.ts) */
export interface Measure {
  overflow: boolean;
  outsideSafe: boolean;
  minFontPx: number;
  contrast: number;
  height: number;
}

export interface ExpertPhotoInfo {
  id: string;
  consentConfirmed: boolean;
}

// ---------------------------------------------------------------------------------------------------
// shared text checks

const FOLD: Record<string, string> = { ą: "a", ć: "c", ę: "e", ł: "l", ń: "n", ó: "o", ś: "s", ź: "z", ż: "z" };
const fold = (s: string) => s.toLowerCase().replace(/[ąćęłńóśźż]/g, (c) => FOLD[c]);
const words = (s: string) => fold(s).split(/[^a-z0-9%]+/).filter((w) => w.length > 2);

/** promises Google's policy and the brief rule out for divorce / relationship services */
const RISKY = [
  { re: /gwarant/, why: "obietnica gwarancji" },
  { re: /100\s?%/, why: "„100%” bez danych" },
  { re: /na pewno|zawsze (sie )?(uda|skuteczn)|bez(konfliktow| zadnego konfliktu)/, why: "obietnica bezkonfliktowego / pewnego wyniku" },
  { re: /najlepsz|nr\s?1|numer jeden/, why: "superlatyw bez źródła" },
  { re: /mediacja (jest|to) (zawsze|jedyn)/, why: "presja na mediację (nie przy przemocy)" },
];
export function riskyClaims(text: string): string[] {
  const t = fold(text);
  return RISKY.filter((r) => r.re.test(t)).map((r) => r.why);
}
/** a fact that needs a source: a number of clients, a percentage, "X lat", "tysiące" */
export function needsProof(text: string): boolean {
  const t = fold(text);
  return /\d{2,}\s*(\+|par|klient|osob|spraw|lat|%)|\d+\s?%|tysiac|setki/.test(t);
}
const CTA_VERBS = /(umow|sprawdz|zadzwon|pobierz|zapisz|poznaj|zobacz|zaplanuj|porozmawiaj|napisz|zacznij|skorzystaj|dowiedz)/;
const OUTCOME = /(plan|krok|cena|koszt|zl|dni|tydzien|bez |szybk|spokoj|porozumien|ustalen|zakres|dzieci|majatek)/;

function jaccard(a: string, b: string) {
  const x = new Set(words(a));
  const y = new Set(words(b));
  if (!x.size || !y.size) return 0;
  let n = 0;
  for (const w of x) if (y.has(w)) n++;
  return n / (x.size + y.size - n);
}
const clamp = (n: number, max: number) => Math.max(0, Math.min(max, Math.round(n)));
const sum = (items: ScoreItem[]) => Math.min(100, items.reduce((n, i) => n + i.points, 0));

export const textKindOf = (rowType: string): TextKind | null => (rowType === "headline" || rowType === "long_headline" || rowType === "description" ? rowType : null);

// ---------------------------------------------------------------------------------------------------
// Scoring A — operational rubric of the brief

export function scoreImageA(v: AdAsset, ctx: BrandContext, m: Measure | null, photo: ExpertPhotoInfo | null): Score {
  const h = (v.headline ?? "").trim();
  const sub = (v.subheadline ?? "").trim();
  const all = [h, sub, v.body ?? "", v.cta ?? ""].join(" ");
  const items: ScoreItem[] = [];
  const hookPts = !h ? 0 : h.length <= 32 ? 20 : h.length <= 48 ? 15 : h.length <= 64 ? 9 : 5;
  items.push({ key: "hook", label: "Jasność hooka / tekstu głównego", max: 20, points: h === h.toUpperCase() && h.length > 12 ? Math.max(0, hookPts - 4) : hookPts, why: !h ? "brak hasła" : `hasło ${h.length} znaków${h.length > 48 ? " — za długie na szybkie przeczytanie" : ""}` });
  const outcome = OUTCOME.test(fold(`${h} ${sub} ${v.body ?? ""}`));
  items.push({ key: "result", label: "Siła rezultatu / mechanizmu", max: 20, points: outcome ? (sub ? 20 : 15) : sub ? 10 : 6, why: outcome ? "pada konkret: plan / krok / cena / rezultat" : "brak konkretnego rezultatu ani mechanizmu" });
  items.push({ key: "brand", label: "Spójność z brandingiem", max: 15, points: (ctx.hasLogo ? 8 : 3) + 7, why: `${ctx.hasLogo ? "logo projektu" : "brak logo w motywie"} + kolory i fonty motywu` });
  const proofNeeded = needsProof(all);
  const risky = riskyClaims(all);
  items.push({
    key: "proof",
    label: "Wiarygodność / dowód",
    max: 15,
    points: risky.length ? 2 : proofNeeded ? (v.claimSource ? (v.approvalRequired && !v.approvedAt ? 8 : 15) : 4) : photo ? 13 : 10,
    why: risky.length ? `ryzykowne sformułowania: ${risky.join(", ")}` : proofNeeded ? (v.claimSource ? `dowód ze źródłem: ${v.claimSource}` : "liczba / fakt bez źródła") : photo ? "prawdziwy ekspert na zdjęciu" : "bez twardych twierdzeń",
  });
  const mobile = !m ? 8 : m.overflow ? 0 : m.outsideSafe ? 5 : m.minFontPx / m.height >= 0.03 ? 15 : 10;
  items.push({ key: "mobile", label: "Czytelność mobilna / safe area", max: 15, points: mobile, why: !m ? "nie sprawdzono renderu" : m.overflow ? "tekst się nie mieści" : m.outsideSafe ? "element poza bezpiecznym obszarem" : `najmniejszy tekst ${Math.round(m.minFontPx)} px` });
  const landing = v.landingUrl || ctx.landingUrl;
  const cta = (v.cta ?? "").trim();
  items.push({ key: "cta", label: "Jedno CTA i zgodność z landingiem", max: 10, points: !cta ? 0 : landing ? 10 : 6, why: !cta ? "brak CTA" : landing ? `CTA „${cta}” → ${landing}` : `CTA „${cta}”, brak adresu strony docelowej` });
  items.push({ key: "contrast", label: "Dostępność / kontrast", max: 5, points: !m ? 3 : m.contrast >= 4.5 ? 5 : m.contrast >= 3 ? 3 : 0, why: m ? `kontrast ${m.contrast.toFixed(1)}:1` : "nie sprawdzono" });
  return { total: sum(items), items, version: "A-1" };
}

export interface VideoConcept {
  conceptId: string;
  variants: AdAsset[];
  scenes: AdAsset[];
}

const sceneText = (s: AdAsset) => `${s.screenText ?? ""} ${s.spokenText ?? ""}`;

export function scoreVideoA(v: VideoConcept, ctx: BrandContext): Score {
  const sc = [...v.scenes].sort((a, b) => (a.sceneIndex ?? 0) - (b.sceneIndex ?? 0));
  const dur = Math.max(v.variants[0]?.durationSec ?? 0, ...sc.map((s) => s.endS ?? 0));
  const first = sc[0];
  const last = sc[sc.length - 1];
  const items: ScoreItem[] = [];
  const hookOk = !!first && (first.startS ?? 0) === 0 && (first.endS ?? 99) <= 4 && !!first.screenText && !!first.spokenText;
  items.push({ key: "hook", label: "Hook w 0–3 s", max: 20, points: !first ? 0 : hookOk ? (/\?/.test(sceneText(first)) || /nie |bez /.test(fold(sceneText(first))) ? 20 : 16) : first.screenText ? 9 : 4, why: !first ? "brak scen" : hookOk ? "pierwsza scena ≤3–4 s, napis + słowa eksperta" : "pierwsza scena za długa albo bez napisu" });
  const probl = sc.some((s) => (s.startS ?? 0) >= 2 && (s.startS ?? 0) <= 9 && /problem|nie |bez |najczesciej|trudn/.test(fold(sceneText(s))));
  items.push({ key: "problem", label: "Klarowny problem i rezultat", max: 20, points: probl ? 20 : sc.length >= 3 ? 12 : 6, why: probl ? "problem nazwany w 3–9 s" : "problem nie pada wprost" });
  items.push({ key: "trust", label: "Autentyczność i wiarygodność", max: 15, points: clamp((v.variants.some((x) => x.expertPhotoKey) || sc.some((s) => s.expertPhotoKey) ? 9 : 4) + (sc.some((s) => riskyClaims(sceneText(s)).length) ? 0 : 6), 15), why: "prawdziwy ekspert w kadrze, bez obietnic bez pokrycia" });
  const mech = sc.filter((s) => (s.startS ?? 0) >= 6 && (s.endS ?? 0) <= dur - 3 && /krok|plan|najpierw|potem|pakiet|ustal/.test(fold(sceneText(s)))).length;
  items.push({ key: "mechanism", label: "Wyjaśniony mechanizm", max: 15, points: mech >= 2 ? 15 : mech === 1 ? 10 : 3, why: mech ? `${mech} scen(y) z mechanizmem` : "brak wyjaśnienia, jak to działa" });
  const lens = sc.map((s) => (s.endS ?? 0) - (s.startS ?? 0)).filter((x) => x > 0);
  const avg = lens.length ? lens.reduce((a, b) => a + b, 0) / lens.length : 0;
  items.push({ key: "pace", label: "Rytm / montaż / uwaga", max: 10, points: !lens.length ? 0 : avg <= 7 && avg >= 2 ? 10 : avg <= 10 ? 6 : 3, why: lens.length ? `średnio ${avg.toFixed(1)} s na scenę` : "brak timingu" });
  const capt = sc.length ? sc.filter((s) => s.screenText && s.screenText.length <= 42).length / sc.length : 0;
  items.push({ key: "captions", label: "Czytelne napisy i mobilne kadrowanie", max: 10, points: clamp(capt * 7 + (v.variants.some((x) => formatKeyOf(x.aspectRatio, x.width, x.height) === "portrait") ? 3 : 0), 10), why: `${Math.round(capt * 100)}% scen z krótkim napisem${v.variants.some((x) => formatKeyOf(x.aspectRatio, x.width, x.height) === "portrait") ? ", jest wersja pionowa" : ""}` });
  const ctaScenes = sc.filter((s) => CTA_VERBS.test(fold(sceneText(s))));
  items.push({ key: "cta", label: "Jedno CTA i zgodność ze ścieżką", max: 5, points: ctaScenes.length === 1 && ctaScenes[0] === last ? 5 : ctaScenes.length ? 3 : 0, why: ctaScenes.length === 1 && ctaScenes[0] === last ? "jedno CTA na końcu" : ctaScenes.length ? `${ctaScenes.length} wezwań do działania` : "brak CTA" });
  const brandIn = sc.some((s) => fold(sceneText(s)).includes(fold(ctx.brandName).split(" ")[0]) || /logo|\.pl|\.com/.test(fold(`${sceneText(s)} ${s.visualBrief ?? ""}`)));
  items.push({ key: "brand", label: "Rozpoznawalność marki", max: 5, points: brandIn ? 5 : 1, why: brandIn ? "marka / logo / adres w filmie" : "marka nie pada" });
  return { total: sum(items), items, version: "A-1" };
}

export function scoreTextA(t: AdAsset, others: AdAsset[], ctx: BrandContext): Score {
  const text = (t.adText ?? "").trim();
  const kind = textKindOf(t.rowType)!;
  const lim = PMAX_SPEC.texts[kind].maxChars;
  const w = new Set(words(text));
  const kw = ctx.keywords.filter((k) => w.has(fold(k)) || fold(text).includes(fold(k)));
  const sim = Math.max(0, ...others.filter((o) => o.assetKey !== t.assetKey && o.rowType === t.rowType).map((o) => jaccard(o.adText ?? "", text)));
  const risky = riskyClaims(text);
  const items: ScoreItem[] = [
    { key: "relevance", label: "Trafność do oferty", max: 25, points: kw.length >= 2 ? 25 : kw.length === 1 ? 18 : 8, why: kw.length ? `słowa oferty: ${kw.slice(0, 4).join(", ")}` : "brak słów z oferty projektu" },
    { key: "unique", label: "Unikalność", max: 20, points: sim >= 0.7 ? 0 : sim >= 0.45 ? 10 : 20, why: sim >= 0.45 ? `podobny do innego tekstu (${Math.round(sim * 100)}%)` : "inny niż pozostałe" },
    { key: "clarity", label: "Jasność", max: 20, points: !text ? 0 : text.length > lim ? 0 : /[!?]{2,}|[A-ZĄĆĘŁŃÓŚŹŻ]{6,}/.test(text) ? 10 : 20, why: text.length > lim ? `ponad limit ${lim} znaków` : /[!?]{2,}|[A-ZĄĆĘŁŃÓŚŹŻ]{6,}/.test(text) ? "wielokrotna interpunkcja / wersaliki" : "zrozumiały" },
    { key: "trust", label: "Wiarygodność", max: 15, points: risky.length ? 3 : 15, why: risky.length ? risky.join(", ") : "bez obietnic bez pokrycia" },
    { key: "intent", label: "Dopasowanie do intencji / CTA", max: 10, points: CTA_VERBS.test(fold(text)) || /\?$/.test(text) ? 10 : kind === "headline" ? 6 : 4, why: CTA_VERBS.test(fold(text)) ? "zawiera wezwanie" : "bez wezwania do działania" },
    { key: "brand", label: "Spójność marki", max: 10, points: fold(text).includes(fold(ctx.brandName)) ? 10 : 7, why: fold(text).includes(fold(ctx.brandName)) ? "nazwa marki" : "ton zgodny, bez nazwy marki" },
  ];
  return { total: sum(items), items, version: "A-1" };
}

// ---------------------------------------------------------------------------------------------------
// Scoring B — this module's methodology (version, weights, sources)

export const SCORING_B = {
  version: "B-2026.11",
  date: "2026-11-09",
  summary:
    "Ocena jakości kreacji przed publikacją, nie prognoza wyników. Google nie publikuje wzoru Ad Strength — kryteria oparto na oficjalnych zaleceniach (rozdzielone od heurystyk). Badanie Optmyzr (2024) pokazało, że wyższa siła reklamy nie przekłada się automatycznie na lepsze CPA/ROAS, więc ilość i różnorodność komponentów nie dominuje tej oceny.",
  sources: {
    adStrength: { url: "https://support.google.com/google-ads/answer/9142254", title: "Google Ads Help — About Ad Strength (trafność, jakość, różnorodność; bez publicznego wzoru)", official: true },
    pmaxCreative: { url: "https://support.google.com/google-ads/answer/14528221", title: "Google Ads Help — Best practices for Performance Max creative assets", official: true },
    rsaStrength: { url: "https://support.google.com/google-ads/answer/9921843", title: "Google Ads Help — Ad Strength for responsive search ads (bez powtórzeń, słowa kluczowe)", official: true },
    abcd: { url: "https://www.thinkwithgoogle.com/marketing-strategies/video/youtube-video-ad-creative/", title: "Think with Google — The ABCDs of effective video ads (Attract, Brand, Connect, Direct)", official: true },
    pmaxSpecs: { url: "https://support.google.com/google-ads/answer/17091269", title: "Google Ads Help — Performance Max specs (safe area 80%, rozmiary)", official: true },
    optmyzr: { url: "https://www.optmyzr.com/blog/google-ad-strength-study/", title: "Optmyzr — Ad Strength study (wrzesień 2024)", official: false },
  },
  accessed: "2026-11-09 (przez wyniki wyszukiwania; strony Google nie były dostępne bezpośrednio z serwera budującego moduł)",
} as const;

/** the criteria of scoring B, for the "Wytyczne PMax" screen */
export const SCORING_B_CRITERIA: Array<{ kind: "grafika" | "wideo" | "tekst"; label: string; weight: number; basis: "oficjalne" | "heurystyka"; why: string; sources: Array<keyof typeof SCORING_B.sources> }> = [
  { kind: "grafika", label: "Jeden komunikat", weight: 25, basis: "heurystyka", why: "Jedno hasło i najwyżej jeden podtytuł czytają się w ułamku sekundy; Google zaleca pokazanie wyróżnika, nie listy komunikatów.", sources: ["pmaxCreative"] },
  { kind: "grafika", label: "Czytelność w małym formacie i safe area", weight: 20, basis: "oficjalne", why: "Treść w środkowych 80% kadru; minimalny rozmiar tekstu względem wysokości grafiki.", sources: ["pmaxSpecs"] },
  { kind: "grafika", label: "Konkretny wyróżnik oferty", weight: 15, basis: "oficjalne", why: "Komponenty mają przekazywać unikalną wartość oferty.", sources: ["pmaxCreative"] },
  { kind: "grafika", label: "Prawdziwy człowiek / autentyczny obraz", weight: 15, basis: "heurystyka", why: "Wysokiej jakości, trafne obrazy; ekspert ze zgodą wzmacnia wiarygodność usług.", sources: ["pmaxCreative", "abcd"] },
  { kind: "grafika", label: "Marka widoczna", weight: 15, basis: "heurystyka", why: "Zasada „Brand” z ABCD przeniesiona na statykę.", sources: ["abcd"] },
  { kind: "grafika", label: "Kierunek działania", weight: 10, basis: "oficjalne", why: "„Direct”: jasne wezwanie do działania.", sources: ["abcd"] },
  { kind: "wideo", label: "Attract — pierwsze sekundy", weight: 25, basis: "oficjalne", why: "ABCD: mocne otwarcie, kilka ujęć w pierwszych 5 s.", sources: ["abcd"] },
  { kind: "wideo", label: "Brand — marka w pierwszych 5 s", weight: 20, basis: "oficjalne", why: "ABCD: marka / produkt wcześnie (zwiększa zapamiętanie, ale może zwiększać pomijanie).", sources: ["abcd"] },
  { kind: "wideo", label: "Connect — problem widza i człowiek", weight: 20, basis: "oficjalne", why: "ABCD: emocja i ludzie.", sources: ["abcd"] },
  { kind: "wideo", label: "Direct — jedno wezwanie na końcu", weight: 15, basis: "oficjalne", why: "ABCD: oferta / CTA na planszy lub lektorem.", sources: ["abcd"] },
  { kind: "wideo", label: "Mobile-first: pion + napisy", weight: 10, basis: "heurystyka", why: "Pionowy film 10–60 s do Shorts; napisy pomagają przy oglądaniu bez dźwięku (źródła branżowe, nie Google).", sources: ["abcd"] },
  { kind: "wideo", label: "Długość 10–60 s", weight: 10, basis: "oficjalne", why: "Minimum 10 s w PMax; praktyczny zakres do 60 s.", sources: ["pmaxSpecs"] },
  { kind: "tekst", label: "Różnorodność", weight: 30, basis: "oficjalne", why: "Siła reklamy uwzględnia różnorodność; nie powtarzać tych samych treści.", sources: ["adStrength", "rsaStrength"] },
  { kind: "tekst", label: "Słowa oferty / zapytań", weight: 25, basis: "oficjalne", why: "Trafne słowa kluczowe w nagłówkach i opisach.", sources: ["rsaStrength"] },
  { kind: "tekst", label: "Konkret i wyróżnik", weight: 20, basis: "oficjalne", why: "Przekazać unikalną wartość.", sources: ["pmaxCreative"] },
  { kind: "tekst", label: "Wezwanie / intencja", weight: 15, basis: "heurystyka", why: "Krótki nagłówek ≤15 znaków dobrze sprawdza się jako CTA (poradniki branżowe).", sources: ["rsaStrength"] },
  { kind: "tekst", label: "Zgodność z zasadami", weight: 10, basis: "oficjalne", why: "Bez gwarancji i obietnic bez pokrycia (zasady reklam, kategorie wrażliwe).", sources: ["adStrength"] },
];

type SrcKey = keyof typeof SCORING_B.sources;
const b = (key: string, label: string, max: number, ratio: number, why: string, basis: "oficjalne" | "heurystyka", sources: SrcKey[]): ScoreItem => ({ key, label, max, points: clamp(ratio * max, max), why, basis, sources: sources.map((s) => SCORING_B.sources[s].url) });

export function scoreImageB(v: AdAsset, ctx: BrandContext, m: Measure | null, photo: ExpertPhotoInfo | null): Score {
  const msgWords = words(`${v.headline ?? ""} ${v.subheadline ?? ""}`).length;
  const usp = OUTCOME.test(fold(`${v.headline ?? ""} ${v.subheadline ?? ""} ${v.body ?? ""}`));
  const items = [
    b("single", "Jeden komunikat", 25, !v.headline ? 0 : msgWords <= 12 ? 1 : msgWords <= 18 ? 0.6 : 0.3, `${msgWords} słów w haśle i podtytule`, "heurystyka", ["pmaxCreative"]),
    b("legible", "Czytelność w małym formacie i safe area", 20, !m ? 0.5 : m.overflow ? 0 : m.outsideSafe ? 0.3 : m.minFontPx / m.height >= 0.035 ? 1 : 0.7, m ? (m.overflow ? "tekst ucięty" : `min. ${Math.round(m.minFontPx)} px, ${m.outsideSafe ? "poza" : "w"} środkowych 80%`) : "bez pomiaru", "oficjalne", ["pmaxSpecs"]),
    b("usp", "Konkretny wyróżnik oferty", 15, usp ? 1 : 0.3, usp ? "wyróżnik w treści" : "brak konkretu (plan / cena / krok)", "oficjalne", ["pmaxCreative"]),
    b("human", "Prawdziwy człowiek / autentyczny obraz", 15, photo && !v.edit?.photoHidden ? (photo.consentConfirmed ? 1 : 0.4) : v.layout === "process_steps" ? 0.6 : 0.4, photo ? (photo.consentConfirmed ? "ekspert ze zgodą" : "ekspert bez potwierdzonej zgody") : "bez zdjęcia", "heurystyka", ["pmaxCreative", "abcd"]),
    b("brand", "Marka widoczna", 15, ctx.hasLogo ? 1 : 0.4, ctx.hasLogo ? "logo motywu na grafice" : "brak logo", "heurystyka", ["abcd"]),
    b("direct", "Kierunek działania", 10, v.cta && CTA_VERBS.test(fold(v.cta)) ? 1 : v.cta ? 0.6 : 0, v.cta ? `CTA „${v.cta}”` : "brak CTA", "oficjalne", ["abcd"]),
  ];
  return { total: sum(items), items, version: SCORING_B.version };
}

export function scoreVideoB(v: VideoConcept, ctx: BrandContext): Score {
  const sc = [...v.scenes].sort((a, b2) => (a.sceneIndex ?? 0) - (b2.sceneIndex ?? 0));
  const dur = Math.max(v.variants[0]?.durationSec ?? 0, ...sc.map((s) => s.endS ?? 0));
  const early = sc.filter((s) => (s.startS ?? 0) < 5);
  const brandEarly = early.some((s) => fold(`${sceneText(s)} ${s.visualBrief ?? ""}`).includes(fold(ctx.brandName).split(" ")[0]) || /logo|ekspert/.test(fold(s.visualBrief ?? "")));
  const ctaLast = sc.length ? CTA_VERBS.test(fold(sceneText(sc[sc.length - 1]))) : false;
  const portrait = v.variants.some((x) => formatKeyOf(x.aspectRatio, x.width, x.height) === "portrait");
  const items = [
    b("attract", "Attract — przyciąga w pierwszych sekundach", 25, early.length >= 2 ? 1 : early.length === 1 && early[0].screenText ? 0.7 : 0.2, `${early.length} ujęć w pierwszych 5 s`, "oficjalne", ["abcd"]),
    b("brand", "Brand — marka / ekspert w pierwszych 5 s", 20, brandEarly ? 1 : 0.3, brandEarly ? "marka lub ekspert od początku" : "marka dopiero później", "oficjalne", ["abcd"]),
    b("connect", "Connect — problem widza i człowiek", 20, sc.some((s) => /nie |bez |problem|trudn|czy /.test(fold(sceneText(s)))) ? 1 : 0.4, "emocja / problem nazwany", "oficjalne", ["abcd"]),
    b("direct", "Direct — jedno wezwanie na końcu (napis + głos)", 15, ctaLast ? 1 : 0.2, ctaLast ? "CTA w ostatniej scenie" : "brak CTA na końcu", "oficjalne", ["abcd"]),
    b("mobile", "Mobile-first: pion + napisy", 10, (portrait ? 0.5 : 0) + (sc.length && sc.every((s) => s.screenText) ? 0.5 : 0), `${portrait ? "jest 9:16" : "brak 9:16"}, ${sc.every((s) => s.screenText) ? "napisy w każdej scenie" : "nie wszystkie sceny mają napis"}`, "heurystyka", ["abcd"]),
    b("length", "Długość 10–60 s", 10, dur >= PMAX_SPEC.videos.minSeconds && dur <= PMAX_SPEC.videos.practicalMaxSeconds ? 1 : 0, `${dur} s`, "oficjalne", ["pmaxSpecs"]),
  ];
  return { total: sum(items), items, version: SCORING_B.version };
}

export function scoreTextB(t: AdAsset, others: AdAsset[], ctx: BrandContext): Score {
  const text = (t.adText ?? "").trim();
  const sim = Math.max(0, ...others.filter((o) => o.assetKey !== t.assetKey && o.rowType === t.rowType).map((o) => jaccard(o.adText ?? "", text)));
  const kw = ctx.keywords.filter((k) => fold(text).includes(fold(k)));
  const items = [
    b("variety", "Różnorodność względem pozostałych", 30, sim >= 0.7 ? 0 : sim >= 0.45 ? 0.5 : 1, `podobieństwo ${Math.round(sim * 100)}%`, "oficjalne", ["adStrength", "rsaStrength"]),
    b("keywords", "Słowa oferty / zapytań", 25, kw.length >= 2 ? 1 : kw.length ? 0.7 : 0.2, kw.length ? kw.slice(0, 3).join(", ") : "brak słów oferty", "oficjalne", ["rsaStrength"]),
    b("usp", "Konkret i wyróżnik", 20, OUTCOME.test(fold(text)) ? 1 : 0.4, OUTCOME.test(fold(text)) ? "konkret" : "ogólnik", "oficjalne", ["pmaxCreative"]),
    b("direct", "Wezwanie / intencja", 15, CTA_VERBS.test(fold(text)) || /\?$/.test(text) ? 1 : 0.4, "krótki nagłówek ≤15 znaków dobrze sprawdza się jako CTA", "heurystyka", ["rsaStrength"]),
    b("policy", "Zgodność z zasadami (bez gwarancji)", 10, riskyClaims(text).length ? 0 : 1, riskyClaims(text).join(", ") || "ok", "oficjalne", ["adStrength"]),
  ];
  return { total: sum(items), items, version: SCORING_B.version };
}

// ---------------------------------------------------------------------------------------------------
// the hard gate — independent of any score

export type GateStatus = "gotowe" | "do_poprawy" | "blokada";
export interface Gate {
  status: GateStatus;
  problems: Array<{ level: "blokada" | "do_poprawy"; message: string }>;
}
const gate = (problems: Gate["problems"]): Gate => ({ status: problems.some((p) => p.level === "blokada") ? "blokada" : problems.length ? "do_poprawy" : "gotowe", problems });

/** archival claims that need a separate legal check before any reuse */
const NEEDS_LEGAL = [
  { re: /zamiast pozwu/, why: "„zamiast pozwu” — nie sugeruj, że dokument zastępuje pozew" },
  { re: /pierwszej rozpraw/, why: "„na pierwszej rozprawie” — nie obiecuj wyniku w każdej sprawie" },
  { re: /\b\d+\s*dni\b|w terminie/, why: "obietnica czasowa — wymaga danych o typowych terminach" },
];
const PRICE = /(cena|koszt|zl\b|zlotych|tani|oplat)/;

/** editorial context of the project: texts from the archive that must not be published again */
export interface GateOptions {
  doNotPublish?: string[];
}
const sameText = (a: string, b: string) => fold(a).replace(/[^a-z0-9]/g, "") === fold(b).replace(/[^a-z0-9]/g, "");

function claimProblems(v: AdAsset, text: string, opts: GateOptions = {}): Gate["problems"] {
  const out: Gate["problems"] = [];
  const t = fold(text);
  for (const h of opts.doNotPublish ?? []) if (h.trim() && (sameText(text, h) || t.includes(fold(h).trim()))) out.push({ level: "blokada", message: `Tekst archiwalny „${h}” (historical_do_not_publish) — nie publikuj bez osobnej weryfikacji.` });
  for (const r of NEEDS_LEGAL) if (r.re.test(t)) out.push({ level: "do_poprawy", message: `Weryfikacja prawna: ${r.why}.` });
  if (PRICE.test(t) && !v.claimSource && !v.approvedAt) out.push({ level: "do_poprawy", message: "Komunikat o cenie / koszcie — potwierdź zakres wycenionej usługi (claim_source albo zatwierdzenie); nie obiecuj całkowitego kosztu sprawy." });
  if ((v.approvalRequired || v.status === "blocked_until_verified") && !v.approvedAt) out.push({ level: "blokada", message: `Wymaga zatwierdzenia źródła / twierdzenia${v.claimSource ? ` (${v.claimSource})` : ""} przez osobę.` });
  if (needsProof(text) && !v.claimSource) out.push({ level: "do_poprawy", message: "Liczba / fakt bez źródła (claim_source) — nie wymyślamy dowodów." });
  for (const r of riskyClaims(text)) out.push({ level: "do_poprawy", message: `Polityka (rozwody): ${r}.` });
  return out;
}

/** An image variant: size, file size (after export), safe area, photo rights, claims, landing. */
export function gateImage(v: AdAsset, ctx: BrandContext, m: Measure | null, photo: ExpertPhotoInfo | null, fileBytes?: number | null, opts: GateOptions = {}): Gate {
  const p: Gate["problems"] = [];
  const key = formatKeyOf(v.aspectRatio, v.width, v.height);
  const spec = PMAX_SPEC.images.formats.find((f) => f.key === key);
  if (!spec) p.push({ level: "blokada", message: `Nieznany format (${v.aspectRatio ?? "?"}).` });
  else if (v.width && v.height && (v.width < spec.minWidth || v.height < spec.minHeight || Math.abs(v.width / v.height - spec.width / spec.height) > 0.02))
    p.push({ level: "blokada", message: `Wymiary ${v.width}×${v.height} nie pasują do ${spec.ratio} (zalecane ${spec.width}×${spec.height}).` });
  if (fileBytes != null && fileBytes > PMAX_SPEC.images.maxFileBytes) p.push({ level: "blokada", message: `Plik ${(fileBytes / 1024 / 1024).toFixed(1)} MB — limit 5 MB.` });
  if (m?.overflow) p.push({ level: "blokada", message: "Tekst nie mieści się w układzie (ucięty)." });
  if (m?.outsideSafe) p.push({ level: "do_poprawy", message: "Element poza środkowymi 80% kadru." });
  const usesPhoto = v.rowType === "image_clean" || (!!(v.expertPhotoKey || v.expertPhotoId) && !v.edit?.photoHidden);
  if (usesPhoto && !photo) p.push({ level: "blokada", message: `Nie przypisano zdjęcia eksperta${v.expertPhotoKey ? ` „${v.expertPhotoKey}”` : ""}.` });
  if (usesPhoto && photo && !photo.consentConfirmed) p.push({ level: "blokada", message: "Brak potwierdzonej zgody na reklamowe użycie zdjęcia eksperta." });
  if (v.rowType !== "image_clean") {
    if (!(v.headline ?? "").trim()) p.push({ level: "do_poprawy", message: "Brak hasła." });
    p.push(...claimProblems(v, [v.headline, v.subheadline, v.body, v.cta].join(" "), opts));
  } else p.push(...claimProblems(v, "", opts));
  if (!(v.landingUrl || ctx.landingUrl)) p.push({ level: "do_poprawy", message: "Brak adresu strony docelowej (uzupełnij w kampanii)." });
  return gate(p);
}

export function gateVideo(v: VideoConcept, ctx: BrandContext, opts: GateOptions = {}): Gate {
  const p: Gate["problems"] = [];
  const sc = [...v.scenes].sort((a, b2) => (a.sceneIndex ?? 0) - (b2.sceneIndex ?? 0));
  const dur = Math.max(v.variants[0]?.durationSec ?? 0, ...sc.map((s) => s.endS ?? 0));
  if (dur < PMAX_SPEC.videos.minSeconds) p.push({ level: "blokada", message: `Film ${dur} s — minimum ${PMAX_SPEC.videos.minSeconds} s.` });
  if (!sc.length) p.push({ level: "do_poprawy", message: "Brak scenariusza (scen)." });
  for (let i = 1; i < sc.length; i++) if ((sc[i].startS ?? 0) < (sc[i - 1].endS ?? 0) - 0.01) p.push({ level: "do_poprawy", message: `Scena ${sc[i].sceneIndex} nachodzi na poprzednią.` });
  const ctas = sc.filter((s) => CTA_VERBS.test(fold(sceneText(s)))).length;
  if (ctas > 1) p.push({ level: "do_poprawy", message: `${ctas} wezwania do działania — zostaw jedno.` });
  for (const s of sc) p.push(...claimProblems(s, sceneText(s), opts).map((x) => ({ ...x, message: `Scena ${s.sceneIndex}: ${x.message}` })));
  for (const x of v.variants) if ((x.approvalRequired || x.status === "blocked_until_verified") && !x.approvedAt) p.push({ level: "blokada", message: `Wariant ${x.assetKey} wymaga zatwierdzenia.` });
  if (!v.variants.some((x) => x.landingUrl) && !ctx.landingUrl) p.push({ level: "do_poprawy", message: "Brak adresu strony docelowej (uzupełnij w kampanii)." });
  return gate(p);
}

export function gateText(t: AdAsset, opts: GateOptions = {}): Gate {
  const p: Gate["problems"] = [];
  const kind = textKindOf(t.rowType)!;
  const text = (t.adText ?? "").trim();
  const lim = PMAX_SPEC.texts[kind].maxChars;
  if (!text) p.push({ level: "blokada", message: "Pusty tekst." });
  if ([...text].length > lim) p.push({ level: "blokada", message: `${[...text].length} znaków — limit ${lim}.` });
  p.push(...claimProblems(t, text, opts));
  return gate(p);
}

/** Texts of one asset group against the counts (required / recommended) and duplicates. */
export function textSetChecks(texts: AdAsset[]) {
  const by = (k: TextKind) => texts.filter((t) => t.rowType === k);
  const out: Array<{ level: "blokada" | "do_poprawy" | "ok"; message: string }> = [];
  for (const k of ["headline", "long_headline", "description"] as TextKind[]) {
    const s = PMAX_SPEC.texts[k];
    const n = by(k).length;
    if (n < s.minCount) out.push({ level: "blokada", message: `${s.label}: ${n} — wymagane min. ${s.minCount}.` });
    else if (n > s.maxCount) out.push({ level: "blokada", message: `${s.label}: ${n} — maksymalnie ${s.maxCount}.` });
    else if (n < s.recommendedCount) out.push({ level: "do_poprawy", message: `${s.label}: ${n} — zalecane ${s.recommendedCount}+.` });
    else out.push({ level: "ok", message: `${s.label}: ${n}/${s.maxCount}` });
  }
  if (by("headline").length && !by("headline").some((t) => [...(t.adText ?? "").trim()].length <= PMAX_SPEC.texts.headline.shortOneMaxChars))
    out.push({ level: "blokada", message: `Co najmniej jeden krótki nagłówek musi mieć ≤${PMAX_SPEC.texts.headline.shortOneMaxChars} znaków.` });
  const seen = new Map<string, string>();
  for (const t of texts) {
    const k = fold((t.adText ?? "").trim()).replace(/[^a-z0-9]/g, "");
    if (!k) continue;
    if (seen.has(k)) out.push({ level: "do_poprawy", message: `Duplikat: „${t.adText}” (${t.assetKey} = ${seen.get(k)}).` });
    else seen.set(k, t.assetKey);
  }
  return out;
}

/** Images of an asset group by format against required / recommended counts. */
export function imageSetChecks(images: AdAsset[]) {
  return PMAX_SPEC.images.formats.map((f) => {
    const n = images.filter((i) => formatKeyOf(i.aspectRatio, i.width, i.height) === f.key).length;
    const req = PMAX_SPEC.images.requiredPerGroup[f.key];
    return { format: f.key, count: n, required: req, recommended: f.recommendedCount, level: n < req ? ("blokada" as const) : n < f.recommendedCount ? ("do_poprawy" as const) : ("ok" as const) };
  });
}
