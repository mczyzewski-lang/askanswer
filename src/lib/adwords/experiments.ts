/**
 * Google Adwords — experiments (CSV v2): one hypothesis (e.g. a hook) expressed as a headline, an image
 * and the first 3 s of a video, in arms A and B. What may differ between the arms depends on the test
 * axis; everything else must be identical, or the test does not test one thing.
 */
import type { AdAsset } from "./score";
import { videoConcepts } from "./video";
import { formatKeyOf, PMAX_SPEC } from "./spec";

export type Axis = "hook" | "photo" | "video_look" | "other";
export const axisOf = (testAxis: string | null | undefined): Axis => {
  const t = (testAxis ?? "").toLowerCase();
  if (/hook|nagłów|naglow|obietnic|komunikac/.test(t)) return "hook";
  if (/zdj|foto|photo|mediator|wizual/.test(t)) return "photo";
  if (/wideo|video|animac|kamer/.test(t)) return "video_look";
  return "other";
};

export interface Arm {
  variant: "A" | "B";
  images: AdAsset[];
  videos: ReturnType<typeof videoConcepts>;
  texts: AdAsset[];
}
export interface Experiment {
  id: string;
  plan: AdAsset | null;
  axis: Axis;
  testAxis: string | null;
  mode: "exploration" | "controlled";
  arms: { A: Arm; B: Arm };
  evidence: string[];
}

const IMAGE = (a: AdAsset) => a.rowType === "image" || a.rowType === "image_clean";
const TEXT = (a: AdAsset) => a.rowType === "headline" || a.rowType === "long_headline" || a.rowType === "description";

export function experiments(assets: AdAsset[]): Experiment[] {
  const ids = [...new Set(assets.map((a) => a.experimentId).filter((x): x is string => !!x))].sort();
  return ids.map((id) => {
    const rows = assets.filter((a) => a.experimentId === id);
    // scenes belong to their video concept's arm
    const videoArm = new Map(rows.filter((a) => a.rowType === "video").map((a) => [a.conceptId, a.variant]));
    const arm = (v: "A" | "B"): Arm => {
      const mine = rows.filter((a) => (a.variant ?? (a.rowType === "video_scene" ? videoArm.get(a.conceptId ?? null) : null)) === v);
      return { variant: v, images: mine.filter(IMAGE), videos: videoConcepts(mine.filter((a) => a.rowType === "video" || a.rowType === "video_scene")), texts: mine.filter(TEXT) };
    };
    const plan = rows.find((a) => a.rowType === "experiment_plan") ?? null;
    const testAxis = plan?.testAxis ?? rows.find((a) => a.testAxis)?.testAxis ?? null;
    const mode = (rows.find((a) => a.deployMode)?.deployMode ?? "exploration") === "controlled" ? "controlled" : "exploration";
    return { id, plan, axis: axisOf(testAxis), testAxis, mode, arms: { A: arm("A"), B: arm("B") }, evidence: [...new Set(rows.map((a) => a.evidenceNote).filter((x): x is string => !!x))] };
  });
}

export interface Check {
  level: "blokada" | "do_poprawy" | "ok";
  message: string;
}

const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
const layoutKey = (a: AdAsset) => a.layout ?? /^(typographic|expert_split|process_steps)\b/.exec(norm(a.visualBrief))?.[1] ?? (a.expertPhotoKey || a.expertPhotoId ? "expert_split" : "typographic");
const fmt = (a: AdAsset) => formatKeyOf(a.aspectRatio, a.width, a.height);

/** Is only the tested variable different between A and B? */
export function experimentChecks(e: Experiment): Check[] {
  const out: Check[] = [];
  const { A, B } = e.arms;
  const fieldsDiff = (x: AdAsset, y: AdAsset, fields: Array<keyof AdAsset>) => fields.filter((f) => norm(String(x[f] ?? "")) !== norm(String(y[f] ?? "")));
  // images: pairs by format
  const fA = [...new Set(A.images.map(fmt))].sort().join(",");
  const fB = [...new Set(B.images.map(fmt))].sort().join(",");
  if (A.images.length + B.images.length && fA !== fB) out.push({ level: "blokada", message: `Formaty grafik różnią się: A [${fA}] / B [${fB}].` });
  for (const x of A.images) {
    const y = B.images.find((b) => fmt(b) === fmt(x));
    if (!y) continue;
    const label = `Grafika ${fmt(x)}`;
    const fixed: Array<keyof AdAsset> = ["subheadline", "body", "cta", "landingUrl", "funnel"];
    if (e.axis === "hook") {
      const d = fieldsDiff(x, y, fixed);
      if (layoutKey(x) !== layoutKey(y)) d.push("layout");
      if ((x.expertPhotoKey ?? x.expertPhotoId ?? "") !== (y.expertPhotoKey ?? y.expertPhotoId ?? "")) d.push("expertPhotoKey");
      if (d.length) out.push({ level: "blokada", message: `${label}: poza hookiem różni się ${d.join(", ")} — test nie sprawdza jednej zmiennej.` });
      if (norm(x.headline) === norm(y.headline)) out.push({ level: "do_poprawy", message: `${label}: hook A i B jest taki sam.` });
    } else if (e.axis === "photo") {
      const d = fieldsDiff(x, y, ["headline", ...fixed]);
      if (d.length) out.push({ level: "blokada", message: `${label}: w teście zdjęcia treść musi być identyczna — różni się ${d.join(", ")}.` });
      if (!!(x.expertPhotoKey || x.expertPhotoId) === !!(y.expertPhotoKey || y.expertPhotoId)) out.push({ level: "do_poprawy", message: `${label}: oba warianty ${x.expertPhotoKey || x.expertPhotoId ? "mają" : "nie mają"} zdjęcia — brak testowanej zmiennej.` });
    }
  }
  // videos: same formats; scenes
  const vf = (arm: Arm) => [...new Set(arm.videos.flatMap((v) => v.variants.map(fmt)))].sort().join(",");
  if ((A.videos.length || B.videos.length) && vf(A) !== vf(B)) out.push({ level: "blokada", message: `Formaty wideo różnią się: A [${vf(A)}] / B [${vf(B)}].` });
  const va = A.videos[0];
  const vb = B.videos[0];
  if (va && vb) {
    const key = (s: AdAsset, withVisual: boolean) => [s.startS, s.endS, norm(s.spokenText), norm(s.screenText), withVisual ? norm(s.visualBrief) : ""].join("|");
    if (e.axis === "hook") {
      const restA = va.scenes.filter((s) => (s.startS ?? 0) >= 3);
      const restB = vb.scenes.filter((s) => (s.startS ?? 0) >= 3);
      const same = restA.length === restB.length && restA.every((s, i) => key(s, true) === key(restB[i], true));
      out.push(same ? { level: "ok", message: "Sceny od 3. sekundy do końca są identyczne w A i B." } : { level: "blokada", message: "Sceny od 3. sekundy różnią się między A i B — w teście hooka zmienia się tylko 0–3 s." });
      for (const [arm, v] of [["A", va], ["B", vb]] as const) {
        const hook = v.scenes.find((s) => (s.startS ?? 0) < 3);
        const head = e.arms[arm].texts.find((t) => t.rowType === "headline")?.adText ?? e.arms[arm].images[0]?.headline;
        if (hook && head && norm(hook.screenText) !== norm(head)) out.push({ level: "do_poprawy", message: `Wideo ${arm}: napis 0–3 s „${hook.screenText}” różni się od nagłówka „${head}”.` });
      }
    } else if (e.axis === "video_look") {
      const same = va.scenes.length === vb.scenes.length && va.scenes.every((s, i) => key(s, false) === key(vb.scenes[i], false));
      out.push(same ? { level: "ok", message: "Ten sam scenariusz i timing w A i B (zmienia się tylko obraz)." } : { level: "blokada", message: "Scenariusz lub timing różni się — w teście formy wideo treść ma być identyczna." });
    }
  }
  // CTA parity
  const ctas = (arm: Arm) => [...new Set(arm.images.map((i) => norm(i.cta)).filter(Boolean))].join(" | ");
  if (ctas(A) && ctas(B) && ctas(A) !== ctas(B)) out.push({ level: "blokada", message: `CTA różni się: A „${ctas(A)}” / B „${ctas(B)}”.` });
  if (!out.some((c) => c.level !== "ok")) out.push({ level: "ok", message: "Ramiona A i B różnią się tylko testowaną zmienną." });
  return out;
}

/** Limits of one asset group, counted for an arm (the exported set must fit in a group). */
export function armLimits(arm: Arm): Check[] {
  const imgs = arm.images.length;
  const heads = arm.texts.filter((t) => t.rowType === "headline").length;
  const vids = arm.videos.reduce((n, v) => n + v.variants.length, 0);
  return [
    { level: imgs > PMAX_SPEC.images.maxPerGroup ? "blokada" : "ok", message: `Obrazy: ${imgs}/${PMAX_SPEC.images.maxPerGroup}` },
    { level: heads > PMAX_SPEC.texts.headline.maxCount ? "blokada" : "ok", message: `Nagłówki: ${heads}/${PMAX_SPEC.texts.headline.maxCount}` },
    { level: vids > PMAX_SPEC.videos.maxPerGroup ? "blokada" : "ok", message: `Filmy: ${vids}/${PMAX_SPEC.videos.maxPerGroup}` },
  ];
}

export const MODE_NOTE = {
  exploration: "Tryb Exploration: B dochodzi do puli obok A (maks. 15 nagłówków). A i B były mieszane przez algorytm — brak izolowanego testu; raport komponentów nie wskaże zwycięzcy.",
  controlled:
    "Tryb A/B (Controlled): eksperyment komponentów PMax (beta, jeśli konto się kwalifikuje) — paczka kontrolna A, eksperymentalna B i wspólna pula bez zmian. 4–6 tygodni, jedna zmienna, te same pozostałe komponenty, URL, konwersje, strategia stawek i automatyzacje; wynik czytaj w panelu eksperymentu (najlepiej na kwalifikowanych leadach i klientach), nie w raporcie komponentów. Obie strony liczą się do limitów grupy.",
  fallback: "Gdy beta nie jest dostępna: test sekwencyjny (okres A, potem okres B) albo osobne grupy komponentów — mniej wiarygodne (sezonowość, uczenie się algorytmu, różne zapytania); traktuj wynik jako kierunkowy.",
} as const;

export type EvidenceLabel = "historyczna ekspozycja" | "hipoteza" | "wynik kontrolowanego eksperymentu" | "próba za mała";
/** confidence about the SCALE of exposure only — never about causing sales */
export function exposureConfidence(impressions: number | null | undefined): { level: "niska" | "średnia" | "wysoka"; label: EvidenceLabel } {
  const n = impressions ?? 0;
  if (n < 1000) return { level: "niska", label: "próba za mała" };
  if (n < 50_000) return { level: "niska", label: "historyczna ekspozycja" };
  if (n < 250_000) return { level: "średnia", label: "historyczna ekspozycja" };
  return { level: "wysoka", label: "historyczna ekspozycja" };
}
