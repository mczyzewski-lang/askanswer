/**
 * Google Adwords — "Landing page": how the page an ad leads to should look. Built from the project's
 * own data (the concept's headline / CTA = message match, the expert photo with consent, the business
 * name, the price texts) plus the rules Google rates a landing page by (relevance, transparency, easy
 * navigation, mobile, speed). A specification for the web team — it does not build or publish the page.
 */
import { hasPrice } from "./score";

export const LANDING_SOURCES = [
  { url: "https://support.google.com/adspolicy/answer/6368661", title: "Google Ads — Destination requirements (strona docelowa musi działać, być użyteczna i łatwa w nawigacji)" },
  { url: "https://support.google.com/adspolicy/answer/16427615", title: "Google Ads — Destination experience" },
  { url: "https://support.google.com/adspolicy/answer/143465?hl=pl", title: "Zasady dot. personalizacji reklam (kategorie wrażliwe)" },
  { url: "https://web.dev/articles/vitals", title: "Core Web Vitals: LCP ≤ 2,5 s, INP ≤ 200 ms, CLS ≤ 0,1" },
  { url: "https://web.dev/articles/accessible-tap-targets", title: "Cele dotykowe ≥ 48 × 48 px" },
];

export interface LandingAsset {
  rowType: string;
  conceptId?: string | null;
  campaignCode?: string | null;
  headline?: string | null;
  subheadline?: string | null;
  body?: string | null;
  cta?: string | null;
  adText?: string | null;
  spokenText?: string | null;
  screenText?: string | null;
  expertPhotoKey?: string | null;
  expertPhotoId?: string | null;
  landingUrl?: string | null;
  experimentId?: string | null;
  variant?: string | null;
}
export interface LandingInput {
  projectName: string;
  campaign: { code: string; name: string; goal: string; landingUrl: string | null; businessName: string | null } | null;
  assets: LandingAsset[];
  conceptId?: string | null;
  photos: Array<{ id: string; key: string; name: string; role: string | null; consentConfirmed: boolean }>;
}
export type CheckLevel = "ok" | "do_poprawy" | "blokada" | "info";
export interface LandingCheck {
  level: CheckLevel;
  area: string;
  message: string;
}
export interface LandingSection {
  key: string;
  title: string;
  purpose: string;
  items: string[];
}
export interface LandingPlan {
  goal: "sprzedaz" | "poradnik";
  url: string | null;
  conceptId: string | null;
  concepts: string[];
  hero: { headline: string; subheadline: string; proof: string; cta: string; expert: { id: string; name: string; role: string | null } | null };
  steps: string[];
  sections: LandingSection[];
  checks: LandingCheck[];
}

const isImage = (a: LandingAsset) => a.rowType === "image";
const meta = (a: LandingAsset) => a.rowType === "experiment_plan" || a.rowType === "historical_reference";
const uniq = <T,>(xs: T[]) => [...new Set(xs)];
const words = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .replace(/[^\p{L}\p{N} ]/gu, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3),
  );

/** the steps of a process_steps body ("a | b | c") or a sensible default */
function stepsOf(body: string | null | undefined, goal: string): string[] {
  const s = (body ?? "")
    .split(/\s*[|•→]\s*|\s*\d\.\s+/)
    .map((x) => x.trim())
    .filter(Boolean);
  if (s.length >= 3) return s.slice(0, 4);
  return goal === "poradnik" ? ["Pobierz poradnik", "Przeczytaj w 10 minut", "Zapisz pytania na konsultację"] : ["Krótka rozmowa — poznajemy sytuację", "Plan i zakres — wiesz, co i kiedy", "Działamy — prowadzimy sprawę krok po kroku"];
}

export function landingPlan(input: LandingInput): LandingPlan {
  const camp = input.campaign;
  const goal = camp?.goal === "poradnik" ? "poradnik" : "sprzedaz";
  const inCamp = input.assets.filter((a) => !meta(a) && (!camp || a.campaignCode === camp.code || (!a.campaignCode && a.rowType !== "image")));
  const imgs = inCamp.filter(isImage).filter((a) => !a.experimentId || a.variant !== "B");
  const concepts = uniq(imgs.map((a) => a.conceptId).filter((c): c is string => !!c));
  const conceptId = input.conceptId && concepts.includes(input.conceptId) ? input.conceptId : (concepts[0] ?? null);
  const lead = imgs.find((a) => a.conceptId === conceptId) ?? imgs[0] ?? null;
  const texts = (t: string) => uniq(inCamp.filter((a) => a.rowType === t).map((a) => a.adText ?? "").filter(Boolean));
  const photo = lead?.expertPhotoId ? input.photos.find((p) => p.id === lead.expertPhotoId) : lead?.expertPhotoKey ? input.photos.find((p) => p.key === lead.expertPhotoKey) : (input.photos.find((p) => p.consentConfirmed) ?? null);
  const ctaDefault = goal === "poradnik" ? "Pobierz poradnik" : "Umów konsultację";
  const hero = {
    headline: lead?.headline ?? texts("headline")[0] ?? input.projectName,
    subheadline: lead?.subheadline ?? texts("description")[0] ?? "",
    proof: lead && !/\|/.test(lead.body ?? "") ? (lead.body ?? "") : "",
    cta: lead?.cta ?? ctaDefault,
    expert: photo ? { id: photo.id, name: photo.name, role: photo.role } : null,
  };
  const steps = stepsOf(imgs.find((a) => /\|/.test(a.body ?? ""))?.body, goal);
  const descriptions = texts("description").slice(0, 3);
  const priceTexts = uniq([...texts("headline"), ...texts("long_headline"), ...texts("description"), ...imgs.map((a) => `${a.headline ?? ""} ${a.body ?? ""}`)].filter((t) => hasPrice(t)));
  const questions = uniq(
    inCamp
      .filter((a) => a.rowType === "video_scene")
      .map((a) => a.screenText ?? a.spokenText ?? "")
      .filter((t) => /\?\s*$/.test(t.trim())),
  ).slice(0, 3);
  const business = camp?.businessName || input.projectName;

  const sections: LandingSection[] = [
    {
      key: "hero",
      title: "1. Pierwszy ekran (hero)",
      purpose: "Potwierdza, że użytkownik trafił tam, gdzie obiecała reklama — to samo hasło, ta sama obietnica, ten sam przycisk.",
      items: [
        `H1 = hasło z reklamy: „${hero.headline}”`,
        hero.subheadline ? `Podtytuł: „${hero.subheadline}”` : "Podtytuł: jedno zdanie — dla kogo i co dostaje",
        `Przycisk: „${hero.cta}” — widoczny bez przewijania (także na telefonie 360 × 640)`,
        hero.expert ? `Zdjęcie eksperta: ${hero.expert.name}${hero.expert.role ? ` — ${hero.expert.role}` : ""} (to samo co w reklamie)` : "Zdjęcie eksperta albo spokojne tło w kolorach motywu",
        hero.proof ? `Dowód pod przyciskiem: „${hero.proof}”` : "Jedno zdanie zaufania pod przyciskiem (np. kto prowadzi sprawy, od kiedy) — tylko fakty do potwierdzenia",
        "Logo i nazwa firmy w nagłówku, telefon klikany (tel:)",
      ],
    },
    goal === "poradnik"
      ? { key: "inside", title: "2. Co jest w poradniku", purpose: "Konkret zamiast obietnic — spis treści, liczba stron, dla kogo.", items: [...descriptions.map((d) => `„${d}”`), "3–5 punktów spisu treści", "Podgląd 1–2 stron"] }
      : { key: "problem", title: "2. Dla kogo i z jakim problemem", purpose: "Nazwij sytuację użytkownika jego językiem (te same kąty co w reklamach).", items: descriptions.length ? descriptions.map((d) => `„${d}”`) : ["3 krótkie punkty: sytuacja → czego się obawia → co zmieniamy"] },
    { key: "steps", title: "3. Jak to wygląda — krok po kroku", purpose: "Zmniejsza niepewność: co się stanie po kliknięciu.", items: steps.map((s, i) => `${i + 1}. ${s}`) },
    {
      key: "expert",
      title: "4. Kto prowadzi sprawę",
      purpose: "Przejrzystość — Google ocenia, czy wiadomo, kto stoi za stroną.",
      items: [hero.expert ? `${hero.expert.name}${hero.expert.role ? `, ${hero.expert.role}` : ""} — krótkie bio (3 zdania), zdjęcie` : "Ekspert: imię, nazwisko, tytuł zawodowy, krótkie bio, zdjęcie", "Tytuł zawodowy i numer wpisu (adwokat / radca prawny) — informacja, nie reklama", "Bez określeń „najlepszy”, „gwarancja wygranej”, porównań z innymi kancelariami"],
    },
    ...(goal === "sprzedaz"
      ? [
          {
            key: "price",
            title: "5. Koszt i zakres",
            purpose: priceTexts.length ? "Reklamy mówią o cenie — strona musi pokazać dokładnie tę samą kwotę i jej zakres." : "Przejrzystość ceny podnosi zaufanie i ocenę strony.",
            items: priceTexts.length ? [...priceTexts.slice(0, 3).map((t) => `Z reklamy: „${t.trim()}” — ta sama kwota na stronie`), "Co obejmuje cena, czego nie obejmuje (opłaty sądowe, dojazdy), czy to cena brutto"] : ["Cena konsultacji albo widełki + co obejmują", "Jeśli cena „od” — napisz, od czego zależy"],
          },
        ]
      : []),
    { key: "faq", title: `${goal === "sprzedaz" ? 6 : 5}. Najczęstsze pytania`, purpose: "Odpowiada na obawy, zanim użytkownik wyjdzie.", items: [...questions.map((q) => `„${q}”`), ...(goal === "poradnik" ? ["Czy poradnik jest bezpłatny?", "Co stanie się z moim adresem e-mail?"] : ["Ile trwa sprawa i od czego to zależy?", "Ile to kosztuje?", "Czy rozmowa jest poufna?", "Co, jeśli druga strona się nie zgadza?"])].slice(0, 6) },
    {
      key: "form",
      title: `${goal === "sprzedaz" ? 7 : 6}. Formularz / kontakt`,
      purpose: "Najkrótsza droga do konwersji — mierzona w Google Ads.",
      items:
        goal === "poradnik"
          ? ["Pola: e-mail (+ imię opcjonalnie)", "Zgoda RODO z linkiem do polityki prywatności", "Po wysłaniu: strona podziękowania z własnym URL (konwersja)"]
          : ["Pola: imię, telefon lub e-mail, krótki opis (opcjonalnie) — nie wymagaj szczegółów sprawy", `Przycisk formularza = „${hero.cta}”`, "Alternatywa: telefon klikany i godziny odbierania", "Zgoda RODO, informacja o tajemnicy zawodowej", "Po wysłaniu: strona podziękowania z własnym URL (konwersja) + czego się spodziewać dalej"],
    },
    { key: "footer", title: `${goal === "sprzedaz" ? 8 : 7}. Stopka`, purpose: "Przejrzystość i zgodność z zasadami strony docelowej.", items: [`Nazwa firmy jak w reklamach: „${business}”`, "Adres, NIP / KRS, telefon, e-mail", "Polityka prywatności i cookies, regulamin", "Bez wyskakujących okien zasłaniających treść"] },
  ];

  // ---- checks on what we know from the project
  const checks: LandingCheck[] = [];
  const url = camp?.landingUrl ?? lead?.landingUrl ?? null;
  if (!url) checks.push({ level: "blokada", area: "URL", message: "Brak adresu strony docelowej (landing_url kampanii) — uzupełnij w zakładce Kampanie." });
  else if (!/^https:\/\//i.test(url)) checks.push({ level: "blokada", area: "URL", message: `Adres ${url} nie używa https://.` });
  else checks.push({ level: "ok", area: "URL", message: `Strona docelowa: ${url}` });
  const urls = uniq(inCamp.map((a) => a.landingUrl).filter((u): u is string => !!u));
  if (urls.length > 1) checks.push({ level: "do_poprawy", area: "URL", message: `Komponenty prowadzą na ${urls.length} różne adresy — w PMax adres końcowy jest jeden na grupę; dopasuj H1 do grupy.` });
  const ctas = uniq(imgs.map((a) => (a.cta ?? "").trim()).filter(Boolean));
  if (ctas.length > 2) checks.push({ level: "do_poprawy", area: "Spójność", message: `W kampanii jest ${ctas.length} różnych CTA (${ctas.join(", ")}) — przycisk na stronie powinien powtarzać to samo działanie.` });
  else if (ctas.length) checks.push({ level: "ok", area: "Spójność", message: `CTA reklam: ${ctas.join(" / ")} — ten sam przycisk na stronie.` });
  const heads = uniq(imgs.map((a) => a.headline ?? "").filter(Boolean));
  const w = words(hero.headline);
  const far = heads.filter((h) => {
    const v = words(h);
    let n = 0;
    for (const x of v) if (w.has(x)) n++;
    return v.size && n / v.size < 0.3;
  });
  if (far.length) checks.push({ level: "info", area: "Spójność", message: `${far.length} z ${heads.length} haseł kampanii mówi co innego niż H1 — sekcje 2–3 powinny odpowiadać też na te obietnice: ${far.slice(0, 3).map((h) => `„${h}”`).join(", ")}${far.length > 3 ? "…" : ""}` });
  if (hero.expert) {
    const p = input.photos.find((x) => x.id === hero.expert!.id);
    checks.push(p?.consentConfirmed ? { level: "ok", area: "Ekspert", message: `Zgoda na wizerunek: ${p.name} — potwierdzona.` } : { level: "blokada", area: "Ekspert", message: `Brak potwierdzonej zgody na wizerunek (${hero.expert.name}) — nie publikuj zdjęcia.` });
  }
  if (priceTexts.length) checks.push({ level: "do_poprawy", area: "Cena", message: "Reklamy podają cenę — strona musi pokazać tę samą kwotę i zakres usługi (inaczej ryzyko odrzucenia za niezgodność)." });
  if (!camp?.businessName) checks.push({ level: "info", area: "Firma", message: "Nazwa firmy kampanii nieustawiona — strona i reklamy muszą używać tej samej nazwy." });
  checks.push({ level: "info", area: "Kategoria wrażliwa", message: "Sprawy rodzinne / rozwód = kategoria wrażliwa: nie twórz z tej strony list remarketingowych i nie używaj Customer Match." });
  return { goal, url, conceptId, concepts, hero, steps, sections, checks };
}

/** universal rules (Google + own recommendations, marked) */
export const LANDING_RULES: Array<{ area: string; rule: string; own?: boolean }> = [
  { area: "Trafność", rule: "H1 powtarza hasło reklamy, przycisk powtarza CTA reklamy (message match)." },
  { area: "Trafność", rule: "Jeden cel na stronę — jedna akcja (konsultacja ALBO poradnik); kampania poradnikowa ma osobną stronę." },
  { area: "Przejrzystość", rule: "Widać, kto stoi za stroną: nazwa firmy, dane kontaktowe, ekspert, polityka prywatności." },
  { area: "Przejrzystość", rule: "Cena i zakres usługi identyczne jak w reklamie; bez ukrytych warunków." },
  { area: "Nawigacja", rule: "Strona działa, nie ma błędów, blokad geograficznych ani komunikatów „w budowie”." },
  { area: "Nawigacja", rule: "Bez wyskakujących okien i reklam zasłaniających treść (Better Ads Standards)." },
  { area: "Telefon", rule: "Przycisk widoczny bez przewijania na 360 × 640; przyklejony pasek CTA na dole na telefonie.", own: true },
  { area: "Telefon", rule: "Tekst ≥ 16 px, przyciski i linki ≥ 48 × 48 px, brak poziomego przewijania." },
  { area: "Szybkość", rule: "Core Web Vitals: LCP ≤ 2,5 s, INP ≤ 200 ms, CLS ≤ 0,1 (sprawdź w PageSpeed Insights)." },
  { area: "Szybkość", rule: "Zdjęcie hero w WEBP/AVIF, ≤ 200 KB, z wymiarami (bez przeskoków układu).", own: true },
  { area: "Pomiar", rule: "Konwersje: wysłanie formularza (strona podziękowania), kliknięcie tel:, pobranie poradnika — każda osobno." },
  { area: "Pomiar", rule: "Baner zgód z Consent Mode v2 (wymagany w EOG dla pomiaru i personalizacji)." },
  { area: "Prawo / etyka", rule: "Bez obietnic wyniku, „gwarancji”, „najlepszy”; zasady etyki zawodu (adwokat / radca) — sprawdź z samorządem.", own: true },
  { area: "Prawo / etyka", rule: "Formularz nie wymaga opisu sprawy ani danych szczególnych (zdrowie, przemoc) — wystarczy kontakt.", own: true },
];

export function landingMarkdown(p: LandingPlan, projectName: string, campaignName: string | null): string {
  const L: string[] = [];
  L.push(`# Landing page — ${projectName}${campaignName ? ` / ${campaignName}` : ""}`, "");
  L.push(`Cel: ${p.goal === "poradnik" ? "pobranie poradnika" : "konsultacja (sprzedaż)"} · URL: ${p.url ?? "do uzupełnienia"} · koncept wiodący: ${p.conceptId ?? "—"}`, "");
  for (const s of p.sections) {
    L.push(`## ${s.title}`, `_${s.purpose}_`, "", ...s.items.map((i) => `- ${i}`), "");
  }
  L.push("## Kontrola na podstawie danych projektu", ...p.checks.map((c) => `- [${c.level}] ${c.area}: ${c.message}`), "");
  L.push("## Zasady (Google + rekomendacje własne oznaczone *)", ...LANDING_RULES.map((r) => `- ${r.area}: ${r.rule}${r.own ? " *" : ""}`), "");
  L.push("## Źródła", ...LANDING_SOURCES.map((s) => `- ${s.title}: ${s.url}`), "");
  return L.join("\n");
}
