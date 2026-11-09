import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { exportAdwordsCsv, isMetaRow, parseAdwordsCsv } from "../../src/lib/adwords/csv";
import { adClaimProblems, blockOf, claimsIn, landingScore, lpHtml, messageMatch, offerValid, productionBlocks, urlStatus, validateVariant, variantBlocks, type ClaimRec, type LpContext } from "../../src/lib/adwords/landing-content";
import { gateSitelink, gateText, type AdAsset } from "../../src/lib/adwords/score";
import { inlineScenesForTest } from "./helpers/inline-scenes";

const V5 = fs.readFileSync("tests/fixtures/adwords/nowy_etap_pmax_v5_50_assetow_i_landing_page.csv", "utf-8");
const parsed = parseAdwordsCsv(V5);
const assets = parsed.assets.map((a, i) => ({ id: `id${i}`, assetKey: a.assetKey, rowType: a.rowType, ...a.data, extra: a.extra, expertPhotoId: null }));
const blocks = assets.filter((a) => a.rowType === "landing_page").map((a) => blockOf(a));
const theme = { background: "#1f3a33", primary: "#24463d", accent: "#c79a4b", text: "#ffffff", highlight: "#e6c27a", secondary: "#2f5a4f" };
const approvedAll: ClaimRec[] = ["rating", "reviews_count", "divorces_count", "record_days", "case_signature"].map((key) => ({ key, claimText: key, proofSource: "profil Google / CRM", dateChecked: "2026-11-09", approvedBy: "a@b.pl", approvalStatus: "approved", claimScope: null }));
const ctx = (over: Partial<LpContext> = {}): LpContext => ({ offer: null, claims: [], variants: { LP_A_PLAN: { url: "https://nowy-etap.pl/plan/" }, LP_B_COST: { url: "https://nowy-etap.pl/koszt/" }, LP_C_PROOF_SPEED: { url: null } }, theme, ...over });
const OFFER = { producer: "mediator", when: "2 dni robocze", form: "PDF + rozmowa", contents: "ustalenia, kroki, koszt usługi", requiresCall: "tak, 20 min", whatIsFree: "plan i rozmowa", confirmed: true };

describe("CSV v5", () => {
  it("66 records: 50 ad assets + 16 landing content; landing rows are meta (never Google assets)", () => {
    expect(parsed.issues.filter((i) => i.level === "error")).toEqual([]);
    expect(parsed.assets).toHaveLength(66);
    expect(parsed.scopes).toEqual({ adAssets: 50, landingContent: 16 });
    expect(parsed.counts.image).toBe(24);
    expect(parsed.counts.video).toBe(12);
    expect(parsed.counts.sitelink).toBe(6);
    expect(parsed.counts.headline + parsed.counts.long_headline + parsed.counts.description).toBe(8);
    expect(isMetaRow("landing_page")).toBe(true);
    const hero = parsed.assets.find((a) => a.assetKey === "LP_A_PLAN-hero")!;
    expect(hero.data.lp?.landing_h1).toBe("Rozwód bez walki w sądzie? Najpierw plan, potem pozew.");
    expect(hero.data.recordScope).toBe("landing_content");
  });
  it("round trip keeps the v5 columns; scope errors are reported with the row", () => {
    const again = parseAdwordsCsv(exportAdwordsCsv(assets as never, "nowy-etap"));
    expect(again.scopes).toEqual({ adAssets: 50, landingContent: 16 });
    expect(again.assets.find((a) => a.assetKey === "S04")!.data.lp?.proof_status).toBe("blocked_missing_url");
    const bad = parseAdwordsCsv("row_type;asset_id;record_scope;landing_variant_id\nlanding_page;X1;ad_asset;LP_A_PLAN\nimage;X2;landing_content;");
    expect(bad.issues.filter((i) => i.column === "record_scope").map((i) => i.row)).toEqual([2, 3]);
  });
  it("inline video segments become scenes (once per concept)", () => {
    const sc = inlineScenesForTest(parsed.assets);
    expect(sc.filter((s) => s.data.conceptId === "V01").map((s) => [s.data.startS, s.data.endS])).toEqual([[0, 3], [3, 9], [9, 19], [19, 27]]);
    expect(sc).toHaveLength(16);
  });
});

describe("Treść Landing Page", () => {
  it("variants inherit the base sections; one H1; C blocked by claims; production removes them", () => {
    const a = variantBlocks(blocks, "LP_A_PLAN");
    const b = variantBlocks(blocks, "LP_B_COST");
    const c = variantBlocks(blocks, "LP_C_PROOF_SPEED");
    expect(a).toHaveLength(10);
    expect(b.filter((x) => x.inherited).map((x) => x.section)).toEqual(["trust_bar", "comparison", "plan_contents", "case_study", "expert_video", "form", "sticky_cta"]);
    expect(b.filter((x) => x.h1).length).toBe(1);
    const vc = validateVariant("LP_C_PROOF_SPEED", c, ctx({ offer: OFFER }));
    expect(vc.statuses).toEqual(expect.arrayContaining(["blocked_claim_validation", "blocked_missing_url"]));
    const p = productionBlocks(c, ctx({ offer: OFFER }));
    expect(p.blocks.some((x) => x.section === "reviews")).toBe(false);
    expect(p.blocks.find((x) => x.section === "hero")!.h1).not.toMatch(/2600/);
    expect(p.blocks.find((x) => x.section === "hero")!.eyebrow).toBe("Opinie klientów w Google");
    // with proofs approved, the claims stay
    expect(productionBlocks(c, ctx({ offer: OFFER, claims: approvedAll })).blocks.find((x) => x.section === "hero")!.h1).toMatch(/2600/);
  });
  it("offer: no confirmed free plan = blocked_offer_validation (plan promised everywhere)", () => {
    const a = variantBlocks(blocks, "LP_A_PLAN");
    expect(validateVariant("LP_A_PLAN", a, ctx()).statuses).toContain("blocked_offer_validation");
    expect(offerValid({ ...OFFER, contents: "" })).toBe(false);
    expect(validateVariant("LP_A_PLAN", a, ctx({ offer: OFFER, claims: approvedAll })).statuses).toEqual([]);
  });
  it("claims: total divorce cost is blocked; detectors", () => {
    expect(claimsIn("Poznaj całkowity koszt rozwodu z góry").map((c) => c.key)).toContain("total_divorce_cost");
    expect(claimsIn("Poznaj całkowity koszt naszej usługi").length).toBe(0);
    expect(claimsIn("★★★★★ 4,8/5 w Google · ponad 1000 opinii").map((c) => c.key)).toEqual(["rating", "reviews_count"]);
    expect(adClaimProblems("Poznaj całkowity koszt rozwodu", null, { offerValid: true, approvedClaims: [], assetApproved: true })[0].level).toBe("blokada");
    expect(urlStatus("http://x.pl")).toBe("invalid");
    expect(urlStatus("https://example.com/lp")).toBe("placeholder");
  });
  it("message match + Landing Match Score (separate from score_seed)", () => {
    const a = variantBlocks(blocks, "LP_A_PLAN");
    const g01 = assets.find((x) => x.assetKey === "G01-L")!;
    const g04 = assets.find((x) => x.assetKey === "G04-L")!;
    expect(messageMatch(g01 as never, a).score).toBeGreaterThanOrEqual(75);
    expect(messageMatch(g04 as never, a).score).toBeLessThan(messageMatch(g04 as never, variantBlocks(blocks, "LP_B_COST")).score);
    const s = landingScore(a, assets as never, ctx({ offer: OFFER, claims: approvedAll }), "LP_A_PLAN");
    expect(s.parts.map((p) => p.max)).toEqual([25, 20, 15, 15, 10, 10, 5]);
    expect(s.total).toBeGreaterThan(80);
    expect(s.total).toBeLessThanOrEqual(100);
  });
  it("HTML export: one <h1>, CTA events, the form; preview flags the claims", () => {
    const a = variantBlocks(blocks, "LP_A_PLAN");
    const html = lpHtml(productionBlocks(a, ctx({ offer: OFFER })).blocks, { projectName: "Nowy Etap", variantId: "LP_A_PLAN", url: null, mode: "production", statuses: [] }, { theme });
    expect(html.match(/<h1>/g)).toHaveLength(1);
    expect(html).toContain('data-event="lp_hero_cta_click"');
    expect(html).toContain('id="formularz"');
    expect(html).not.toContain("1000 opinii");
    const prev = lpHtml(a, { projectName: "Nowy Etap", variantId: "LP_A_PLAN", url: null, mode: "preview", statuses: ["blocked_offer_validation"] }, { theme, findings: (b) => ({ claims: [], statuses: b.section === "hero" ? ["blocked_claim_validation"] : [] }) });
    expect(prev).toContain("PODGLĄD ROBOCZY");
  });
});

describe("ad gates (v5 context)", () => {
  const lp = { offerValid: false, approvedClaims: [] as string[] };
  it("plan promise without a confirmed offer, unproven numbers, sitelinks", () => {
    const h = { assetKey: "LH02", rowType: "long_headline", adText: "Odbierz bezpłatny Plan Rozwodu i poznaj koszt naszej usługi przed decyzją" } as AdAsset;
    expect(gateText(h, { lp }).problems.some((p) => /blocked_offer_validation/.test(p.message))).toBe(true);
    expect(gateText(h, { lp: { ...lp, offerValid: true } }).problems.some((p) => /blocked_offer_validation/.test(p.message))).toBe(false);
    expect(gateText(h).problems.some((p) => /blocked_offer_validation/.test(p.message))).toBe(false);
    const s04 = assets.find((a) => a.assetKey === "S04") as unknown as AdAsset;
    const g = gateSitelink(s04, { lp: { offerValid: true, approvedClaims: [] } });
    expect(g.status).toBe("blokada");
    expect(g.problems.some((p) => /blocked_missing_url/.test(p.message))).toBe(true);
    const s01 = assets.find((a) => a.assetKey === "S01") as unknown as AdAsset;
    expect(gateSitelink(s01, { lp: { offerValid: true, approvedClaims: [] } }).status).not.toBe("blokada");
  });
});
