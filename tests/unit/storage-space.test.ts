import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "askby-store-"));
beforeAll(() => {
  process.env.STORAGE_DRIVER = "local";
  process.env.STORAGE_LOCAL_DIR = dir;
});

describe("local storage uses disk space sparingly", () => {
  it("putFile stores a temp file without a second copy (hard link) and the work file stays usable", async () => {
    const { makeTempDir, putFile, localPathFor } = await import("../../src/lib/server/storage");
    const work = await makeTempDir("t");
    const f = path.join(work, "a.bin");
    await fsp.writeFile(f, Buffer.alloc(1024 * 64, 7));
    await putFile("projects/p/a.bin", f, "application/octet-stream");
    const a = await fsp.stat(f);
    const b = await fsp.stat(localPathFor("projects/p/a.bin"));
    expect(b.ino).toBe(a.ino); // same data on disk
    expect(b.nlink).toBe(2);
    await fsp.rm(work, { recursive: true });
    expect((await fsp.readFile(localPathFor("projects/p/a.bin"))).length).toBe(1024 * 64);
  });

  it("cleanupTemp removes stale work dirs and abandoned uploads, keeps fresh ones", async () => {
    const { cleanupTemp, tmpDir } = await import("../../src/lib/server/storage");
    const old = Date.now() / 1000 - 8 * 3600;
    const mk = async (p: string, ageSec: number) => {
      await fsp.mkdir(p, { recursive: true });
      await fsp.writeFile(path.join(p, "x"), "data");
      await fsp.utimes(path.join(p, "x"), ageSec, ageSec);
      await fsp.utimes(p, ageSec, ageSec);
    };
    await mk(tmpDir("take-old"), old);
    await mk(tmpDir("take-new"), Date.now() / 1000);
    await mk(tmpDir("uploads", "u-old"), Date.now() / 1000 - 5 * 86400);
    await mk(tmpDir("uploads", "u-recent"), old); // 8 h old upload may still be resumed
    const r = await cleanupTemp();
    expect(r.removed).toBe(2);
    expect(fs.existsSync(tmpDir("take-old"))).toBe(false);
    expect(fs.existsSync(tmpDir("take-new"))).toBe(true);
    expect(fs.existsSync(tmpDir("uploads", "u-old"))).toBe(false);
    expect(fs.existsSync(tmpDir("uploads", "u-recent"))).toBe(true);
  });

  it("reports disk usage and explains a full disk", async () => {
    const { diskUsage, diskFullMessage } = await import("../../src/lib/server/storage");
    const d = await diskUsage();
    expect(d!.total).toBeGreaterThan(0);
    expect(diskFullMessage(Object.assign(new Error("ENOSPC: no space left on device, copyfile"), { code: "ENOSPC" }))).toMatch(/Brak miejsca/);
    expect(diskFullMessage(new Error("other"))).toBeNull();
  });
});
