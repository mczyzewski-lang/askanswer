import { describe, expect, it } from "vitest";
import { createCanvas } from "@napi-rs/canvas";
import { drawOverlay } from "../../src/lib/render/compositor";
import { parseTypo, TYPO_PRESETS, defaultMotif } from "../../src/lib/render/typo";
import { overlay as overlaySchema } from "../../src/lib/editor/schema";
import { registerFonts } from "../../src/lib/render/server-render";
import { THEME_PRESETS } from "../../src/lib/themes";
import type { EditorDocument, TypoOverlay } from "../../src/lib/editor/types";

const p = THEME_PRESETS.find((t) => t.key === "nowy-etap")!;
const theme = { name: "Nowy Etap", primary: p.primary, accent: p.accent, secondary: p.secondary, text: p.text, highlight: p.highlight, background: p.background, questionFont: p.questionFont, subtitleFont: p.subtitleFont, labelFont: p.labelFont };
const doc = { width: 1080, height: 1920, theme } as unknown as EditorDocument;
const env = { getFrame: () => null, getImage: () => null };
/** how many pixels differ from the flat background */
function painted(o: TypoOverlay, t: number, settled = false) {
  const c = createCanvas(270, 480);
  const g = c.getContext("2d");
  g.fillStyle = "#777777";
  g.fillRect(0, 0, 270, 480);
  g.scale(0.25, 0.25);
  drawOverlay(g as never, doc, o, t, { ...env, settled } as never, 30);
  const d = g.getImageData(0, 0, 270, 480).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - 0x77) > 6 || Math.abs(d[i + 1] - 0x77) > 6 || Math.abs(d[i + 2] - 0x77) > 6) n++;
  return n;
}

describe("typo animations", () => {
  it("markup: lines by newline or |, *accent* words (also across words, with punctuation)", () => {
    expect(parseTypo("Najpierw *plan*,\npotem pozew")).toEqual([[{ t: "Najpierw", acc: false }, { t: "plan,", acc: true }], [{ t: "potem", acc: false }, { t: "pozew", acc: false }]]);
    expect(parseTypo("Plan | *bez walki* w sądzie").map((l) => l.map((w) => (w.acc ? `[${w.t}]` : w.t)).join(" "))).toEqual(["Plan", "[bez] [walki] w sądzie"]);
    expect(defaultMotif("Nowy Etap (Kampania)")).toBe("stairs");
    expect(defaultMotif("Pravna")).toBe("bar");
  });

  it("every preset: nothing before it starts, builds up, drawn in the export (server canvas), leaves at the end; the document validates", () => {
    registerFonts();
    for (const pr of TYPO_PRESETS) {
      const o = { id: "t1", name: pr.label, kind: "typo", preset: pr.key, text: pr.sample, sub: pr.sub, size: pr.size, start: 1, end: 1 + pr.seconds, opacity: 1, animation: "none", motif: "stairs", ...pr.box } as TypoOverlay;
      const early = painted(o, 1.08);
      const mid = painted(o, 1 + pr.seconds / 2);
      const last = painted(o, 1 + pr.seconds - 0.02);
      expect({ k: pr.key, grows: mid > early, visible: mid > 300, leaves: last < mid }).toEqual({ k: pr.key, grows: true, visible: true, leaves: true });
      // paused editor: the finished state from the first frame (the transition keeps its real frame)
      if (pr.key !== "stairWipe") expect(painted(o, 1.01, true)).toBeGreaterThan(mid * 0.8);
      expect(overlaySchema.safeParse(JSON.parse(JSON.stringify(o))).success).toBe(true);
    }
  });
});
