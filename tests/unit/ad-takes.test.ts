import { describe, expect, it } from "vitest";
import { buildInitialDocument } from "../../src/lib/editor/factory";
import { DEFAULT_THEME } from "../../src/lib/themes";
import { splitAdTake, tightenAdTake, type AdPart } from "../../src/lib/editor/ad-takes";
import { switchHook } from "../../src/lib/editor/timeline";
import { adsCsvTemplate, parseHybridCsv } from "../../src/lib/csv-import";
import { hookList, isMultiHook } from "../../src/lib/question-kinds";

const take = () => buildInitialDocument({ questionText: "Długi a małżeństwo", theme: DEFAULT_THEME, mode: "ANSWER_ONLY", recording: { assetId: "rec", duration: 30 }, segments: [], pauses: [], visibility: "FULL", questionSeconds: 4 });
const parts: AdPart[] = [
  { kind: "hook", i: 0, start: 0.5, end: 4 },
  { kind: "hook", i: 1, start: 4, end: 8.5 },
  { kind: "hook", i: 2, start: 8.5, end: 12 },
  { kind: "body", i: 0, start: 12, end: 28 },
];

describe("ads recorded with several hooks", () => {
  it("one take → hook versions + one body; switching a version keeps the body", () => {
    const d = splitAdTake(take(), parts, "Długi a małżeństwo");
    expect(d.clips.map((c) => c.label)).toEqual(["HOOK", "BODY"]);
    expect(d.clips[1]).toMatchObject({ sourceIn: 12, sourceOut: 28, start: 3.5 });
    expect(d.hooks!.variants.map((v) => [v.code, v.clip!.sourceIn, v.clip!.sourceOut])).toEqual([["Hook A", 0.5, 4], ["Hook B", 4, 8.5], ["Hook C", 8.5, 12]]);
    const b = switchHook(d, 1);
    expect(b.clips[0]).toMatchObject({ sourceIn: 4, sourceOut: 8.5 });
    expect(b.clips[1]).toMatchObject({ sourceIn: 12, sourceOut: 28 });
    expect(b.clips[1].start).toBeCloseTo(4.5, 1);
  });
  it("fits each part to its words once the transcript is there", () => {
    const d = splitAdTake(take(), parts, "T");
    const words = [{ start: 1.0, end: 3.2 }, { start: 4.6, end: 7.9 }, { start: 9.0, end: 11.1 }, { start: 12.8, end: 27.0 }];
    const t = tightenAdTake(d, words);
    expect(t.meta.adSplit).toBe("words");
    expect(t.clips[0].sourceIn).toBeCloseTo(0.85, 2);
    expect(t.clips[0].sourceOut).toBeCloseTo(3.5, 2);
    expect(t.hooks!.variants[1].clip!.sourceIn).toBeCloseTo(4.45, 2);
    expect(t.clips[1].sourceIn).toBeCloseTo(12.65, 2);
    // without words nothing changes (and it is tried again later)
    expect(tightenAdTake(d, []).meta.adSplit).toBe("markers");
  });
  it("reads several hooks from the CSV (Hook 2, Hook 3… columns or ||)", () => {
    const rows = parseHybridCsv(
      'Typ;Kategoria;Tytuł wideo;Hook;Hook 2;Hook 3;Treść\nhookzprompterem;Długi;Długi a mąż;Masz długi?;3 rzeczy o długach;Mąż nie wie?;Treść reklamy.\npytaniazprompterem;Długi;Mąż i długi;Czy mam powiedzieć mężowi? || Mąż nie wie o długach. Co robić?;;;Odpowiedź eksperta.',
    )!;
    expect(rows[0]).toMatchObject({ kind: "HOOK_PROMPTER", text: "Długi a mąż", hooks: ["Masz długi?", "3 rzeczy o długach", "Mąż nie wie?"], script: "Treść reklamy." });
    expect(rows[1]).toMatchObject({ kind: "QUESTION_PROMPTER", text: "Mąż i długi", hooks: ["Czy mam powiedzieć mężowi?", "Mąż nie wie o długach. Co robić?"] });
    expect(isMultiHook("HOOK_PROMPTER", rows[0])).toBe(true);
    expect(hookList("PROMPTER", { text: "T", hooks: ["a", "b"] })).toEqual(["T"]);
    // the example file reads back as two ads
    const ex = parseHybridCsv(adsCsvTemplate())!;
    expect(ex.map((r) => [r.kind, r.hooks?.length])).toEqual([["HOOK_PROMPTER", 3], ["QUESTION_PROMPTER", 2]]);
  });
});
