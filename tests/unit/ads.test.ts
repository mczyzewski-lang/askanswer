import { describe, expect, it } from "vitest";
import { parseAdsScript } from "../../src/lib/ads-script";
import { matchPart, similar } from "../../src/lib/ads-match";

/** a transcript: words 0.4 s each, `pause` before the given word indices */
function say(text: string, pauses: Record<number, number> = {}) {
  let t = 0.5;
  return text.split(/\s+/).map((w, i) => {
    t += pauses[i] ?? 0;
    const word = { text: w, start: t, end: t + 0.35 };
    t += 0.4;
    return word;
  });
}

describe("ads script", () => {
  it("reads reel;tytuł;hook;body;cta with ; and extra body columns", () => {
    const { reels, errors } = parseAdsScript("reel;tytuł;hook;body;body 2;cta\nR1;Pierwszy;Hook jeden;Wspólne body;;Kup teraz\nR2;;Hook dwa;Wspólne body;Drugie body;Kup teraz\nR1;dup;x;y;z;w\n");
    expect(errors).toHaveLength(1);
    expect(reels).toHaveLength(2);
    expect(reels[0]).toEqual({ code: "R1", title: "Pierwszy", parts: [{ role: "hook", text: "Hook jeden" }, { role: "body", text: "Wspólne body" }, { role: "cta", text: "Kup teraz" }] });
    expect(reels[1].parts.map((p) => p.role)).toEqual(["hook", "body", "body2", "cta"]);
  });
  it("needs the reel column", () => {
    expect(parseAdsScript("hook;body\na;b").errors[0]).toMatch(/reel/);
  });
});

describe("finding the script in the footage", () => {
  it("tolerates inflection and transcription slips", () => {
    expect(similar("upadlosci", "upadlosc")).toBe(true);
    expect(similar("komornik", "komornika")).toBe(true);
    expect(similar("dom", "kot")).toBe(false);
    expect(similar("2024", "2025")).toBe(false);
  });

  it("finds a part, keeps words the expert added inside it, and picks the last good retake", () => {
    const words = say(
      // take 1 (stumbles) … take 2 (good, with an added phrase) … then the CTA after a pause
      "Twoja rata jest wyższa niż eee niż cała wypłata posłuchaj Twoja rata jest naprawdę wyższa niż cała wypłata posłuchaj Zrób bezpłatny test na stronie",
      { 10: 1.5, 19: 1.2 },
    );
    const footage = [{ id: "f1", words }];
    const hook = matchPart("Twoja rata jest wyższa niż cała wypłata? Posłuchaj.", footage)!;
    expect(hook.footageId).toBe("f1");
    expect(hook.i0).toBe(10); // the second take
    expect(hook.i1).toBe(18);
    expect(hook.extra).toEqual(["naprawdę"]); // the added word stays in the cut
    expect(hook.score).toBeGreaterThan(0.8);
    const cta = matchPart("Zrób bezpłatny test na stronie", footage)!;
    expect(cta.i0).toBe(19);
    expect(cta.start).toBeGreaterThan(hook.end + 1);
  });

  it("keeps a sentence added at the end while the speech flows on, but stops at the next part", () => {
    const words = say("Sąd ustala plan spłaty dla Ciebie i to jest bardzo ważne Zrób test", { 11: 0.2 });
    const footage = [{ id: "f", words }];
    const body = matchPart("Sąd ustala plan spłaty dla Ciebie", footage, { stops: new Map([["f", new Set([11])]]) })!;
    expect(body.i1).toBe(10); // "… bardzo ważne" kept, "Zrób test" (the next part) not
    expect(body.extra).toEqual(["i", "to", "jest", "bardzo", "ważne"]);
  });

  it("finds nothing for a text that was never said", () => {
    const m = matchPart("Zupełnie inny tekst o czymś innym", [{ id: "f", words: say("Twoja rata jest wyższa niż cała wypłata") }]);
    expect(!m || m.score < 0.3).toBe(true);
  });
});

describe("numbers", () => {
  it("never mixes up words that differ only in a number", () => {
    expect(similar("slowo3", "slowo13")).toBe(false);
    expect(similar("500", "5000")).toBe(false);
    expect(similar("4500", "4500")).toBe(true);
  });
});

describe("hook versions", () => {
  it("swaps only the hook: the rest moves by the length difference, edits of a version are kept", async () => {
    const { buildInitialDocument } = await import("../../src/lib/editor/factory");
    const { DEFAULT_THEME } = await import("../../src/lib/themes");
    const { switchHook, contentDuration } = await import("../../src/lib/editor/timeline");
    const doc = buildInitialDocument({ questionText: "Tytuł A", theme: DEFAULT_THEME, mode: "ANSWER_ONLY", recording: { assetId: "f", duration: 60 }, segments: [], pauses: [], visibility: "FULL", questionSeconds: 4 });
    const fr = doc.clips[0].framing;
    doc.clips = [
      { id: "h", assetId: "f", sourceIn: 1, sourceOut: 4, start: 0, volume: 1, muted: false, framing: fr, label: "HOOK", background: { blur: 40 } },
      { id: "b", assetId: "f", sourceIn: 20, sourceOut: 30, start: 3, volume: 1, muted: false, framing: fr, label: "BODY" },
    ];
    doc.zooms = [{ id: "z", start: 5, end: 7, type: "smooth-in", fromScale: 1, toScale: 1.2, easing: "easeInOut", cx: 0.5, cy: 0.4 } as never];
    doc.hooks = {
      clipId: "h",
      active: 0,
      variants: [
        { id: "v0", code: "R1", title: "Tytuł A", clip: { assetId: "f", sourceIn: 1, sourceOut: 4, volume: 1, muted: false, framing: fr, label: "HOOK" } },
        { id: "v1", code: "R2", title: "Tytuł B", clip: { assetId: "f", sourceIn: 40, sourceOut: 45, volume: 1, muted: false, framing: fr, label: "HOOK" } },
      ],
    };
    const b = switchHook(doc, 1);
    expect(b.clips[0]).toMatchObject({ id: "h", sourceIn: 40, sourceOut: 45, start: 0, background: { blur: 40 } });
    expect(b.clips[1].start).toBeCloseTo(5); // body after the 5 s hook
    expect(b.zooms[0].start).toBeCloseTo(7);
    expect(b.overlays.find((o) => o.kind === "text" && o.role === "question")).toMatchObject({ text: "Tytuł B" });
    expect(contentDuration(b)).toBeCloseTo(15);
    // trim the hook of version B, go back and forth: the trim stays with B
    b.clips[0] = { ...b.clips[0], sourceOut: 44 };
    b.clips[1] = { ...b.clips[1], start: 4 }; // trimmed with ripple
    const a = switchHook(b, 0);
    expect(a.clips[0].sourceIn).toBe(1);
    expect(a.clips[1].start).toBeCloseTo(3);
    const b2 = switchHook(a, 1);
    expect(b2.clips[0].sourceOut).toBe(44);
    expect(b2.clips[1].start).toBeCloseTo(4);
  });
});
