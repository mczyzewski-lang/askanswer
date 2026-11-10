import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { drawCreative } from "../../src/lib/adwords/draw";
import { THEME_PRESETS } from "../../src/lib/themes";
import { registerFonts } from "../../src/lib/render/server-render";
import { COMPARISON_TEMPLATES } from "../../src/lib/server/adwords-variants";
import { assertSafeSvg, svgTone, svgToPng, swapTone } from "../../src/lib/server/svg-logo";

const theme = { ...THEME_PRESETS.find((t) => t.key === "nowy-etap")! } as never;
const FORMATS: Array<[number, number, { top: number; bottom: number; left: number; right: number } | null]> = [
  [1200, 628, null],
  [1200, 1200, null],
  [960, 1200, null],
  [1440, 1440, { top: 0.06, bottom: 0.06, left: 0.06, right: 0.06 }],
  [1440, 1800, { top: 0.06, bottom: 0.06, left: 0.06, right: 0.06 }],
  [1440, 2560, { top: 0.14, bottom: 0.35, left: 0.06, right: 0.06 }],
];

describe("comparison cards", () => {
  it("the 5 templates fit every Google and Meta format (logo, topic on top, webinar pill + date)", async () => {
    registerFonts();
    const logo = await loadImage(fs.readFileSync("public/presets/nowy-etap.png"));
    const logoDark = await loadImage(fs.readFileSync("public/presets/nowy-etap-white.png"));
    for (const t of COMPARISON_TEMPLATES)
      for (const [w, h, ins] of FORMATS)
        for (const webinar of [false, true]) {
          const c = createCanvas(w, h);
          const m = drawCreative(c.getContext("2d") as never, {
            width: w,
            height: h,
            layout: "comparison",
            copy: { headline: t.title, cta: t.cta, comparison: { title: t.title, leftLabel: t.left_label, leftTitle: t.left_title, left: t.left, rightLabel: "Nowy Etap", rightTitle: t.right_title, right: t.right, note: "Najpierw plan i ustalenia, dopiero potem pozew o rozwód." }, badge: webinar ? "Bezpłatny webinar on-line" : null, dateLine: webinar ? "Wtorek 20:00,\n17 Listopada" : null },
            theme,
            logo: logo as never,
            logoDark: logoDark as never,
            topic: "rozwód",
            safeMargin: 0.1,
            safeInsets: ins,
          });
          expect({ t: t.key, w, h, webinar, overflow: m.overflow, outside: m.outsideSafe }).toEqual({ t: t.key, w, h, webinar, overflow: false, outside: false });
          expect(m.minFontPx).toBeGreaterThanOrEqual(14);
        }
  }, 120_000);

  it("SVG logos: active content refused, white logo → its light-background twin, drawn to PNG", async () => {
    const svg = `<svg width="100" height="20" viewBox="0 0 100 20" xmlns="http://www.w3.org/2000/svg"><path d="M0 0h50v20H0z" fill="white"/><path d="M60 0h40v20H60z" fill="#BE934E"/></svg>`;
    expect(() => assertSafeSvg(svg)).not.toThrow();
    expect(() => assertSafeSvg(svg.replace("<path", '<script>alert(1)</script><path'))).toThrow();
    expect(() => assertSafeSvg(svg.replace("<path", '<image href="https://x.y/a.png"/><path'))).toThrow();
    expect(() => assertSafeSvg(svg.replace('fill="white"', 'fill="white" onload="x()"'))).toThrow();
    expect(svgTone(svg)).toBe("dark");
    const light = swapTone(svg, "#263D3A");
    expect(light).toContain('fill="#263D3A"');
    expect(light).toContain('fill="#BE934E"');
    expect(svgTone(light)).toBe("light");
    const png = await svgToPng(svg, 800);
    const img = await loadImage(png);
    expect([img.width, img.height]).toEqual([800, 160]);
  });
});
