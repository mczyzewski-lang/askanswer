import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { parseAdwordsCsv } from "../../src/lib/adwords/csv";
import { landingMarkdown, landingPlan } from "../../src/lib/adwords/landing";

const V1 = fs.readFileSync("tests/fixtures/adwords/nowy_etap_google_adwords_pmax.csv", "utf-8");
const assets = parseAdwordsCsv(V1).assets.map((a) => ({ assetKey: a.assetKey, rowType: a.rowType, ...a.data }));
const camp = { code: "NE-PMAX-SPRZ", name: "Sprzedaż", goal: "sprzedaz", landingUrl: "https://example.pl/rozwod", businessName: "Nowy Etap" };

describe("Landing page plan", () => {
  it("message match: H1 and button repeat the leading concept's headline and CTA", () => {
    const p = landingPlan({ projectName: "Nowy Etap", campaign: camp, assets, photos: [] });
    expect(p.conceptId).toBe("G01");
    expect(p.hero.headline).toBe("Rozwód bez wojny");
    expect(p.hero.cta).toBe("Umów konsultację");
    expect(p.steps).toEqual(["Rozmowa z mediatorem", "Wspólny plan", "Krótki proces"]);
    expect(p.sections.map((s) => s.key)).toEqual(["hero", "problem", "steps", "expert", "price", "faq", "form", "footer"]);
    expect(p.checks.find((c) => c.area === "URL")?.level).toBe("ok");
  });
  it("another concept, a missing / http URL, a photo without consent", () => {
    const other = landingPlan({ projectName: "X", campaign: { ...camp, landingUrl: "http://x.pl" }, assets, conceptId: "G02", photos: [] });
    expect(other.conceptId).toBe("G02");
    expect(other.checks.some((c) => c.level === "blokada" && /https/.test(c.message))).toBe(true);
    const none = landingPlan({ projectName: "X", campaign: { ...camp, landingUrl: null }, assets, conceptId: "G04", photos: [{ id: "p1", key: "ekspert_anna", name: "Anna", role: "mediatorka", consentConfirmed: false }] });
    expect(none.checks.filter((c) => c.level === "blokada").length).toBeGreaterThanOrEqual(1);
    expect(none.hero.expert?.name).toBe("Anna");
    expect(none.checks.some((c) => c.area === "Ekspert" && c.level === "blokada")).toBe(true);
  });
  it("educational campaign: download CTA, e-mail only form, no price section; markdown spec", () => {
    const p = landingPlan({ projectName: "X", campaign: { ...camp, goal: "poradnik" }, assets: [], photos: [] });
    expect(p.goal).toBe("poradnik");
    expect(p.hero.cta).toBe("Pobierz poradnik");
    expect(p.sections.some((s) => s.key === "price")).toBe(false);
    const md = landingMarkdown(p, "X", "Poradnik");
    expect(md).toContain("# Landing page — X / Poradnik");
    expect(md).toContain("LCP ≤ 2,5 s");
  });
});
