/**
 * Google Adwords — "Popraw nagłówki": headlines that do not say what the ad is about (the topic, e.g.
 * "rozwód") get a proposal that does — written by OpenAI within the limits and the editorial rules, or
 * by a simple rule when OpenAI is not configured. Nothing is saved until a person accepts a proposal.
 */
import { prisma } from "./db";
import { env, openaiConfigured } from "./env";
import { openaiErrorText } from "./reel-review";
import { adwordsProject, projectTopic } from "./adwords";
import { mentionsTopic } from "../adwords/score";
import { PMAX_SPEC } from "../adwords/spec";

export const COPYFIX_SYSTEM = `ADWORDS_COPYFIX
Jesteś copywriterem kampanii Google Ads Performance Max kancelarii (rynek polski). Przepisujesz nagłówki tak, żeby od razu było jasne, czego dotyczy reklama (temat podany niżej, np. „rozwód”) — temat musi paść w nagłówku (w dowolnej odmianie).
Zasady:
- zachowaj sens, kąt komunikacji i ton oryginału; nie dodawaj nowych obietnic, liczb, cen, terminów ani gwarancji;
- nie pisz „całkowity koszt rozwodu” (znamy tylko koszt naszej usługi);
- naturalna polszczyzna, bez wykrzykników i CAPS LOCKA;
- ściśle trzymaj limit znaków podany przy każdej pozycji (liczą się spacje);
- przykład: „Najpierw plan. Potem pozew.” → „Najpierw plan i ustalenia. Dopiero potem pozew o rozwód.”
Zwróć JSON: {"items":[{"key":"…","text":"…"}]} — po jednej pozycji na każdy klucz z listy.`;

export interface CopyFix {
  key: string;
  kind: "image" | "headline" | "long_headline";
  /** database ids the text belongs to (all formats of an image concept) */
  ids: string[];
  label: string;
  current: string;
  proposal: string;
  limit: number;
}

/** the rule when OpenAI is off: "… pozew" → "… pozew o rozwód"; else "Rozwód: …" when it fits */
export function ruleFix(text: string, topic: string, limit: number): string {
  const t = text.trim();
  const T = topic.charAt(0).toUpperCase() + topic.slice(1);
  if (/rozw/i.test(topic) && /\bpozew\b/i.test(t) && !/pozew o rozw/i.test(t)) {
    const r = t.replace(/\bpozew\b/i, "pozew o rozwód");
    if ([...r].length <= limit) return r;
  }
  const lower = t.charAt(0).toLowerCase() + t.slice(1);
  const pre = `${T}: ${lower}`;
  if ([...pre].length <= limit) return pre;
  const short = `${T} — ${lower}`;
  return [...short].length <= limit ? short : [...pre].slice(0, limit).join("").replace(/\s+\S*$/, "");
}

export async function copyFixes(projectId: string): Promise<{ topic: string | null; engine: "openai" | "rule"; warning: string | null; items: CopyFix[] }> {
  const { project, assets } = await adwordsProject(projectId);
  const topic = projectTopic(project, assets);
  if (!topic) return { topic: null, engine: "rule", warning: "Ustaw temat reklam (np. „rozwód”) w zakładce Kampanie.", items: [] };
  const items: CopyFix[] = [];
  // image concepts: one headline for all formats
  const concepts = new Map<string, typeof assets>();
  for (const a of assets.filter((x) => x.rowType === "image" && x.layout !== "infographic" && (x.headline ?? "").trim())) concepts.set(a.conceptId ?? a.assetKey, [...(concepts.get(a.conceptId ?? a.assetKey) ?? []), a]);
  for (const [c, rows] of concepts) {
    const h = rows[0].headline!.trim();
    if (!mentionsTopic(h, topic)) items.push({ key: `img:${c}`, kind: "image", ids: rows.map((r) => r.id), label: `${c} (grafika)`, current: h, proposal: "", limit: 60 });
  }
  for (const a of assets.filter((x) => (x.rowType === "headline" || x.rowType === "long_headline") && (x.adText ?? "").trim())) {
    if (mentionsTopic(a.adText!, topic)) continue;
    const kind = a.rowType as "headline" | "long_headline";
    items.push({ key: `txt:${a.assetKey}`, kind, ids: [a.id], label: `${a.assetKey} (${kind === "headline" ? "nagłówek" : "długi nagłówek"})`, current: a.adText!.trim(), proposal: "", limit: PMAX_SPEC.texts[kind].maxChars });
  }
  const fallback = () => items.forEach((i) => (i.proposal = ruleFix(i.current, topic, i.limit)));
  if (!items.length) return { topic, engine: "rule", warning: null, items };
  if (!openaiConfigured()) {
    fallback();
    return { topic, engine: "rule", warning: "OpenAI nie jest skonfigurowany — propozycje z prostej reguły; popraw je ręcznie przed zapisaniem.", items };
  }
  const user = [`Temat reklam: ${topic}`, `Marka: ${project.name}`, "Pozycje (klucz | limit znaków | obecny tekst):", ...items.map((i) => `${i.key} | ${i.limit} | ${i.current}`)].join("\n");
  const res = await fetch(`${env.openaiBaseUrl}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.openaiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: env.openaiTextModel, response_format: { type: "json_object" }, messages: [{ role: "system", content: COPYFIX_SYSTEM }, { role: "user", content: user }] }),
    signal: AbortSignal.timeout(90_000),
  }).catch(() => null);
  const data = res ? ((await res.json().catch(() => ({}))) as { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } }) : {};
  if (!res?.ok) {
    fallback();
    return { topic, engine: "rule", warning: res ? openaiErrorText(res.status, data) : "Brak połączenia z OpenAI — propozycje z prostej reguły.", items };
  }
  let got: Array<{ key?: string; text?: string }> = [];
  try {
    got = (JSON.parse((data.choices?.[0]?.message?.content ?? "{}").replace(/^```(?:json)?\s*|\s*```$/g, "")) as { items?: typeof got }).items ?? [];
  } catch {
    /* fall back below */
  }
  for (const i of items) {
    const t = got.find((g) => g.key === i.key)?.text?.trim() ?? "";
    // a proposal over the limit or still without the topic is replaced by the rule
    i.proposal = t && [...t].length <= i.limit && mentionsTopic(t, topic) ? t : ruleFix(i.current, topic, i.limit);
  }
  return { topic, engine: "openai", warning: null, items };
}

export async function setTopic(projectId: string, topic: string | null) {
  await prisma.project.update({ where: { id: projectId }, data: { adwordsTopic: topic?.trim() || null } });
}
