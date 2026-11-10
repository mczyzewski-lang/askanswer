/**
 * Google Adwords — more creatives from the concepts already there:
 * - "z ekspertem": the same headline / CTA with a real photo of an expert from the library (layout
 *   expert_split), one new concept per source concept (G03 → G03E), photos taken in turn;
 * - "z infografiką": an infographic drawn by OpenAI (the reels' infographic rules, the theme's palette),
 *   one picture per format, shown full-bleed with the CTA and the gold frame (G03 → G03I). The text in
 *   the picture is AI's: the new concept needs a person's approval before it is published.
 */
import { NO_LONG_DASH_RULE } from "../dashes";
import fsp from "node:fs/promises";
import path from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { HttpError } from "./errors";
import { enqueue } from "./jobs";
import { makeTempDir, putFile } from "./storage";
import { randomToken } from "./crypto";
import { generateOpenAIImage } from "./openai-images";
import { env, openaiConfigured, openaiKeyDiagnostics } from "./env";
import { topicOf } from "../adwords/context";
import { themeFromRow, DEFAULT_THEME } from "../themes";
import { adInfographicPrompt } from "../infographic-prompt";
import { fillStyle } from "../broll-style";
import { stepsOf } from "../adwords/draw";
import { formatKeyOf } from "../adwords/spec";

type Row = Prisma.AdwordsAssetGetPayload<object>;
const COPY_SKIP = new Set(["id", "projectId", "createdAt", "updatedAt", "assetKey", "conceptId", "approvedAt", "approvedBy", "order"]);
const keyFor = (src: Row, c: string, suffix: string) => (src.assetKey.startsWith(c) ? `${c}${suffix}${src.assetKey.slice(c.length)}` : `${src.assetKey}-${suffix}`);

async function sourceConcepts(projectId: string, conceptIds?: string[]) {
  const rows = await prisma.adwordsAsset.findMany({ where: { projectId, rowType: "image", ...(conceptIds?.length ? { conceptId: { in: conceptIds } } : {}) }, orderBy: { order: "asc" } });
  const by = new Map<string, Row[]>();
  for (const r of rows) if (r.conceptId) by.set(r.conceptId, [...(by.get(r.conceptId) ?? []), r]);
  return by;
}
const taken = async (projectId: string) => new Set((await prisma.adwordsAsset.findMany({ where: { projectId }, select: { conceptId: true } })).map((r) => r.conceptId).filter((x): x is string => !!x));

/**
 * Copies of each concept with an expert's photo — one per chosen photo (default: the photos with consent).
 * A concept that already shows a photo gets copies with the OTHER photos. Concept ids: G03E, G03E2, G03E3…
 */
export async function expertVariants(projectId: string, conceptIds?: string[], photoIds?: string[]) {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, include: { theme: { include: { expertPhotos: { orderBy: { createdAt: "asc" } } } } } });
  const all = project.theme?.expertPhotos ?? [];
  if (!all.length) throw new HttpError(400, "Najpierw dodaj zdjęcia ekspertów (zakładka Zdjęcia ekspertów).");
  const chosen = photoIds?.length ? all.filter((p) => photoIds.includes(p.id)) : all.filter((p) => p.consentConfirmed).length ? all.filter((p) => p.consentConfirmed) : all;
  if (!chosen.length) throw new HttpError(400, "Wybierz zdjęcia.");
  const used = await taken(projectId);
  // which photo each existing variant uses (no duplicates of the same concept + photo)
  const existing = await prisma.adwordsAsset.findMany({ where: { projectId, rowType: "image" }, select: { conceptId: true, expertPhotoId: true, edit: true } });
  const has = new Set(existing.filter((e) => e.expertPhotoId).map((e) => `${((e.edit ?? {}) as { variantOf?: string }).variantOf ?? e.conceptId}|${e.expertPhotoId}`));
  const made: string[] = [];
  const skipped: string[] = [];
  let max = (await prisma.adwordsAsset.aggregate({ where: { projectId }, _max: { order: true } }))._max.order ?? 0;
  for (const [c, rows] of await sourceConcepts(projectId, conceptIds)) {
    const edit = (rows[0].edit ?? {}) as { variantOf?: string };
    if (edit.variantOf || rows.some((r) => r.layout === "infographic")) {
      skipped.push(c);
      continue;
    }
    for (const photo of chosen) {
      if (has.has(`${c}|${photo.id}`) || rows[0].expertPhotoId === photo.id) continue;
      let id = `${c}E`;
      for (let n = 2; used.has(id); n++) id = `${c}E${n}`;
      used.add(id);
      has.add(`${c}|${photo.id}`);
      for (const r of rows) {
        const data = Object.fromEntries(Object.entries(r).filter(([key]) => !COPY_SKIP.has(key))) as Record<string, unknown>;
        await prisma.adwordsAsset.create({
          data: {
            ...(data as object),
            projectId,
            conceptId: id,
            assetKey: keyFor(r, c, id.slice(c.length)),
            layout: "expert_split",
            expertPhotoId: photo.id,
            expertPhotoKey: photo.key,
            experimentId: null,
            variant: null,
            pairedAssetId: null,
            lp: r.lp ? ({ ...(r.lp as object), layout_id: "expert_split" } as Prisma.InputJsonValue) : Prisma.JsonNull,
            edit: { variantOf: c } as Prisma.InputJsonValue,
            extra: (r.extra ?? Prisma.JsonNull) as Prisma.InputJsonValue,
            order: ++max,
          } as Prisma.AdwordsAssetUncheckedCreateInput,
        });
      }
      made.push(id);
    }
  }
  return { made, skipped, photos: chosen.length };
}

/** start the infographic versions (a background job per concept) */
export async function startInfographics(projectId: string, conceptIds: string[]) {
  if (!openaiConfigured()) throw new HttpError(400, `Infografiki wymagają klucza OpenAI. ${openaiKeyDiagnostics()}`);
  if (!conceptIds.length) throw new HttpError(400, "Zaznacz koncepty (pole wyboru na karcie).");
  if (conceptIds.length > 6) throw new HttpError(400, "Najwyżej 6 konceptów naraz (każdy to 3 obrazy AI).");
  const used = await taken(projectId);
  const jobs: string[] = [];
  for (const c of conceptIds) {
    if (used.has(`${c}I`)) continue;
    const j = await enqueue("adwords-infographic", { projectId, conceptId: c }, { idempotencyKey: `adwords-infographic:${projectId}:${c}`, maxAttempts: 2 });
    jobs.push(j.id);
  }
  return { jobs: jobs.length };
}

const RATIO: Record<string, "1.91:1" | "1:1" | "4:5"> = { landscape: "1.91:1", square: "1:1", portrait: "4:5" };

/** worker "adwords-infographic": three pictures (one per format) → a new concept G…I awaiting approval */
export async function runAdInfographic(projectId: string, conceptId: string) {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, include: { theme: true } });
  const rows = (await sourceConcepts(projectId, [conceptId])).get(conceptId) ?? [];
  if (!rows.length) throw new Error(`Brak konceptu ${conceptId}`);
  if (await prisma.adwordsAsset.findFirst({ where: { projectId, conceptId: `${conceptId}I` } })) return { skipped: true };
  const theme = project.theme ? themeFromRow(project.theme) : DEFAULT_THEME;
  const style = project.theme?.brollStyle ? fillStyle(project.theme.brollStyle, theme) : null;
  const src = rows[0];
  const steps = stepsOf(src.body);
  const items = (steps.length ? steps : [src.subheadline, src.body].filter((x): x is string => !!x?.trim()).slice(0, 3)).map((t) => ({ value: t, label: "" }));
  const dir = await makeTempDir("adwords-infographic");
  const max = (await prisma.adwordsAsset.aggregate({ where: { projectId }, _max: { order: true } }))._max.order ?? 0;
  try {
    const made: string[] = [];
    for (const [k, r] of rows.entries()) {
      const fk = formatKeyOf(r.aspectRatio, r.width, r.height) ?? "square";
      const W = r.width ?? 1200;
      const H = r.height ?? 1200;
      const raw = path.join(dir, `${k}-raw.png`);
      await generateOpenAIImage(adInfographicPrompt({ headline: src.headline ?? "", items }, theme, style, RATIO[fk] ?? "1:1"), { width: W, height: H, out: raw });
      // cover-crop to the exact format pixels
      const img = await loadImage(await fsp.readFile(raw));
      const cv = createCanvas(W, H);
      const s = Math.max(W / img.width, H / img.height);
      cv.getContext("2d").drawImage(img, (W - img.width * s) / 2, (H - img.height * s) / 2, img.width * s, img.height * s);
      const out = path.join(dir, `${k}.png`);
      await fsp.writeFile(out, cv.toBuffer("image/png"));
      const key = `projects/${projectId}/uploads/${randomToken(12)}.png`;
      const size = await putFile(key, out, "image/png");
      const asset = await prisma.mediaAsset.create({ data: { kind: "IMAGE", projectId, storageKey: key, mimeType: "image/png", sizeBytes: size, width: W, height: H, hasAudio: false, hasVideo: true, originalName: `Infografika Adwords ${conceptId} ${fk}`, meta: { source: "adwords-infographic", conceptId } } });
      const data = Object.fromEntries(Object.entries(r).filter(([key2]) => !COPY_SKIP.has(key2))) as Record<string, unknown>;
      const a = await prisma.adwordsAsset.create({
        data: {
          ...(data as object),
          projectId,
          conceptId: `${conceptId}I`,
          assetKey: keyFor(r, conceptId, "I"),
          layout: "infographic",
          expertPhotoId: null,
          expertPhotoKey: null,
          experimentId: null,
          variant: null,
          pairedAssetId: null,
          // the text in the picture is AI's — a person checks the spelling and approves it
          approvalRequired: true,
          claimSource: "Infografika wygenerowana przez AI — sprawdź pisownię i liczby przed publikacją",
          lp: r.lp ? ({ ...(r.lp as object), layout_id: "infographic" } as Prisma.InputJsonValue) : Prisma.JsonNull,
          edit: { variantOf: conceptId, infographicAssetId: asset.id } as Prisma.InputJsonValue,
          extra: (r.extra ?? Prisma.JsonNull) as Prisma.InputJsonValue,
          order: max + 1 + k,
        } as Prisma.AdwordsAssetUncheckedCreateInput,
      });
      made.push(a.id);
    }
    return { conceptId: `${conceptId}I`, assets: made };
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

// ------------------------------------------------------------------------------------------ comparison

export const COMPARE_SYSTEM = `ADWORDS_COMPARE
Tworzysz grafikę porównawczą (dwie karty: „tradycyjnie” vs „z nami”) do reklamy kancelarii w Google Ads / Meta, na podstawie istniejącego hasła.
Karta = etykieta (np. „TRADYCYJNIE”, „GDY JEST SPÓR”, „BEZ PLANU” / nazwa marki) + mocna linia (≤ 28 znaków, np. „Najpierw pozew” / „Najpierw plan”) + opis (≤ 70 znaków, np. „Pozew → odpowiedź → kolejne pisma” / „Plan → rozmowy → ustalenia → pozew”).
Tytuł to pytanie albo teza klienta (np. „A gdyby odwrócić kolejność?”, „Ile będzie kosztować rozwód?”), ≤ 45 znaków.
Zasady: konkretnie, bez liczb, terminów, cen i obietnic wyniku, których nie ma w źródle; nie sugeruj, że każdy tradycyjny proces to wojna; bez „gwarantujemy”; naturalna polszczyzna; prawa strona to mechanizm z hasła.
Zwróć JSON: {"title":"…","left_label":"…","left_title":"…","left":"…","right_label":"…","right_title":"…","right":"…"}`;

export interface CompareCopy {
  title: string;
  left_label: string;
  left_title?: string;
  left: string;
  right_label: string;
  right_title?: string;
  right: string;
}
/** without OpenAI: a plain rule from the headline and the topic */
export function compareRule(headline: string, topic: string | null): CompareCopy {
  const div = /rozw/i.test(topic ?? headline);
  return {
    title: div ? "Rozwód: tradycyjnie czy z planem?" : "Tradycyjnie czy z nami?",
    left_label: "Tradycyjnie",
    left: div ? "Najpierw pozew, potem spór o wszystko" : "Bez planu i bez jasnych kroków",
    right_label: div ? "Z planem" : "Z nami",
    right: headline.replace(/\.$/, "").slice(0, 60),
  };
}

async function compareCopy(headline: string, body: string | null, topic: string | null, brand: string): Promise<CompareCopy> {
  if (!openaiConfigured()) return compareRule(headline, topic);
  const res = await fetch(`${env.openaiBaseUrl}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.openaiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: env.openaiTextModel, response_format: { type: "json_object" }, messages: [{ role: "system", content: `${COMPARE_SYSTEM}\n${NO_LONG_DASH_RULE}` }, { role: "user", content: `Marka: ${brand}\nTemat: ${topic ?? "—"}\nHasło: ${headline}\nDopisek: ${body ?? "—"}` }] }),
    signal: AbortSignal.timeout(60_000),
  }).catch(() => null);
  if (!res?.ok) return compareRule(headline, topic);
  try {
    const d = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const o = JSON.parse((d.choices?.[0]?.message?.content ?? "{}").replace(/^```(?:json)?\s*|\s*```$/g, "").replace(/[—–]/g, "-")) as Partial<CompareCopy>;
    const cut = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);
    const out = { title: cut(o.title, 70), left_label: cut(o.left_label, 24), left_title: cut(o.left_title, 40), left: cut(o.left, 90), right_label: cut(o.right_label, 24), right_title: cut(o.right_title, 40), right: cut(o.right, 90) };
    return out.left && out.right ? out : compareRule(headline, topic);
  } catch {
    return compareRule(headline, topic);
  }
}

/** a comparison version of each concept (G03 → G03C): two cards, the texts by OpenAI (or a rule), editable after */
export async function comparisonVariants(projectId: string, conceptIds?: string[]) {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  const all = await prisma.adwordsAsset.findMany({ where: { projectId }, select: { headline: true, adText: true, subheadline: true, body: true } });
  const topic = topicOf(project.adwordsTopic, all.flatMap((a) => [a.headline ?? "", a.adText ?? "", a.subheadline ?? "", a.body ?? ""]));
  const used = await taken(projectId);
  const made: string[] = [];
  const skipped: string[] = [];
  let max = (await prisma.adwordsAsset.aggregate({ where: { projectId }, _max: { order: true } }))._max.order ?? 0;
  for (const [c, rows] of await sourceConcepts(projectId, conceptIds)) {
    const edit = (rows[0].edit ?? {}) as { variantOf?: string };
    if (edit.variantOf || rows[0].layout === "comparison" || rows[0].layout === "infographic" || used.has(`${c}C`) || !(rows[0].headline ?? "").trim()) {
      skipped.push(c);
      continue;
    }
    const cc = await compareCopy(rows[0].headline!, rows[0].body, topic, project.name);
    for (const r of rows) {
      const data = Object.fromEntries(Object.entries(r).filter(([key]) => !COPY_SKIP.has(key))) as Record<string, unknown>;
      await prisma.adwordsAsset.create({
        data: {
          ...(data as object),
          projectId,
          conceptId: `${c}C`,
          assetKey: keyFor(r, c, "C"),
          headline: cc.title || r.headline,
          layout: "comparison",
          expertPhotoId: null,
          expertPhotoKey: null,
          experimentId: null,
          variant: null,
          pairedAssetId: null,
          lp: { ...((r.lp ?? {}) as object), layout_id: "comparison", comparison_title: cc.title, comparison_left_label: cc.left_label, comparison_left: cc.left, comparison_right_label: cc.right_label, comparison_right: cc.right, ...(cc.left_title ? { comparison_left_title: cc.left_title } : {}), ...(cc.right_title ? { comparison_right_title: cc.right_title } : {}) } as Prisma.InputJsonValue,
          edit: { variantOf: c } as Prisma.InputJsonValue,
          extra: (r.extra ?? Prisma.JsonNull) as Prisma.InputJsonValue,
          order: ++max,
        } as Prisma.AdwordsAssetUncheckedCreateInput,
      });
    }
    made.push(`${c}C`);
  }
  return { made, skipped };
}

// ------------------------------------------------------------------------------- comparison templates

/** ready comparison concepts (the light "cards" design): the question on top, the usual way vs ours */
export const COMPARISON_TEMPLATES: Array<{ key: string; title: string; left_label: string; left_title: string; left: string; right_title: string; right: string; cta: string; why: string }> = [
  { key: "kolejnosc", title: "„A gdyby odwrócić kolejność?”", left_label: "Tradycyjnie", left_title: "Najpierw pozew", left: "Pozew → odpowiedź → kolejne pisma → ustalenia w trakcie sporu", right_title: "Najpierw plan", right: "Plan → rozmowy → ustalenia → pozew", cta: "Odbierz bezpłatny Plan Rozwodu", why: "pokazuje mechanizm, nie ogólną obietnicę" },
  { key: "cena", title: "„Ile będzie kosztować rozwód?”", left_label: "Tradycyjnie", left_title: "„To zależy…”", left: "Koszty kolejnych czynności mogą być trudne do przewidzenia.", right_title: "Cena znana z góry", right: "Poznajesz cenę i zakres naszej usługi przed decyzją.", cta: "Sprawdź koszt i odbierz Plan", why: "trafia w obawę o koszty — cena usługi, nie wszystkich kosztów sądowych" },
  { key: "bez-wojny", title: "„Rozwód nie musi oznaczać wojny”", left_label: "Gdy jest spór", left_title: "Walka o każde ustalenie", left: "Konflikt → stanowiska stron → rozstrzygnięcia sądu", right_title: "Najpierw rozmowa", right: "Mediacja → próba porozumienia → przygotowanie dokumentów", cta: "Sprawdź, jak działa rozwód bez wojny", why: "emocjonalny kontrast, bez sugerowania, że każdy rozwód to wojna" },
  { key: "kroki", title: "„Wiesz, co będzie dalej?”", left_label: "Bez planu", left_title: "Co teraz?", left: "Niepewność, kolejne decyzje, zmieniające się ustalenia.", right_title: "Znasz kolejne kroki", right: "Plan działania, lista dokumentów i uporządkowany proces.", cta: "Poznaj swój Plan Rozwodu", why: "poczucie kontroli, bez obietnic czasu" },
  { key: "zakres", title: "„Za co właściwie płacisz?”", left_label: "Tradycyjny model godzinowy", left_title: "Płacisz za kolejne czynności", left: "Konsultacje, pisma i dodatkowy czas pracy.", right_title: "Znasz zakres pomocy", right: "Wiesz, jakie działania obejmuje proponowana usługa.", cta: "Poznaj zakres i cenę usługi", why: "dla porównujących kancelarie (częściowo jak „cena”)" },
];

/** the templates as new concepts (3 Google formats each); a template already added is skipped */
export async function comparisonTemplates(projectId: string, keys?: string[]) {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  const used = await taken(projectId);
  const existing = await prisma.adwordsAsset.findMany({ where: { projectId, rowType: "image" }, select: { edit: true, campaignCode: true, assetGroup: true, landingUrl: true } });
  const have = new Set(existing.map((a) => ((a.edit ?? {}) as { template?: string }).template).filter(Boolean));
  const base = existing.find((a) => a.landingUrl) ?? existing[0] ?? null;
  const formats = [
    { key: "L", ratio: "1.91:1", width: 1200, height: 628 },
    { key: "SQ", ratio: "1:1", width: 1200, height: 1200 },
    { key: "P", ratio: "4:5", width: 960, height: 1200 },
  ];
  let max = (await prisma.adwordsAsset.aggregate({ where: { projectId }, _max: { order: true } }))._max.order ?? 0;
  const made: string[] = [];
  const skipped: string[] = [];
  for (const t of COMPARISON_TEMPLATES.filter((x) => !keys?.length || keys.includes(x.key))) {
    if (have.has(t.key)) {
      skipped.push(t.key);
      continue;
    }
    let code = "";
    for (let i = 1; i < 1000 && !code; i++) if (!used.has(`K${String(i).padStart(2, "0")}`)) code = `K${String(i).padStart(2, "0")}`;
    used.add(code);
    for (const f of formats) {
      await prisma.adwordsAsset.create({
        data: {
          projectId,
          conceptId: code,
          assetKey: `${code}-${f.key}`,
          rowType: "image",
          aspectRatio: f.ratio,
          width: f.width,
          height: f.height,
          headline: t.title,
          cta: t.cta,
          layout: "comparison",
          campaignCode: base?.campaignCode ?? null,
          assetGroup: base?.assetGroup ?? null,
          landingUrl: base?.landingUrl ?? null,
          funnel: "sprzedaz",
          status: "draft",
          scoreNote: `Porównanie: ${t.why}`,
          lp: { layout_id: "comparison", comparison_title: t.title, comparison_left_label: t.left_label, comparison_left_title: t.left_title, comparison_left: t.left, comparison_right_label: project.name, comparison_right_title: t.right_title, comparison_right: t.right } as Prisma.InputJsonValue,
          edit: { template: t.key } as Prisma.InputJsonValue,
          order: ++max,
        },
      });
    }
    made.push(code);
  }
  return { made, skipped };
}

// ------------------------------------------------------------------------- 10 PMax creatives from history

/**
 * Ten PMax image concepts built on the history report (1 Jan – 8 Nov 2026): the text angles with the
 * best directional CTR and the most clicks carried into images (the old images had ~0.25% CTR, the
 * best headlines 12–17%). No numbers without a source, no promise of the unconfirmed free plan, the
 * topic in every headline (or on top of the card), ≤32 characters, a mechanism in the sub-line, one
 * CTA, the real expert's photo.
 */
export const PMAX_TOP10: Array<{
  key: string;
  layout: "comparison" | "expert_split";
  headline: string;
  sub: string;
  cta: string;
  cmp?: { left_label: string; left_title: string; left: string; right_title: string; right: string };
  history: string;
}> = [
  { key: "bez-walki", layout: "comparison", headline: "Rozwód bez walki w sądzie", sub: "Najpierw ustalenia, potem pozew.", cta: "Sprawdź, jak to działa", cmp: { left_label: "Gdy jest spór", left_title: "Walka w sądzie", left: "Pisma, rozprawy, kolejne terminy", right_title: "Ustalenia przed sądem", right: "Rozmowa, porozumienie, dokumenty" }, history: "„Rozwód bez walki w sądzie”: najwięcej kliknięć (122 tys.), CTR 13,3%" },
  { key: "zanim-pozew", layout: "comparison", headline: "Sprawdź, zanim złożysz pozew", sub: "Plan i ustalenia przed pozwem.", cta: "Sprawdź przed pozwem", cmp: { left_label: "Tradycyjnie", left_title: "Najpierw pozew", left: "Pozew, odpowiedź, spór o szczegóły", right_title: "Najpierw plan", right: "Ustalenia, dokumenty, potem pozew" }, history: "„Sprawdź, zanim złożysz pozew”: CTR 17,0%" },
  { key: "obnizyc-koszty", layout: "comparison", headline: "Jak obniżyć koszty rozwodu?", sub: "Poznaj zakres i cenę usługi z góry.", cta: "Sprawdź koszt usługi", cmp: { left_label: "Tradycyjnie", left_title: "„To zależy…”", left: "Kolejne czynności, kolejne koszty", right_title: "Cena znana z góry", right: "Zakres i cena usługi przed decyzją" }, history: "„Jak obniżyć koszty rozwodu?”: najwyższy CTR 17,1%" },
  { key: "porozumienie", layout: "comparison", headline: "Porozumienie zamiast sporu", sub: "Wspólne ustalenia o dzieciach i majątku.", cta: "Umów konsultację", cmp: { left_label: "Spór", left_title: "Każdy o swoje", left: "Stanowiska, pisma, decyzja sądu", right_title: "Wspólne ustalenia", right: "Dzieci, majątek, kontakty: spisane razem" }, history: "„Porozumienie zamiast sporu”: CTR 10,5%; „Złóż to zamiast pozwu”: 119 tys. kliknięć" },
  { key: "koszt-z-gory", layout: "comparison", headline: "Chcesz znać koszt z góry?", sub: "Bez niespodzianek i burzy nerwów.", cta: "Poznaj cenę usługi", cmp: { left_label: "Bez wyceny", left_title: "Niespodzianki", left: "Dopłaty za kolejne kroki", right_title: "Cena na start", right: "Wiesz, za co płacisz, zanim zaczniesz" }, history: "opis „Rozwód - chcesz znać z góry koszt i uniknąć burzy nerwów?”: CTR 13,2%, 70 tys. kliknięć" },
  { key: "bez-winy", layout: "comparison", headline: "Rozwód bez orzekania o winie", sub: "Spokojniej dla Was i dla dzieci.", cta: "Sprawdź, czy to dla Was", cmp: { left_label: "Spór o winę", left_title: "Dowody i świadkowie", left: "Długi spór o to, kto zawinił", right_title: "Zgodny wniosek", right: "Wspólne ustalenia, mniej stresu" }, history: "„Rozwód bez orzekania o winie”: CTR 11,6%" },
  { key: "mediator", layout: "expert_split", headline: "Spokojny rozwód z mediatorem", sub: "Ustalenia o dzieciach i majątku.", cta: "Umów konsultację", history: "„Spokojny rozwód z mediatorem”: CTR 12,4%; opis o mediatorze: 30 tys. kliknięć" },
  { key: "dzieci", layout: "expert_split", headline: "Rozwód a opieka nad dziećmi", sub: "Ustalenia z mediatorem, bez sporu.", cta: "Umów konsultację", history: "opis „Mediator pomoże Wam ustalić podział majątku i opiekę nad dziećmi”: 30 tys. kliknięć, CTR 9,7%" },
  { key: "online", layout: "expert_split", headline: "Mediacja rozwodowa online", sub: "Ustalenia bez wychodzenia z domu.", cta: "Umów rozmowę online", history: "„Mediacja rozwodowa online”: CTR 11,8%" },
  { key: "plan-pozew", layout: "expert_split", headline: "Rozwód: plan przed pozwem", sub: "Krok po kroku, z prawnikiem.", cta: "Poznaj plan działania", history: "kąt „najpierw porozumienie, potem pozew”: mediana CTR 12,2%" },
];

/** the ten concepts (P01–P10, 3 Google formats each) with the first consented expert photo; added once */
export async function pmaxTopTen(projectId: string) {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, include: { theme: { include: { expertPhotos: true } } } });
  const photo = project.theme?.expertPhotos.find((p) => p.consentConfirmed) ?? null;
  const used = await taken(projectId);
  const existing = await prisma.adwordsAsset.findMany({ where: { projectId, rowType: "image" }, select: { edit: true, campaignCode: true, assetGroup: true, landingUrl: true } });
  const have = new Set(existing.map((a) => ((a.edit ?? {}) as { template?: string }).template).filter(Boolean));
  const base = existing.find((a) => a.landingUrl) ?? existing[0] ?? null;
  const formats = [
    { key: "L", ratio: "1.91:1", width: 1200, height: 628 },
    { key: "SQ", ratio: "1:1", width: 1200, height: 1200 },
    { key: "P", ratio: "4:5", width: 960, height: 1200 },
  ];
  let max = (await prisma.adwordsAsset.aggregate({ where: { projectId }, _max: { order: true } }))._max.order ?? 0;
  const made: string[] = [];
  const skipped: string[] = [];
  for (const t of PMAX_TOP10) {
    if (have.has(`pmax10:${t.key}`)) {
      skipped.push(t.key);
      continue;
    }
    let code = "";
    for (let i = 1; i < 1000 && !code; i++) if (!used.has(`P${String(i).padStart(2, "0")}`)) code = `P${String(i).padStart(2, "0")}`;
    used.add(code);
    for (const f of formats) {
      await prisma.adwordsAsset.create({
        data: {
          projectId,
          conceptId: code,
          assetKey: `${code}-${f.key}`,
          rowType: "image",
          aspectRatio: f.ratio,
          width: f.width,
          height: f.height,
          headline: t.headline,
          subheadline: t.sub,
          cta: t.cta,
          layout: t.layout,
          expertPhotoId: photo?.id ?? null,
          campaignCode: base?.campaignCode ?? null,
          assetGroup: base?.assetGroup ?? null,
          landingUrl: base?.landingUrl ?? null,
          funnel: "sprzedaz",
          status: "draft",
          scoreNote: `Z historii PMax: ${t.history}`.slice(0, 500),
          ...(t.cmp ? { lp: { layout_id: "comparison", comparison_title: t.headline, comparison_left_label: t.cmp.left_label, comparison_left_title: t.cmp.left_title, comparison_left: t.cmp.left, comparison_right_label: project.name, comparison_right_title: t.cmp.right_title, comparison_right: t.cmp.right } as Prisma.InputJsonValue } : {}),
          edit: { template: `pmax10:${t.key}` } as Prisma.InputJsonValue,
          order: ++max,
        },
      });
    }
    made.push(code);
  }
  return { made, skipped, photo: photo?.name ?? null };
}
