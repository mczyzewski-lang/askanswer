/**
 * Person masks for background blur ("AMSK"): one 8-bit grayscale mask per sampled frame
 * (255 = person), each frame deflate-raw compressed, with an offset table for random access.
 * Shared by the worker (writes), the export renderer and the Studio preview (read).
 *
 *   0  "AMSK"            4 bytes
 *   4  version (1)       u8, reserved u8
 *   6  width, height     u16, u16 (little endian)
 *  10  fps               f32
 *  14  count             u32
 *  18  offsets[count+1]  u32 — byte offsets of each compressed frame, relative to the data start
 *  ..  data
 */
export interface MaskHeader {
  width: number;
  height: number;
  fps: number;
  count: number;
  dataStart: number;
  offsets: Uint32Array;
}

export function parseMaskHeader(buf: ArrayBuffer | Uint8Array): MaskHeader {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (String.fromCharCode(u8[0], u8[1], u8[2], u8[3]) !== "AMSK" || u8[4] !== 1) throw new Error("Nieprawidłowy plik maski");
  const width = dv.getUint16(6, true);
  const height = dv.getUint16(8, true);
  const fps = dv.getFloat32(10, true);
  const count = dv.getUint32(14, true);
  const offsets = new Uint32Array(count + 1);
  for (let i = 0; i <= count; i++) offsets[i] = dv.getUint32(18 + i * 4, true);
  return { width, height, fps, count, dataStart: 18 + (count + 1) * 4, offsets };
}

export function encodeMaskFile(width: number, height: number, fps: number, frames: Uint8Array[]): Uint8Array {
  const head = 18 + (frames.length + 1) * 4;
  const total = head + frames.reduce((n, f) => n + f.length, 0);
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  out.set([0x41, 0x4d, 0x53, 0x4b, 1, 0]);
  dv.setUint16(6, width, true);
  dv.setUint16(8, height, true);
  dv.setFloat32(10, fps, true);
  dv.setUint32(14, frames.length, true);
  let off = 0;
  frames.forEach((f, i) => {
    dv.setUint32(18 + i * 4, off, true);
    out.set(f, head + off);
    off += f.length;
  });
  dv.setUint32(18 + frames.length * 4, off, true);
  return out;
}

/** Index of the mask frame shown at a source time. */
export function maskFrameIndex(h: Pick<MaskHeader, "fps" | "count">, sourceTime: number): number {
  return Math.max(0, Math.min(h.count - 1, Math.round(sourceTime * h.fps)));
}

/** 8-bit mask → RGBA with the mask as alpha (for canvas "destination-in"). */
export function maskToRgba(gray: Uint8Array, out?: Uint8ClampedArray): Uint8ClampedArray {
  const px = out ?? new Uint8ClampedArray(gray.length * 4);
  for (let i = 0, j = 0; i < gray.length; i++, j += 4) {
    px[j] = 0;
    px[j + 1] = 0;
    px[j + 2] = 0;
    px[j + 3] = gray[i];
  }
  return px;
}
