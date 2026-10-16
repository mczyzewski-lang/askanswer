import { describe, expect, it } from "vitest";
import { imageSize } from "../../src/lib/server/openai-images";
import { openaiInfographicPrompt } from "../../src/lib/server/broll";
import { DEFAULT_THEME } from "../../src/lib/themes";

describe("OpenAI infographic images", () => {
  it("asks for a size the model accepts, close to the video format", () => {
    expect(imageSize("gpt-image-2", 1080, 1920)).toBe("864x1536"); // 9:16, multiples of 16, cheaper default
    expect(imageSize("gpt-image-2", 1920, 1080)).toBe("1536x864");
    expect(imageSize("gpt-image-2", 1080, 1920, 1824)).toBe("1024x1824");
    expect(imageSize("gpt-image-2.5-flare", 1080, 1080)).toBe("1536x1536");
    expect(imageSize("gpt-image-1.5", 1080, 1920)).toBe("1024x1536"); // fixed sizes on older models
  });

  it("prompt carries the exact Polish text, safe areas and theme colours", () => {
    const p = openaiInfographicPrompt({ headline: "Ile trwa rozwód?", items: [{ value: "6–12 mies.", label: "w sądzie okręgowym" }], note: null }, DEFAULT_THEME, null);
    expect(p).toContain("«Ile trwa rozwód?»");
    expect(p).toContain("«6–12 mies.»");
    expect(p).toMatch(/top 22%.*bottom 32%/);
    expect(p).toContain(DEFAULT_THEME.primary);
    expect(p).not.toContain("footnote");
  });
});
