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
