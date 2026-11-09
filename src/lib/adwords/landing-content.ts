/**
 * Google Adwords v5 — "Treść Landing Page": the landing page content of a project (CSV rows
 * `record_scope=landing_content`, `row_type=landing_page`), linked to the ads that lead to it.
 *
 * - variants LP_A_PLAN / LP_B_COST / LP_C_PROOF_SPEED; a variant without its own block of a section
 *   inherits it from LP_A_PLAN (the base),
 * - a claims registry: a number / record / rating without a confirmed proof blocks publication and is
 *   removed from the production render,
 * - the offer: the free Plan Rozwodu has to really exist (who makes it, when, in what form…) —
 *   otherwise `blocked_offer_validation`,
 * - Landing Match Score 0–100: heuristic and auditable, NOT a CVR forecast; gating is stronger than the score.
 */
import Papa from "papaparse";

// ------------------------------------------------------------------------------------------ constants

export const BASE_VARIANT = "LP_A_PLAN";
export const LP_VARIANTS: Record<string, { label: string; note: string }> = {
  LP_A_PLAN: { label: "A: Plan", note: "Domyślny eksperyment nr 1 — jeden mechanizm: najpierw plan, potem pozew." },
  LP_B_COST: { label: "B: Koszt", note: "Dla reklam o cenie — koszt naszej usługi znany przed decyzją." },
  LP_C_PROOF_SPEED: { label: "C: Proof + Speed", note: "Propozycja właściciela — zablokowana do weryfikacji danych (2600 rozwodów, 8 dni, opinie)." },
};
export const variantLabel = (id: string | null | undefined) => (id ? (LP_VARIANTS[id]?.label ?? id) : "—");

export const SECTIONS = ["hero", "trust_bar", "comparison", "plan_contents", "pricing", "case_study", "expert_video", "reviews", "form", "faq", "sticky_cta"] as const;
export const SECTION_LABEL: Record<string, string> = {
  hero: "Hero (pierwszy ekran)",
  trust_bar: "Pasek zaufania",
  comparison: "Tradycyjnie vs Nowy Etap",
  plan_contents: "Co zawiera plan",
  pricing: "Koszty",
  case_study: "Case study",
  expert_video: "Ekspert i wideo",
  reviews: "Opinie",
  form: "Formularz",
  faq: "FAQ",
  sticky_cta: "Sticky CTA (mobile)",
};

/** the offer, as the owner wants it vs as it is safe to say */
export const CTA_VERSIONS = {
  user: { label: "Wersja właściciela (propozycja — NIE zatwierdzony claim)", text: "Poznaj całkowity koszt rozwodu z góry i odbierz bezpłatny Plan" },
  safe: { label: "Wersja rekomendowana (gdy plan jest bezpłatny i wycena jasna)", text: "Poznaj całkowity koszt naszej usługi i odbierz bezpłatny Plan Rozwodu" },
  button: { label: "Przycisk (krótki, mobile)", text: "Poznaj koszt i odbierz bezpłatny plan" },
} as const;
export const OFFER_CORE = "Najpierw plan i ustalenia. Dopiero potem pozew o rozwód.";

export const FUNNEL = ["PMax reklama", "właściwy LP", "klik CTA", "start formularza", "wysłanie", "plan dostarczony", "kwalifikacja", "sprzedaż"];
export const LP_EVENTS: Array<{ name: string; when: string }> = [
  { name: "lp_view", when: "wyświetlenie strony — wariant + angle + UTMy" },
  { name: "lp_hero_cta_click", when: "klik CTA w hero" },
  { name: "lp_sticky_cta_click", when: "klik przyklejonego CTA (mobile)" },
  { name: "plan_form_start", when: "pierwsze pole formularza" },
  { name: "plan_form_submit", when: "wysłanie formularza (konwersja w Google Ads)" },
  { name: "plan_delivered", when: "plan dostarczony — rozróżnij dostawę automatyczną od kontaktu po rozmowie (z CRM)" },
  { name: "qualified_lead", when: "kwalifikacja leada (CRM)" },
  { name: "sale_closed", when: "sprzedaż + wartość usługi (CRM, import konwersji offline)" },
];

// ------------------------------------------------------------------------------------------ blocks

export interface LpBlock {
  id: string;
  assetKey: string;
  variantId: string;
  section: string;
  order: number;
  eyebrow: string;
  h1: string;
  h2: string;
  bullets: string[];
  body: string;
  primaryCta: string;
  secondaryCta: string;
  microcopy: string;
  visual: string;
  targetStep: string;
  event: string;
  angle: string;
  proofClaim: string;
  proofSourceRequired: string;
  proofStatus: string;
  proofScope: string;
  implementationNote: string;
  comparisonLeft: string;
  comparisonRight: string;
  photoId: string | null;
  hidden: boolean;
  /** shown in this variant but defined in the base variant */
  inherited?: boolean;
}
type Lp = Record<string, string | undefined> | null | undefined;
interface BlockSource {
  id: string;
  assetKey: string;
  landingVariantId?: string | null;
  body?: string | null;
  expertPhotoId?: string | null;
  lp?: unknown;
  extra?: unknown;
}

const splitList = (s: string | undefined) =>
  (s ?? "")
    .split(/\s*\|\s*|\n+/)
    .map((x) => x.trim())
    .filter(Boolean);

export function blockOf(a: BlockSource): LpBlock {
  const lp = (a.lp ?? {}) as Record<string, string | undefined>;
  const ex = (a.extra ?? {}) as Record<string, string | undefined>;
  return {
    id: a.id,
    assetKey: a.assetKey,
    variantId: a.landingVariantId ?? BASE_VARIANT,
    section: lp.landing_section ?? "hero",
    order: Number(lp.landing_order ?? 0) || 0,
    eyebrow: lp.landing_eyebrow ?? "",
    h1: lp.landing_h1 ?? "",
    h2: lp.landing_h2 ?? "",
    bullets: splitList(lp.landing_bullets),
    body: a.body ?? "",
    primaryCta: lp.landing_primary_cta ?? "",
    secondaryCta: lp.landing_secondary_cta ?? "",
    microcopy: lp.landing_microcopy ?? "",
    visual: lp.landing_visual_direction ?? "",
    targetStep: lp.landing_target_step ?? "",
    event: lp.landing_event ?? "",
    angle: lp.message_match_angle ?? "",
    proofClaim: lp.proof_claim ?? "",
    proofSourceRequired: lp.proof_source_required ?? "",
    proofStatus: lp.proof_status ?? "",
    proofScope: lp.proof_scope ?? "",
    implementationNote: lp.page_implementation_note ?? "",
    comparisonLeft: lp.comparison_left ?? ex.comparison_left ?? "",
    comparisonRight: lp.comparison_right ?? ex.comparison_right ?? "",
    photoId: lp._photo_id || a.expertPhotoId || null,
    hidden: lp._hidden === "true",
  };
}

/** the blocks of a variant: its own + the base variant's sections it does not override */
export function variantBlocks(all: LpBlock[], variantId: string): LpBlock[] {
  const own = all.filter((b) => b.variantId === variantId);
  const sections = new Set(own.map((b) => b.section));
  const inherited = variantId === BASE_VARIANT ? [] : all.filter((b) => b.variantId === BASE_VARIANT && !sections.has(b.section)).map((b) => ({ ...b, inherited: true }));
  return [...own, ...inherited].sort((a, b) => a.order - b.order || SECTIONS.indexOf(a.section as never) - SECTIONS.indexOf(b.section as never));
}
export const variantsOf = (all: LpBlock[]) => {
  const ids = [...new Set(all.map((b) => b.variantId))];
  return [...Object.keys(LP_VARIANTS).filter((k) => ids.includes(k)), ...ids.filter((k) => !LP_VARIANTS[k]).sort()];
};

export const blockTexts = (b: LpBlock) => [b.eyebrow, b.h1, b.h2, ...b.bullets, b.body, b.primaryCta, b.secondaryCta, b.microcopy, b.comparisonLeft, b.comparisonRight].filter(Boolean);
export const blockText = (b: LpBlock) => blockTexts(b).join("\n");

// ------------------------------------------------------------------------------------------ claims

export interface ClaimRec {
  id?: string;
  key: string;
  claimText: string;
  proofSource: string | null;
  dateChecked: string | Date | null;
  approvedBy: string | null;
  approvalStatus: string;
  claimScope: string | null;
  note?: string | null;
}
const DETECTORS: Array<{ key: string; label: string; re: RegExp; scope: string }> = [
  { key: "rating", label: "Ocena w Google", re: /\b\d[,.]\d\s*\/\s*5\b/, scope: "aktualna średnia z profilu Google + data" },
  { key: "reviews_count", label: "Liczba opinii", re: /(ponad\s+|\b)\d[\d\s ]*\+?\s*opini/i, scope: "rzeczywista liczba opinii z profilu Google + data" },
  { key: "divorces_count", label: "Liczba rozwodów", re: /\b\d[\d\s ]{2,}\s*(zakończonych\s+)?(spraw\s+)?rozwod/i, scope: "zakończone sprawy rozwodowe z CRM: okres, sposób liczenia" },
  { key: "people_count", label: "Liczba osób / klientów", re: /\b\d[\d\s ]{2,}\+?\s*(os[óo]b|klient)/i, scope: "z CRM — to nie to samo co liczba rozwodów" },
  { key: "record_days", label: "Rekord / czas sprawy w dniach", re: /\b\d+\s*dni\b/i, scope: "definicja (od–do), sygnatura, zgoda na użycie; tylko jako case study" },
  { key: "case_signature", label: "Sygnatura sprawy", re: /\b[IVX]+\s+C\s+\d+\/\d{2}\b/, scope: "zgodność orzeczenia, bez danych osobowych" },
  { key: "duration_compare", label: "Porównanie czasu (lata / miesiące)", re: /\b\d+\s*(lat|lata|miesi[ąę]c\w*)\b/i, scope: "porównywalne dane źródłowe dla obu liczb" },
  { key: "total_divorce_cost", label: "„Całkowity koszt rozwodu”", re: /całkowit\w*\s+koszt\w*\s+rozwodu/i, scope: "znany jest tylko koszt naszej usługi — opłaty sądowe i koszty osób trzecich są poza nim" },
  { key: "no_extra_costs", label: "Brak dodatkowych kosztów", re: /(zero|bez|żadnych)\s+dodatkowych\s+koszt/i, scope: "zapis w umowie" },
  { key: "guarantee", label: "Gwarancja", re: /gwarant/i, scope: "zapis w umowie, zakres gwarancji" },
];
export const CLAIM_LABEL: Record<string, string> = Object.fromEntries(DETECTORS.map((d) => [d.key, d.label]));
export const CLAIM_SCOPE_HINT: Record<string, string> = Object.fromEntries(DETECTORS.map((d) => [d.key, d.scope]));

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ł/g, "l")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 60);

/** the claims a text makes (by the registry key) */
export function claimsIn(text: string): Array<{ key: string; label: string; match: string }> {
  const out: Array<{ key: string; label: string; match: string }> = [];
  for (const d of DETECTORS) {
    const m = d.re.exec(text);
    if (m) out.push({ key: d.key, label: d.label, match: m[0].trim() });
  }
  return out;
}
/** the registry keys of a CSV proof_claim (detected patterns, or the claim itself) */
export function claimKeysOf(proofClaim: string): string[] {
  const found = claimsIn(proofClaim).map((c) => c.key);
  return found.length ? found : proofClaim.trim() ? [`proof_${slug(proofClaim)}`] : [];
}

export const isApproved = (key: string, claims: ClaimRec[]) => {
  const c = claims.find((x) => x.key === key);
  return !!c && c.approvalStatus === "approved" && !!c.proofSource?.trim() && !!c.dateChecked;
};

// ------------------------------------------------------------------------------------------ offer

export interface OfferInfo {
  producer?: string;
  when?: string;
  form?: string;
  contents?: string;
  requiresCall?: string;
  whatIsFree?: string;
  /** the fixed price of OUR service (when it is known) */
  servicePrice?: string;
  confirmed?: boolean;
  confirmedBy?: string | null;
  confirmedAt?: string | null;
}
export const OFFER_FIELDS: Array<[keyof OfferInfo, string, string]> = [
  ["producer", "Kto wytwarza plan", "np. mediator / prawnik prowadzący, na podstawie formularza"],
  ["when", "Kiedy klient go otrzymuje", "np. w ciągu 2 dni roboczych od rozmowy"],
  ["form", "W jakiej formie", "np. PDF na e-mail + omówienie telefoniczne"],
  ["contents", "Co plan obejmuje", "np. możliwe ustalenia, kolejne kroki, dokumenty, koszt naszej usługi"],
  ["requiresCall", "Czy wymaga rozmowy", "tak / nie — i jak długiej"],
  ["whatIsFree", "Co jest bezpłatne", "np. plan i rozmowa; płatne: prowadzenie sprawy"],
];
export const offerMissing = (o: OfferInfo | null | undefined) => OFFER_FIELDS.filter(([k]) => !String(o?.[k] ?? "").trim()).map(([, l]) => l);
/** the free plan is described AND a person confirmed it is really delivered */
export const offerValid = (o: OfferInfo | null | undefined) => !!o?.confirmed && offerMissing(o).length === 0;
const PLAN_RE = /(bezpłatn\w*\s+plan|plan\w*\s+rozwodu|odbierz\s+(bezpłatny\s+)?plan)/i;
export const mentionsPlan = (t: string) => PLAN_RE.test(t);

// ------------------------------------------------------------------------------------------ statuses

export type LpStatus = "blocked_claim_validation" | "blocked_offer_validation" | "blocked_missing_url";
export const STATUS_LABEL: Record<LpStatus, string> = {
  blocked_claim_validation: "blokada: twierdzenie bez dowodu",
  blocked_offer_validation: "blokada: oferta planu niepotwierdzona",
  blocked_missing_url: "blokada: brak prawdziwego URL",
};

export interface LpContext {
  offer: OfferInfo | null;
  claims: ClaimRec[];
  /** variant → URL / name */
  variants: Record<string, { url?: string | null; name?: string | null } | undefined>;
  theme?: { background: string; primary: string; accent: string; text: string; highlight: string; secondary: string } | null;
}

export function urlStatus(url: string | null | undefined): "ok" | "missing" | "invalid" | "placeholder" {
  const u = (url ?? "").trim();
  if (!u) return "missing";
  let parsed: URL;
  try {
    parsed = new URL(u);
  } catch {
    return "invalid";
  }
  if (parsed.protocol !== "https:") return "invalid";
  if (/(^|\.)(example\.(com|pl|org)|localhost|test|invalid)$/i.test(parsed.hostname) || /todo|do[-_ ]?uzupe|placeholder|xxx/i.test(u)) return "placeholder";
  return "ok";
}
export const URL_STATUS_LABEL = { ok: "URL OK", missing: "brak URL", invalid: "URL nieprawidłowy (wymagany https://)", placeholder: "URL zastępczy — nie prawdziwa strona" } as const;

export interface BlockFinding {
  claims: Array<{ key: string; label: string; match: string; approved: boolean }>;
  statuses: LpStatus[];
}
export function blockFindings(b: LpBlock, ctx: LpContext): BlockFinding {
  const text = blockText(b);
  const claims = claimsIn(text).map((c) => ({ ...c, approved: isApproved(c.key, ctx.claims) }));
  const statuses = new Set<LpStatus>();
  if (claims.some((c) => !c.approved)) statuses.add("blocked_claim_validation");
  if (b.proofClaim && /block|need|wymag|pending|niepotw|weryf/i.test(b.proofStatus || "pending") && !claimKeysOf(b.proofClaim).every((k) => isApproved(k, ctx.claims))) statuses.add("blocked_claim_validation");
  if (mentionsPlan(text) && !offerValid(ctx.offer)) statuses.add("blocked_offer_validation");
  return { claims, statuses: [...statuses] };
}

// ------------------------------------------------------------------------------------------ contrast

const lum = (hex: string) => {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex ?? "").trim());
  if (!m) return 0.5;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const contrast = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
/** the theme colour that stands out most on the page background (the CTA) + readable text on it */
export function ctaColors(t: NonNullable<LpContext["theme"]>) {
  const bg = [t.primary, t.accent, t.highlight, t.secondary].reduce((best, c) => (contrast(c, t.background) > contrast(best, t.background) ? c : best), t.primary);
  const fg0 = contrast(t.background, bg) >= contrast(t.text, bg) ? t.background : t.text;
  const fg = contrast(fg0, bg) >= 4.5 ? fg0 : lum(bg) > 0.4 ? "#111111" : "#ffffff";
  return { bg, fg, ratioOnPage: contrast(bg, t.background), ratioText: contrast(fg, bg) };
}

// ------------------------------------------------------------------------------------------ validator

export type CheckLevel = "ok" | "do_poprawy" | "blokada" | "info";
export interface LpCheck {
  level: CheckLevel;
  message: string;
}
const normCta = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, "").replace(/\s+/g, " ").trim();

export function validateVariant(variantId: string, blocks: LpBlock[], ctx: LpContext): { statuses: LpStatus[]; checks: LpCheck[] } {
  const vis = blocks.filter((b) => !b.hidden);
  const checks: LpCheck[] = [];
  const statuses = new Set<LpStatus>();
  const h1s = vis.filter((b) => b.h1.trim());
  if (h1s.length === 1) checks.push({ level: "ok", message: `Jedna H1: „${h1s[0].h1}”` });
  else checks.push({ level: "blokada", message: h1s.length ? `${h1s.length} bloki z H1 (${h1s.map((b) => SECTION_LABEL[b.section] ?? b.section).join(", ")}) — na stronie ma być jedna H1.` : "Brak H1 — hero musi mieć nagłówek główny." });
  const hero = vis.find((b) => b.section === "hero");
  if (!hero) checks.push({ level: "blokada", message: "Brak sekcji hero." });
  else if (vis[0] !== hero) checks.push({ level: "do_poprawy", message: "Hero powinno być pierwszym blokiem." });
  const primaries = [...new Set(vis.map((b) => b.primaryCta).filter(Boolean).map(normCta))];
  if (primaries.length === 1) checks.push({ level: "ok", message: `Jeden nadrzędny CTA: „${vis.find((b) => b.primaryCta)!.primaryCta}”` });
  else if (!primaries.length) checks.push({ level: "blokada", message: "Brak głównego CTA (landing_primary_cta)." });
  else checks.push({ level: "do_poprawy", message: `${primaries.length} różne główne CTA — zostaw jeden nadrzędny (pozostałe jako drugorzędne): ${primaries.join(" / ")}` });
  if (hero && hero.h1.length > 70) checks.push({ level: "do_poprawy", message: `H1 ma ${hero.h1.length} znaków — na telefonie (390 px) zajmie pół ekranu; celuj w ≤ 60.` });
  if (hero && hero.h2.length > 180) checks.push({ level: "do_poprawy", message: `H2 w hero ma ${hero.h2.length} znaków — skróć do ≤ 160.` });
  if (hero && claimsIn(`${hero.h1}`).length >= 2) checks.push({ level: "do_poprawy", message: "H1 łączy kilka obietnic / liczb — jeden mechanizm na pierwszym ekranie; dowody niżej jako osobne bloki." });
  if (ctx.theme) {
    const c = ctaColors(ctx.theme);
    const body = contrast(ctx.theme.text, ctx.theme.background);
    checks.push(c.ratioText >= 4.5 ? { level: "ok", message: `Kontrast tekstu przycisku ${c.ratioText.toFixed(1)}:1 (min. 4,5:1).` } : { level: "do_poprawy", message: `Kontrast tekstu przycisku ${c.ratioText.toFixed(1)}:1 — poniżej 4,5:1.` });
    if (c.ratioOnPage < 3) checks.push({ level: "do_poprawy", message: `Przycisk słabo odcina się od tła (${c.ratioOnPage.toFixed(1)}:1, min. 3:1 dla elementów interfejsu).` });
    checks.push(body >= 4.5 ? { level: "ok", message: `Kontrast tekstu strony ${body.toFixed(1)}:1.` } : { level: "blokada", message: `Kontrast tekstu strony ${body.toFixed(1)}:1 — nieczytelne (min. 4,5:1).` });
  }
  const url = ctx.variants[variantId]?.url ?? null;
  const us = urlStatus(url);
  if (us === "ok") checks.push({ level: "ok", message: `URL: ${url}` });
  else {
    statuses.add("blocked_missing_url");
    checks.push({ level: "blokada", message: `${URL_STATUS_LABEL[us]}${url ? `: ${url}` : ""} — ustaw prawdziwy adres wariantu.` });
  }
  const form = vis.find((b) => b.section === "form");
  if (!form) checks.push({ level: "do_poprawy", message: "Brak formularza — następny krok musi być na stronie." });
  else if (hero && mentionsPlan(blockText(hero)) && !mentionsPlan(blockText(form))) checks.push({ level: "do_poprawy", message: "Hero obiecuje plan, a formularz go nie wspomina — formularz ma prowadzić do otrzymania planu." });
  else checks.push({ level: "ok", message: "Formularz zgodny z ofertą." });
  if (form && form.bullets.length > 5) checks.push({ level: "do_poprawy", message: `Formularz ma ${form.bullets.length} pól — skróć do 3–4 (bez opisu sprawy jako pola wymaganego).` });
  if (form && /opis\s+sprawy|szczegół\w*\s+sprawy/i.test(blockText(form)) && !/opcjonaln/i.test(blockText(form))) checks.push({ level: "do_poprawy", message: "Nie wymagaj opisu sprawy w formularzu — dane wrażliwe; pole opcjonalne albo wcale." });
  for (const b of vis) {
    const f = blockFindings(b, ctx);
    f.statuses.forEach((s) => statuses.add(s));
    const bad = f.claims.filter((c) => !c.approved);
    if (bad.length) {
      const fake = b.section === "reviews" || b.section === "case_study" || b.section === "trust_bar";
      checks.push({ level: "blokada", message: `${SECTION_LABEL[b.section] ?? b.section}${b.inherited ? " (z wariantu A)" : ""}: ${bad.map((c) => `${c.label} „${c.match}”`).join(", ")} — ${fake ? "referencja / dowód bez potwierdzenia (brak fikcyjnych referencji)" : "twierdzenie bez dowodu"} → w eksporcie produkcyjnym zostanie usunięte.` });
    }
    if (bad.some((c) => c.key === "total_divorce_cost")) checks.push({ level: "blokada", message: "„Całkowity koszt rozwodu” — znany jest tylko koszt naszej usługi; użyj „całkowity koszt naszej usługi”." });
  }
  if (vis.some((b) => mentionsPlan(blockText(b))) && !offerValid(ctx.offer)) checks.push({ level: "blokada", message: `Oferta bezpłatnego planu niepotwierdzona${offerMissing(ctx.offer).length ? ` (brak: ${offerMissing(ctx.offer).join(", ")})` : ""} — nie obiecuj planu, dopóki nie jest dostarczany.` });
  if (variantId === "LP_C_PROOF_SPEED" && statuses.has("blocked_claim_validation")) checks.push({ level: "info", message: "Wariant C: rekomendacja — „2600 rozwodów” i „8 dni” jako osobne, zweryfikowane bloki dowodu niżej, nie w H1; 8 dni to przykład indywidualny, nie obietnica terminu." });
  if (!vis.some((b) => b.event)) checks.push({ level: "do_poprawy", message: "Żaden blok nie ma landing_event — oznacz CTA i formularz zdarzeniami analityki." });
  return { statuses: [...statuses], checks };
}

// ------------------------------------------------------------------------------------------ ads ↔ landing

export interface LandingAd {
  id: string;
  assetKey: string;
  rowType: string;
  conceptId?: string | null;
  headline?: string | null;
  subheadline?: string | null;
  adText?: string | null;
  cta?: string | null;
  screenText?: string | null;
  spokenText?: string | null;
  landingUrl?: string | null;
  landingVariantId?: string | null;
  experimentId?: string | null;
  variant?: string | null;
  lp?: Record<string, string> | null;
}
const words = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .replace(/[^\p{L}\p{N} ]/gu, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3),
  );
export const adCopy = (a: LandingAd) => [a.headline, a.subheadline, a.adText, a.screenText, a.lp?.video_hook_0_3].filter(Boolean).join(" ");

/** how well the ad and the variant's first screen say the same thing (0–100, heuristic) */
export function messageMatch(ad: LandingAd, blocks: LpBlock[]): { score: number; label: "dobra" | "częściowa" | "słaba" | "brak LP"; notes: string[] } {
  const hero = blocks.find((b) => b.section === "hero" && !b.hidden);
  if (!hero) return { score: 0, label: "brak LP", notes: ["Wariant nie ma hero."] };
  const notes: string[] = [];
  const a = words(adCopy(ad));
  const h = words(`${hero.eyebrow} ${hero.h1} ${hero.h2} ${hero.microcopy}`);
  let shared = 0;
  for (const w of a) if (h.has(w)) shared++;
  const ratio = a.size ? shared / Math.min(a.size, Math.max(1, h.size)) : 0;
  const textPts = Math.round(Math.min(1, ratio * 1.6) * 50);
  if (textPts < 20) notes.push("Hasło reklamy prawie nie występuje w hero.");
  const adAngle = ad.lp?.message_match_angle ?? "";
  const anglePts = adAngle && hero.angle ? (adAngle.toLowerCase() === hero.angle.toLowerCase() ? 25 : 0) : 10;
  if (adAngle && hero.angle && anglePts === 0) notes.push(`Angle reklamy „${adAngle}” ≠ angle LP „${hero.angle}”.`);
  const adCta = `${ad.cta ?? ""} ${ad.lp?.cta_button_short ?? ""}`;
  const lpCta = blocks.map((b) => b.primaryCta).join(" ");
  let ctaPts = 10;
  if (mentionsPlan(adCta) && mentionsPlan(lpCta)) ctaPts = 25;
  else if (/konsultac/i.test(adCta) && mentionsPlan(lpCta)) {
    ctaPts = 5;
    notes.push("CTA reklamy sprzedaje konsultację, a LP — Plan Rozwodu.");
  } else if (!adCta.trim()) ctaPts = 15;
  const score = Math.min(100, textPts + anglePts + ctaPts);
  return { score, label: score >= 75 ? "dobra" : score >= 50 ? "częściowa" : "słaba", notes };
}

/** where an ad leads and whether it may (variant, URL, block statuses) */
export function adLanding(ad: LandingAd, all: LpBlock[], ctx: LpContext) {
  const variantId = ad.landingVariantId ?? null;
  const own = ad.lp?.proof_status && /^blocked/.test(ad.lp.proof_status) ? [ad.lp.proof_status] : [];
  if (!variantId) return { variantId: null, url: ad.landingUrl ?? null, urlStatus: urlStatus(ad.landingUrl), match: null, statuses: own, note: ad.lp?.landing_target_step || "Brak docelowego wariantu LP" };
  const blocks = variantBlocks(all, variantId);
  const url = ctx.variants[variantId]?.url ?? ad.landingUrl ?? null;
  return { variantId, url, urlStatus: urlStatus(url), match: blocks.length ? messageMatch(ad, blocks) : null, statuses: own, note: null as string | null };
}

/** ads of one A/B test of the hook must share the same landing page */
export function experimentLandingCheck(ads: LandingAd[]): LpCheck | null {
  const byExp = new Map<string, Set<string>>();
  for (const a of ads) if (a.experimentId && a.variant) byExp.set(a.experimentId, (byExp.get(a.experimentId) ?? new Set()).add(a.landingVariantId ?? "—"));
  const bad = [...byExp].filter(([, v]) => v.size > 1);
  return bad.length ? { level: "blokada", message: `Testy ${bad.map(([k]) => k).join(", ")}: warianty A i B prowadzą na różne LP — w ścisłym teście hasła oba muszą używać tego samego LP.` } : byExp.size ? { level: "ok", message: "Warianty testów A/B prowadzą na ten sam LP." } : null;
}

// ------------------------------------------------------------------------------------------ score

export interface LpScorePart {
  key: string;
  label: string;
  max: number;
  points: number;
  notes: string[];
}
/** Landing Match Score 0–100 — heuristic, auditable, NOT a CVR forecast; separate from score_seed and campaign results */
export function landingScore(blocks: LpBlock[], ads: LandingAd[], ctx: LpContext, variantId: string): { total: number; parts: LpScorePart[] } {
  const vis = blocks.filter((b) => !b.hidden);
  const has = (s: string) => vis.some((b) => b.section === s);
  const hero = vis.find((b) => b.section === "hero");
  const linked = ads.filter((a) => a.landingVariantId === variantId);
  const parts: LpScorePart[] = [];
  {
    const n: string[] = [];
    let p = hero?.h1 ? 5 : 0;
    if (!hero?.h1) n.push("brak H1");
    const mm = linked.map((a) => messageMatch(a, blocks).score);
    const avg = mm.length ? mm.reduce((x, y) => x + y, 0) / mm.length : 0;
    p += Math.round((avg / 100) * 15);
    n.push(mm.length ? `średni message match ${Math.round(avg)}/100 z ${mm.length} reklam` : "żadna reklama nie prowadzi na ten wariant");
    const lpCta = vis.map((b) => b.primaryCta).join(" ");
    if (linked.length && linked.every((a) => !a.cta || mentionsPlan(`${a.cta} ${a.lp?.cta_button_short ?? ""}`) === mentionsPlan(lpCta))) p += 5;
    else n.push("CTA reklam i LP mówią o różnych krokach");
    parts.push({ key: "match", label: "Spójność reklama → H1 → CTA", max: 25, points: p, notes: n });
  }
  {
    const n: string[] = [];
    let p = 0;
    if (has("plan_contents")) p += 7;
    else n.push("brak „co zawiera plan”");
    if (has("pricing")) p += 7;
    else n.push("brak sekcji kosztów");
    if (has("form") || vis.some((b) => b.targetStep)) p += 6;
    else n.push("brak następnego kroku");
    parts.push({ key: "offer", label: "Klarowność oferty", max: 20, points: p, notes: n });
  }
  {
    const all = vis.flatMap((b) => blockFindings(b, ctx).claims);
    const ok = all.filter((c) => c.approved).length;
    const p = all.length ? Math.round((15 * ok) / all.length) : 10;
    parts.push({ key: "proof", label: "Uwiarygodnienie twierdzeń", max: 15, points: p, notes: [all.length ? `${ok}/${all.length} twierdzeń z dowodem` : "brak liczb do udowodnienia (neutralny proof)"] });
  }
  {
    const n: string[] = [];
    let p = 0;
    if (hero && hero.h1.length <= 60) p += 5;
    else n.push("H1 > 60 znaków");
    if (hero && hero.h2.length <= 160) p += 3;
    else n.push("H2 > 160 znaków");
    if (has("sticky_cta")) p += 4;
    else n.push("brak sticky CTA");
    if (!ctx.theme || ctaColors(ctx.theme).ratioText >= 4.5) p += 3;
    else n.push("kontrast CTA < 4,5:1");
    parts.push({ key: "mobile", label: "Czytelność na mobile / hierarchia", max: 15, points: p, notes: n });
  }
  {
    const n: string[] = [];
    const form = vis.find((b) => b.section === "form");
    let p = 0;
    if (form) p += 4;
    else n.push("brak formularza");
    if (form && form.bullets.length && form.bullets.length <= 4) p += 3;
    else if (form) n.push(form.bullets.length ? `${form.bullets.length} pól` : "pola formularza nieopisane (landing_bullets)");
    const prim = vis.find((b) => b.primaryCta)?.primaryCta ?? "";
    if (form && (!form.primaryCta || normCta(form.primaryCta) === normCta(prim))) p += 3;
    else if (form) n.push("przycisk formularza ≠ główne CTA");
    parts.push({ key: "form", label: "Prostota formularza", max: 10, points: p, notes: n });
  }
  {
    const n: string[] = [];
    let p = 0;
    if (has("faq")) p += 4;
    else n.push("brak FAQ");
    if (has("pricing")) p += 3;
    else n.push("brak kosztów");
    if (has("plan_contents") || has("comparison")) p += 3;
    else n.push("brak etapów");
    parts.push({ key: "certainty", label: "Redukcja niepewności", max: 10, points: p, notes: n });
  }
  {
    const n: string[] = [];
    let p = 0;
    if (urlStatus(ctx.variants[variantId]?.url) === "ok") p += 3;
    else n.push("URL nieustawiony");
    if (vis.some((b) => b.event)) p += 2;
    else n.push("brak zdarzeń analityki");
    parts.push({ key: "tech", label: "Dostępność, szybkość, QA", max: 5, points: p, notes: [...n, "szybkość (Core Web Vitals) sprawdź na żywej stronie"] });
  }
  return { total: parts.reduce((s, x) => s + x.points, 0), parts };
}

// ------------------------------------------------------------------------------------------ production

const SEGMENT = /(?<=[.!?·*])\s+|\s+·\s+/;
/**
 * The production render: hidden blocks out; proof / review / case-study blocks with an unconfirmed
 * claim removed; other sentences with an unconfirmed claim cut out (an emptied eyebrow gets a neutral line).
 */
export function productionBlocks(blocks: LpBlock[], ctx: LpContext): { blocks: LpBlock[]; removed: string[] } {
  const removed: string[] = [];
  const out: LpBlock[] = [];
  const bad = (t: string) => claimsIn(t).some((c) => !isApproved(c.key, ctx.claims));
  const clean = (t: string, where: string) => {
    if (!t || !bad(t)) return t;
    const kept = t.split(SEGMENT).filter((seg) => {
      const b = bad(seg);
      if (b) removed.push(`${where}: „${seg.trim()}”`);
      return !b;
    });
    return kept.join(" ").replace(/\s*[·*]\s*$/, "").trim();
  };
  for (const b of blocks) {
    if (b.hidden) continue;
    const f = blockFindings(b, ctx);
    const proofBlock = b.section === "reviews" || b.section === "case_study" || b.section === "trust_bar";
    if (proofBlock && f.statuses.includes("blocked_claim_validation")) {
      removed.push(`cały blok „${SECTION_LABEL[b.section] ?? b.section}” (dowód niepotwierdzony)`);
      continue;
    }
    const where = SECTION_LABEL[b.section] ?? b.section;
    const nb: LpBlock = {
      ...b,
      eyebrow: clean(b.eyebrow, where),
      h1: clean(b.h1, where),
      h2: clean(b.h2, where),
      bullets: b.bullets.map((x) => clean(x, where)).filter(Boolean),
      body: clean(b.body, where),
      microcopy: clean(b.microcopy, where),
      comparisonLeft: clean(b.comparisonLeft, where),
      comparisonRight: clean(b.comparisonRight, where),
    };
    if (b.section === "hero" && b.eyebrow && !nb.eyebrow) nb.eyebrow = "Opinie klientów w Google";
    out.push(nb);
  }
  return { blocks: out, removed };
}

// ------------------------------------------------------------------------------------------ exports

const LP_CSV_COLS = ["landing_variant_id", "landing_order", "landing_section", "landing_eyebrow", "landing_h1", "landing_h2", "landing_bullets", "body", "landing_primary_cta", "landing_secondary_cta", "landing_microcopy", "landing_visual_direction", "landing_target_step", "landing_event", "proof_claim", "proof_status", "inherited_from_base"];
export function lpCsv(variantId: string, blocks: LpBlock[]): string {
  const rows = blocks.map((b) => [variantId, String(b.order), b.section, b.eyebrow, b.h1, b.h2, b.bullets.join(" | "), b.body, b.primaryCta, b.secondaryCta, b.microcopy, b.visual, b.targetStep, b.event, b.proofClaim, b.proofStatus, b.inherited ? BASE_VARIANT : ""]);
  return "﻿" + Papa.unparse({ fields: LP_CSV_COLS, data: rows }, { delimiter: ";", newline: "\r\n" });
}

export interface LpExportMeta {
  projectName: string;
  variantId: string;
  url: string | null;
  mode: "preview" | "production";
  statuses: LpStatus[];
  removed?: string[];
}
export function lpMarkdown(blocks: LpBlock[], m: LpExportMeta): string {
  const L: string[] = [`<!-- ${m.projectName} · ${variantLabel(m.variantId)} · ${m.mode === "production" ? "eksport produkcyjny" : "PODGLĄD ROBOCZY — nie publikować"} · URL: ${m.url ?? "brak"} -->`, ""];
  if (m.mode === "preview" && m.statuses.length) L.push(`> ⚠ ${m.statuses.map((s) => STATUS_LABEL[s]).join(" · ")}`, "");
  for (const b of blocks) {
    L.push(`<!-- ${b.section}${b.event ? ` · event: ${b.event}` : ""} -->`);
    if (b.eyebrow) L.push(`_${b.eyebrow}_`);
    if (b.h1) L.push(`# ${b.h1}`);
    else L.push(`## ${b.h2 || SECTION_LABEL[b.section] || b.section}`);
    if (b.h1 && b.h2) L.push("", b.h2);
    if (b.body) L.push("", b.body);
    if (b.comparisonLeft || b.comparisonRight) L.push("", `| Tradycyjnie | Nowy Etap |`, `|---|---|`, `| ${b.comparisonLeft} | ${b.comparisonRight} |`);
    if (b.bullets.length) L.push("", ...b.bullets.map((x) => `- ${x}`));
    if (b.primaryCta) L.push("", `**[${b.primaryCta}](#formularz)**${b.secondaryCta ? ` · [${b.secondaryCta}](#)` : ""}`);
    if (b.microcopy) L.push("", `<small>${b.microcopy}</small>`);
    L.push("");
  }
  if (m.removed?.length) L.push("<!-- usunięte z eksportu produkcyjnego (brak dowodu):", ...m.removed.map((r) => `  - ${r}`), "-->");
  return L.join("\n");
}

export function lpJson(blocks: LpBlock[], m: LpExportMeta, theme: LpContext["theme"]) {
  return {
    schema: "askby.landing.v1",
    project: m.projectName,
    variant: m.variantId,
    variantLabel: variantLabel(m.variantId),
    url: m.url,
    mode: m.mode,
    statuses: m.statuses,
    removed: m.removed ?? [],
    theme,
    events: LP_EVENTS.map((e) => e.name),
    sections: blocks.map((b) => ({ section: b.section, order: b.order, eyebrow: b.eyebrow || null, h1: b.h1 || null, h2: b.h2 || null, body: b.body || null, bullets: b.bullets, comparison: b.comparisonLeft || b.comparisonRight ? { left: b.comparisonLeft, right: b.comparisonRight } : null, primaryCta: b.primaryCta || null, secondaryCta: b.secondaryCta || null, microcopy: b.microcopy || null, visual: b.visual || null, event: b.event || null, photoId: b.photoId, inherited: !!b.inherited })),
  };
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const FONT_FILES: Record<string, string> = { "DM Sans": "DMSans", Inter: "Inter", Manrope: "Manrope", Montserrat: "Montserrat", Poppins: "Poppins" };

export interface LpHtmlOptions {
  theme: NonNullable<LpContext["theme"]> & { questionFont?: string; subtitleFont?: string };
  logoUrl?: string | null;
  photoUrl?: (id: string | null) => string | null;
  /** origin of the app's /fonts (preview); without it Google Fonts are linked */
  fontBase?: string | null;
  /** preview: flag the findings of each block */
  findings?: (b: LpBlock) => BlockFinding | null;
  businessName?: string;
}
/** semantic HTML (one H1, H2 per section, CTA links, the form) — the same document is the preview and the export */
export function lpHtml(blocks: LpBlock[], m: LpExportMeta, o: LpHtmlOptions): string {
  const t = o.theme;
  const c = ctaColors(t);
  const head = o.theme.questionFont || "Inter";
  const bodyF = o.theme.subtitleFont || head;
  const fams = [...new Set([head, bodyF])];
  const fontCss = o.fontBase
    ? fams
        .filter((f) => FONT_FILES[f])
        .flatMap((f) => [400, 600, 800].map((w) => `@font-face{font-family:"${f}";src:url("${o.fontBase}/fonts/${FONT_FILES[f]}-${w}.ttf") format("truetype");font-weight:${w};font-display:swap}`))
        .join("\n")
    : "";
  const gf = !o.fontBase ? `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?${fams.map((f) => `family=${encodeURIComponent(f).replace(/%20/g, "+")}:wght@400;600;800`).join("&")}&display=swap">` : "";
  const cta = (text: string, event: string, cls = "cta") => `<a class="${cls}" href="#formularz" data-event="${esc(event)}">${esc(text)}</a>`;
  const sec = (b: LpBlock, inner: string, alt = false) => {
    const f = m.mode === "preview" ? o.findings?.(b) : null;
    const warn = f && f.statuses.length ? `<p class="warn">⚠ ${f.statuses.map((s) => STATUS_LABEL[s]).join(" · ")}${f.claims.filter((x) => !x.approved).length ? ` — ${f.claims.filter((x) => !x.approved).map((x) => esc(x.match)).join(", ")}` : ""}</p>` : "";
    return `<section class="s s-${b.section}${alt ? " alt" : ""}${f && f.statuses.length ? " flagged" : ""}" data-section="${b.section}"${b.event ? ` data-event="${esc(b.event)}"` : ""}><div class="w">${warn}${inner}</div></section>`;
  };
  const list = (xs: string[]) => (xs.length ? `<ul>${xs.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : "");
  const h2 = (b: LpBlock) => `<h2>${esc(b.h2 || SECTION_LABEL[b.section] || b.section)}</h2>`;
  const p = (s: string, cls = "") => (s ? `<p${cls ? ` class="${cls}"` : ""}>${esc(s)}</p>` : "");
  const primary = blocks.find((b) => b.primaryCta)?.primaryCta ?? CTA_VERSIONS.button.text;
  let alt = false;
  const parts = blocks
    .filter((b) => b.section !== "sticky_cta")
    .map((b) => {
      alt = !alt;
      const photo = o.photoUrl?.(b.photoId) ?? null;
      switch (b.section) {
        case "hero":
          return `<header class="hero" data-section="hero"><div class="w hero-grid"><div>${m.mode === "preview" && o.findings?.(b)?.statuses.length ? `<p class="warn">⚠ ${o.findings!(b)!.statuses.map((s) => STATUS_LABEL[s]).join(" · ")}</p>` : ""}${b.eyebrow ? `<p class="eyebrow">${esc(b.eyebrow)}</p>` : ""}<h1>${esc(b.h1)}</h1>${p(b.h2, "lead")}${b.primaryCta ? cta(b.primaryCta, b.event || "lp_hero_cta_click") : ""}${p(b.microcopy, "micro")}</div><div class="hero-img">${photo ? `<img src="${esc(photo)}" alt="">` : `<span>${esc(b.visual || "zdjęcie: realny mediator / mediacja")}</span>`}</div></div></header>`;
        case "comparison":
          return sec(b, `${h2(b)}<div class="cmp"><div><h3>Tradycyjnie</h3>${p(b.comparisonLeft)}</div><div class="nowy"><h3>${esc(o.businessName ?? "Z nami")}</h3>${p(b.comparisonRight)}</div></div>${list(b.bullets)}`, alt);
        case "form":
          return sec(
            b,
            `${h2(b)}${p(b.body)}<form id="formularz" data-event="plan_form_submit" onsubmit="return false">${(b.bullets.length ? b.bullets : ["Imię", "Telefon", "E-mail"]).map((f) => `<label>${esc(f)}<input name="${esc(f.toLowerCase().replace(/[^a-z0-9ąćęłńóśźż]+/g, "_"))}" data-event-start="plan_form_start"></label>`).join("")}<label class="consent"><input type="checkbox"> Zgoda na kontakt w sprawie planu · polityka prywatności</label><button type="submit" class="cta">${esc(b.primaryCta || primary)}</button>${p(b.microcopy, "micro")}</form>`,
            alt,
          );
        case "faq":
          return sec(b, `${h2(b)}${b.bullets.map((q) => `<details><summary>${esc(q.split(/\s*[—–]\s*|\?\s+/)[0].replace(/\??$/, "?"))}</summary>${p(q.includes("—") || q.includes("–") ? q.split(/\s*[—–]\s*/).slice(1).join(" — ") : "")}</details>`).join("")}${p(b.body)}`, alt);
        case "expert_video":
          return sec(b, `${h2(b)}<div class="expert">${photo ? `<img src="${esc(photo)}" alt="">` : `<span class="ph">wideo / zdjęcie eksperta</span>`}<div>${p(b.body)}${list(b.bullets)}${b.secondaryCta ? `<a class="link" href="#">${esc(b.secondaryCta)}</a>` : ""}</div></div>`, alt);
        default:
          return sec(b, `${b.eyebrow ? `<p class="eyebrow">${esc(b.eyebrow)}</p>` : ""}${h2(b)}${p(b.body)}${list(b.bullets)}${b.primaryCta ? cta(b.primaryCta, b.event || "lp_cta_click") : ""}${p(b.microcopy, "micro")}`, alt);
      }
    })
    .join("\n");
  const sticky = blocks.find((b) => b.section === "sticky_cta");
  const banner = m.mode === "preview" && m.statuses.length ? `<div class="banner">PODGLĄD ROBOCZY — ${m.statuses.map((s) => STATUS_LABEL[s]).join(" · ")}</div>` : "";
  return `<!doctype html>
<html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(blocks.find((b) => b.h1)?.h1 ?? m.projectName)}</title>
${m.mode === "preview" ? '<meta name="robots" content="noindex">' : ""}
${gf}
<style>
${fontCss}
:root{--bg:${t.background};--text:${t.text};--accent:${t.accent};--sec:${t.secondary};--cta:${c.bg};--cta-text:${c.fg}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:400 17px/1.6 "${bodyF}",system-ui,sans-serif}
h1,h2,h3{font-family:"${head}",system-ui,sans-serif;line-height:1.15;margin:0 0 .5em}h1{font-weight:800;font-size:clamp(30px,4.2vw,54px)}h2{font-weight:800;font-size:clamp(24px,2.6vw,34px)}h3{font-size:19px}
.w{max-width:1120px;margin:0 auto;padding:0 24px}.top{display:flex;align-items:center;justify-content:space-between;padding:16px 24px;max-width:1120px;margin:0 auto}.top img{height:34px}.top .tel{border:1px solid var(--cta);color:var(--cta);border-radius:999px;padding:6px 14px;text-decoration:none;font-size:14px}
.hero{padding:40px 0 56px}.hero-grid{display:grid;grid-template-columns:1.15fr 1fr;gap:40px;align-items:center}.eyebrow{font-size:14px;letter-spacing:.02em;color:var(--accent);margin:0 0 12px}.lead{font-size:19px;opacity:.9;margin:0 0 24px}.micro{font-size:14px;opacity:.75;margin:12px 0 0}
.hero-img{aspect-ratio:4/3;border-radius:16px;overflow:hidden;background:linear-gradient(135deg,var(--sec),var(--accent));display:grid;place-items:center;color:#fff;font-size:14px;text-align:center;padding:0}.hero-img img{width:100%;height:100%;object-fit:cover}
.cta{display:inline-flex;align-items:center;justify-content:center;text-align:center;line-height:1.25;min-height:52px;padding:0 28px;border-radius:12px;background:var(--cta);color:var(--cta-text);font:700 17px "${head}",system-ui,sans-serif;text-decoration:none;border:0;cursor:pointer}
.s{padding:56px 0}.s.alt{background:color-mix(in srgb,var(--sec) 14%,var(--bg))}ul{padding-left:1.2em}li{margin:.3em 0}
.cmp{display:grid;grid-template-columns:1fr 1fr;gap:16px}.cmp>div{border:1px solid color-mix(in srgb,var(--text) 15%,transparent);border-radius:14px;padding:20px}.cmp .nowy{border-color:var(--cta)}
.expert{display:grid;grid-template-columns:280px 1fr;gap:28px;align-items:center}.expert img,.expert .ph{width:100%;aspect-ratio:1;object-fit:cover;border-radius:16px;background:var(--sec);display:grid;place-items:center;color:#fff;font-size:13px}
form{display:grid;gap:12px;max-width:520px}label{display:grid;gap:4px;font-size:15px}input{height:48px;border-radius:10px;border:1px solid color-mix(in srgb,var(--text) 30%,transparent);padding:0 12px;font:inherit;background:transparent;color:inherit}.consent{display:flex;gap:8px;align-items:flex-start;font-size:13px}.consent input{height:18px;width:18px}
details{border-bottom:1px solid color-mix(in srgb,var(--text) 15%,transparent);padding:14px 0}summary{cursor:pointer;font-weight:600}
.sticky{display:none}footer{padding:28px 24px 96px;font-size:13px;opacity:.75;text-align:center}
.banner{position:sticky;top:0;z-index:5;background:#b91c1c;color:#fff;font:600 13px system-ui;padding:8px 16px;text-align:center}.warn{background:#fee2e2;color:#991b1b;border-radius:8px;padding:6px 10px;font:600 13px system-ui;margin:0 0 12px}.flagged{outline:2px dashed #dc2626;outline-offset:-6px}
@media (max-width:760px){body{font-size:16px}.hero{padding:20px 0 36px}.hero-grid,.cmp,.expert{grid-template-columns:1fr}.hero-img{order:2;aspect-ratio:16/10}.s{padding:40px 0}.cta{width:100%}
.sticky{display:flex;gap:8px;position:fixed;left:0;right:0;bottom:0;padding:10px 12px;background:var(--bg);border-top:1px solid color-mix(in srgb,var(--text) 15%,transparent);z-index:4}.sticky .cta{flex:1;min-height:48px}.sticky .tel{display:grid;place-items:center;min-width:48px;border:1px solid var(--cta);border-radius:12px;color:var(--cta);text-decoration:none}}
</style></head>
<body data-variant="${esc(m.variantId)}" data-event-view="lp_view">
${banner}
<div class="top">${o.logoUrl ? `<img src="${esc(o.logoUrl)}" alt="${esc(o.businessName ?? m.projectName)}">` : `<strong>${esc(o.businessName ?? m.projectName)}</strong>`}<a class="tel" href="tel:">☎ Zadzwoń</a></div>
<main>
${parts}
</main>
<footer>${esc(o.businessName ?? m.projectName)} · adres · NIP · telefon · e-mail · <a href="#">Polityka prywatności</a> · <a href="#">Regulamin</a></footer>
${sticky || blocks.length ? `<div class="sticky">${cta(sticky?.primaryCta || primary, sticky?.event || "lp_sticky_cta_click")}<a class="tel" href="tel:" aria-label="Zadzwoń">☎</a></div>` : ""}
</body></html>`;
}

// ------------------------------------------------------------------------------------------ ad gates

/** v5 rules for the ads (context of the project: offer + approved claims) */
export function adClaimProblems(text: string, lp: Record<string, string> | null | undefined, opts: { offerValid: boolean; approvedClaims: string[]; assetApproved: boolean; landingUrl?: string | null }): Array<{ level: "blokada" | "do_poprawy"; message: string }> {
  const out: Array<{ level: "blokada" | "do_poprawy"; message: string }> = [];
  for (const c of claimsIn(text)) {
    if (opts.approvedClaims.includes(c.key)) continue;
    if (c.key === "total_divorce_cost") out.push({ level: "blokada", message: "„Całkowity koszt rozwodu” — znany jest tylko koszt naszej usługi (blocked_claim_validation)." });
    else if (!opts.assetApproved) out.push({ level: "blokada", message: `${c.label} „${c.match}” bez potwierdzenia w rejestrze twierdzeń (blocked_claim_validation).` });
  }
  if (mentionsPlan(text) && !opts.offerValid) out.push({ level: "blokada", message: "Obiecuje bezpłatny plan, a oferta nie jest potwierdzona w zakładce Treść Landing Page (blocked_offer_validation)." });
  const st = lp?.proof_status ?? "";
  const cleared =
    st === "blocked_missing_url" ? urlStatus(opts.landingUrl) === "ok" : st === "blocked_offer_validation" ? opts.offerValid : opts.assetApproved || (!!lp?.proof_claim && claimKeysOf(lp.proof_claim).every((k) => opts.approvedClaims.includes(k)));
  if (/^blocked_/.test(st) && !cleared) out.push({ level: "blokada", message: `Status z CSV: ${st}${lp?.proof_source_required ? ` — wymagane: ${lp.proof_source_required}` : ""}.` });
  return out;
}
