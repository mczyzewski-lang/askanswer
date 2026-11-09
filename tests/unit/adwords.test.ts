import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { createCanvas } from "@napi-rs/canvas";
import { adwordsCsvTemplate, exportAdwordsCsv, parseAdwordsCsv, slugify } from "../../src/lib/adwords/csv";
import { gateImage, gateText, gateVideo, scoreImageA, scoreImageB, scoreTextA, scoreVideoA, scoreVideoB, textSetChecks, type AdAsset } from "../../src/lib/adwords/score";
import { scenesToSrt, teleprompterScript, videoConcepts } from "../../src/lib/adwords/video";
import { drawCreative, stepsOf } from "../../src/lib/adwords/draw";
import { DEFAULT_THEME } from "../../src/lib/themes";
import { registerFonts } from "../../src/lib/render/server-render";

const FILE = fs.readFileSync("tests/fixtures/adwords/nowy_etap_google_adwords_pmax.csv", "utf-8");
const ctx = { brandName: "Nowy Etap", keywords: ["rozwód", "plan", "mediator", "konsultacja"], landingUrl: null, hasLogo: true };
const asAssets = (text: string): AdAsset[] => parseAdwordsCsv(text).assets.map((a) => ({ assetKey: a.assetKey, rowType: a.rowType, ...a.data }));

describe("Google Adwords CSV", () => {
  it("reads the sample: 81 records of the right kinds, no errors", () => {
    const r = parseAdwordsCsv(FILE);
    expect(r.delimiter).toBe(";");
    expect(r.issues.filter((i) => i.level === "error")).toEqual([]);
    expect(r.assets).toHaveLength(81);
    expect(r.counts).toEqual({ image: 18, image_clean: 2, video: 15, video_scene: 21, headline: 15, long_headline: 5, description: 5, sitelink: 0, experiment_plan: 0, historical_reference: 0, landing_page: 0 });
    // quoted ";" and line breaks survive, Polish letters too
    expect(r.assets.find((a) => a.assetKey === "G03-L")!.data.body).toBe("Pakiet konsultacji; zakres opisany przed startem");
    expect(r.assets.find((a) => a.assetKey === "V05-S1")!.data.spokenText).toContain("\nBez sprzedaży");
    expect(r.assets.find((a) => a.assetKey === "G05-L")!.data).toMatchObject({ approvalRequired: true, status: "blocked_until_verified", scoreSeed: 60 });
    expect(slugify("Nowy Etap")).toBe("nowy-etap");
  });

  it("round trip: export → import gives the same records (and BOM / comma files read too)", () => {
    const a = parseAdwordsCsv(FILE).assets;
    const out = exportAdwordsCsv(a.map((x) => ({ assetKey: x.assetKey, rowType: x.rowType, ...x.data, extra: x.extra })), "nowy-etap");
    const b = parseAdwordsCsv(out).assets;
    expect(b.map((x) => [x.assetKey, x.data])).toEqual(a.map((x) => [x.assetKey, x.data]));
    const comma = "row_type,asset_id,ad_text\nheadline,H1,\"Rozwód, ale spokojnie\"\n";
    expect(parseAdwordsCsv(comma).assets[0].data.adText).toBe("Rozwód, ale spokojnie");
    expect(parseAdwordsCsv(adwordsCsvTemplate()).issues.filter((i) => i.level === "error")).toEqual([]);
  });

  it("errors carry the row number; duplicates and bad values are refused; unknown columns are kept", () => {
    const bad = "row_type;asset_id;width;ad_text;moja_kolumna\nheadline;H1;;Ok;x\nfoo;H2;;;\nheadline;H1;;Znowu;\nimage;G1;abc;;\nheadline;H3;;;\n";
    const r = parseAdwordsCsv(bad);
    const msg = r.issues.map((i) => `${i.row}:${i.column ?? ""}`);
    expect(msg).toEqual(expect.arrayContaining(["3:row_type", "4:asset_id", "5:width", "5:concept_id", "6:ad_text"]));
    expect(r.assets[0].extra).toEqual({ moja_kolumna: "x" });
    // a column mapped by hand
    const m = parseAdwordsCsv("Typ;Identyfikator;Tekst\nheadline;H9;Hej\n", { Identyfikator: "asset_id" });
    expect(m.assets[0]).toMatchObject({ assetKey: "H9", rowType: "headline" });
  });
});

describe("scoring and the gate", () => {
  const all = asAssets(FILE);
  it("texts: limits block, a short headline ≤15 is required, duplicates are found", () => {
    expect(gateText({ assetKey: "x", rowType: "headline", adText: "x".repeat(31) }).status).toBe("blokada");
    expect(gateText({ assetKey: "x", rowType: "description", adText: "Gwarantujemy rozwód bez konfliktu" }).status).toBe("do_poprawy");
    const texts = all.filter((a) => ["headline", "long_headline", "description"].includes(a.rowType));
    const checks = textSetChecks(texts);
    expect(checks.filter((c) => c.level === "blokada")).toEqual([]);
    expect(textSetChecks([...texts, { assetKey: "H99", rowType: "headline", adText: "Rozwód bez wojny!" }]).some((c) => c.message.startsWith("Duplikat"))).toBe(true);
    const s = scoreTextA(texts[0], texts, ctx);
    expect(s.total).toBeLessThanOrEqual(100);
    expect(s.items.reduce((n, i) => n + i.max, 0)).toBe(100);
  });

  it("images: an unconfirmed claim blocks whatever the score; a photo without consent blocks", () => {
    const g05 = all.find((a) => a.assetKey === "G05-L")!;
    const m = { overflow: false, outsideSafe: false, minFontPx: 40, contrast: 7, height: 628 };
    expect(gateImage(g05, ctx, m, null).status).toBe("blokada");
    expect(gateImage({ ...g05, approvedAt: new Date() }, { ...ctx, landingUrl: "https://nowyetap.pl" }, m, null).status).not.toBe("blokada");
    const g02 = all.find((a) => a.assetKey === "G02-SQ")!;
    expect(gateImage(g02, ctx, m, { id: "p", consentConfirmed: false }).problems.some((p) => p.message.includes("zgody"))).toBe(true);
    const a = scoreImageA(g02, ctx, m, { id: "p", consentConfirmed: true });
    const b = scoreImageB(g02, ctx, m, { id: "p", consentConfirmed: true });
    expect(a.items.map((i) => i.max).reduce((x, y) => x + y)).toBe(100);
    expect(b.items.map((i) => i.max).reduce((x, y) => x + y)).toBe(100);
    expect(b.items.every((i) => i.basis && i.sources?.length)).toBe(true);
  });

  it("videos: concepts joined by concept_id; ≥10 s; one CTA; SRT and teleprompter from the scenes", () => {
    const vids = videoConcepts(all);
    expect(vids.map((v) => [v.conceptId, v.variants.length])).toEqual([["V01", 3], ["V02", 3], ["V03", 3], ["V04", 3], ["V05", 3]]);
    expect(vids.reduce((n, v) => n + v.scenes.length, 0)).toBe(21);
    const v1 = vids[0];
    // the price line in scene 4 needs the service scope confirmed; with a source it is ready
    const g1 = gateVideo(v1, { ...ctx, landingUrl: "https://nowyetap.pl" });
    expect(g1.problems.map((p) => p.message)).toEqual([expect.stringContaining("zakres wycenionej usługi")]);
    expect(gateVideo({ ...v1, scenes: v1.scenes.map((s) => ({ ...s, claimSource: "cennik 2026" })) }, { ...ctx, landingUrl: "https://nowyetap.pl" }).status).toBe("gotowe");
    expect(scoreVideoA(v1, ctx).total).toBeGreaterThan(60);
    expect(scoreVideoB(v1, ctx).items.map((i) => i.max).reduce((x, y) => x + y)).toBe(100);
    const srt = scenesToSrt(v1.scenes);
    expect(srt.split("\n")[1]).toBe("00:00:00,000 --> 00:00:03,000");
    expect(srt).toContain("Czy rozwód musi oznaczać wojnę?");
    expect(teleprompterScript(v1)).toContain("[3]");
    expect(gateVideo({ ...v1, variants: v1.variants.map((x) => ({ ...x, durationSec: 8 })), scenes: v1.scenes.slice(0, 1) }, ctx).status).toBe("blokada");
  });
});

describe("the creative renderer (server canvas, real fonts)", () => {
  registerFonts();
  const sizes = [
    [1200, 628],
    [1200, 1200],
    [960, 1200],
  ];
  for (const layout of ["typographic", "process_steps"] as const)
    it(`${layout}: three formats at exact pixel sizes, text inside the safe area`, async () => {
      for (const [w, h] of sizes) {
        const c = createCanvas(w, h);
        const m = drawCreative(c.getContext("2d") as never, { width: w, height: h, layout, copy: { headline: "Najpierw plan, potem pozew", subheadline: "Ustalenia przed sądem oszczędzają nerwy", body: "1. Plan rozstania | 2. Porozumienie | 3. Pozew bez sporu", cta: "Zaplanuj rozstanie" }, theme: DEFAULT_THEME });
        expect(m.overflow).toBe(false);
        expect(m.outsideSafe).toBe(false);
        expect(m.contrast).toBeGreaterThanOrEqual(3);
        const png = await c.encode("png");
        expect(png.readUInt32BE(16)).toBe(w);
        expect(png.readUInt32BE(20)).toBe(h);
        expect(png.length).toBeLessThan(5120 * 1024);
      }
    });
  it("a headline that cannot fit is reported", () => {
    const c = createCanvas(1200, 628);
    const m = drawCreative(c.getContext("2d") as never, { width: 1200, height: 628, layout: "typographic", copy: { headline: "Bardzo ".repeat(40), cta: "Ok" }, theme: DEFAULT_THEME });
    expect(m.overflow).toBe(true);
    expect(stepsOf("1. A | 2. B | 3. C | 4. D")).toEqual(["A", "B", "C"]);
  });
});
