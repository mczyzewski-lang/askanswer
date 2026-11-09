import fs from "node:fs";
import Papa from "papaparse";
import { describe, expect, it } from "vitest";
import { adwordsCsvTemplate, canonicalHeaders, collapseDerivedScenes, exportAdwordsCsv, isMetaRow, parseAdwordsCsv, TEMPLATE_V5_COLUMNS } from "../../src/lib/adwords/csv";
import { comparisonOf } from "../../src/lib/adwords/draw";
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

const V1 = fs.readFileSync("tests/fixtures/adwords/nowy_etap_google_adwords_pmax.csv", "utf-8");
/** what the module stores of a record (the parsed data, extra and scenes), for comparing a round trip */
const stored = (text: string) => {
  const p = parseAdwordsCsv(text);
  const all = [...p.assets, ...inlineScenesForTest(p.assets)];
  return Object.fromEntries(all.map((a) => [a.assetKey, { rowType: a.rowType, ...a.data, extra: Object.fromEntries(Object.entries(a.extra).filter(([k]) => k !== "schema_version")) }]));
};
/** export the stored records (scenes collapsed back into the script columns) in the file's column order */
const roundTrip = (text: string) => {
  const p = parseAdwordsCsv(text);
  const rows = [...p.assets, ...inlineScenesForTest(p.assets)].map((a) => ({ assetKey: a.assetKey, rowType: a.rowType, ...a.data, extra: a.extra }));
  return exportAdwordsCsv(rows as never, "nowy-etap", "1", canonicalHeaders(p));
};

describe("CSV v5 — 99 columns by name", () => {
  it("recognises every column by its name: module columns, v5 groups, nothing unknown", () => {
    expect(parsed.headers).toHaveLength(99);
    expect(parsed.schema).toBe("v5");
    expect(parsed.columns.unknown).toEqual([]);
    expect(Object.keys(parsed.columns.groups).sort()).toEqual(["comparison", "cta", "historical", "landing", "match", "page", "proof", "score", "sitelink", "test", "video"]);
    expect(parsed.columns.core.length + Object.values(parsed.columns.groups).flat().length).toBe(99);
    // the same file with the columns shuffled reads the same
    const rows = Papa.parse<string[]>(V5.replace(/^\uFEFF/, ""), { delimiter: ";" }).data.filter((r) => r.length > 1);
    const order = rows[0].map((_, i) => i).reverse();
    const shuffled = Papa.unparse(rows.map((r) => order.map((i) => r[i])), { delimiter: ";" });
    expect(stored(shuffled)).toEqual(stored(V5));
  });
  it("comparison graphics, A/B pairs, test priority, history and scores are stored", () => {
    const g07 = parsed.assets.find((a) => a.assetKey === "G07-SQ")!;
    expect(comparisonOf(g07.data.lp)).toEqual({ title: "Tradycyjnie vs Nowy Etap", leftLabel: "Tradycyjnie", left: "Najpierw pozew, potem spór o wszystko", rightLabel: "Z planem", right: "Najpierw plan i ustalenia, potem pozew" });
    expect(g07.data.lp?.layout_id).toBe("comparison");
    const g01 = parsed.assets.find((a) => a.assetKey === "G01-L")!;
    expect([g01.data.experimentId, g01.data.variant, g01.data.pairedAssetId, g01.data.testPriority, g01.data.deployMode]).toEqual(["T01", "A", "G02-L", 1, "controlled"]);
    expect(g01.data.lp).toMatchObject({ historical_impressions: "920583", historical_ctr: "13,25%", test_kpi: "CPL kwalifikowany", score_clarity: "80" });
    expect(parsed.assets.find((a) => a.assetKey === "LP_A_PLAN-hero")!.data.lp?.landing_social_proof).toMatch(/4,8\/5/);
  });
  it("video scripts become scenes with hook, spoken words, screen text and the shot", () => {
    const sc = inlineScenesForTest(parsed.assets).filter((s) => s.data.conceptId === "V01");
    expect(sc.map((s) => [s.data.startS, s.data.endS, s.data.screenText])).toEqual([
      [0, 3, "Rozwód bez walki w sądzie?"],
      [3, 9, "Najpierw plan"],
      [9, 19, "Potem dokumenty i pozew"],
      [19, 27, "Odbierz bezpłatny plan"],
    ]);
    expect(sc[0].data.spokenText).toBe("Rozwód bez walki w sądzie?");
    expect(sc[1].data.visualBrief).toBe("ekspert + plansza „plan”");
    expect(sc.every((s) => s.data.recordScope === null)).toBe(true);
  });
  it("import report: types, missing fields with the rows", () => {
    expect(parsed.missing.find((m) => m.rowType === "sitelink" && m.field === "landing_url")?.rows).toHaveLength(1);
    expect(parsed.missing.some((m) => m.rowType === "image" && m.field.startsWith("comparison"))).toBe(false);
    const broken = parseAdwordsCsv("row_type;asset_id;concept_id;layout_id;comparison_left\nimage;X1;G1;comparison;A");
    expect(broken.missing.find((m) => m.field.startsWith("comparison"))?.rows).toEqual([2]);
  });
  it("export → import keeps every value and the column order (v5 and v1); edited scenes go back into the script columns", () => {
    const out = roundTrip(V5);
    expect(out.split("\r\n")[0].replace(/^\uFEFF/, "").split(";")).toEqual(parsed.headers);
    expect(stored(out)).toEqual(stored(V5));
    expect(parseAdwordsCsv(out).assets).toHaveLength(66);
    const v1 = roundTrip(V1);
    expect(stored(v1)).toEqual(stored(V1));
    expect(parseAdwordsCsv(v1).headers).toHaveLength(30);
    // a scene edited in the module is written back into its video row
    const p = parseAdwordsCsv(V5);
    const rows = [...p.assets, ...inlineScenesForTest(p.assets)].map((a) => ({ assetKey: a.assetKey, rowType: a.rowType, ...a.data, extra: a.extra }));
    const sc = rows.find((r) => r.assetKey === "V01-SC2")!;
    sc.spokenText = "Zmieniona wypowiedź";
    const back = collapseDerivedScenes(rows as never);
    expect(back.filter((r) => r.rowType === "video_scene")).toHaveLength(0);
    expect(back.filter((r) => r.conceptId === "V01" && r.rowType === "video").every((r) => r.lp?.video_spoken_3_9 === "Zmieniona wypowiedź")).toBe(true);
  });
  it("the v5 template has all 99 columns and every record kind, and imports without errors", () => {
    const t = parseAdwordsCsv(adwordsCsvTemplate("x"));
    expect(t.headers).toEqual(TEMPLATE_V5_COLUMNS);
    expect(t.issues.filter((i) => i.level === "error")).toEqual([]);
    expect(new Set(t.assets.map((a) => a.rowType))).toEqual(new Set(["image", "video", "headline", "long_headline", "description", "sitelink", "landing_page", "experiment_plan"]));
    expect(parseAdwordsCsv(adwordsCsvTemplate("x", "v1")).headers).toHaveLength(30);
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
    expect(p.blocks.find((x) => x.section === "hero")!.socialProof).toBe("Opinie klientów w Google");
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
