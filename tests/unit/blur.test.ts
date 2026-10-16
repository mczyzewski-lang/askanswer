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

describe("mask refinement and background fill", () => {
  it("guided filter moves a blocky edge onto the real edge of the picture", async () => {
    const { refineMask } = await import("../../src/lib/server/segment");
    // guide (real mask size): bright person left of x=300, dark room right; the model's coarse mask
    // (256 px wide, as from the 256×256 input) puts the edge ~5 px too far right
    const gw = 640;
    const gh = 40;
    const luma = new Float32Array(gw * gh);
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) luma[y * gw + x] = x < 300 ? 0.85 : 0.15;
    const cw = 256;
    const ch = 16;
    const coarse = new Float32Array(cw * ch);
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) coarse[y * cw + x] = x < 122 ? 1 : 0; // edge at 305 px
    const out = refineMask(coarse, cw, ch, luma, gw, gh);
    const row = 20 * gw;
    expect(out[row + 296]).toBeGreaterThan(230);
    expect(out[row + 303]).toBeLessThan(80); // inside the coarse mask, but outside the person in the picture
  });

  it("fills the person's area in the background with the surrounding colours", async () => {
    const { fillBehindPerson } = await import("../../src/lib/render/compositor");
    const w = 40;
    const h = 40;
    const px = new Uint8ClampedArray(w * h * 4);
    const mask = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const x = i % w;
      const person = x >= 15 && x < 25;
      px.set(person ? [0, 0, 0, 255] : [200, 50, 50, 255], i * 4);
      mask[i * 4 + 3] = person ? 255 : 0;
    }
    fillBehindPerson(px, mask, w, h);
    const at = (x: number, y: number) => px[(y * w + x) * 4];
    expect(at(20, 20)).toBeGreaterThan(150); // the dark person no longer bleeds into the blurred room
    expect(at(5, 20)).toBe(200); // the room itself is untouched
  });
});

describe("mask stability over time", () => {
  it("damps small frame-to-frame noise but lets real movement through", async () => {
    const { stabilize } = await import("../../src/lib/server/segment");
    const prev = new Uint8Array([128, 128, 0, 255]);
    const cur = new Uint8Array([140, 128, 255, 0]); // noise, unchanged, person moved in, person moved out
    stabilize(cur, prev);
    expect(Math.abs(cur[0] - 128)).toBeLessThan(8);
    expect(cur[1]).toBe(128);
    expect(cur[2]).toBe(255);
    expect(cur[3]).toBe(0);
  });
});
