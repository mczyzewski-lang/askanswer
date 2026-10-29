/**
 * AI of Social Media Studio (OpenAI Chat Completions, JSON output validated with Zod):
 *  - per-platform publications of a film (never one text copied everywhere),
 *  - regeneration variants, 3 alternative openings, hashtags only,
 *  - comment classification and reply drafts (personal data removed before the text leaves),
 *  - the analyst (observations kept apart from hypotheses, sample size stated).
 * Rules come from the versioned module src/lib/social/rules.ts; every call is stored (AiGeneration).
 */
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { env, openaiConfigured } from "../env";
import { HttpError } from "../errors";
import { BANNED_HASHTAGS, checkPostText, GLOBAL_RULES, normalizeHashtags, PLATFORM_RULES, RULES_VERSION } from "@/lib/social/rules";
import { PLATFORM_META, PLATFORMS, type Platform } from "@/lib/social/platforms";

export class AiError extends Error {}

/** one JSON answer from the model, validated; one retry that shows the model what was wrong */
export async function aiJson<T>(task: string, system: string, user: string, schema: z.ZodType<T>): Promise<{ data: T; model: string }> {
  if (!openaiConfigured()) throw new HttpError(503, "Funkcje AI wymagają klucza OpenAI (OPENAI_API_KEY w Railway → Variables).");
  let model = env.openaiTextModel;
  const messages: Array<{ role: string; content: string }> = [
    { role: "system", content: `ZADANIE: ${task}\n\n${system}\n\nOdpowiadasz WYŁĄCZNIE jednym obiektem JSON zgodnym z opisanym formatem.` },
    { role: "user", content: user },
  ];
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${env.openaiBaseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.openaiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, response_format: { type: "json_object" }, messages }),
      signal: AbortSignal.timeout(180_000),
    });
    const body = (await res.json().catch(() => ({}))) as { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } };
    if (!res.ok) {
      if ((res.status === 400 || res.status === 404) && /model/i.test(JSON.stringify(body)) && model !== "gpt-4.1") {
        model = "gpt-4.1";
        continue;
      }
      throw new AiError(`OpenAI: ${body.error?.message ?? `HTTP ${res.status}`}`);
    }
    const text = body.choices?.[0]?.message?.content ?? "";
    let parsed: unknown;
    try {
      parsed = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ""));
    } catch {
      messages.push({ role: "assistant", content: text.slice(0, 4000) }, { role: "user", content: "To nie był poprawny JSON. Zwróć sam obiekt JSON." });
      continue;
    }
    const r = schema.safeParse(parsed);
    if (r.success) return { data: r.data, model };
    messages.push({ role: "assistant", content: text.slice(0, 8000) }, { role: "user", content: `Odpowiedź nie pasuje do formatu: ${r.error.issues.slice(0, 8).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}. Popraw i zwróć cały obiekt JSON.` });
  }
  throw new AiError("AI zwróciło odpowiedź, której nie da się odczytać — spróbuj ponownie.");
}

// --------------------------------------------------------------------------- brand context

async function brandContext(projectId: string) {
  const p = await prisma.socialProject.findUniqueOrThrow({ where: { id: projectId }, include: { brand: true, knowledgeDocs: { orderBy: { updatedAt: "desc" }, take: 10 } } });
  const b = p.brand;
  const kb = [b?.knowledgeBase ?? "", ...p.knowledgeDocs.map((d) => `# ${d.name}\n${d.content}`)].join("\n\n").slice(0, 8000);
  const lines = [
    `MARKA / PROJEKT: ${p.name}`,
    `JĘZYK PUBLIKACJI: ${p.language === "en" ? "angielski" : "polski"}`,
    b?.description && `DZIAŁALNOŚĆ: ${b.description}`,
    b?.audience && `GRUPA DOCELOWA: ${b.audience}`,
    b?.goal && `GŁÓWNY CEL KOMUNIKACJI: ${b.goal}`,
    b?.tone && `TON MARKI: ${b.tone}`,
    b?.website && `STRONA: ${b.website}`,
    b?.products && `PRODUKTY / USŁUGI: ${b.products}`,
    b?.usp && `USP: ${b.usp}`,
    b?.preferredCta && `PREFEROWANE CTA: ${b.preferredCta}`,
    b?.forbiddenPhrases.length && `ZAKAZANE SFORMUŁOWANIA (nie używaj nigdy): ${b.forbiddenPhrases.join("; ")}`,
    b?.keywords.length && `SŁOWA KLUCZOWE: ${b.keywords.join(", ")}`,
    kb && `BAZA WIEDZY (jedyne źródło faktów o ofercie):\n${kb}`,
  ].filter(Boolean);
  return { project: p, text: lines.join("\n"), forbidden: b?.forbiddenPhrases ?? [], moderation: b?.moderationRules ?? "" };
}

function platformBrief(platforms: Platform[]) {
  return platforms
    .map((pl) => {
      const r = PLATFORM_RULES[pl];
      return [
        `## ${PLATFORM_META[pl].name} (${PLATFORM_META[pl].format}) — platform: "${pl}"`,
        `Limity: opis+CTA+hashtagi do ${r.limits.text} znaków${r.limits.title ? `, tytuł do ${r.limits.title}` : ""}, hashtagi ${r.limits.hashtagsRecommended[0]}–${r.limits.hashtagsRecommended[1]} (maks. ${r.limits.hashtagsMax})${r.limits.tagsTotal ? `, tagi YouTube razem do ${r.limits.tagsTotal} znaków` : ""}.`,
        ...r.writing.map((w) => `- ${w}`),
      ].join("\n");
    })
    .join("\n\n");
}

// --------------------------------------------------------------------------- publications

const Post = z.object({
  platform: z.enum(["INSTAGRAM", "FACEBOOK", "TIKTOK", "YOUTUBE", "LINKEDIN"]),
  title: z.string().default(""),
  description: z.string().min(1),
  hashtags: z.array(z.string()).default([]),
  cta: z.string().default(""),
  firstComment: z.string().default(""),
  coverSecond: z.number().nullable().default(null),
  coverReason: z.string().default(""),
  youtubeTags: z.array(z.string()).default([]),
  altOpenings: z.array(z.string()).default([]),
});
export type GeneratedPost = z.infer<typeof Post>;
const PostsOut = z.object({ posts: z.array(Post).min(1) });

const POST_FORMAT = `FORMAT JSON:
{ "posts": [ {
  "platform": "INSTAGRAM|TIKTOK|YOUTUBE|FACEBOOK|LINKEDIN",
  "title": "tylko YouTube (tytuł) — dla innych pusty",
  "description": "gotowy opis BEZ hashtagów i BEZ CTA (one idą w osobnych polach)",
  "hashtags": ["#tag", ...],
  "cta": "jedno zdanie CTA",
  "firstComment": "opcjonalny pierwszy komentarz albo pusty",
  "coverSecond": liczba sekund filmu na okładkę albo null,
  "coverReason": "dlaczego ten moment",
  "youtubeTags": ["tylko YouTube", ...],
  "altOpenings": ["3 alternatywne pierwsze zdania (różne mechanizmy: lęk, liczba, pytanie)"]
} ] }`;

/** what has worked for this project so far (top posts by views), if anything */
async function historyHints(projectId: string) {
  const posts = await prisma.platformPost.findMany({ where: { projectId, status: "PUBLISHED" }, select: { platform: true, description: true, cta: true, snapshots: { orderBy: { capturedAt: "desc" }, take: 1, select: { views: true, likes: true, comments: true } } }, take: 200, orderBy: { publishedAt: "desc" } });
  const scored = posts.map((p) => ({ ...p, views: p.snapshots[0]?.views ?? null })).filter((p) => p.views !== null) as Array<(typeof posts)[number] & { views: number }>;
  if (scored.length < 3) return "";
  scored.sort((a, b) => b.views - a.views);
  return `HISTORIA PROJEKTU (${scored.length} opublikowanych z danymi; to wskazówka, nie reguła):\n${scored
    .slice(0, 5)
    .map((p) => `- ${PLATFORM_META[p.platform as Platform].name}, ${p.views} wyśw.: otwarcie „${p.description.split(/\n|\. /)[0].slice(0, 120)}”, CTA „${p.cta.slice(0, 80)}”`)
    .join("\n")}`;
}

function generationSystem(platforms: Platform[]) {
  return [
    "Jesteś doświadczonym social media managerem i copywriterem. Przygotowujesz OSOBNE publikacje tego samego filmu na każdą wskazaną platformę.",
    "ZASADY OGÓLNE:",
    ...GLOBAL_RULES.map((r) => `- ${r}`),
    `- Zakazane hashtagi: ${BANNED_HASHTAGS.map((h) => `#${h}`).join(" ")}.`,
    "- Jeśli czegoś nie wiesz (cena, termin, warunki), nie pisz tego — zamiast tego zaproś do kontaktu.",
    "WYMAGANIA PLATFORM:",
    platformBrief(platforms),
    POST_FORMAT,
  ].join("\n");
}

function mediaContext(m: { title: string; description: string; transcript: string | null; durationSec: number | null; width: number | null; height: number | null }, goal: string) {
  return [
    `TYTUŁ FILMU: ${m.title || "(brak)"}`,
    m.description && `OPIS OD AUTORA: ${m.description}`,
    goal && `CEL MARKETINGOWY TEJ PUBLIKACJI: ${goal}`,
    `FILM: ${m.durationSec ? `${Math.round(m.durationSec)} s` : "długość nieznana"}, ${m.width && m.height ? `${m.width}×${m.height}` : ""}`,
    m.transcript ? `TRANSKRYPCJA (to, co mówi się w filmie):\n${m.transcript.slice(0, 9000)}` : "TRANSKRYPCJA: brak — opieraj się tylko na tytule i opisie, nie dopowiadaj treści filmu.",
  ]
    .filter(Boolean)
    .join("\n");
}

/** clean an AI post: hashtags normalised (banned removed), limits respected where trimming is safe */
function tidy(p: GeneratedPost): GeneratedPost {
  const r = PLATFORM_RULES[p.platform];
  return {
    ...p,
    title: r.fields.title ? p.title.slice(0, r.limits.title ?? 100) : "",
    hashtags: normalizeHashtags(p.hashtags, r.limits.hashtagsRecommended[1] || 3),
    youtubeTags: p.platform === "YOUTUBE" ? p.youtubeTags.map((t) => t.replace(/^#/, "").trim()).filter(Boolean).slice(0, 15) : [],
    altOpenings: p.altOpenings.slice(0, 3),
    firstComment: r.fields.firstComment ? p.firstComment : "",
  };
}

/** "Przygotuj publikacje z AI": one version per target platform of the film */
export async function generatePosts(contentItemId: string, userId: string | null, onlyPostIds?: string[]) {
  const item = await prisma.contentItem.findUniqueOrThrow({ where: { id: contentItemId }, include: { media: true, posts: { include: { socialAccount: true } } } });
  const targets = item.posts.filter((p) => !onlyPostIds?.length || onlyPostIds.includes(p.id));
  const platforms = [...new Set(targets.map((p) => p.platform as Platform))];
  if (!platforms.length) throw new HttpError(400, "Brak platform do przygotowania");
  const brand = await brandContext(item.projectId);
  const user = [brand.text, mediaContext(item.media, item.goal), await historyHints(item.projectId), `PLATFORMY DO PRZYGOTOWANIA: ${platforms.join(", ")} (konta: ${targets.map((t) => `${t.platform}: ${t.socialAccount.displayName ?? t.socialAccount.accountHandle ?? ""}`).join("; ")})`].filter(Boolean).join("\n\n");
  const gen = await prisma.aiGeneration.create({ data: { projectId: item.projectId, kind: "POSTS", contentItemId, model: env.openaiTextModel, rulesVersion: RULES_VERSION, input: { platforms, transcript: !!item.media.transcript } as Prisma.InputJsonValue, userId } });
  try {
    const { data, model } = await aiJson("SOCIAL_POSTS", generationSystem(platforms), user, PostsOut);
    let posts = data.posts.map(tidy).filter((p) => platforms.includes(p.platform));
    // identical texts on two platforms are a failure of the brief: ask once more for the duplicates
    const dup = posts.filter((p, i) => posts.some((q, j) => j < i && q.description.trim() === p.description.trim()));
    if (dup.length) {
      const again = await aiJson("SOCIAL_POSTS", generationSystem(dup.map((d) => d.platform)), `${user}\n\nPoprzednio dla ${dup.map((d) => d.platform).join(", ")} powstał ten sam tekst co dla innej platformy. Napisz je od nowa, wyraźnie inaczej, pod specyfikę platformy.`, PostsOut);
      posts = posts.map((p) => (dup.some((d) => d.platform === p.platform) ? (again.data.posts.map(tidy).find((x) => x.platform === p.platform) ?? p) : p));
    }
    const missing = platforms.filter((pl) => !posts.some((p) => p.platform === pl));
    const issues = posts.map((p) => ({ platform: p.platform, issues: checkPostText(p.platform, { title: p.title, description: p.description, hashtags: p.hashtags, cta: p.cta, firstComment: p.firstComment, options: { youtubeTags: p.youtubeTags } }, brand.forbidden) }));
    await prisma.aiGeneration.update({ where: { id: gen.id }, data: { model, output: { posts, missing, issues } as unknown as Prisma.InputJsonValue } });
    return { generationId: gen.id, posts, missing, issues };
  } catch (e) {
    await prisma.aiGeneration.update({ where: { id: gen.id }, data: { error: (e as Error).message.slice(0, 1000) } });
    throw e;
  }
}

export const REGENERATE_MODES = {
  shorter: "Krócej — zachowaj sens, wytnij zbędne zdania.",
  sales: "Bardziej sprzedażowo — wyraźniejsza korzyść i CTA, bez obietnic wyników i bez wymyślonych faktów.",
  educational: "Bardziej edukacyjnie — konkretna wiedza z filmu, wyjaśnienie po ludzku.",
  natural: "Bardziej naturalnie — język mówiony, mniej marketingowo.",
  concrete: "Więcej konkretów — tylko z transkrypcji i bazy wiedzy; nie wymyślaj liczb.",
  other_cta: "Inne CTA — zaproponuj inne wezwanie do działania, reszta bez dużych zmian.",
  hashtags: "Wygeneruj ponownie tylko hashtagi (i tagi YouTube) — opis zostaw bez zmian.",
} as const;
export type RegenerateMode = keyof typeof REGENERATE_MODES;

/** a new version of one platform's publication (applied as a new revision by the caller) */
export async function regeneratePost(postId: string, mode: RegenerateMode, userId: string | null) {
  const post = await prisma.platformPost.findUniqueOrThrow({ where: { id: postId }, include: { contentItem: { include: { media: true } } } });
  const pl = post.platform as Platform;
  const brand = await brandContext(post.projectId);
  const current = JSON.stringify({ platform: pl, title: post.title, description: post.description, hashtags: post.hashtags, cta: post.cta, firstComment: post.firstComment, youtubeTags: (post.options as { youtubeTags?: string[] }).youtubeTags ?? [] });
  const user = [brand.text, mediaContext(post.contentItem.media, post.contentItem.goal), `OBECNA WERSJA:\n${current}`, `POLECENIE: ${REGENERATE_MODES[mode]}`, `Zwróć { "posts": [ jedna publikacja dla ${pl} ] }.`].join("\n\n");
  const gen = await prisma.aiGeneration.create({ data: { projectId: post.projectId, kind: mode === "hashtags" ? "HASHTAGS" : "REGENERATE", platformPostId: postId, contentItemId: post.contentItemId, rulesVersion: RULES_VERSION, input: { mode, before: JSON.parse(current) } as Prisma.InputJsonValue, userId } });
  try {
    const { data, model } = await aiJson("SOCIAL_POSTS", generationSystem([pl]), user, PostsOut);
    const p = tidy(data.posts.find((x) => x.platform === pl) ?? { ...data.posts[0], platform: pl });
    await prisma.aiGeneration.update({ where: { id: gen.id }, data: { model, output: p as unknown as Prisma.InputJsonValue } });
    return { generationId: gen.id, post: p };
  } catch (e) {
    await prisma.aiGeneration.update({ where: { id: gen.id }, data: { error: (e as Error).message.slice(0, 1000) } });
    throw e;
  }
}

const HooksOut = z.object({ openings: z.array(z.object({ mechanism: z.string().default(""), text: z.string().min(1) })).min(1) });

/** 3 alternative first sentences for one publication */
export async function alternativeOpenings(postId: string, userId: string | null) {
  const post = await prisma.platformPost.findUniqueOrThrow({ where: { id: postId }, include: { contentItem: { include: { media: true } } } });
  const brand = await brandContext(post.projectId);
  const user = [brand.text, mediaContext(post.contentItem.media, post.contentItem.goal), `OBECNY OPIS (${post.platform}):\n${post.description}`, 'Zaproponuj 3 alternatywne pierwsze zdania (otwarcia) — różne mechanizmy: konkretny lęk, liczba z filmu (jeśli jest), pytanie dzielące widzów. Format: { "openings": [ { "mechanism": "…", "text": "…" } ] }'].join("\n\n");
  const { data, model } = await aiJson("SOCIAL_HOOKS", ["Piszesz otwarcia publikacji social media.", ...GLOBAL_RULES.map((r) => `- ${r}`)].join("\n"), user, HooksOut);
  await prisma.aiGeneration.create({ data: { projectId: post.projectId, kind: "HOOKS", platformPostId: postId, contentItemId: post.contentItemId, model, rulesVersion: RULES_VERSION, output: data as unknown as Prisma.InputJsonValue, userId } });
  return data.openings.slice(0, 3);
}

// --------------------------------------------------------------------------- comments

/** personal data never goes to the AI: e-mails, phone / account / ID numbers, links, @mentions */
export function redactPersonal(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[e-mail]")
    .replace(/\b(?:PL)?\d{2}[ ]?(?:\d{4}[ ]?){6}\b/g, "[nr konta]")
    .replace(/\b\d{11}\b/g, "[nr PESEL]")
    .replace(/(?:\+?\d[\d\s-]{7,}\d)/g, "[telefon]")
    .replace(/https?:\/\/\S+/g, "[link]")
    .replace(/@[\w.]{2,}/g, "@[użytkownik]");
}

export const COMMENT_CATEGORIES = ["question", "positive", "negative", "spam", "purchase_intent", "contact_request", "needs_human"] as const;
export const SENSITIVE = ["complaint", "legal", "medical", "personal_data", "conflict", "unusual", "needs_verification"] as const;

const ClassOut = z.object({
  comments: z.array(
    z.object({
      id: z.string(),
      category: z.enum(COMMENT_CATEGORIES),
      sentiment: z.enum(["positive", "neutral", "negative"]).default("neutral"),
      isQuestion: z.boolean().default(false),
      isLead: z.boolean().default(false),
      needsHuman: z.boolean().default(false),
      sensitive: z.array(z.enum(SENSITIVE)).default([]),
      language: z.string().default("pl"),
      reason: z.string().default(""),
    }),
  ),
});
export type CommentClass = z.infer<typeof ClassOut>["comments"][number];

export async function classifyComments(projectId: string, items: Array<{ id: string; text: string; postContext: string; hadPersonalData: boolean }>) {
  if (!items.length) return [];
  const brand = await brandContext(projectId);
  const system = [
    "Klasyfikujesz komentarze pod publikacjami marki. Dla każdego komentarza zwróć kategorię i flagi.",
    "Kategorie: question (pytanie), positive, negative, spam, purchase_intent (chce kupić / skorzystać), contact_request (prosi o kontakt), needs_human (wymaga człowieka).",
    "sensitive: complaint (skarga), legal (sprawa prawna / konkretna sprawa osoby), medical, personal_data (podaje dane osobowe), conflict (kłótnia, obraźliwe), unusual (nietypowa sytuacja), needs_verification (odpowiedź wymaga sprawdzenia faktów).",
    "isLead = purchase_intent lub contact_request lub wyraźne zainteresowanie ofertą. needsHuman = true dla wszystkiego, co wrażliwe lub niejasne.",
    brand.moderation && `ZASADY MODERACJI MARKI: ${brand.moderation}`,
    'Format: { "comments": [ { "id", "category", "sentiment", "isQuestion", "isLead", "needsHuman", "sensitive": [], "language", "reason" } ] }',
  ]
    .filter(Boolean)
    .join("\n");
  const user = `MARKA: ${brand.project.name}\n\n${items.map((c) => `[${c.id}] (pod publikacją: ${c.postContext.slice(0, 160)})${c.hadPersonalData ? " [autor podał dane osobowe — usunięte]" : ""}\n${redactPersonal(c.text).slice(0, 1500)}`).join("\n\n")}`;
  const { data, model } = await aiJson("SOCIAL_CLASSIFY", system, user, ClassOut);
  await prisma.aiGeneration.create({ data: { projectId, kind: "COMMENT_CLASSIFY", model, rulesVersion: RULES_VERSION, input: { count: items.length } as Prisma.InputJsonValue, output: data as unknown as Prisma.InputJsonValue } });
  // personal data given by the author always needs a human, whatever the model says
  return data.comments.map((c) => (items.find((i) => i.id === c.id)?.hadPersonalData ? { ...c, needsHuman: true, sensitive: [...new Set([...c.sensitive, "personal_data" as const])] } : c));
}

const ReplyOut = z.object({ reply: z.string().min(1), language: z.string().default("pl"), needsHuman: z.boolean().default(false), reason: z.string().default("") });

/** a reply draft for one comment (never sent without a person, unless the safe auto mode allows it) */
export async function replyDraft(commentId: string, userId: string | null) {
  const c = await prisma.socialComment.findUniqueOrThrow({ where: { id: commentId }, include: { platformPost: { include: { contentItem: { include: { media: true } } } } } });
  const thread = await prisma.socialComment.findMany({ where: { socialAccountId: c.socialAccountId, OR: [{ nativeId: c.parentNativeId ?? "__none" }, { parentNativeId: c.parentNativeId ?? c.nativeId }] }, orderBy: { postedAt: "asc" }, take: 10 });
  const brand = await brandContext(c.projectId);
  const system = [
    "Piszesz odpowiedź na komentarz w imieniu marki. Krótko (1–3 zdania), uprzejmie, naturalnie, w języku autora komentarza.",
    "Nie wymyślaj cen, terminów, warunków usług ani innych faktów — tylko to, co jest w bazie wiedzy i w filmie. Gdy brakuje informacji, zaproś do kontaktu (wiadomość prywatna / formularz ze strony).",
    "Nie podawaj porad prawnych / medycznych w konkretnej sprawie — zaproponuj kontakt. Nie proś o dane osobowe w komentarzu.",
    "needsHuman = true, jeśli komentarz to skarga, sprawa prawna lub medyczna, dane osobowe, konflikt, sytuacja nietypowa albo pytanie wymagające weryfikacji.",
    brand.moderation && `ZASADY MODERACJI MARKI: ${brand.moderation}`,
    'Format: { "reply": "…", "language": "pl", "needsHuman": false, "reason": "…" }',
  ]
    .filter(Boolean)
    .join("\n");
  const user = [
    brand.text,
    c.platformPost ? `PUBLIKACJA: ${c.platformPost.contentItem.media.title} — ${c.platformPost.description.slice(0, 600)}` : "",
    c.platformPost?.contentItem.media.transcript ? `TRANSKRYPCJA FILMU (fragment): ${c.platformPost.contentItem.media.transcript.slice(0, 3000)}` : "",
    thread.length > 1 ? `WĄTEK:\n${thread.map((t) => `${t.isOwn ? "MARKA" : "Użytkownik"}: ${redactPersonal(t.text).slice(0, 400)}`).join("\n")}` : "",
    `KOMENTARZ (${PLATFORM_META[c.platform as Platform].name}): ${redactPersonal(c.text).slice(0, 1500)}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  const { data, model } = await aiJson("SOCIAL_REPLY", system, user, ReplyOut);
  const gen = await prisma.aiGeneration.create({ data: { projectId: c.projectId, kind: "COMMENT_REPLY", commentId, model, rulesVersion: RULES_VERSION, output: data as unknown as Prisma.InputJsonValue, userId } });
  return { ...data, generationId: gen.id };
}

// --------------------------------------------------------------------------- analyst

const InsightsOut = z.object({
  observations: z.array(z.string()).default([]),
  hypotheses: z.array(z.string()).default([]),
  topics: z.array(z.string()).default([]),
  openings: z.array(z.string()).default([]),
  ctas: z.array(z.string()).default([]),
  frequency: z.string().default(""),
  hours: z.string().default(""),
  nextVideos: z.array(z.string()).default([]),
  caveats: z.array(z.string()).default([]),
});
export type Insights = z.infer<typeof InsightsOut> & { sampleSize: number; generatedAt: string };

export async function analystInsights(projectId: string, rows: Array<{ platform: string; publishedAt: string; hourLocal: number; weekday: number; title: string; opening: string; cta: string; hashtags: string[]; views: number | null; likes: number | null; comments: number | null; shares: number | null; saves: number | null; engagementRate: number | null }>, userId: string | null): Promise<Insights> {
  const brand = await brandContext(projectId);
  const system = [
    "Jesteś analitykiem social media. Analizujesz wyniki publikacji projektu.",
    "Oddzielaj OBSERWACJE (co wprost wynika z danych) od HIPOTEZ (możliwe wyjaśnienia do sprawdzenia).",
    "Przy małej próbie (mniej niż ~20 publikacji na platformę) nie wyciągaj silnych wniosków — napisz to w caveats.",
    "Nie porównuj bezpośrednio views z reach ani metryk różnych platform jak tej samej miary.",
    "Godziny i częstotliwość podawaj jako hipotezy do przetestowania, nie jako pewnik.",
    'Format: { "observations": [], "hypotheses": [], "topics": [], "openings": [], "ctas": [], "frequency": "", "hours": "", "nextVideos": [], "caveats": [] }',
  ].join("\n");
  const user = `${brand.text}\n\nDANE (${rows.length} publikacji; null = platforma nie podaje):\n${JSON.stringify(rows).slice(0, 30_000)}`;
  const { data, model } = await aiJson("SOCIAL_INSIGHTS", system, user, InsightsOut);
  const out = { ...data, sampleSize: rows.length, generatedAt: new Date().toISOString() };
  await prisma.aiGeneration.create({ data: { projectId, kind: "INSIGHTS", model, rulesVersion: RULES_VERSION, input: { rows: rows.length } as Prisma.InputJsonValue, output: out as unknown as Prisma.InputJsonValue, userId } });
  return out;
}

export { PLATFORMS };
