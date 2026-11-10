/**
 * Meta (Facebook / Instagram) ads — a simplified sibling of the Google Adwords set: the texts of Ads
 * Manager + one banner in three formats, drawn by the same function as the PMax creatives (the gold
 * frame, one big headline, the high-contrast CTA), with and / or without the expert's photo. An ad leads
 * to a website or to a webinar page — then its date is on the banner and the ad expires after it.
 */
import Papa from "papaparse";
import { adClaimProblems, urlStatus } from "./landing-content";
import { comparisonOf } from "./draw";

/** feed 1:1 and 4:5, Stories / Reels 9:16 with Meta's Reels safe zone (top 14%, bottom 35%, sides 6%); Ads Guide sizes 1440 px */
export const META_FORMATS = [
  { key: "square", label: "Feed 1:1", width: 1440, height: 1440, insets: null },
  { key: "feed", label: "Feed 4:5", width: 1440, height: 1800, insets: null },
  { key: "story", label: "Stories / Reels 9:16", width: 1440, height: 2560, insets: { top: 0.14, bottom: 0.35, left: 0.06, right: 0.06 } },
] as const;
export type MetaFormatKey = (typeof META_FORMATS)[number]["key"];

/** text lengths before Meta truncates ("… Więcej") — recommendations, not hard limits; Ads Guide (single image): headline 27, primary text 50–150 (~125 shown) */
export const META_LIMITS = { primaryText: 125, metaHeadline: 27, description: 30 } as const;

/** the CTA button of Ads Manager (API enum → the Polish label) */
export const META_CTAS: Record<string, string> = {
  LEARN_MORE: "Dowiedz się więcej",
  SIGN_UP: "Zarejestruj się",
  SUBSCRIBE: "Subskrybuj",
  BOOK_NOW: "Zarezerwuj",
  CONTACT_US: "Skontaktuj się z nami",
  MESSAGE_PAGE: "Wyślij wiadomość",
  DOWNLOAD: "Pobierz",
  GET_QUOTE: "Uzyskaj wycenę",
  APPLY_NOW: "Złóż wniosek",
  CALL_NOW: "Zadzwoń",
};

export interface MetaAdData {
  id?: string;
  name: string;
  primaryText: string;
  metaHeadline: string;
  description: string;
  ctaButton: string;
  headline: string;
  ctaImage: string;
  destination: string;
  url: string | null;
  webinarTitle: string | null;
  webinarAt: string | Date | null;
  layout: string;
  body: string | null;
  withoutExpert: boolean;
  photoIds: string[];
  /** the pill at the top ("Bezpłatny webinar on-line"); empty = none (a webinar: "Webinar") */
  badgeText?: string | null;
  /** the day and date in gold under the pill */
  showDate?: boolean;
  /** comparison layout: comparison_title / _left_label / _left / _right_label / _right */
  extra?: Record<string, string | undefined> | null;
  /** AI infographic version: format → media asset id */
  infographic?: Partial<Record<MetaFormatKey, string>> | null;
}

const WARSAW = "Europe/Warsaw";
/** "WEBINAR · wt. 24 lis · 19:00" — in Warsaw time, the same on the server and in the browser */
export function webinarBadge(at: string | Date | null | undefined): string | null {
  if (!at) return null;
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return null;
  const day = new Intl.DateTimeFormat("pl-PL", { timeZone: WARSAW, weekday: "short", day: "numeric", month: "short" }).format(d).replace(/\.$/, "");
  const time = new Intl.DateTimeFormat("pl-PL", { timeZone: WARSAW, hour: "2-digit", minute: "2-digit" }).format(d);
  return `Webinar · ${day} · ${time}`;
}

/** "wtorek, 24 listopada · 19:00" — the date line on the banner (Warsaw time) */
export function eventDateLine(at: string | Date | null | undefined): string | null {
  if (!at) return null;
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return null;
  const part = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("pl-PL", { timeZone: WARSAW, ...o }).format(d);
  const cap = (s: string) => s.charAt(0).toLocaleUpperCase("pl-PL") + s.slice(1);
  const time = part({ hour: "2-digit", minute: "2-digit" });
  const month = part({ day: "numeric", month: "long" }).replace(/^\d+\s*/, "");
  // two lines: "Wtorek 20:00," / "17 Listopada"
  return `${cap(part({ weekday: "long" }))} ${time},\n${part({ day: "numeric" })} ${cap(month)}`;
}
export const DEFAULT_WEBINAR_BADGE = "Bezpłatny webinar on-line";

/** Warsaw's offset (minutes) at a moment */
function warsawOffset(d: Date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: WARSAW, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(d).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
  return Math.round((asUtc - Math.floor(d.getTime() / 60000) * 60000) / 60000);
}
/** "2026-11-24T19:00" typed as Warsaw time → ISO (whatever the computer's time zone) */
export function warsawToIso(local: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local);
  if (!m) return null;
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  const off = warsawOffset(new Date(guess));
  return new Date(guess - off * 60000).toISOString();
}
/** ISO → "2026-11-24T19:00" in Warsaw time (for the datetime-local field) */
export function isoToWarsaw(at: string | Date | null | undefined): string {
  if (!at) return "";
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "";
  return new Date(d.getTime() + warsawOffset(d) * 60000).toISOString().slice(0, 16);
}

/** the versions of an ad: without the photo (if wanted) + one per chosen photo */
export const hasInfographic = (ad: Pick<MetaAdData, "infographic">) => META_FORMATS.every((f) => !!ad.infographic?.[f.key]);
export const metaVersions = (ad: Pick<MetaAdData, "withoutExpert" | "photoIds" | "infographic">) => [...(ad.withoutExpert || !ad.photoIds.length ? ["none"] : []), ...ad.photoIds, ...(hasInfographic(ad) ? ["info"] : [])];

/** what the banner of one format / version shows (input of drawCreative, without theme / logo / photo) */
export function metaCreative(ad: MetaAdData, format: MetaFormatKey, mode: boolean | "info") {
  const f = META_FORMATS.find((x) => x.key === format)!;
  const cmp = comparisonOf(ad.extra);
  const layout = mode === "info" ? "infographic" : mode ? "expert_split" : ad.layout === "process_steps" && ad.body?.trim() ? "process_steps" : ad.layout === "comparison" && cmp ? "comparison" : "typographic";
  return {
    width: f.width,
    height: f.height,
    layout: layout as "expert_split" | "process_steps" | "typographic" | "comparison" | "infographic",
    copy: { headline: ad.headline || cmp?.title || ad.metaHeadline || ad.name, body: ad.body, comparison: layout === "comparison" ? cmp : null, cta: ad.ctaImage || META_CTAS[ad.ctaButton] || "Dowiedz się więcej", badge: ad.badgeText?.trim() || (ad.destination === "webinar" ? "Webinar" : null), dateLine: ad.showDate !== false ? eventDateLine(ad.webinarAt) : null },
    safeMargin: 0.1,
    safeInsets: f.insets,
  };
}

export type MetaCheck = { level: "blokada" | "do_poprawy" | "ok"; message: string };
/** checks of one ad (the banner overflow is measured where it is drawn) */
export function metaChecks(ad: MetaAdData, ctx: { photos: Array<{ id: string; consentConfirmed: boolean; name: string }>; lp?: { offerValid: boolean; approvedClaims: string[] } | null; now?: Date }): MetaCheck[] {
  const out: MetaCheck[] = [];
  const len = (s: string) => [...(s ?? "")].length;
  if (!ad.headline.trim() && !(ad.layout === "comparison" && comparisonOf(ad.extra))) out.push({ level: "blokada", message: "Brak hasła na grafice." });
  if (ad.layout === "comparison" && !comparisonOf(ad.extra) && (ad.withoutExpert || !ad.photoIds.length)) out.push({ level: "do_poprawy", message: "Układ porównania bez treści obu kart — uzupełnij lewą i prawą stronę." });
  if (ad.infographic && hasInfographic(ad)) out.push({ level: "do_poprawy", message: "Wersja z infografiką: tekst na obrazie napisało AI — sprawdź pisownię i liczby przed publikacją." });
  if (!ad.primaryText.trim()) out.push({ level: "do_poprawy", message: "Brak tekstu głównego (nad grafiką)." });
  if (len(ad.primaryText) > META_LIMITS.primaryText) out.push({ level: "do_poprawy", message: `Tekst główny ${len(ad.primaryText)} znaków — Meta pokaże ~${META_LIMITS.primaryText}, resztę po „Więcej”; najważniejsze daj na początek.` });
  if (len(ad.metaHeadline) > META_LIMITS.metaHeadline) out.push({ level: "do_poprawy", message: `Nagłówek ${len(ad.metaHeadline)} znaków — zalecane ≤ ${META_LIMITS.metaHeadline} (dalej ucinany).` });
  if (len(ad.description) > META_LIMITS.description) out.push({ level: "do_poprawy", message: `Opis ${len(ad.description)} znaków — zalecane ≤ ${META_LIMITS.description}.` });
  const us = urlStatus(ad.url);
  if (us !== "ok") out.push({ level: "blokada", message: us === "missing" ? (ad.destination === "webinar" ? "Brak adresu strony webinaru." : "Brak adresu strony.") : us === "placeholder" ? "Adres zastępczy — podaj prawdziwą stronę." : "Adres musi zaczynać się od https://." });
  if (ad.destination === "webinar") {
    const at = ad.webinarAt ? new Date(ad.webinarAt) : null;
    if (!at || Number.isNaN(at.getTime())) out.push({ level: "blokada", message: "Webinar bez daty i godziny." });
    else if (at.getTime() < (ctx.now ?? new Date()).getTime()) out.push({ level: "blokada", message: `Webinar już się odbył (${webinarBadge(at)}) — wyłącz reklamę albo zmień datę.` });
    if (!ad.webinarTitle?.trim()) out.push({ level: "do_poprawy", message: "Brak tytułu webinaru." });
    if (!["SIGN_UP", "SUBSCRIBE", "BOOK_NOW", "LEARN_MORE"].includes(ad.ctaButton)) out.push({ level: "do_poprawy", message: "Przy webinarze lepszy przycisk „Zarejestruj się”." });
  }
  for (const id of ad.photoIds) {
    const p = ctx.photos.find((x) => x.id === id);
    if (!p) out.push({ level: "blokada", message: "Wybrane zdjęcie eksperta nie istnieje." });
    else if (!p.consentConfirmed) out.push({ level: "blokada", message: `Brak zgody na reklamowe użycie zdjęcia: ${p.name}.` });
  }
  // the project's claims / offer rules (v5 projects) — the same as for the Google ads
  if (ctx.lp) for (const p of adClaimProblems([ad.headline, ad.primaryText, ad.metaHeadline, ad.description, ad.ctaImage].join(" "), null, { ...ctx.lp, assetApproved: false, landingUrl: ad.url })) out.push({ level: p.level, message: p.message });
  if (!out.length) out.push({ level: "ok", message: "Gotowe do Ads Managera." });
  return out;
}
export const metaStatus = (checks: MetaCheck[]) => (checks.some((c) => c.level === "blokada") ? "blokada" : checks.some((c) => c.level === "do_poprawy") ? "do_poprawy" : "gotowe");

export const metaSlug = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ł/g, "l")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "reklama";

/** the texts for Ads Manager, one row per ad version (the image files of each format named) */
export function metaCsv(rows: Array<{ ad: MetaAdData; version: string; versionLabel: string; files: string[] }>): string {
  const data = rows.map(({ ad, versionLabel, files }) => ({
    "Ad name": `${ad.name}${versionLabel ? ` - ${versionLabel}` : ""}`,
    "Primary text": ad.primaryText,
    Headline: ad.metaHeadline,
    Description: ad.description,
    "Call to action": ad.ctaButton,
    "Call to action (PL)": META_CTAS[ad.ctaButton] ?? "",
    "Website URL": ad.url ?? "",
    Destination: ad.destination === "webinar" ? "webinar" : "strona",
    "Webinar title": ad.webinarTitle ?? "",
    "Webinar date (Warsaw)": ad.destination === "webinar" ? (webinarBadge(ad.webinarAt) ?? "") : "",
    "Image files": files.join(" | "),
  }));
  const out: Array<Record<string, string>> = data.length ? data : [{ "Ad name": "" }];
  return "\uFEFF" + Papa.unparse(out, { delimiter: ";" });
}
