import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { assembleChunks, chunkDir, sniffVideo } from "@/lib/server/chunked";

describe("sliced uploads", () => {
  it("assembles the slices in order and frees each one as it goes", async () => {
    const id = `t${Date.now()}`;
    const dir = chunkDir("test-uploads", id);
    fs.mkdirSync(dir, { recursive: true });
    ["aa", "bb", "cc"].forEach((t, i) => fs.writeFileSync(`${dir}/${String(i).padStart(6, "0")}.part`, t));
    const { file } = await assembleChunks("test-uploads", id, 3);
    expect(fs.readFileSync(file, "utf8")).toBe("aabbcc");
    expect(fs.readdirSync(dir)).toEqual(["assembled.bin"]);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  it("tells a video by its first bytes", () => {
    const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypisom")]);
    expect(sniffVideo(mp4)).toEqual({ ext: "mp4", mime: "video/mp4" });
    expect(sniffVideo(Buffer.concat([Buffer.from([0, 0, 0, 20]), Buffer.from("ftypqt  ")]))).toEqual({ ext: "mov", mime: "video/quicktime" });
    expect(sniffVideo(Buffer.from("not a video at all"))).toBeNull();
  });
});

import { acceptsFile } from "@/lib/client/accept-file";

describe("drop zone file filter", () => {
  const f = (name: string, type: string) => new File(["x"], name, { type });
  it("accepts by MIME type, wildcard or extension", () => {
    expect(acceptsFile(f("P1016420.MP4", "video/mp4"), "video/*")).toBe(true);
    expect(acceptsFile(f("klip.mov", ""), "video/mp4,.mov")).toBe(true);
    expect(acceptsFile(f("pytania.CSV", "application/vnd.ms-excel"), ".csv,text/csv")).toBe(true);
    expect(acceptsFile(f("zdjecie.png", "image/png"), ".csv,text/csv")).toBe(false);
    expect(acceptsFile(f("cokolwiek.bin", ""), undefined)).toBe(true);
  });
});

import { json } from "@/lib/server/http";

describe("JSON responses", () => {
  it("send file sizes over 2 GB (BigInt) as numbers", async () => {
    const r = json({ sizeBytes: BigInt(4_294_967_296), ok: true }, 201);
    expect(r.status).toBe(201);
    expect(r.headers.get("content-type")).toContain("application/json");
    expect(await r.json()).toEqual({ sizeBytes: 4294967296, ok: true });
  });
});
