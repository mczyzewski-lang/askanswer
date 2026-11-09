/**
 * Google Adwords v5 — server side of "Treść Landing Page": the offer, the variants' URLs, the claims
 * registry (seeded from the texts and the CSV proof_claim) and the context the validators need.
 */
import { prisma } from "./db";
import { BASE_VARIANT, CLAIM_LABEL, CLAIM_SCOPE_HINT, STATUS_LABEL, blockFindings, blockOf, claimKeysOf, claimsIn, isApproved, lpCsv, lpHtml, lpJson, lpMarkdown, offerValid, productionBlocks, validateVariant, variantBlocks, variantsOf, type ClaimRec, type LpBlock, type LpContext, type OfferInfo } from "../adwords/landing-content";
import { slugify } from "../adwords/csv";
import { HttpError } from "./errors";
import { themeFromRow, DEFAULT_THEME } from "../themes";

export interface LandingSettings {
  variants: Record<string, { url?: string | null; name?: string | null }>;
  /** what the agency decided about Final URL expansion in PMax */
  urlStrategy?: { finalUrlExpansion?: "on" | "off" | "unknown"; exclusions?: string; checkedBy?: string | null; checkedAt?: string | null };
}

const textOf = (a: { headline: string | null; subheadline: string | null; body: string | null; cta: string | null; adText: string | null; spokenText: string | null; screenText: string | null; lp: unknown }) => {
  const lp = (a.lp ?? {}) as Record<string, string>;
  return [a.headline, a.subheadline, a.body, a.cta, a.adText, a.spokenText, a.screenText, lp.landing_eyebrow, lp.landing_h1, lp.landing_h2, lp.landing_bullets, lp.landing_primary_cta, lp.landing_microcopy, lp.cta_extended_user_proposal, lp.cta_extended_safe, lp.cta_button_short, lp.sitelink_description_1, lp.sitelink_description_2, lp.comparison_left, lp.comparison_right].filter(Boolean).join("\n");
};

/** every claim the project's texts make gets a (pending) entry in the registry — existing entries are kept */
export async function seedClaims(projectId: string) {
  const assets = await prisma.adwordsAsset.findMany({ where: { projectId } });
  const found = new Map<string, { text: string; scope: string | null; note: string | null }>();
  for (const a of assets) {
    const lp = (a.lp ?? {}) as Record<string, string>;
    for (const c of claimsIn(textOf(a))) if (!found.has(c.key)) found.set(c.key, { text: c.match, scope: CLAIM_SCOPE_HINT[c.key] ?? null, note: null });
    if (lp.proof_claim)
      for (const k of claimKeysOf(lp.proof_claim)) {
        const cur = found.get(k);
        found.set(k, { text: k.startsWith("proof_") ? lp.proof_claim : (cur?.text ?? lp.proof_claim), scope: lp.proof_scope || cur?.scope || CLAIM_SCOPE_HINT[k] || null, note: lp.proof_source_required || cur?.note || null });
      }
  }
  const have = new Set((await prisma.adwordsClaim.findMany({ where: { projectId }, select: { key: true } })).map((c) => c.key));
  const add = [...found].filter(([k]) => !have.has(k));
  if (add.length) await prisma.adwordsClaim.createMany({ data: add.map(([key, v]) => ({ projectId, key, claimText: CLAIM_LABEL[key] ? `${CLAIM_LABEL[key]}: ${v.text}` : v.text, claimScope: v.scope, note: v.note })), skipDuplicates: true });
}

export async function landingContext(projectId: string): Promise<LpContext & { settings: LandingSettings; claims: ClaimRec[] }> {
  const p = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, include: { theme: true, adwordsCampaigns: true } });
  const claims = (await prisma.adwordsClaim.findMany({ where: { projectId }, orderBy: { createdAt: "asc" } })).map((c) => ({ ...c, dateChecked: c.dateChecked?.toISOString() ?? null }));
  const settings = (p.adwordsLanding ?? {}) as unknown as LandingSettings;
  settings.variants = settings.variants ?? {};
  // a variant without its own URL: the landing_url of its blocks, else the campaign URL (A only)
  const blocks = (await prisma.adwordsAsset.findMany({ where: { projectId, rowType: "landing_page" } })).map((a) => ({ b: blockOf(a), url: a.landingUrl }));
  const variants: LpContext["variants"] = {};
  for (const id of new Set([...blocks.map((x) => x.b.variantId), ...Object.keys(settings.variants)])) {
    const set = settings.variants[id];
    const fromCsv = blocks.find((x) => x.b.variantId === id && x.url)?.url ?? null;
    variants[id] = { url: set?.url ?? fromCsv ?? (id === BASE_VARIANT ? (p.adwordsCampaigns.find((c) => c.landingUrl)?.landingUrl ?? null) : null), name: set?.name ?? null };
  }
  const t = p.theme ? themeFromRow(p.theme) : DEFAULT_THEME;
  return { offer: (p.adwordsOffer ?? null) as OfferInfo | null, claims, variants, theme: t, settings };
}

/** what the ad gates need (v5 projects only — a project without landing / v5 data keeps the older rules) */
export function gateLpOf(isV5: boolean, ctx: { offer: OfferInfo | null; claims: ClaimRec[] }) {
  return isV5 ? { offerValid: offerValid(ctx.offer), approvedClaims: ctx.claims.filter((c) => isApproved(c.key, ctx.claims)).map((c) => c.key) } : null;
}
export const isV5Project = (assets: Array<{ recordScope: string | null; landingVariantId: string | null }>) => assets.some((a) => a.recordScope || a.landingVariantId);

// ------------------------------------------------------------------------------------------ export

export type LpFormat = "csv" | "md" | "html" | "json";
/**
 * One variant's content. "production": hidden blocks out, unconfirmed claims removed, refused while the
 * offer is unconfirmed or the URL is missing (those cannot be cut out). "preview": everything, flagged.
 */
export async function landingExport(projectId: string, variantId: string, fmt: LpFormat, mode: "preview" | "production") {
  const p = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, include: { theme: true, adwordsCampaigns: true } });
  const ctx = await landingContext(projectId);
  const all = (await prisma.adwordsAsset.findMany({ where: { projectId, rowType: "landing_page" }, orderBy: { order: "asc" } })).map(blockOf);
  const blocks = variantBlocks(all, variantId);
  if (!blocks.length) throw new HttpError(404, `Brak bloków wariantu ${variantId}`);
  const v = validateVariant(variantId, blocks, ctx);
  const refuse = v.statuses.filter((s) => s !== "blocked_claim_validation");
  if (mode === "production" && refuse.length) throw new HttpError(409, `Eksport produkcyjny zablokowany: ${refuse.map((s) => STATUS_LABEL[s]).join(", ")}. Użyj podglądu roboczego albo zamknij wymagane dane.`);
  const prod = mode === "production" ? productionBlocks(blocks, ctx) : { blocks: blocks.filter((b) => !b.hidden), removed: [] };
  const meta = { projectName: p.name, variantId, url: ctx.variants[variantId]?.url ?? null, mode, statuses: mode === "production" ? [] : v.statuses, removed: prod.removed } as const;
  const slug = slugify(p.name);
  const name = `${slug}_${variantId}${mode === "preview" ? "_PODGLAD" : ""}`;
  const theme = ctx.theme!;
  if (fmt === "csv") return { name: `${name}.csv`, type: "text/csv; charset=utf-8", body: lpCsv(variantId, prod.blocks) };
  if (fmt === "md") return { name: `${name}.md`, type: "text/markdown; charset=utf-8", body: lpMarkdown(prod.blocks, meta) };
  if (fmt === "json") return { name: `${name}.json`, type: "application/json", body: JSON.stringify(lpJson(prod.blocks, meta, theme), null, 2) };
  const findings = (b: LpBlock) => blockFindings(b, ctx);
  return { name: `${name}.html`, type: "text/html; charset=utf-8", body: lpHtml(prod.blocks, meta, { theme: { ...theme, questionFont: theme && "questionFont" in theme ? (theme as { questionFont: string }).questionFont : undefined, subtitleFont: theme && "subtitleFont" in theme ? (theme as { subtitleFont: string }).subtitleFont : undefined }, businessName: p.adwordsCampaigns.find((c) => c.businessName)?.businessName ?? p.name, findings }) };
}

/** the whole-project ZIP: production files of the variants that may be exported, a note for the blocked ones */
export async function landingZipFiles(projectId: string): Promise<Record<string, string>> {
  const all = (await prisma.adwordsAsset.findMany({ where: { projectId, rowType: "landing_page" } })).map(blockOf);
  const out: Record<string, string> = {};
  for (const id of variantsOf(all)) {
    try {
      for (const f of ["html", "md", "json", "csv"] as const) {
        const r = await landingExport(projectId, id, f, "production");
        out[`landing_page/${r.name}`] = r.body;
      }
    } catch (e) {
      out[`landing_page/${id}_ZABLOKOWANY.txt`] = `${(e as Error).message}\n`;
    }
  }
  return out;
}
