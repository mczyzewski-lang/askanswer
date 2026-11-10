/**
 * Google Adwords — the creative assistant: a person describes the image or the video they want; the AI
 * drafts it as a concept of this module (an image in three formats, or a video script with scenes for
 * recording), following the brand, the PMax rules and the editorial rules. Nothing is saved until the
 * person accepts the draft.
 */
import { prisma } from "./db";
import { env, openaiConfigured } from "./env";
import { openaiErrorText } from "./reel-review";
import { matchHistory } from "../adwords/history";
import { PMAX_SPEC } from "../adwords/spec";

export const ASSISTANT_SYSTEM = `ADWORDS_ASSISTANT
Jesteś kreatywnym w agencji Google Ads (Performance Max). Na podstawie prośby użytkownika przygotuj JEDNĄ kreację dla marki. Zasady:
- Grafika: jedno mocne hasło (max ~40 znaków), najwyżej jeden krótki podtytuł, opcjonalnie krótki punkt dowodu albo 3 kroki (dla układu process_steps, rozdzielone „ | ”), jedno CTA. Bez pięciu komunikatów na jednej grafice.
- Wideo: 20–30 s, sceny: 0–3 s HOOK (pytanie lub kontrast; twarz eksperta i napis), 3–8 s problem/reframe, 8–18 s mechanizm (2–3 kroki), 18–24 s zaufanie / zakres usługi (bez nieudokumentowanych obietnic), 24–30 s jedno CTA z marką. Każda scena: słowa eksperta (do nagrania z promptera), napis na ekranie (krótki), kadr/obraz/ruch. Prawdziwy ekspert, bez stockowych scen płaczących ludzi.
- Nie obiecuj gwarantowanego ani bezkonfliktowego rozwodu, wyroku w terminie, całkowitego kosztu sprawy; nie naciskaj na mediację (nie przy przemocy). Nie używaj tekstów oznaczonych jako archiwalne do niepublikowania.
- Liczby i fakty tylko, jeśli są w prośbie użytkownika — wtedy wpisz je w claim_source jako „do potwierdzenia”.
- Historyczne hasła to tylko kontekst (ekspozycja, nie wynik testu).
Odpowiedz wyłącznie JSON:
{"kind":"image"|"video","concept_id":"krótki kod, np. G07 albo V06","rationale":"1–2 zdania po polsku","image":{"layout":"typographic"|"expert_split"|"process_steps","headline":"…","subheadline":"…","body":"…","cta":"…","visual_brief":"…","use_expert_photo":true|false},"video":{"duration_sec":30,"scenes":[{"start_s":0,"end_s":3,"spoken_text":"…","screen_text":"…","visual_brief":"…"}]},"headline_for_ads":"opcjonalny krótki nagłówek ≤30 znaków"}`;

export interface AssistantDraft {
  kind: "image" | "video";
  conceptId: string;
  rationale: string;
  image?: { layout: "typographic" | "expert_split" | "process_steps"; headline: string; subheadline: string; body: string; cta: string; visualBrief: string; useExpertPhoto: boolean };
  video?: { durationSec: number; scenes: Array<{ startS: number; endS: number; spokenText: string; screenText: string; visualBrief: string }> };
  headlineForAds?: string | null;
  claimSource?: string | null;
  engine: "openai" | "template";
  warning?: string | null;
}

export const nextCode = (taken: Set<string>, prefix: string) => {
  for (let i = 1; i < 1000; i++) {
    const c = `${prefix}${String(i).padStart(2, "0")}`;
    if (!taken.has(c)) return c;
  }
  return `${prefix}${Date.now().toString(36)}`;
};

/** A draft without the AI: the person's own words as the copy, the standard structure for video. */
function templateDraft(prompt: string, kind: "image" | "video", code: string): AssistantDraft {
  const sentence = prompt.split(/[.!?\n]/).map((s) => s.trim()).filter(Boolean);
  const head = (sentence[0] ?? prompt).slice(0, 48);
  if (kind === "image") return { kind, conceptId: code, rationale: "Szkic z Twojego opisu (bez AI — brak klucza OpenAI).", image: { layout: "typographic", headline: head, subheadline: sentence[1]?.slice(0, 80) ?? "", body: "", cta: "Umów konsultację", visualBrief: prompt.slice(0, 300), useExpertPhoto: false }, engine: "template" };
  return {
    kind,
    conceptId: code,
    rationale: "Szkic struktury z Twojego opisu (bez AI — brak klucza OpenAI).",
    video: {
      durationSec: 30,
      scenes: [
        { startS: 0, endS: 3, spokenText: head, screenText: head, visualBrief: "Ekspert patrzy w kamerę, zbliżenie" },
        { startS: 3, endS: 8, spokenText: sentence[1] ?? "Problem widza — krótko.", screenText: "Problem", visualBrief: "Ekspert, plan średni" },
        { startS: 8, endS: 18, spokenText: sentence[2] ?? "Jak to działa: 2–3 kroki.", screenText: "Jak to działa", visualBrief: "Ekspert przy stole; plansze kroków" },
        { startS: 18, endS: 24, spokenText: "Kto pomaga i jaki jest zakres usługi.", screenText: "Zakres usługi", visualBrief: "Ekspert do kamery" },
        { startS: 24, endS: 30, spokenText: "Umów konsultację.", screenText: "Umów konsultację", visualBrief: "Plansza: logo i adres" },
      ],
    },
    engine: "template",
  };
}

export async function assistantDraft(projectId: string, prompt: string, kind: "image" | "video"): Promise<AssistantDraft> {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, include: { theme: { include: { expertPhotos: { select: { key: true, name: true, consentConfirmed: true } } } } } });
  const assets = await prisma.adwordsAsset.findMany({ where: { projectId }, select: { conceptId: true, rowType: true, adText: true, headline: true, status: true } });
  const taken = new Set(assets.map((a) => a.conceptId).filter((x): x is string => !!x));
  const code = nextCode(taken, kind === "image" ? "G" : "V");
  if (!openaiConfigured()) return templateDraft(prompt, kind, code);
  const history = await prisma.adwordsHistoryRow.findMany({ where: { projectId, typeKey: { in: ["headline", "long_headline", "description"] } }, orderBy: { clicks: "desc" }, take: 12 });
  const banned = assets.filter((a) => a.rowType === "historical_reference" && /do_not_publish/i.test(a.status ?? "")).map((a) => a.adText ?? "");
  const related = matchHistory(prompt, history).slice(0, 3);
  const user = [
    `Marka / projekt: ${project.name}${project.description ? ` — ${project.description}` : ""}`,
    project.adwordsBrief ? `Brief: ${project.adwordsBrief.slice(0, 1200)}` : "",
    `Rodzaj: ${kind === "image" ? "grafika (formaty 1,91:1, 1:1, 4:5 — ten sam koncept)" : "wideo PMax (16:9, 1:1, 9:16)"}`,
    `Proponowany kod konceptu: ${code}`,
    `Zdjęcia ekspertów w bibliotece: ${project.theme?.expertPhotos.map((p) => `${p.key} (${p.name}${p.consentConfirmed ? "" : ", bez zgody"})`).join(", ") || "brak"}`,
    `Obecne nagłówki: ${assets.filter((a) => a.rowType === "headline").map((a) => a.adText).slice(0, 15).join(" | ") || "—"}`,
    history.length ? `Historyczne hasła (ekspozycja, nie wynik testu): ${history.map((h) => `„${h.component.split("\n")[0]}” (${h.clicks ?? 0} klik.)`).join("; ")}` : "",
    related.length ? `Najbliższe historyczne: ${related.map((h) => h.component.split("\n")[0]).join(" | ")}` : "",
    banned.length ? `Nie używaj (archiwum, do niepublikowania): ${banned.join(" | ")}` : "",
    `Limity: nagłówek Google Ads ≤${PMAX_SPEC.texts.headline.maxChars} znaków.`,
    `Prośba użytkownika: ${prompt}`,
  ]
    .filter(Boolean)
    .join("\n");
  const res = await fetch(`${env.openaiBaseUrl}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.openaiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: env.openaiTextModel, response_format: { type: "json_object" }, messages: [{ role: "system", content: ASSISTANT_SYSTEM }, { role: "user", content: user }] }),
    signal: AbortSignal.timeout(90_000),
  });
  const data = (await res.json().catch(() => ({}))) as { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string; code?: string } };
  if (!res.ok) return { ...templateDraft(prompt, kind, code), warning: openaiErrorText(res.status, data) };
  let o: Record<string, unknown> = {};
  try {
    o = JSON.parse((data.choices?.[0]?.message?.content ?? "{}").replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    return { ...templateDraft(prompt, kind, code), warning: "OpenAI zwrócił odpowiedź, której nie da się odczytać — szkic z Twojego opisu." };
  }
  const str = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);
  const cid = /^[A-Za-z]{1,3}\d{1,3}$/.test(String(o.concept_id ?? "")) && !taken.has(String(o.concept_id)) ? String(o.concept_id) : code;
  const out: AssistantDraft = { kind, conceptId: cid, rationale: str(o.rationale, 400), headlineForAds: o.headline_for_ads ? str(o.headline_for_ads, 30) : null, engine: "openai" };
  if (kind === "image") {
    const im = (o.image ?? {}) as Record<string, unknown>;
    const layout = im.layout === "expert_split" || im.layout === "process_steps" ? im.layout : "typographic";
    out.image = { layout, headline: str(im.headline, 80), subheadline: str(im.subheadline, 120), body: str(im.body, 160), cta: str(im.cta, 30) || "Umów konsultację", visualBrief: str(im.visual_brief, 400), useExpertPhoto: !!im.use_expert_photo };
    if (!out.image.headline) return { ...templateDraft(prompt, kind, code), warning: "AI nie podało hasła — szkic z Twojego opisu." };
  } else {
    const v = (o.video ?? {}) as { duration_sec?: unknown; scenes?: Array<Record<string, unknown>> };
    const scenes = (v.scenes ?? []).slice(0, 8).map((s) => ({ startS: Number(s.start_s) || 0, endS: Number(s.end_s) || 0, spokenText: str(s.spoken_text, 600), screenText: str(s.screen_text, 120), visualBrief: str(s.visual_brief, 300) })).filter((s) => s.endS > s.startS);
    if (!scenes.length) return { ...templateDraft(prompt, kind, code), warning: "AI nie podało scen — szkic z Twojego opisu." };
    out.video = { durationSec: Math.max(10, Number(v.duration_sec) || scenes[scenes.length - 1].endS), scenes };
  }
  return out;
}

/** Save an accepted draft as components (an image in three formats, or a video in three orientations + scenes). */
export async function applyDraft(projectId: string, d: AssistantDraft, opts: { campaignCode?: string | null; assetGroup?: string | null; expertPhotoId?: string | null; headlineForAds?: boolean } = {}) {
  const exists = await prisma.adwordsAsset.findFirst({ where: { projectId, conceptId: d.conceptId } });
  if (exists) throw new Error(`Koncept ${d.conceptId} już istnieje — zmień kod.`);
  const base = { projectId, conceptId: d.conceptId, campaignCode: opts.campaignCode ?? null, assetGroup: opts.assetGroup ?? null, funnel: "sprzedaz", status: "draft", scoreNote: `asystent: ${d.rationale}`.slice(0, 500), order: 20_000 };
  const created: string[] = [];
  if (d.kind === "image" && d.image) {
    const photo = d.image.useExpertPhoto && opts.expertPhotoId ? opts.expertPhotoId : null;
    for (const f of PMAX_SPEC.images.formats) {
      const a = await prisma.adwordsAsset.create({
        data: { ...base, assetKey: `${d.conceptId}-${f.key === "landscape" ? "L" : f.key === "square" ? "SQ" : "P"}`, rowType: "image", aspectRatio: f.ratio, width: f.width, height: f.height, headline: d.image.headline, subheadline: d.image.subheadline || null, body: d.image.body || null, cta: d.image.cta, visualBrief: d.image.visualBrief, layout: photo ? "expert_split" : d.image.layout === "expert_split" ? "typographic" : d.image.layout, expertPhotoId: photo, claimSource: d.claimSource ?? null },
      });
      created.push(a.id);
    }
  } else if (d.kind === "video" && d.video) {
    for (const f of PMAX_SPEC.videos.formats) {
      const a = await prisma.adwordsAsset.create({ data: { ...base, assetKey: `${d.conceptId}-${f.key === "landscape" ? "169" : f.key === "square" ? "11" : "916"}`, rowType: "video", aspectRatio: f.ratio, width: f.width, height: f.height, durationSec: d.video.durationSec, expertPhotoId: opts.expertPhotoId ?? null } });
      created.push(a.id);
    }
    for (const [i, s] of d.video.scenes.entries()) {
      const a = await prisma.adwordsAsset.create({ data: { ...base, assetKey: `${d.conceptId}-S${i + 1}`, rowType: "video_scene", sceneIndex: i + 1, startS: s.startS, endS: s.endS, spokenText: s.spokenText, screenText: s.screenText, visualBrief: s.visualBrief, expertPhotoId: opts.expertPhotoId ?? null } });
      created.push(a.id);
    }
  }
  if (opts.headlineForAds && d.headlineForAds) {
    const n = await prisma.adwordsAsset.count({ where: { projectId, rowType: "headline" } });
    await prisma.adwordsAsset.create({ data: { ...base, conceptId: null, assetKey: `${d.conceptId}-H${n + 1}`, rowType: "headline", adText: d.headlineForAds } });
  }
  return { conceptId: d.conceptId, created: created.length };
}
