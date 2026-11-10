import { expect, test } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { unzipSync } from "fflate";
import { adminRequest, login } from "./helpers";

test("Meta (FB/IG) tab: texts → banners in 3 formats with / without the expert, a webinar with its date, PNG / ZIP for Ads Manager", async ({ page, request }) => {
  test.setTimeout(240_000);
  await adminRequest(request);
  const project = await (await request.post("/api/admin/projects", { data: { name: "Nowy Etap", preset: "nowy-etap" } })).json();
  const base = `/api/admin/adwords/${project.id}`;
  const photo = path.join(os.tmpdir(), `meta-anna-${Date.now()}.jpg`);
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=800x1000:duration=1", "-frames:v", "1", photo]);
  expect((await request.post(`${base}/photos`, { multipart: { file: { name: "anna.jpg", mimeType: "image/jpeg", buffer: fs.readFileSync(photo) }, key: "anna", name: "Anna Mediatorka", consentConfirmed: "true" } })).ok()).toBe(true);

  await login(page);
  // the tab works in a project without Google creatives
  await page.goto(`/admin/adwords/${project.id}?tab=meta`);
  await page.getByTestId("meta-new").click();
  const ed = page.getByTestId("meta-editor");
  await ed.getByLabel("Nazwa reklamy").fill("Webinar listopad");
  await ed.getByLabel("Tekst główny").fill("Rozwód bez walki w sądzie? Na bezpłatnym webinarze pokażemy, jak przygotować plan rozwodu.");
  await ed.getByLabel("Nagłówek Meta").fill("Bezpłatny webinar o rozwodzie");
  await ed.getByLabel("Opis Meta").fill("Plan przed pozwem");
  await ed.getByLabel("Hasło na grafice").fill("Rozwód bez walki? Webinar o planie rozwodu");
  await ed.getByLabel("Cel: webinar").check();
  await expect(ed.getByLabel("Przycisk CTA")).toHaveValue("SIGN_UP");
  await ed.getByLabel("Adres docelowy").fill("https://nowy-etap.pl/webinar/");
  await ed.getByLabel("Tytuł webinaru").fill("Plan rozwodu krok po kroku");
  const future = new Date(Date.now() + 14 * 86_400_000);
  const p2 = (n: number) => String(n).padStart(2, "0");
  await ed.getByLabel("Data webinaru").fill(`${future.getFullYear()}-${p2(future.getMonth() + 1)}-${p2(future.getDate())}T19:00`);
  // the expert: the version without + Anna → 2 versions × 3 formats in the live preview
  await expect(ed.getByLabel("Ekspert anna")).toBeChecked();
  await expect(ed.getByTestId("meta-version")).toHaveCount(2);
  await expect(ed.getByText("Gotowe do Ads Managera.")).toBeVisible();
  await ed.getByTestId("meta-save").click();
  const card = page.getByTestId("meta-card");
  await expect(card).toHaveCount(1);
  await expect(card).toContainText("Webinar: Plan rozwodu krok po kroku");
  // typed 19:00 = 19:00 Warsaw time on the banner, whatever the computer's zone
  await expect(card).toContainText("19:00");
  await expect(card).toContainText("gotowe");
  await expect(card.getByTestId("meta-png")).toHaveCount(6);
  if (process.env.LP_SHOTS) {
    await page.setViewportSize({ width: 1500, height: 1000 });
    await page.waitForTimeout(1500);
    await card.screenshot({ path: `${process.env.LP_SHOTS}/meta-card.png` });
  }

  // the PNGs: exact sizes, nothing cut off
  const ads = await (await request.get(`${base}/meta`)).json();
  const id = ads[0].id;
  for (const [format, version, w, h] of [["square", "none", 1080, 1080], ["story", ads[0].photoIds[0], 1080, 1920], ["feed", ads[0].photoIds[0], 1080, 1350]] as const) {
    const r = await request.get(`${base}/meta/${id}/render?format=${format}&version=${version}`);
    expect(r.status()).toBe(200);
    expect(r.headers()["x-render-overflow"]).toBe("false");
    const png = Buffer.from(await r.body());
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([w, h]);
  }
  // the package for Ads Manager: 2 versions × 3 formats + the texts
  const z = unzipSync(new Uint8Array(await (await request.get(`${base}/meta/zip`)).body()));
  expect(Object.keys(z).filter((n) => n.endsWith(".png"))).toHaveLength(6);
  const csv = new TextDecoder().decode(z["meta_teksty.csv"]);
  expect(csv).toContain("SIGN_UP");
  expect(csv).toContain("https://nowy-etap.pl/webinar/");
  expect(csv).toContain("Webinar ·");

  // the comparison layout and the AI infographic version
  await card.getByTestId("meta-edit").click();
  const ed2 = page.getByTestId("meta-editor");
  await ed2.getByLabel("Układ Meta").selectOption("comparison");
  await ed2.getByLabel("Meta Lewa — treść").fill("Najpierw pozew, potem spór");
  await ed2.getByLabel("Meta Prawa — treść").fill("Najpierw plan, potem pozew");
  await ed2.getByTestId("meta-save").click();
  await expect(page.getByTestId("meta-editor")).toHaveCount(0);
  const cmp = await request.get(`${base}/meta/${id}/render?format=story&version=none`);
  expect(cmp.headers()["x-render-overflow"]).toBe("false");
  expect((await (await request.get(`${base}/meta`)).json())[0].extra.comparison_left).toBe("Najpierw pozew, potem spór");
  await page.getByTestId("meta-card").getByTestId("meta-infographic").click();
  await expect(page.getByTestId("meta-card").getByTestId("meta-version").filter({ hasText: "Infografika AI" })).toBeVisible({ timeout: 120_000 });
  const info = await request.get(`${base}/meta/${id}/render?format=feed&version=info`);
  expect(info.status()).toBe(200);
  const z2 = unzipSync(new Uint8Array(await (await request.get(`${base}/meta/zip?ads=${id}`)).body()));
  expect(Object.keys(z2).filter((n) => n.endsWith(".png"))).toHaveLength(9);
  expect(Object.keys(z2).some((n) => n.includes("infografika"))).toBe(true);

  // a webinar in the past blocks the ad
  await request.patch(`${base}/meta/${id}`, { data: { webinarAt: new Date(Date.now() - 86_400_000).toISOString() } });
  await page.reload();
  await expect(page.getByTestId("meta-card")).toContainText("Webinar już się odbył");
  await expect(page.getByTestId("meta-card")).toContainText("blokada");
});
