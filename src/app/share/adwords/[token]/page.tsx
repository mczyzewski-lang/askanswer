import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { adwordsProject, defaultBrief, evaluateProject, toAdAsset } from "@/lib/server/adwords";
import { landingContext } from "@/lib/server/adwords-landing";
import { shareOf } from "@/lib/server/adwords-share";
import { formatKeyOf, FORMAT_LABEL, PMAX_SPEC } from "@/lib/adwords/spec";
import { videoConcepts } from "@/lib/adwords/video";
import { blockOf, validateVariant, variantBlocks, variantLabel, variantsOf, STATUS_LABEL } from "@/lib/adwords/landing-content";
import { AdwordsShareView, type ShareData, type ShareStatus } from "./view";

export const metadata: Metadata = { title: "Materiały Google Ads — podgląd dla agencji", robots: { index: false, follow: false }, referrer: "no-referrer" };
export const dynamic = "force-dynamic";

const worst = (xs: ShareStatus[]): ShareStatus => (xs.includes("blokada") ? "blokada" : xs.includes("do_poprawy") ? "do_poprawy" : "gotowe");

/** Read-only page of a project's Google Ads set for an agency — opened by its link, no login. */
export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const s = await shareOf(token, { count: true }).catch(() => null);
  if (!s) notFound();
  const { project, assets, campaigns } = await adwordsProject(s.projectId);
  const ev = await evaluateProject(s.projectId);
  const list = assets.map(toAdAsset);
  const gate = new Map([...ev.images, ...ev.texts, ...ev.sitelinks].map((x) => [x.id, x.gate]));
  const msg = (id: string) => (gate.get(id)?.problems ?? []).map((p) => p.message);
  const st = (id: string) => (gate.get(id)?.status ?? "gotowe") as ShareStatus;

  const images = assets.filter((a) => a.rowType === "image" || a.rowType === "image_clean");
  const conceptIds = [...new Set(images.map((a) => a.conceptId ?? a.assetKey))];
  const order = ["landscape", "square", "portrait"];
  const concepts = conceptIds.map((c) => {
    const imgs = images.filter((a) => (a.conceptId ?? a.assetKey) === c).sort((a, b) => order.indexOf(formatKeyOf(a.aspectRatio, a.width, a.height) ?? "") - order.indexOf(formatKeyOf(b.aspectRatio, b.width, b.height) ?? ""));
    const head = imgs[0];
    return {
      conceptId: c,
      headline: head.headline ?? head.visualBrief ?? "",
      subheadline: head.subheadline ?? "",
      cta: head.cta ?? "",
      clean: head.rowType === "image_clean",
      experiment: head.experimentId ? `${head.experimentId}${head.variant ? ` / ${head.variant}` : ""}` : null,
      landing: head.landingVariantId ? variantLabel(head.landingVariantId) : null,
      status: worst(imgs.map((a) => st(a.id))),
      problems: [...new Set(imgs.flatMap((a) => msg(a.id)))],
      images: imgs.map((a) => {
        const k = formatKeyOf(a.aspectRatio, a.width, a.height);
        return { id: a.id, format: k ? FORMAT_LABEL[k] : (a.aspectRatio ?? ""), key: k ?? "", size: a.width && a.height ? `${a.width}×${a.height}` : "", status: st(a.id) };
      }),
    };
  });
  const textKinds = [
    ["headline", PMAX_SPEC.texts.headline.label, PMAX_SPEC.texts.headline.maxChars],
    ["long_headline", PMAX_SPEC.texts.long_headline.label, PMAX_SPEC.texts.long_headline.maxChars],
    ["description", PMAX_SPEC.texts.description.label, PMAX_SPEC.texts.description.maxChars],
  ] as const;
  const texts = textKinds.map(([k, label, max]) => ({
    kind: k,
    label,
    max,
    items: assets.filter((a) => a.rowType === k && (a.adText ?? "").trim()).map((a) => ({ id: a.id, assetKey: a.assetKey, text: a.adText ?? "", len: [...(a.adText ?? "")].length, status: st(a.id), problems: msg(a.id) })),
  }));
  const sitelinks = assets
    .filter((a) => a.rowType === "sitelink")
    .map((a) => {
      const lp = (a.lp ?? {}) as Record<string, string>;
      return { id: a.id, assetKey: a.assetKey, text: a.adText ?? "", d1: lp.sitelink_description_1 ?? "", d2: lp.sitelink_description_2 ?? "", url: a.landingUrl ?? "", status: st(a.id), problems: msg(a.id) };
    });
  const videos = videoConcepts(list).map((v) => {
    const e = ev.videos.find((x) => x.conceptId === v.conceptId);
    return {
      conceptId: v.conceptId,
      headline: v.variants[0]?.headline ?? v.scenes[0]?.screenText ?? "",
      formats: v.variants.map((x) => x.aspectRatio ?? "").filter(Boolean),
      status: (e?.gate.status ?? "gotowe") as ShareStatus,
      problems: (e?.gate.problems ?? []).map((p) => p.message),
      scenes: v.scenes.map((x) => ({ t: `${x.startS ?? "?"}–${x.endS ?? "?"} s`, spoken: x.spokenText ?? "", screen: x.screenText ?? "", visual: x.visualBrief ?? "" })),
    };
  });
  const lctx = await landingContext(s.projectId);
  const blocks = assets.filter((a) => a.rowType === "landing_page").map(blockOf);
  const landing = variantsOf(blocks).map((id) => {
    const v = validateVariant(id, variantBlocks(blocks, id), lctx);
    const refuse = v.statuses.filter((x) => x !== "blocked_claim_validation");
    return { id, label: variantLabel(id), url: lctx.variants[id]?.url ?? null, exportable: refuse.length === 0, reasons: refuse.map((x) => STATUS_LABEL[x]), claimsRemoved: v.statuses.includes("blocked_claim_validation") };
  });
  const brief = project.adwordsBrief ?? defaultBrief(project, { campaigns, assets: list, evaluation: ev });
  const data: ShareData = {
    token,
    project: project.name,
    label: s.label,
    expiresAt: s.expiresAt?.toISOString() ?? null,
    specVerifiedAt: PMAX_SPEC.verifiedAt,
    campaigns: campaigns.map((c) => ({ code: c.code, name: c.name, url: c.landingUrl, businessName: c.businessName })),
    concepts,
    texts,
    sitelinks,
    videos,
    landing,
    brief,
  };
  return <AdwordsShareView data={data} />;
}
