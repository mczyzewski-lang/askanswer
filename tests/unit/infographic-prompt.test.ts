import { describe, expect, it } from "vitest";
import { INFOGRAPHIC_PROMPT_BASE, infographicPrompt, isBasePrompt } from "../../src/lib/infographic-prompt";
import { DEFAULT_THEME } from "../../src/lib/themes";

const info = { headline: "Ile trwa rozwód?", items: [{ value: "6 mies.", label: "średni czas" }], note: null };

describe("infographic prompt template", () => {
  it("the base: values and theme colours filled, empty parts left out", () => {
    const p = infographicPrompt(info, DEFAULT_THEME, null);
    expect(p).toContain("Headline: «Ile trwa rozwód?»");
    expect(p).toContain("1. big value «6 mies.» — label «średni czas»");
    expect(p).toContain(`(${DEFAULT_THEME.background})`);
    expect(p).not.toContain("{{");
    expect(p).not.toContain("Small footnote");
    expect(p).not.toMatch(/\n\s*\n/);
  });
  it("a theme's own template is used; unknown placeholders stay as they are", () => {
    const p = infographicPrompt(info, DEFAULT_THEME, "styl X", "Hand-drawn chalkboard. Title {{headline}} in {{accent}}. {{style}} {{unknown}}");
    expect(p).toBe(`Hand-drawn chalkboard. Title Ile trwa rozwód? in ${p.split(" in ")[1].split(".")[0]}. Visual style of the illustration elements (as a still image): styl X {{unknown}}`);
    expect(p).toContain(`(${DEFAULT_THEME.accent})`);
  });
  it("the base (also with other line endings / spaces) is not a change", () => {
    expect(isBasePrompt(null)).toBe(true);
    expect(isBasePrompt(`  ${INFOGRAPHIC_PROMPT_BASE.replace(/\n/g, "\r\n")}\n`)).toBe(true);
    expect(isBasePrompt(`${INFOGRAPHIC_PROMPT_BASE} More icons.`)).toBe(false);
  });
});
