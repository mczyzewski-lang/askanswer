import { describe, expect, it } from "vitest";
import { createCanvas } from "@napi-rs/canvas";
import { registerFonts } from "../../src/lib/render/server-render";
import { drawCreative } from "../../src/lib/adwords/draw";
import { DEFAULT_THEME } from "../../src/lib/themes";
import { META_FORMATS, isoToWarsaw, warsawToIso, metaChecks, metaCreative, metaCsv, metaStatus, metaVersions, webinarBadge, type MetaAdData } from "../../src/lib/adwords/meta";

const ad: MetaAdData = { name: "Webinar listopad", primaryText: "Rozwód bez walki w sądzie? Na webinarze pokażemy, jak przygotować plan.", metaHeadline: "Bezpłatny webinar o rozwodzie", description: "24 listopada, 19:00", ctaButton: "SIGN_UP", headline: "Rozwód bez walki? Webinar o planie rozwodu", ctaImage: "Zapisz się na webinar", destination: "webinar", url: "https://nowy-etap.pl/webinar/", webinarTitle: "Plan rozwodu", webinarAt: "2026-11-24T18:00:00Z", layout: "typographic", body: null, withoutExpert: true, photoIds: ["p1"] };
const photos = [{ id: "p1", name: "Anna", consentConfirmed: true }];

describe("Meta ads", () => {
  it("the webinar date in Warsaw time; versions; formats with the Reels safe zone", () => {
    expect(webinarBadge("2026-11-24T18:00:00Z")).toMatch(/^Webinar · wt\.?,? 24 lis · 19:00$/);
    expect(metaVersions(ad)).toEqual(["none", "p1"]);
    expect(metaVersions({ withoutExpert: false, photoIds: [] })).toEqual(["none"]);
    expect(META_FORMATS.map((f) => `${f.width}x${f.height}`)).toEqual(["1080x1080", "1080x1350", "1080x1920"]);
    const c = metaCreative(ad, "story", true);
    expect([c.layout, c.copy.badge, c.safeInsets]).toEqual(["expert_split", webinarBadge(ad.webinarAt), { top: 0.14, bottom: 0.35, left: 0.06, right: 0.06 }]);
    expect(metaCreative({ ...ad, destination: "website" }, "square", false).copy.badge).toBeNull();
  });
  it("checks: a past webinar, no URL, texts over Meta's limits, a photo without consent", () => {
    const now = new Date("2026-11-10T10:00:00Z");
    expect(metaStatus(metaChecks(ad, { photos, now }))).toBe("gotowe");
    expect(metaChecks(ad, { photos, now: new Date("2026-11-25T10:00:00Z") }).some((c) => c.level === "blokada" && /już się odbył/.test(c.message))).toBe(true);
    expect(metaChecks({ ...ad, url: "" }, { photos, now }).some((c) => c.level === "blokada")).toBe(true);
    expect(metaChecks({ ...ad, webinarAt: null }, { photos, now }).some((c) => /bez daty/.test(c.message))).toBe(true);
    expect(metaChecks({ ...ad, primaryText: "x".repeat(200), metaHeadline: "y".repeat(50) }, { photos, now }).filter((c) => c.level === "do_poprawy")).toHaveLength(2);
    expect(metaStatus(metaChecks(ad, { photos: [{ id: "p1", name: "Anna", consentConfirmed: false }], now }))).toBe("blokada");
  });
  it("every format renders without overflow and keeps text inside the safe zone (incl. the 9:16 Reels zone)", () => {
    registerFonts();
    for (const f of META_FORMATS)
      for (const withPhoto of [false, true]) {
        const c = metaCreative(ad, f.key, withPhoto);
        const cv = createCanvas(c.width, c.height);
        const photo = withPhoto ? { image: createCanvas(800, 1000) as never, focalX: 0.5, focalY: 0.4 } : null;
        const m = drawCreative(cv.getContext("2d") as never, { ...c, theme: DEFAULT_THEME, photo });
        expect([f.key, withPhoto, m.overflow, m.outsideSafe]).toEqual([f.key, withPhoto, false, false]);
      }
  });
  it("the date field is Warsaw time whatever the computer's zone (winter and summer)", () => {
    expect(warsawToIso("2026-11-24T19:00")).toBe("2026-11-24T18:00:00.000Z");
    expect(warsawToIso("2026-07-10T19:00")).toBe("2026-07-10T17:00:00.000Z");
    expect(isoToWarsaw("2026-11-24T18:00:00Z")).toBe("2026-11-24T19:00");
    expect(isoToWarsaw("2026-07-10T17:00:00Z")).toBe("2026-07-10T19:00");
  });
  it("the comparison layout with the webinar pill fits every format (no negative boxes)", () => {
    registerFonts();
    const cmp = { ...ad, layout: "comparison", extra: { comparison_left: "Najpierw pozew, potem spór", comparison_right: "Najpierw plan i ustalenia, potem pozew" } };
    for (const f of META_FORMATS) {
      const c = metaCreative(cmp, f.key, false);
      expect(c.layout).toBe("comparison");
      const m = drawCreative(createCanvas(c.width, c.height).getContext("2d") as never, { ...c, theme: DEFAULT_THEME });
      expect([f.key, m.overflow, m.outsideSafe]).toEqual([f.key, false, false]);
    }
  });
  it("texts CSV for Ads Manager", () => {
    const csv = metaCsv([{ ad, version: "none", versionLabel: "bez eksperta", files: ["meta/a.png"] }]);
    expect(csv).toContain("Primary text;Headline;Description;Call to action");
    expect(csv).toContain("SIGN_UP");
    expect(csv).toContain("Webinar listopad — bez eksperta");
  });
});
