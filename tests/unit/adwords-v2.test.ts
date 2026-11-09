import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { exportAdwordsCsv, parseAdwordsCsv, isMetaRow } from "../../src/lib/adwords/csv";
import { experiments, experimentChecks, armLimits, exposureConfidence } from "../../src/lib/adwords/experiments";
import { isHistoryReport, matchHistory, parseHistory, plNumber, plDate, directionalCtr } from "../../src/lib/adwords/history";
import { gateText, type AdAsset } from "../../src/lib/adwords/score";
import { gateOptionsOf } from "../../src/lib/adwords/context";

const V1 = fs.readFileSync("tests/fixtures/adwords/nowy_etap_google_adwords_pmax.csv", "utf-8");
const V2 = fs.readFileSync("tests/fixtures/adwords/nowy_etap_pmax_kreacje_AB_v2.csv", "utf-8");
const HIST = fs.readFileSync("tests/fixtures/adwords/Grupa plików – raport szczegółowych informacji o komponentach (3).csv", "utf-8");
const assetsOf = (t: string): AdAsset[] => parseAdwordsCsv(t).assets.map((a) => ({ assetKey: a.assetKey, rowType: a.rowType, ...a.data }));

describe("Historia PMax — the Google Ads asset report", () => {
  it("Polish numbers and dates", () => {
    expect(plNumber("8 825,39")).toBe(8825.39);
    expect(plNumber("920 583")).toBe(920583);
    expect(plNumber("329 606,47 zł")).toBe(329606.47);
    expect(plNumber("--")).toBeNull();
    expect(plDate("4 lis 2026")?.toISOString().slice(0, 10)).toBe("2026-11-04");
    expect(plDate("1 stycznia 2026")?.toISOString().slice(0, 10)).toBe("2026-01-01");
  });
  it("67 records, the period, the 13 fields, multi-line assets, no sums", () => {
    expect(isHistoryReport(HIST)).toBe(true);
    expect(isHistoryReport(V1)).toBe(false);
    const h = parseHistory(HIST);
    expect(h.rows).toHaveLength(67);
    expect(h.issues).toEqual([]);
    expect([h.period.from?.toISOString().slice(0, 10), h.period.to?.toISOString().slice(0, 10)]).toEqual(["2026-01-01", "2026-11-08"]);
    const r = h.rows.find((x) => x.component === "Rozwód bez walki w sądzie")!;
    expect([r.impressions, r.clicks, r.conversions, r.cost, r.typeKey, r.status]).toEqual([920583, 122016, 8825.39, 266241.65, "headline", "Odpowiedni"]);
    expect(Object.keys(r.raw)).toHaveLength(13);
    expect(r.raw["Konwersje"]).toBe("8 825,39");
    expect(h.rows.every((x) => x.convValue === 0)).toBe(true);
    const multi = h.rows.find((x) => x.component.startsWith("Rozwód - chcesz znać"))!;
    expect(multi.component).toContain("\n");
    expect([multi.clicks, multi.conversions, multi.typeKey]).toEqual([70034, 5596.1, "description"]);
    const imgs = h.rows.filter((x) => x.typeKey.startsWith("image"));
    expect(imgs).toHaveLength(16);
    expect(imgs.filter((x) => x.status === "Nieodpowiedni")).toHaveLength(4);
    expect(imgs.filter((x) => x.status === "Nieodpowiedni" && x.typeKey === "image_square")).toHaveLength(3);
    expect(h.rows.filter((x) => x.typeKey === "video")).toHaveLength(12);
    expect(h.rows.find((x) => x.typeKey === "business_name")!.conversions).toBe(10659.25);
    expect(h.rows.filter((x) => x.lastUpdated?.toISOString().startsWith("2026-11-04")).every((x) => (x.impressions ?? 0) <= 257)).toBe(true);
    expect(directionalCtr(r)).toBeCloseTo(0.1325, 3);
  });
  it("matching a new message to history; exposure confidence is about scale only", () => {
    const h = parseHistory(HIST);
    expect(matchHistory("Rozwód bez walki w sądzie", h.rows)[0].component).toBe("Rozwód bez walki w sądzie");
    expect(exposureConfidence(920583)).toEqual({ level: "wysoka", label: "historyczna ekspozycja" });
    expect(exposureConfidence(257)).toEqual({ level: "niska", label: "próba za mała" });
  });
});

describe("CSV v2 — experiments", () => {
  it("v1 still reads and exports exactly as v1; v2 adds experiments and metadata rows", () => {
    const v1 = parseAdwordsCsv(V1);
    expect(v1.assets).toHaveLength(81);
    expect(exportAdwordsCsv(v1.assets.map((a) => ({ assetKey: a.assetKey, rowType: a.rowType, ...a.data, extra: a.extra })), "nowy-etap").split("\r\n")[0]).not.toContain("experiment_id");
    const v2 = parseAdwordsCsv(V2);
    expect(v2.issues.filter((i) => i.level === "error")).toEqual([]);
    expect(v2.counts.experiment_plan).toBe(5);
    expect(v2.counts.historical_reference).toBe(4);
    expect(isMetaRow("experiment_plan") && isMetaRow("historical_reference") && !isMetaRow("image")).toBe(true);
    const back = parseAdwordsCsv(exportAdwordsCsv(v2.assets.map((a) => ({ assetKey: a.assetKey, rowType: a.rowType, ...a.data, extra: a.extra })), "nowy-etap"));
    expect(back.assets.map((a) => [a.assetKey, a.data])).toEqual(v2.assets.map((a) => [a.assetKey, a.data]));
  });
  it("T01–T05: arms, identical scenes after 3 s, one variable", () => {
    const ex = experiments(assetsOf(V2));
    expect(ex.map((e) => [e.id, e.axis])).toEqual([["T01", "hook"], ["T02", "hook"], ["T03", "hook"], ["T04", "photo"], ["T05", "video_look"]]);
    const t01 = ex[0];
    expect(t01.arms.A.images).toHaveLength(3);
    expect(t01.arms.B.videos[0].variants).toHaveLength(3);
    expect(t01.arms.A.texts[0].adText).toBe("Rozwód bez walki w sądzie");
    expect(t01.arms.B.texts[0].adText).toBe("Rozwód bez wojny");
    for (const e of ex) expect(experimentChecks(e).filter((c) => c.level === "blokada"), e.id).toEqual([]);
    expect(experimentChecks(t01).some((c) => c.message.includes("od 3. sekundy do końca są identyczne"))).toBe(true);
    // a changed scene after 3 s, or a different CTA, breaks the test
    const broken = { ...t01, arms: { ...t01.arms, B: { ...t01.arms.B, videos: [{ ...t01.arms.B.videos[0], scenes: t01.arms.B.videos[0].scenes.map((s, i) => (i === 2 ? { ...s, spokenText: "Inny tekst" } : s)) }], images: t01.arms.B.images.map((i) => ({ ...i, cta: "Zadzwoń" })) } } };
    const bad = experimentChecks(broken).filter((c) => c.level === "blokada").map((c) => c.message);
    expect(bad.some((m) => m.includes("od 3. sekundy różnią się"))).toBe(true);
    expect(bad.some((m) => m.includes("CTA różni się") || m.includes("poza hookiem"))).toBe(true);
    expect(armLimits(t01.arms.A).every((c) => c.level === "ok")).toBe(true);
  });
  it("archive texts marked do_not_publish block reuse; risky archival claims need a legal check", () => {
    const all = assetsOf(V2);
    const opts = gateOptionsOf(all);
    expect(opts.doNotPublish).toEqual(["Złóż to zamiast pozwu", "Rozwód na pierwszej rozprawie", "Skróć rozwód nawet do 8 dni"]);
    expect(gateText({ assetKey: "x", rowType: "headline", adText: "Złóż to zamiast pozwu" }, opts).status).toBe("blokada");
    expect(gateText({ assetKey: "x", rowType: "headline", adText: "Rozwód w 8 dni" }).problems.some((p) => p.message.includes("Weryfikacja prawna"))).toBe(true);
    expect(gateText({ assetKey: "x", rowType: "headline", adText: "Cena znana z góry" }).problems.some((p) => p.message.includes("zakres"))).toBe(true);
    expect(gateText({ assetKey: "x", rowType: "headline", adText: "Cena znana z góry", claimSource: "cennik" }).status).toBe("gotowe");
  });
});
