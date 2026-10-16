import { describe, expect, it } from "vitest";
import { stablePick, withFillers } from "../../src/lib/fillers";

const Q = "Czy po rozwodzie mogę wrócić do nazwiska panieńskiego, jeśli mam dzieci?";
const FILLER = /(yyy|mm|ech|eee|hmm|yy)…/i;

describe("narrator fillers", () => {
  it("is deterministic per question", () => {
    expect(withFillers(Q, "q1")).toBe(withFillers(Q, "q1"));
  });

  it("is subtle: never more than one filler, about half of questions unchanged", () => {
    let changed = 0;
    for (let i = 0; i < 400; i++) {
      const out = withFillers(Q, `q${i}`);
      const n = (out.match(/…/g) ?? []).length;
      expect(n).toBeLessThanOrEqual(1);
      if (n) changed++;
      // the question itself is intact
      expect(out.replace(/(^\S+… )|(,? ?\S+…)/, "").replace(/\s+/g, " ").replace(" ,", ",")).toContain("rozwodzie");
    }
    expect(changed / 400).toBeGreaterThan(0.35);
    expect(changed / 400).toBeLessThan(0.65);
  });

  it("puts a middle filler inside the sentence, not at the ends", () => {
    for (let i = 0; i < 300; i++) {
      const out = withFillers(Q, `m${i}`);
      if (!FILLER.test(out) || /^\S+… /.test(out)) continue;
      const words = out.split(/\s+/);
      const at = words.findIndex((w) => FILLER.test(w));
      expect(at).toBeGreaterThan(1);
      expect(at).toBeLessThan(words.length - 2);
    }
  });

  it("leaves very short texts alone", () => {
    expect(withFillers("Dzień dobry", "x")).toBe("Dzień dobry");
  });

  it("stablePick spreads voices and is stable per key", () => {
    const voices = ["a", "b", "c"];
    expect(stablePick(voices, "q1")).toBe(stablePick(voices, "q1"));
    const used = new Set(Array.from({ length: 60 }, (_, i) => stablePick(voices, `q${i}`)));
    expect(used.size).toBe(3);
    expect(stablePick([], "x")).toBeUndefined();
  });
});
