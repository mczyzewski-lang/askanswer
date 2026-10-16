import { describe, expect, it } from "vitest";
import { createCanvas } from "@napi-rs/canvas";
import { drawFrame, type Ctx } from "../../src/lib/render/compositor";
import { buildInitialDocument } from "../../src/lib/editor/factory";
import { DEFAULT_THEME } from "../../src/lib/themes";
import { encodeMaskFile, maskFrameIndex, maskToRgba, parseMaskHeader } from "../../src/lib/render/mask-format";

/** local contrast: mean absolute difference between horizontal neighbours */
function sharpness(px: Uint8ClampedArray, W: number, x0: number, y0: number, w: number, h: number) {
  let s = 0;
  let n = 0;
  for (let y = y0; y < y0 + h; y++)
    for (let x = x0; x < x0 + w - 1; x++) {
      const i = (y * W + x) * 4;
      s += Math.abs(px[i] - px[i + 4]);
      n++;
    }
  return s / n;
}

describe("background blur", () => {
  it("blurs the background and keeps the masked person sharp (same code as the export)", () => {
    const W = 270;
    const H = 480;
    // source frame: fine checkerboard everywhere
    const src = createCanvas(W, H);
    const sctx = src.getContext("2d");
    for (let y = 0; y < H; y += 4) for (let x = 0; x < W; x += 4) {
      sctx.fillStyle = (x + y) % 8 ? "#ffffff" : "#000000";
      sctx.fillRect(x, y, 4, 4);
    }
    // mask: person = centre column
    const mw = 27;
    const mh = 48;
    const gray = new Uint8Array(mw * mh);
    for (let y = 0; y < mh; y++) for (let x = 9; x < 18; x++) gray[y * mw + x] = 255;
    const mask = createCanvas(mw, mh);
    const mctx = mask.getContext("2d");
    const img = mctx.createImageData(mw, mh);
    maskToRgba(gray, img.data);
    mctx.putImageData(img, 0, 0);

    const doc = buildInitialDocument({ questionText: "Q", theme: DEFAULT_THEME, mode: "ANSWER_ONLY", recording: { assetId: "rec", duration: 5 }, segments: [], pauses: [], visibility: "FULL", questionSeconds: 4 });
    doc.width = W;
    doc.height = H;
    doc.overlays = [];
    doc.subtitles.enabled = false;
    doc.clips[0].background = { blur: 60 };
    const scratchMap = new Map<string, import("@napi-rs/canvas").Canvas>();
    const out = createCanvas(W, H);
    drawFrame(out.getContext("2d") as unknown as Ctx, doc, 1, {
      getFrame: () => ({ image: src as unknown as CanvasImageSource, width: W, height: H }),
      getImage: () => null,
      getMask: () => ({ image: mask as unknown as CanvasImageSource, width: mw, height: mh }),
      scratch: (k, w, h) => {
        let c = scratchMap.get(k);
        if (!c || c.width !== w || c.height !== h) {
          c = createCanvas(w, h);
          scratchMap.set(k, c);
        }
        return { canvas: c as unknown as CanvasImageSource, ctx: c.getContext("2d") as unknown as Ctx };
      },
    });
    const px = out.getContext("2d").getImageData(0, 0, W, H).data;
    const person = sharpness(px, W, 110, 100, 40, 280);
    const background = sharpness(px, W, 10, 100, 60, 280);
    expect(person).toBeGreaterThan(45); // checkerboard edges intact (pure checkerboard ≈ 64)
    expect(background).toBeLessThan(15); // smoothed out
  });

  it("mask file round-trips and maps source time to frames", async () => {
    const zlib = await import("node:zlib");
    const frames = [new Uint8Array([0, 255, 128, 64]), new Uint8Array([255, 255, 0, 0])].map((f) => zlib.deflateRawSync(f));
    const file = encodeMaskFile(2, 2, 15, frames);
    const h = parseMaskHeader(file);
    expect(h).toMatchObject({ width: 2, height: 2, fps: 15, count: 2 });
    const second = zlib.inflateRawSync(file.subarray(h.dataStart + h.offsets[1], h.dataStart + h.offsets[2]));
    expect([...second]).toEqual([255, 255, 0, 0]);
    expect(maskFrameIndex(h, 0)).toBe(0);
    expect(maskFrameIndex(h, 0.07)).toBe(1);
    expect(maskFrameIndex(h, 99)).toBe(1);
  });
});
