/**
 * Google Adwords — "Analiza i propozycje treści": the project's own analysis (the PMax history report,
 * the current set vs Google's recommendations, the offer / claims rules) feeds an OpenAI prompt that
 * writes NEW headlines, descriptions, image concepts and Meta ads — the imported CSV is only inspiration.
 * Every proposal is checked (limits, topic, unproven claims, archive texts, duplicates) before a person
 * picks what to add.
 */
import { prisma } from "./db";
import { env, openaiConfigured } from "./env";
import { openaiErrorText } from "./reel-review";
import { adwordsProject, projectTopic } from "./adwords";
import { landingContext } from "./adwords-landing";
import { nextCode } from "./adwords-assistant";
import { angleOf, ANGLE_LABEL } from "../adwords/history";
import { exposureConfidence } from "../adwords/experiments";
import { claimsIn, isApproved, offerValid, CTA_VERSIONS } from "../adwords/landing-content";
import { mentionsTopic } from "../adwords/score";
import { PMAX_SPEC } from "../adwords/spec";
import { META_LIMITS, META_CTAS } from "../adwords/meta";
import { PRACTICES } from "../adwords/best-practices";

export const PROPOSE_SYSTEM = `ADWORDS_PROPOSE
Jesteś strategiem i copywriterem kampanii Google Ads Performance Max oraz Meta (Facebook / Instagram) dla kancelarii (rynek polski). Na podstawie ANALIZY (historia wyników PMax, obecny zestaw, reguły) piszesz NOWE treści — obecne teksty z CSV są tylko inspiracją, nie kopiuj ich.
Zasady:
- temat reklam musi paść w każdym nagłówku (w dowolnej odmianie), żeby odbiorca od razu wiedział, czego dotyczy reklama;
- buduj na kątach, które historycznie miały największą ekspozycję i CTR (to sygnał kierunkowy, nie wynik testu) i dodaj 1–2 nowe kąty do przetestowania;
- różnorodność: różne mechanizmy (pytanie, korzyść, proces/kroki, porównanie „tradycyjnie vs z planem”, ekspert), nie warianty tego samego zdania;
- bez liczb, rekordów, ocen, cen i terminów, których nie ma w potwierdzonych twierdzeniach; bez „gwarantujemy”, „najlepszy”, „najskuteczniejszy”, bez obietnic wyniku; nie pisz „całkowity koszt rozwodu” (znamy tylko koszt naszej usługi);
- jeśli oferta bezpłatnego planu nie jest potwierdzona, nie obiecuj planu — sprzedawaj rozmowę / informację;
- ściśle trzymaj limity: nagłówek ≤30 znaków (min. 2 nagłówki ≤15), długi nagłówek ≤90, opis ≤90; Meta: tekst główny 50–125, nagłówek ≤27, opis ≤30;
- naturalna polszczyzna, krótko, bez wykrzykników i CAPS LOCKA; hasło na grafikę ≤45 znaków (może mieć prefiks z dwukropkiem, np. „Rozwód: …”).
Zwróć JSON:
{"summary":["3–6 wniosków z analizy, po polsku"],
 "headlines":[{"text":"…","angle":"…","why":"…"}] (12),
 "long_headlines":[{"text":"…","angle":"…","why":"…"}] (3),
 "descriptions":[{"text":"…","angle":"…","why":"…"}] (4),
 "image_concepts":[{"headline":"…","layout":"typographic|comparison|process_steps|expert","cta":"…","body":"kroki rozdzielone | (dla process_steps)","left_label":"…","left":"…","right_label":"…","right":"…","angle":"…","why":"…"}] (4),
 "meta_ads":[{"name":"…","primary_text":"…","headline":"…","description":"…","image_headline":"…","cta_button":"LEARN_MORE|SIGN_UP|CONTACT_US|BOOK_NOW|MESSAGE_PAGE","angle":"…","why":"…"}] (3),
 "tests":[{"hypothesis":"…","a":"…","b":"…"}] (2)}`;

export interface Analysis {
  topic: string | null;
  bullets: string[];
  history: { period: string | null; top: Array<{ text: string; type: string; impressions: number; clicks: number; ctr: number | null; confidence: string }>; weak: Array<{ text: string; impressions: number; ctr: number | null }>; angles: Array<{ angle: string; label: string; components: number; medianCtr: number | null }> };
  current: { headlines: number; longHeadlines: number; descriptions: number; shortHeadlines: number; topicCoverage: number; concepts: number; metaAds: number; angles: Record<string, number> };
  rules: { offerValid: boolean; approvedClaims: string[]; unprovenClaims: string[]; doNotPublish: string[] };
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
const pct = (n: number | null) => (n == null ? "—" : `${(n * 100).toFixed(1).replace(".", ",")}%`);

export async function analyzeProject(projectId: string): Promise<Analysis> {
  const { project, assets } = await adwordsProject(projectId);
  const topic = projectTopic(project, assets);
  const lctx = await landingContext(projectId);
  const hist = await prisma.adwordsHistoryRow.findMany({ where: { projectId, typeKey: { in: ["headline", "long_headline", "description"] } } });
  const imp = await prisma.adwordsHistoryImport.findFirst({ where: { projectId }, orderBy: { periodTo: "desc" } });
  const withCtr = hist.map((h) => ({ ...h, ctr: h.impressions ? (h.clicks ?? 0) / h.impressions : null }));
  const top = [...withCtr].filter((h) => (h.impressions ?? 0) >= 1000).sort((a, b) => (b.clicks ?? 0) - (a.clicks ?? 0)).slice(0, 8);
  const weak = [...withCtr].filter((h) => (h.impressions ?? 0) >= 20_000 && h.ctr != null).sort((a, b) => a.ctr! - b.ctr!).slice(0, 4);
  const byAngle = new Map<string, number[]>();
  for (const h of withCtr) if (h.ctr != null && (h.impressions ?? 0) >= 1000) byAngle.set(h.angle ?? angleOf(h.component), [...(byAngle.get(h.angle ?? angleOf(h.component)) ?? []), h.ctr]);
  const angles = [...byAngle].map(([angle, xs]) => ({ angle, label: ANGLE_LABEL[angle as keyof typeof ANGLE_LABEL] ?? angle, components: xs.length, medianCtr: median(xs) })).sort((a, b) => (b.medianCtr ?? 0) - (a.medianCtr ?? 0));
  const texts = (t: string) => assets.filter((a) => a.rowType === t && (a.adText ?? "").trim()).map((a) => a.adText!.trim());
  const heads = texts("headline");
  const all = [...heads, ...texts("long_headline"), ...assets.filter((a) => a.rowType === "image" && a.headline).map((a) => a.headline!)];
  const curAngles: Record<string, number> = {};
  for (const t of [...heads, ...texts("long_headline"), ...texts("description")]) curAngles[angleOf(t)] = (curAngles[angleOf(t)] ?? 0) + 1;
  const metaAds = await prisma.metaAd.count({ where: { projectId } });
  const concepts = new Set(assets.filter((a) => a.rowType === "image").map((a) => a.conceptId)).size;
  const allText = assets.flatMap((a) => [a.headline, a.adText, a.body, a.subheadline].filter(Boolean)).join("\n");
  const unproven = [...new Set(claimsIn(allText).filter((c) => !isApproved(c.key, lctx.claims)).map((c) => `${c.label} „${c.match}”`))];
  const rules = {
    offerValid: offerValid(lctx.offer),
    approvedClaims: lctx.claims.filter((c) => isApproved(c.key, lctx.claims)).map((c) => c.claimText),
    unprovenClaims: unproven,
    doNotPublish: assets.filter((a) => a.rowType === "historical_reference" && /do_not_publish/i.test(a.status ?? "")).map((a) => a.adText || a.headline || "").filter(Boolean),
  };
  const current = { headlines: heads.length, longHeadlines: texts("long_headline").length, descriptions: texts("description").length, shortHeadlines: heads.filter((h) => [...h].length <= 15).length, topicCoverage: all.length ? all.filter((t) => mentionsTopic(t, topic)).length / all.length : 0, concepts, metaAds, angles: curAngles };
  const R = PMAX_SPEC.texts;
  const bullets = [
    top.length ? `Najwięcej kliknięć w historii (ekspozycja, nie wynik testu): ${top.slice(0, 3).map((t) => `„${t.component.split("\n")[0]}” (${t.clicks ?? 0} klik., CTR ${pct(t.ctr)})`).join("; ")}.` : "Brak raportu historii PMax — propozycje opierają się na obecnych treściach i dobrych praktykach.",
    angles.length ? `Kąty wg mediany CTR (kierunkowo): ${angles.map((a) => `${a.label} ${pct(a.medianCtr)}`).join(", ")}.` : "",
    `Obecny zestaw: ${current.headlines}/${R.headline.recommendedCount} nagłówków (≤15 znaków: ${current.shortHeadlines}), ${current.longHeadlines}/${R.long_headline.recommendedCount} długich, ${current.descriptions}/${R.description.recommendedCount} opisów; ${concepts} konceptów graficznych, ${metaAds} reklam Meta.`,
    topic ? `Temat „${topic}” pada w ${Math.round(current.topicCoverage * 100)}% haseł.` : "Temat reklam nieustawiony.",
    rules.offerValid ? "Oferta bezpłatnego planu potwierdzona — można ją obiecywać." : "Oferta bezpłatnego planu niepotwierdzona — propozycje nie obiecują planu.",
    unproven.length ? `Twierdzenia bez dowodu w obecnych treściach (pomijamy je): ${unproven.slice(0, 4).join(", ")}.` : "",
  ].filter(Boolean);
  return { topic, bullets, history: { period: imp?.periodRaw ?? null, top: top.map((t) => ({ text: t.component.split("\n")[0], type: t.typeKey, impressions: t.impressions ?? 0, clicks: t.clicks ?? 0, ctr: t.ctr, confidence: exposureConfidence(t.impressions).level })), weak: weak.map((w) => ({ text: w.component.split("\n")[0], impressions: w.impressions ?? 0, ctr: w.ctr })), angles }, current, rules };
}

export interface Proposal {
  kind: "headline" | "long_headline" | "description" | "image" | "meta";
  text: string;
  angle: string;
  why: string;
  limit?: number;
  issues: string[];
  /** image concept / meta ad details */
  data?: Record<string, string>;
}

function check(p: Proposal, topic: string | null, existing: Set<string>, rules: Analysis["rules"], approvedKeys: string[]): Proposal {
  const issues: string[] = [];
  const len = [...p.text].length;
  if (p.limit && len > p.limit) issues.push(`${len}/${p.limit} znaków`);
  if (topic && (p.kind === "headline" || p.kind === "long_headline" || p.kind === "image") && !mentionsTopic(p.text, topic)) issues.push(`bez tematu „${topic}”`);
  const all = [p.text, ...Object.values(p.data ?? {})].join(" ");
  for (const c of claimsIn(all)) if (!approvedKeys.includes(c.key)) issues.push(`twierdzenie bez dowodu: ${c.match}`);
  if (/najlepsz|najskuteczniejsz|gwarant/i.test(all)) issues.push("zwrot wartościujący / gwarancja");
  if (!rules.offerValid && /bezpłatn\w*\s+plan|plan\w*\s+rozwodu/i.test(all)) issues.push("obiecuje plan, a oferta niepotwierdzona");
  if (rules.doNotPublish.some((d) => d && all.toLowerCase().includes(d.toLowerCase()))) issues.push("tekst z archiwum (nie publikować)");
  if (p.kind !== "meta" && existing.has(p.text.trim().toLowerCase())) issues.push("już jest w zestawie");
  if (p.kind === "meta" && p.data) {
    if ([...(p.data.primary_text ?? "")].length > META_LIMITS.primaryText) issues.push(`tekst główny > ${META_LIMITS.primaryText}`);
    if ([...(p.data.headline ?? "")].length > META_LIMITS.metaHeadline) issues.push(`nagłówek Meta > ${META_LIMITS.metaHeadline}`);
  }
  return { ...p, issues };
}

/** without OpenAI: a few proposals from rules (history's best texts + the topic) */
function ruleProposals(a: Analysis): Omit<Proposal, "issues">[] {
  const t = a.topic ?? "rozwód";
  const T = t.charAt(0).toUpperCase() + t.slice(1);
  const off = a.rules.offerValid;
  const out: Omit<Proposal, "issues">[] = [
    { kind: "headline", text: `${T} bez walki w sądzie`, angle: "bez_wojny", why: "kąt z największą ekspozycją", limit: 30 },
    { kind: "headline", text: `${T}: najpierw plan`, angle: "plan_pozew", why: "mechanizm", limit: 30 },
    { kind: "headline", text: `${T} — koszt usługi z góry`, angle: "koszt", why: "przejrzysty koszt", limit: 30 },
    { kind: "headline", text: `${T}? Zacznij od planu`, angle: "plan_pozew", why: "pytanie + krok", limit: 30 },
    { kind: "long_headline", text: `${T} bez walki: najpierw plan i ustalenia, dopiero potem pozew`, angle: "plan_pozew", why: "pełny mechanizm", limit: 90 },
    { kind: "description", text: off ? `Odbierz bezpłatny plan rozwodu i poznaj koszt naszej usługi przed decyzją.` : `Porozmawiaj z nami o planie rozwodu i poznaj koszt naszej usługi przed decyzją.`, angle: "koszt", why: "oferta + koszt", limit: 90 },
    { kind: "image", text: `${T}: najpierw plan, potem pozew`, angle: "plan_pozew", why: "jedno hasło + CTA", data: { layout: "typographic", cta: off ? "Odbierz bezpłatny plan" : "Umów rozmowę" } },
    { kind: "image", text: `${T}: tradycyjnie czy z planem?`, angle: "porównanie", why: "porównanie mechanizmów", data: { layout: "comparison", cta: off ? "Odbierz bezpłatny plan" : "Umów rozmowę", left_label: "Tradycyjnie", left: "Najpierw pozew, potem spór", right_label: "Z planem", right: "Najpierw ustalenia, potem pozew" } },
  ];
  for (const h of a.history.top.slice(0, 3)) if ([...h.text].length <= 30 && mentionsTopic(h.text, t)) out.push({ kind: "headline", text: h.text, angle: angleOf(h.text), why: `historycznie ${h.clicks} kliknięć — powtórka sprawdzonego hasła`, limit: 30 });
  return out;
}

export async function proposeContent(projectId: string): Promise<{ analysis: Analysis; proposals: Proposal[]; summary: string[]; tests: Array<{ hypothesis: string; a: string; b: string }>; engine: "openai" | "rule"; warning: string | null }> {
  const analysis = await analyzeProject(projectId);
  const { project, assets } = await adwordsProject(projectId);
  const lctx = await landingContext(projectId);
  const approvedKeys = lctx.claims.filter((c) => isApproved(c.key, lctx.claims)).map((c) => c.key);
  const existing = new Set([...assets.map((a) => (a.adText ?? a.headline ?? "").trim().toLowerCase()).filter(Boolean)]);
  const finish = (ps: Omit<Proposal, "issues">[]) => ps.map((p) => check({ ...p, issues: [] }, analysis.topic, existing, analysis.rules, approvedKeys));
  if (!openaiConfigured()) return { analysis, proposals: finish(ruleProposals(analysis)), summary: analysis.bullets, tests: [], engine: "rule", warning: "OpenAI nie jest skonfigurowany — kilka propozycji z reguł; pełna analiza i propozycje AI po dodaniu OPENAI_API_KEY." };
  const g = PRACTICES.google.slice(0, 6).map((p) => `- ${p.text}`).join("\n");
  const m = PRACTICES.meta.slice(0, 6).map((p) => `- ${p.text}`).join("\n");
  const user = [
    `Marka: ${project.name}`,
    `Temat reklam: ${analysis.topic ?? "—"}`,
    `Oferta bezpłatnego planu: ${analysis.rules.offerValid ? "POTWIERDZONA" : "NIEPOTWIERDZONA (nie obiecuj planu)"}`,
    `CTA (rekomendowane): ${CTA_VERSIONS.button.text}; długie: ${CTA_VERSIONS.safe.text}`,
    `Potwierdzone twierdzenia (tylko te liczby wolno użyć): ${analysis.rules.approvedClaims.join("; ") || "brak"}`,
    `Twierdzenia bez dowodu (nie używaj): ${analysis.rules.unprovenClaims.join("; ") || "—"}`,
    `Nie publikować (archiwum): ${analysis.rules.doNotPublish.join(" | ") || "—"}`,
    `Historia PMax ${analysis.history.period ?? ""} — najwięcej kliknięć (ekspozycja kierunkowa):`,
    ...analysis.history.top.map((t) => `  „${t.text}” (${t.type}) — ${t.impressions} wyśw., ${t.clicks} klik., CTR ${pct(t.ctr)}, pewność ${t.confidence}`),
    analysis.history.weak.length ? `Słabe przy dużej ekspozycji: ${analysis.history.weak.map((w) => `„${w.text}” CTR ${pct(w.ctr)}`).join("; ")}` : "",
    analysis.history.angles.length ? `Kąty wg mediany CTR: ${analysis.history.angles.map((a) => `${a.label} ${pct(a.medianCtr)} (${a.components} komp.)`).join(", ")}` : "",
    `Obecny zestaw: ${analysis.current.headlines} nagłówków, ${analysis.current.longHeadlines} długich, ${analysis.current.descriptions} opisów, ${analysis.current.concepts} konceptów graficznych; kąty: ${Object.entries(analysis.current.angles).map(([k, v]) => `${k} ${v}`).join(", ")}`,
    `Obecne nagłówki (tylko inspiracja, nie powtarzaj): ${assets.filter((a) => a.rowType === "headline").map((a) => a.adText).slice(0, 15).join(" | ")}`,
    `Dobre praktyki Google 2026:\n${g}`,
    `Dobre praktyki Meta 2026:\n${m}`,
  ]
    .filter(Boolean)
    .join("\n");
  const res = await fetch(`${env.openaiBaseUrl}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.openaiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: env.openaiTextModel, response_format: { type: "json_object" }, messages: [{ role: "system", content: PROPOSE_SYSTEM }, { role: "user", content: user }] }),
    signal: AbortSignal.timeout(150_000),
  }).catch(() => null);
  const data = res ? ((await res.json().catch(() => ({}))) as { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } }) : {};
  if (!res?.ok) return { analysis, proposals: finish(ruleProposals(analysis)), summary: analysis.bullets, tests: [], engine: "rule", warning: res ? openaiErrorText(res.status, data) : "Brak połączenia z OpenAI — propozycje z reguł." };
  let o: Record<string, unknown> = {};
  try {
    o = JSON.parse((data.choices?.[0]?.message?.content ?? "{}").replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    return { analysis, proposals: finish(ruleProposals(analysis)), summary: analysis.bullets, tests: [], engine: "rule", warning: "OpenAI zwrócił odpowiedź, której nie da się odczytać — propozycje z reguł." };
  }
  const arr = (k: string) => (Array.isArray(o[k]) ? (o[k] as Array<Record<string, unknown>>) : []);
  const s = (v: unknown, n = 300) => String(v ?? "").trim().slice(0, n);
  const ps: Omit<Proposal, "issues">[] = [
    ...arr("headlines").map((x) => ({ kind: "headline" as const, text: s(x.text, 60), angle: s(x.angle, 40), why: s(x.why), limit: PMAX_SPEC.texts.headline.maxChars })),
    ...arr("long_headlines").map((x) => ({ kind: "long_headline" as const, text: s(x.text, 120), angle: s(x.angle, 40), why: s(x.why), limit: PMAX_SPEC.texts.long_headline.maxChars })),
    ...arr("descriptions").map((x) => ({ kind: "description" as const, text: s(x.text, 120), angle: s(x.angle, 40), why: s(x.why), limit: PMAX_SPEC.texts.description.maxChars })),
    ...arr("image_concepts").map((x) => ({ kind: "image" as const, text: s(x.headline, 80), angle: s(x.angle, 40), why: s(x.why), limit: 60, data: { layout: ["typographic", "comparison", "process_steps", "expert"].includes(String(x.layout)) ? String(x.layout) : "typographic", cta: s(x.cta, 40), body: s(x.body, 160), left_label: s(x.left_label, 24), left: s(x.left, 60), right_label: s(x.right_label, 24), right: s(x.right, 60) } })),
    ...arr("meta_ads").map((x) => ({ kind: "meta" as const, text: s(x.image_headline, 80), angle: s(x.angle, 40), why: s(x.why), data: { name: s(x.name, 80), primary_text: s(x.primary_text, 400), headline: s(x.headline, 60), description: s(x.description, 60), cta_button: META_CTAS[String(x.cta_button)] ? String(x.cta_button) : "LEARN_MORE" } })),
  ].filter((p) => p.text);
  const tests = arr("tests").map((t) => ({ hypothesis: s(t.hypothesis), a: s(t.a, 120), b: s(t.b, 120) }));
  const summary = arr("summary").length ? (o.summary as unknown[]).map((x) => s(x)) : analysis.bullets;
  return { analysis, proposals: finish(ps), summary, tests, engine: "openai", warning: null };
}

/** add the picked proposals: texts as Google Ads texts, image concepts (3 formats), Meta ads */
export async function applyProposals(projectId: string, picked: Proposal[], opts: { campaignCode?: string | null; assetGroup?: string | null }) {
  const { project, assets, photos, campaigns } = await adwordsProject(projectId);
  const taken = new Set(assets.map((a) => a.conceptId).filter((x): x is string => !!x));
  const campaign = opts.campaignCode ?? campaigns[0]?.code ?? null;
  const group = opts.assetGroup ?? assets.find((a) => a.campaignCode === campaign && a.assetGroup)?.assetGroup ?? null;
  const url = campaigns.find((c) => c.code === campaign)?.landingUrl ?? assets.find((a) => a.landingUrl)?.landingUrl ?? null;
  const photo = photos.find((p) => p.consentConfirmed) ?? photos[0] ?? null;
  let order = ((await prisma.adwordsAsset.aggregate({ where: { projectId }, _max: { order: true } }))._max.order ?? 0) + 1;
  const made = { texts: 0, concepts: [] as string[], meta: 0 };
  for (const p of picked) {
    if (p.kind === "headline" || p.kind === "long_headline" || p.kind === "description") {
      const n = await prisma.adwordsAsset.count({ where: { projectId, rowType: p.kind } });
      let key = `AI-${p.kind === "headline" ? "H" : p.kind === "long_headline" ? "LH" : "D"}${n + 1}`;
      for (let i = 2; await prisma.adwordsAsset.findUnique({ where: { projectId_assetKey: { projectId, assetKey: key } } }); i++) key = `${key.replace(/-\d+$/, "")}-${i}`;
      await prisma.adwordsAsset.create({ data: { projectId, assetKey: key, rowType: p.kind, adText: p.text, campaignCode: campaign, assetGroup: group, landingUrl: url, status: "draft", scoreNote: `AI: ${p.angle} — ${p.why}`.slice(0, 500), order: order++ } });
      made.texts++;
    } else if (p.kind === "image") {
      const code = nextCode(taken, "G");
      taken.add(code);
      const d = p.data ?? {};
      const expert = d.layout === "expert" && photo;
      const layout = expert ? "expert_split" : d.layout === "expert" ? "typographic" : d.layout;
      const lp = layout === "comparison" ? { layout_id: "comparison", comparison_title: p.text, comparison_left_label: d.left_label || "Tradycyjnie", comparison_left: d.left, comparison_right_label: d.right_label || "Z planem", comparison_right: d.right } : undefined;
      for (const f of PMAX_SPEC.images.formats) {
        await prisma.adwordsAsset.create({
          data: { projectId, conceptId: code, assetKey: `${code}-${f.key === "landscape" ? "L" : f.key === "square" ? "SQ" : "P"}`, rowType: "image", aspectRatio: f.ratio, width: f.width, height: f.height, headline: p.text, body: d.body || null, cta: d.cta || null, layout, expertPhotoId: expert ? photo!.id : null, campaignCode: campaign, assetGroup: group, landingUrl: url, funnel: "sprzedaz", status: "draft", scoreNote: `AI: ${p.angle} — ${p.why}`.slice(0, 500), ...(lp ? { lp } : {}), order: order++ },
        });
      }
      made.concepts.push(code);
    } else if (p.kind === "meta") {
      const d = p.data ?? {};
      const n = await prisma.metaAd.count({ where: { projectId } });
      await prisma.metaAd.create({ data: { projectId, name: d.name || `Meta AI ${n + 1}`, primaryText: d.primary_text ?? "", metaHeadline: d.headline ?? "", description: d.description ?? "", ctaButton: d.cta_button ?? "LEARN_MORE", headline: p.text, url, photoIds: photo?.consentConfirmed ? [photo.id] : [], order: n } });
      made.meta++;
    }
  }
  void project;
  return made;
}
