import { expect, test } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { adminRequest, login } from "./helpers";

const V5 = fs.readFileSync("tests/fixtures/adwords/nowy_etap_pmax_v5_50_assetow_i_landing_page.csv", "utf-8");
const HIST_NAME = "Grupa plików – raport szczegółowych informacji o komponentach (3).csv";
const HIST = fs.readFileSync(`tests/fixtures/adwords/${HIST_NAME}`, "utf-8");

test("10 PMax creatives from the history: each scores > 95/100 (A) and passes the gates in every format", async ({ page, request }) => {
  test.setTimeout(300_000);
  await adminRequest(request);
  const project = await (await request.post("/api/admin/projects", { data: { name: "Nowy Etap", preset: "nowy-etap" } })).json();
  const base = `/api/admin/adwords/${project.id}`;
  await request.post(`${base}/import`, { data: { text: V5, fileName: "v5.csv", dryRun: false } });
  await request.post(`${base}/history`, { data: { text: HIST, fileName: HIST_NAME, dryRun: false } });
  const photo = path.join(os.tmpdir(), `kamil-${Date.now()}.jpg`);
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=800x1000:duration=1", "-frames:v", "1", photo]);
  expect((await request.post(`${base}/photos`, { multipart: { file: { name: "kamil.jpg", mimeType: "image/jpeg", buffer: fs.readFileSync(photo) }, key: "kamil", name: "Kamil Jura", consentConfirmed: "true" } })).ok()).toBe(true);

  await login(page);
  await page.goto(`/admin/adwords/${project.id}?tab=grafiki`);
  await page.getByTestId("variants-pmax10").click();
  await expect(page.getByText(/Dodano 10 reklam PMax/)).toBeVisible({ timeout: 60_000 });
  const data = await (await request.get(base)).json();
  const rows = data.assets.filter((a: { conceptId: string | null }) => /^P\d+$/.test(a.conceptId ?? ""));
  expect(rows).toHaveLength(30);
  // scored on the real renders (the ZIP manifest: overflow, smallest text, contrast measured)
  const concepts = [...new Set(rows.map((a: { conceptId: string }) => a.conceptId))].join(",");
  const zip = await request.get(`${base}/zip?fmt=png&concepts=${encodeURIComponent(concepts)}`);
  expect(zip.status()).toBe(200);
  const { unzipSync, strFromU8 } = await import("fflate");
  const files = unzipSync(new Uint8Array(await zip.body()));
  const manifest = JSON.parse(strFromU8(files["manifest.json"])).files as Array<{ asset_id: string; score_a: number; status: string; warnings: string }>;
  console.log(manifest.map((m) => `${m.asset_id} A=${m.score_a} ${m.status} ${m.warnings}`).join("\n"));
  expect(manifest).toHaveLength(30);
  for (const m of manifest) {
    expect({ k: m.asset_id, over95: m.score_a > 95 }).toEqual({ k: m.asset_id, over95: true });
    // the cost concepts wait only for the owner's approval of the price claim
    const price = /^P0(3|5)-/.test(m.asset_id);
    expect({ k: m.asset_id, status: m.status, warnings: price ? m.warnings.includes("Komunikat o cenie") && !m.warnings.replace(/Komunikat o cenie[^|]*/, "").trim() : m.warnings }).toEqual({ k: m.asset_id, status: price ? "do_poprawy" : "gotowe", warnings: price ? true : "" });
  }
  if (process.env.LP_SHOTS) for (const c of ["P01", "P03", "P07"]) await page.getByTestId("concept-card").filter({ hasText: c }).first().screenshot({ path: `${process.env.LP_SHOTS}/pmax10-${c}.png` });
});
