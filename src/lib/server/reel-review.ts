/**
 * Ads Studio: a reel script scored against the editor's guidelines (hook, tension, retention…) and
 * rewritten into a stronger version to swap in — by an OpenAI text model, as structured JSON.
 */
import { env, openaiConfigured, openaiKeyDiagnostics } from "./env";

export const REEL_EDITOR_GUIDELINES = `ROLA
Jesteś redaktorem rolek (Instagram Reels / TikTok / YouTube Shorts) dla marki usług prawno-finansowych. Oceniasz istniejący scenariusz rolki, a potem piszesz mocniejszą wersję do podmiany. Piszesz po polsku, prostym językiem, bez żargonu prawniczego.

CEL
Maksymalizacja: (1) czasu oglądania i powtórek, (2) udostępnień w DM, (3) zapisów, (4) przejść na profil i wiadomości od potencjalnych klientów. Lajki są drugorzędne. Zasięg bez leadów to porażka.

KRYTERIA OCENY (każde 0–10, z wagą; wynik końcowy 0–100)
1. HOOK 0–2 s (waga 25%)
   10 = pierwsze zdanie i napis na ekranie zatrzymują kciuk: konkretny lęk, liczba, kontrowersja lub pytanie dzielące widzów; zero powitań.
   0 = „Cześć, jestem…”, „Dzisiaj opowiem…”, logo, wolne wejście.
2. NAPIĘCIE 2–6 s (waga 15%)
   Czy jest stawka (koszt, ryzyko, błąd) i obietnica odpowiedzi? Czy widz wie, po co zostać do końca?
3. RETENCJA / TEMPO (waga 15%)
   Jedna myśl na rolkę. Brak pustych zdań i powtórzeń. Zmiana ujęcia lub napisu co 1–2 s. Długość 15–35 s, chyba że treść uzasadnia dłuższą.
4. PAYOFF (waga 15%)
   Konkret na końcu: liczba, termin, przepis wytłumaczony po ludzku, zaskoczenie. Czy jest powód, żeby zapisać?
5. SHAREABILITY (waga 15%)
   Czy widz pomyśli o konkretnej osobie, której to wyśle („to o moim bracie / mamie / znajomym z długami”)? Relatywność, emocja, „to musisz wiedzieć”.
6. CTA (waga 5%)
   CTA pod sygnał: „wyślij komuś, kto…”, „zapisz, zanim…”, „napisz SŁOWO w wiadomości”. Minus za „daj lajka / obserwuj”.
7. AUTENTYCZNOŚĆ (waga 5%)
   Naturalny język mówiony, ludzki, surowy. Minus za czytanie z kartki, korpo-ton, tekst brzmiący jak AI.
8. DOPASOWANIE DO KLIENTA I OFERTY (waga 5%)
   Czy przyciąga osoby, które mogą zostać klientami, a nie przypadkowy zasięg? Czy prowadzi logicznie do usługi?

CZERWONE FLAGI (każda obniża wynik końcowy o 10 pkt i musi być naprawiona w nowej wersji)
- Brak napisów lub hook działa tylko z dźwiękiem (większość ogląda bez dźwięku)
- Odpowiedź zdradzona w pierwszych 2 s (nie ma po co zostać)
- Więcej niż jedna główna myśl
- Obietnica wyniku: „umorzymy”, „gwarantujemy”, „na pewno wygrasz”, „pozbędziesz się długów” → ryzyko prawne
- Dane klienta umożliwiające identyfikację bez potwierdzonej zgody (RODO)
- Clickbait, którego treść nie spełnia
- Pusta końcówka (rolka się „rozjeżdża” zamiast zamknąć)

ZASADY DLA FORMATU [PYTANIE]
- Pytanie dotyka lęku lub dzieli widzów („Czy komornik może zabrać ci 800+?”).
- Odpowiedź dopiero po 2–3 zdaniach kontekstu.
- Najlepiej pytanie z prawdziwych komentarzy lub rozmów z klientami.
- Zakończenie: jednoznaczna odpowiedź + co zrobić teraz.

ZASADY DLA FORMATU [EKSPERT] (ekspert sam mówi hook i treść)
- Hook wypowiada EKSPERT z pozycji wiedzy i doświadczenia: teza, liczba, lista, ostrzeżenie, mit do obalenia — np. „3 najważniejsze rzeczy, gdy masz długi”, „Ten błąd kosztuje dłużników najwięcej”.
- Ekspert może zwrócić się do widza w 2. osobie („Masz długi? Zrób to najpierw.”), ale NIE mówi jak klient w 1. osobie o swoim problemie („Czy mam powiedzieć mężowi o długach?” to głos klienta, nie eksperta).
- Treść to wiedza eksperta podana prosto; bez „zapytała mnie klientka…”, chyba że jest to w oryginale.

ZASADY DLA FORMATU [PYTANIE KLIENTA] (lektor czyta pytanie klienta, ekspert odpowiada)
- Hook to PYTANIE ZADANE PRZEZ KLIENTA, nie wypowiedź eksperta. Czyta je inny głos (lektor), jakby pisała je prawdziwa osoba: 1. osoba, język potoczny, jej konkretna sytuacja i emocja — np. „Czy mam powiedzieć mężowi o długach?”, „Komornik zajął mi konto. Co z pensją?”.
- Hook nigdy nie jest tezą ani listą eksperta („3 rzeczy, które…”, „Dziś wyjaśnię…”) i nie mówi o kliencie w 3. osobie („Klientka pyta, czy…”).
- Hook to jedno lub dwa krótkie zdania, kończy się pytajnikiem; bez danych umożliwiających identyfikację.
- Treść (body) i CTA mówi EKSPERT: odpowiada bezpośrednio pytającemu i widzom w tej samej sytuacji, nie powtarza pytania słowo w słowo; najpierw krótki kontekst, potem jednoznaczna odpowiedź i co zrobić teraz.
- Alternatywne hooki (altHooks) w tym formacie to też pytania klienta w 1. osobie.

ZASADY DLA FORMATU [TALKING HEAD KLIENTA]
- Najmocniejsze emocjonalne zdanie z wywiadu idzie na początek jako hook, potem cofnięcie do historii.
- Struktura: ból → moment decyzji → co się zmieniło (konkret: czas, kwota, spokój) → zdanie do widza w podobnej sytuacji.
- Klient mówi własnymi słowami; nie poprawiaj go na język marketingowy.
- Jeśli scenariusz jest pisany do przeczytania przez klienta, zamień go na listę pytań do wywiadu + wskaż, które odpowiedzi wyciąć do rolki.
- Zawsze dopisz w uwagach: „wymagana pisemna zgoda klienta na wizerunek i opis sprawy”.

ZASADY PISANIA NOWEJ WERSJI
- Zachowaj fakty i sens oryginału; nie wymyślaj liczb, wyników ani historii klienta. Jeśli brakuje konkretu, wstaw [DO UZUPEŁNIENIA: …].
- Zdania krótkie, do 12 słów. Język mówiony.
- Ostatnie zdanie, jeśli się da, nawiązuje do pierwszego (pętla → powtórki).
- Opisuj proces i możliwości, nigdy nie gwarantuj wyniku.

Jeśli podano statystyki: najpierw zdiagnozuj, gdzie rolka traci widzów (niski średni czas = hook/tempo; dobre oglądanie, mało udostępnień = brak relatywności/CTA; dużo zasięgu, brak wiadomości = złe dopasowanie do oferty) i ustaw dźwignie pod tę diagnozę.`;

/** The answer as data (the guideline's output sections, plus the new hook / body / CTA to swap in). */
const OUTPUT = `FORMAT ODPOWIEDZI: wyłącznie JSON (bez markdown), dokładnie w tej strukturze — to są sekcje 1–8 z wytycznych:
{
  "score": liczba 0–100 (wynik końcowy po odjęciu czerwonych flag),
  "verdict": "jednozdaniowy werdykt",
  "diagnosis": "diagnoza ze statystyk albo null",
  "criteria": [{"name": "HOOK 0–2 s", "score": 0–10, "why": "1 zdanie"}, … wszystkie 8 kryteriów w kolejności z wytycznych],
  "redFlags": ["…"] (pusta lista, gdy brak),
  "levers": ["…", "…", "…"] (3 największe dźwignie),
  "newVersion": {
    "onScreen": "napis na ekranie 0–2 s",
    "timeline": [{"time": "0–2 s", "text": "…"}, {"time": "2–6 s", "text": "…"}, {"time": "6–X s", "text": "…"}, {"time": "koniec", "text": "…"}],
    "hook": "hook 0–2 s: w formacie [PYTANIE KLIENTA] pytanie klienta w 1. osobie (czyta lektor); w pozostałych to, co mówi ekspert",
    "body": "to, co ekspert mówi po hooku aż do CTA",
    "cta": "CTA wypowiadane na końcu",
    "shots": ["sugestie ujęć / cięć / B-rolli"],
    "caption": "opis pod rolką: max 3 zdania + 1 pytanie zachęcające do komentarza"
  },
  "altHooks": [{"mechanism": "lęk", "text": "…"}, {"mechanism": "liczba", "text": "…"}, {"mechanism": "kontrowersja", "text": "…"}],
  "predicted": {"score": liczba 0–100, "limits": "co jeszcze ogranicza wynik"},
  "compliance": ["uwagi compliance: zgody, ryzykowne sformułowania"]
}
hook + body + cta w "newVersion" to pełny tekst mówiony nowej wersji (do podmiany w scenariuszu nagrania).`;

export interface ReelReview {
  score: number;
  verdict: string;
  diagnosis?: string | null;
  criteria: Array<{ name: string; score: number; why: string }>;
  redFlags: string[];
  levers: string[];
  newVersion: { onScreen: string; timeline: Array<{ time: string; text: string }>; hook: string; body: string; cta: string; shots: string[]; caption: string };
  altHooks: Array<{ mechanism: string; text: string }>;
  predicted: { score: number; limits: string };
  compliance: string[];
}

export interface ReviewInput {
  title: string | null;
  parts: Array<{ role: string; text: string }>;
  format: string;
  brief: string | null;
  stats?: string | null;
}

/** Who says the hook — spelled out so the new version keeps the right voice. */
const VOICE: Record<string, string> = {
  "[PYTANIE KLIENTA]": "KTO MÓWI: hook = pytanie klienta czytane przez lektora (głos klienta, 1. osoba); treść i CTA = ekspert odpowiada.",
  "[EKSPERT]": "KTO MÓWI: hook, treść i CTA mówi ekspert (głos eksperta, wiedza) — hook nie jest pytaniem klienta w 1. osobie.",
};

export function reviewUserMessage(p: ReviewInput): string {
  return [
    `FORMAT: ${p.format}`,
    VOICE[p.format] ?? "",
    p.brief ? `GRUPA DOCELOWA I USŁUGA: ${p.brief}` : "",
    p.title ? `TYTUŁ / NAPIS NAD ROLKĄ: ${p.title}` : "",
    "SCENARIUSZ:",
    ...p.parts.map((x) => `[${x.role.toUpperCase()}] ${x.text}`),
    p.stats ? `STATYSTYKI: ${p.stats}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function asReview(raw: unknown): ReelReview {
  const r = (raw ?? {}) as Partial<ReelReview>;
  const num = (v: unknown, max: number) => Math.max(0, Math.min(max, Math.round(Number(v) || 0)));
  const strs = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean) : []);
  const nv = (r.newVersion ?? {}) as Partial<ReelReview["newVersion"]>;
  return {
    score: num(r.score, 100),
    verdict: String(r.verdict ?? ""),
    diagnosis: r.diagnosis ? String(r.diagnosis) : null,
    criteria: (Array.isArray(r.criteria) ? r.criteria : []).map((c) => ({ name: String(c?.name ?? ""), score: num(c?.score, 10), why: String(c?.why ?? "") })),
    redFlags: strs(r.redFlags),
    levers: strs(r.levers),
    newVersion: {
      onScreen: String(nv.onScreen ?? ""),
      timeline: (Array.isArray(nv.timeline) ? nv.timeline : []).map((t) => ({ time: String(t?.time ?? ""), text: String(t?.text ?? "") })),
      hook: String(nv.hook ?? ""),
      body: String(nv.body ?? ""),
      cta: String(nv.cta ?? ""),
      shots: strs(nv.shots),
      caption: String(nv.caption ?? ""),
    },
    altHooks: (Array.isArray(r.altHooks) ? r.altHooks : []).map((h) => ({ mechanism: String(h?.mechanism ?? ""), text: String(h?.text ?? "") })).filter((h) => h.text),
    predicted: { score: num(r.predicted?.score, 100), limits: String(r.predicted?.limits ?? "") },
    compliance: strs(r.compliance),
  };
}

/** Plain-language reason for an OpenAI error the admin can act on. */
export function openaiErrorText(status: number, body: { error?: { message?: string; code?: string; type?: string } }): string {
  const e = body.error ?? {};
  const raw = e.message ?? `HTTP ${status}`;
  if (e.code === "insufficient_quota" || /quota|billing/i.test(raw))
    return `OpenAI: brak środków lub przekroczony limit na koncie OpenAI (platform.openai.com → Billing). Szczegóły: ${raw}`;
  if (status === 401 || e.code === "invalid_api_key" || /api key/i.test(raw))
    return `OpenAI: klucz API jest nieprawidłowy lub wyłączony — wygeneruj nowy w platform.openai.com → API keys i podmień OPENAI_API_KEY w Railway. Szczegóły: ${raw}`;
  if (status === 403 || /verif|organization/i.test(raw)) return `OpenAI: konto nie ma dostępu do modelu (może wymagać weryfikacji organizacji). Szczegóły: ${raw}`;
  return `OpenAI: ${raw}`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One call, retried on a rate limit (not an empty balance) and on server errors. */
async function chat(model: string, user: string) {
  for (let attempt = 0; ; attempt++) {
    const res = await chatOnce(model, user);
    if (attempt >= 3 || !(res.status === 429 || res.status >= 500)) return res;
    const body = await res.clone().json().catch(() => ({}));
    if (/insufficient_quota|billing/i.test(JSON.stringify(body))) return res;
    const after = Number(res.headers.get("retry-after"));
    await sleep(Number.isFinite(after) && after > 0 ? Math.min(after, 60) * 1000 : 2000 * 2 ** attempt);
  }
}

async function chatOnce(model: string, user: string) {
  return fetch(`${env.openaiBaseUrl}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.openaiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: `${REEL_EDITOR_GUIDELINES}\n\n${OUTPUT}` },
        { role: "user", content: user },
      ],
    }),
    signal: AbortSignal.timeout(180_000),
  });
}

/** Score a reel and write the version to swap in. */
export async function reviewReel(p: ReviewInput): Promise<ReelReview & { model: string }> {
  if (!openaiConfigured()) throw new Error(`Ocena treści wymaga klucza OpenAI. ${openaiKeyDiagnostics()}`);
  let model = env.openaiTextModel;
  let res = await chat(model, reviewUserMessage(p));
  // an account without the default model: fall back to a widely available one
  if (res.status === 404 || res.status === 400) {
    const body = await res.clone().json().catch(() => ({}));
    if (/model/i.test(JSON.stringify(body)) && model !== "gpt-4.1") {
      model = "gpt-4.1";
      res = await chat(model, reviewUserMessage(p));
    }
  }
  const data = (await res.json().catch(() => ({}))) as { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string; code?: string; type?: string } };
  if (!res.ok) throw new Error(openaiErrorText(res.status, data));
  const text = data.choices?.[0]?.message?.content ?? "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    throw new Error("OpenAI zwrócił odpowiedź, której nie da się odczytać — spróbuj ponownie.");
  }
  return { ...asReview(parsed), model };
}
