import fs from "node:fs";
import { expect, test } from "@playwright/test";
import { adminRequest, login } from "./helpers";

/**
 * Ads Studio: a script file + raw footage → reels cut from the transcript. The mock transcription
 * names the words słowo1, słowo2… along the fixture's voiced parts, so the script uses those words.
 */
test("ads studio: script + footage → reels laid out from the transcript", async ({ page, request }) => {
  test.setTimeout(300_000);
  await adminRequest(request);
  await login(page);
  await page.goto("/admin/ads");
  await page.getByLabel("Nazwa kampanii").fill("Kampania testowa");
  await page.getByRole("button", { name: "Nowa kampania" }).click();
  await expect(page.getByTestId("ads-studio")).toBeVisible();
  const projectId = page.url().split("/").pop()!;

  // 1. the script: two reels share the same body; one hook was never recorded
  const csv = [
    "reel;hook-number;tytuł;hook;body;cta",
    "P01;h01;Pierwszy;słowo1 słowo2 słowo3;słowo4 słowo5 słowo6 słowo7;słowo11 słowo12",
    // body / CTA only in the reel's first row
    "P01;h02;Drugi;słowo8 słowo9 słowo10;;",
    "P01;h03;Trzeci;Tego hooka nikt nigdy nie nagrał;;",
  ].join("\n");
  await page.getByTestId("ads-script-input").setInputFiles({ name: "scenariusze.csv", mimeType: "text/csv", buffer: Buffer.from(csv, "utf-8") });
  await expect(page.getByTestId("ads-reel")).toHaveCount(3);

  // 2. the footage, sent in slices (like a long camera file)
  const buf = fs.readFileSync("tests/fixtures/generated/sample-take.mp4");
  const { id: fid } = await (await request.post(`/api/admin/ads/${projectId}/footage`, { data: { name: "nagranie-1.mp4", size: buf.length } })).json();
  const SLICE = 1024 * 1024;
  const total = Math.ceil(buf.length / SLICE);
  for (let i = 0; i < total; i++) expect((await request.put(`/api/admin/ads/footage/${fid}/chunks/${i}`, { data: buf.subarray(i * SLICE, (i + 1) * SLICE), headers: { "content-type": "application/octet-stream" } })).ok()).toBeTruthy();
  expect((await request.post(`/api/admin/ads/footage/${fid}/complete`, { data: { totalChunks: total } })).ok()).toBeTruthy();
  await page.reload();
  await expect(page.getByTestId("ads-footage-row")).toHaveAttribute("data-status", "READY", { timeout: 120_000 });

  // the campaign's look: subtitles style for every reel
  expect((await request.patch(`/api/admin/projects/${projectId}`, { data: { subtitlePreset: "bold-social" } })).ok()).toBeTruthy();

  // 3. lay out the reels: the hooks of reel P01 are ONE edit with hook versions;
  // h03 was never recorded → reported, not laid out
  await page.getByTestId("ads-build").click();
  await expect(page.getByTestId("ads-open-studio")).toHaveCount(2, { timeout: 60_000 });
  const data = await (await request.get(`/api/admin/ads/${projectId}`)).json();
  const [r1, r2, r3] = ["P01-h01", "P01-h02", "P01-h03"].map((c) => data.reels.find((r: { code: string }) => r.code === c));
  expect(r1.matches.map((m: { missing?: boolean }) => !!m.missing)).toEqual([false, false, false]);
  expect(r1.matches[0].score).toBeGreaterThan(0.9);
  expect(r3.matches[0].missing).toBe(true);
  expect(r3.compositionId).toBeNull();
  await expect(page.getByTestId("ads-reel").nth(2).locator('[data-missing="true"]')).toHaveCount(1);
  expect(r1.compositionId).toBe(r2.compositionId);
  expect([r1.hookIndex, r2.hookIndex]).toEqual([0, 1]);
  await expect(page.getByTestId("ads-hook-version").first()).toHaveText("hook 1/2");

  // the edit = hook → body → CTA, the title at the top for the whole reel
  const doc = (await (await request.get(`/api/admin/compositions/${r1.compositionId}`)).json()).composition.document;
  expect(doc.clips.map((c: { label: string }) => c.label)).toEqual(["HOOK", "BODY", "CTA"]);
  expect(doc.hooks.variants.map((v: { code: string }) => v.code)).toEqual(["P01-h01", "P01-h02"]);
  expect(doc.hooks.variants[1].clip.sourceIn).toBeGreaterThan(doc.clips[1].sourceIn); // R2's hook was said after the body
  const title = doc.overlays.find((o: { role?: string }) => o.role === "question");
  expect(title).toMatchObject({ text: "Pierwszy", end: null });
  expect(doc.subtitles.segments.length).toBeGreaterThan(0);
  expect(doc.subtitles.preset).toBe("bold-social");

  // a second file through the page (sliced upload in the browser)
  await page.getByTestId("ads-video-input").setInputFiles({ name: "nagranie-2.mp4", mimeType: "video/mp4", buffer: buf });
  await expect(page.getByTestId("ads-footage-row")).toHaveCount(2, { timeout: 60_000 });
  await expect(page.getByTestId("ads-footage-row").nth(1)).toHaveAttribute("data-status", "READY", { timeout: 120_000 });

  // B-roll: upload cutaways to the campaign, pick one — the Studio offers it
  const br = await request.post(`/api/admin/ads/${projectId}/broll`, { multipart: { file: { name: "przebitka.mp4", mimeType: "video/mp4", buffer: buf } } });
  expect(br.status()).toBe(201);
  const brId = (await br.json()).id;
  await request.post(`/api/admin/ads/${projectId}/broll`, { multipart: { file: { name: "druga.mp4", mimeType: "video/mp4", buffer: buf } } });
  await page.reload();
  await expect(page.getByTestId("ads-broll-item")).toHaveCount(2);
  await page.getByTestId("ads-broll-item").first().getByTestId("ads-broll-pick").click();
  await expect(page.getByTestId("ads-broll-item").first()).toHaveAttribute("data-picked", "true");
  await expect.poll(async () => (await (await request.get(`/api/admin/ads/${projectId}/broll`)).json()).items.filter((i: { picked: boolean }) => i.picked).length).toBe(1);

  // the Studio: switch the hook version — the rest of the edit stays, the title follows the version
  await page.getByTestId("ads-open-studio").first().click();
  await expect(page.getByTestId("timeline")).toBeVisible({ timeout: 60_000 });
  const sw = page.getByTestId("hook-version");
  await expect(sw).toHaveValue("0");
  await sw.selectOption("1");
  await expect(page.getByText("Zapisano")).toBeVisible({ timeout: 20_000 });
  await expect
    .poll(async () => {
      const d = (await (await request.get(`/api/admin/compositions/${r1.compositionId}`)).json()).composition.document;
      return [d.hooks.active, d.overlays.find((o: { role?: string }) => o.role === "question").text, Math.round(d.clips[0].sourceIn * 100)];
    }, { timeout: 20_000 })
    .toEqual([1, "Drugi", Math.round(doc.hooks.variants[1].clip.sourceIn * 100)]);
  // the shared body sits right after the (other) hook
  const d2 = (await (await request.get(`/api/admin/compositions/${r1.compositionId}`)).json()).composition.document;
  expect(d2.clips[1].start).toBeCloseTo(d2.clips[0].sourceOut - d2.clips[0].sourceIn, 1);
  expect(d2.clips[1].sourceIn).toBeCloseTo(doc.clips[1].sourceIn, 3);

  // the picked cutaway, one click from the Graphics tab: full screen at the playhead
  await page.getByTestId("tab-graphics").click();
  await expect(page.getByTestId("studio-broll-item")).toHaveCount(1); // only the picked one
  await page.getByTestId("studio-broll-item").click();
  await expect
    .poll(async () => {
      const d = (await (await request.get(`/api/admin/compositions/${r1.compositionId}`)).json()).composition.document;
      const o = d.overlays.find((x: { kind: string; assetId?: string }) => x.kind === "video" && x.assetId === brId);
      return o ? [o.x, o.y, o.w, o.h, o.fit, o.volume] : null;
    }, { timeout: 20_000 })
    .toEqual([0, 0, 1, 1, "cover", 0]);

  // every hook version as its own MP4, from the one edit
  test.setTimeout(600_000);
  const rj = await (await request.post(`/api/admin/compositions/${r1.compositionId}/render`, { data: { format: "720x1280", quality: "draft", allHooks: true } })).json();
  expect(rj.jobs.map((j: { code: string }) => j.code)).toEqual(["P01-h01", "P01-h02"]);
  const durations: number[] = [];
  for (const j of rj.jobs) {
    let st: { status: string; duration?: number | null } = { status: "QUEUED" };
    for (let i = 0; i < 150 && st.status !== "SUCCEEDED"; i++) {
      await page.waitForTimeout(2000);
      st = await (await request.get(`/api/admin/render-jobs/${j.id}`)).json();
      if (st.status === "FAILED") throw new Error("render failed");
    }
    expect(st.status).toBe("SUCCEEDED");
    durations.push(st.duration ?? 0);
  }
  const hookLen = (v: { clip: { sourceIn: number; sourceOut: number } }) => v.clip.sourceOut - v.clip.sourceIn;
  expect(durations.every((x) => x > 0)).toBe(true);
  expect(durations[1] - durations[0]).toBeCloseTo(hookLen(d2.hooks.variants[1]) - hookLen(d2.hooks.variants[0]), 0);
});

test("ads campaign settings keep the campaign format and stay off the projects list", async ({ page, request }) => {
  await adminRequest(request);
  const p = await (await request.post("/api/admin/ads", { data: { name: "Kampania ustawienia" } })).json();
  await login(page);
  await page.goto("/admin");
  await expect(page.getByText("Kampania ustawienia")).toHaveCount(0);
  await page.goto(`/admin/projects/${p.id}`);
  await page.getByRole("tab", { name: "Ustawienia" }).click();
  await expect(page.getByText("Kampania Ads Studio")).toBeVisible();
  await page.getByRole("button", { name: /Zapisz/ }).first().click();
  await expect.poll(async () => (await (await request.get(`/api/admin/projects/${p.id}`)).json()).project.format).toBe("ADS");
});

test("an ads campaign can be deleted with its files", async ({ page, request }) => {
  await adminRequest(request);
  const p = await (await request.post("/api/admin/ads", { data: { name: "Kampania do usunięcia" } })).json();
  await login(page);
  await page.goto(`/admin/ads/${p.id}`);
  page.once("dialog", (d) => void d.accept());
  await page.getByTestId("ads-delete").click();
  await expect(page).toHaveURL(/\/admin\/ads$/);
  await expect(page.getByText("Kampania do usunięcia")).toHaveCount(0);
  expect((await request.get(`/api/admin/ads/${p.id}`)).status()).toBe(404);
});

test("ads campaign look: theme, title style, subtitles and end screen for every reel", async ({ page, request }) => {
  await adminRequest(request);
  const p = await (await request.post("/api/admin/ads", { data: { name: "Kampania wygląd" } })).json();
  await login(page);
  await page.goto(`/admin/ads/${p.id}`);
  const look = page.getByTestId("ads-look");
  await expect(look).toBeVisible();
  // the title at the top: plain text, in the centre
  await look.getByTestId("ads-title-style").getByRole("button", { name: "Sam tekst" }).click();
  await look.getByRole("button", { name: "Środek" }).click();
  // subtitles
  await look.getByTestId("ads-subtitles").selectOption("bold-social");
  // end screen
  const end = look.getByTestId("ads-end-screen");
  await end.getByRole("switch").click();
  await end.getByLabel("Adres strony", { exact: true }).fill("kancelaria.pl");
  await end.getByLabel("Podpis", { exact: true }).fill("Zrób test");
  await end.getByRole("button", { name: "Nałóż na końcówkę" }).click();
  await end.getByTestId("ads-end-screen-save").click();
  await expect.poll(async () => {
    const d = await (await request.get(`/api/admin/ads/${p.id}`)).json();
    return [d.project.theme.questionStyle, d.project.theme.questionPosition, d.project.subtitlePreset, d.project.ctaEnabled, d.project.ctaUrl, d.project.ctaPlacement];
  }).toEqual(["plain", "center", "bold-social", true, "kancelaria.pl", "overlay"]);
  // another project's theme: copied (the campaign gets its own editable copy)
  const before = (await (await request.get(`/api/admin/ads/${p.id}`)).json()).project.themeId;
  await look.getByTestId("ads-theme-from").selectOption({ index: 1 });
  await expect.poll(async () => (await (await request.get(`/api/admin/ads/${p.id}`)).json()).project.themeId).not.toBe(before);
});

test("ads scoring: OpenAI reviews each script, the new version and an A/B hook can be swapped in", async ({ page, request }) => {
  test.setTimeout(180_000);
  await adminRequest(request);
  const p = await (await request.post("/api/admin/ads", { data: { name: "Kampania scoring" } })).json();
  await login(page);
  await page.goto(`/admin/ads/${p.id}`);
  const csv = ["reel;hook-number;tytuł;hook;body;cta", "P01;h01;Pierwszy;Masz długi?;Stare body reelsa.;Stare CTA.", "P01;h02;Drugi;Komornik dzwoni?;;"].join("\n");
  await page.getByTestId("ads-script-input").setInputFiles({ name: "scenariusze.csv", mimeType: "text/csv", buffer: Buffer.from(csv, "utf-8") });
  await expect(page.getByTestId("ads-reel")).toHaveCount(2);
  await page.getByLabel("Grupa docelowa i usługa").fill("osoby z długami — upadłość konsumencka");
  await page.getByLabel("Grupa docelowa i usługa").blur();
  await expect.poll(async () => (await (await request.get(`/api/admin/ads/${p.id}`)).json()).project.adsBrief).toBe("osoby z długami — upadłość konsumencka");

  await page.getByTestId("ads-review-missing").click();
  await expect(page.getByTestId("ads-score")).toHaveCount(2, { timeout: 60_000 });
  await expect(page.getByTestId("ads-score").first()).toHaveText("54/100 → 78");

  const reels = async () => (await (await request.get(`/api/admin/ads/${p.id}`)).json()).reels as Array<{ id: string; code: string; parts: Array<{ role: string; text: string }> }>;
  const text = (r: { parts: Array<{ role: string; text: string }> }, role: string) => r.parts.find((x) => x.role === role)?.text;

  // the dialog: verdict, criteria, the new version, A/B hooks
  await page.getByTestId("ads-score").first().click();
  const dlg = page.getByTestId("ads-review");
  await expect(dlg).toContainText("Hook ogólny");
  await expect(dlg).toContainText("HOOK 0–2 s");
  await expect(dlg.getByTestId("ads-new-version")).toContainText("Nowe body z propozycji.");
  page.on("dialog", (d) => void d.accept());
  await dlg.getByTestId("ads-apply-hook").first().click();
  await expect.poll(async () => text((await reels()).find((r) => r.code === "P01-h01")!, "hook")).toBe("Alternatywny hook lęk");

  // the whole new version: body + CTA for every hook version of the reel
  await dlg.getByTestId("ads-apply-all").click();
  await expect.poll(async () => (await reels()).map((r) => [text(r, "body"), text(r, "cta")])).toEqual([
    ["Nowe body z propozycji.", "Wyślij to komuś, kto ma komornika."],
    ["Nowe body z propozycji.", "Wyślij to komuś, kto ma komornika."],
  ]);
  const after = await reels();
  expect(text(after.find((r) => r.code === "P01-h01")!, "hook")).toBe("Nowy hook: Masz długi?");
  expect(text(after.find((r) => r.code === "P01-h02")!, "hook")).toBe("Komornik dzwoni?");

  // the updated scripts as CSV (to record again)
  const out = await (await request.get(`/api/admin/ads/${p.id}/script`)).text();
  expect(out).toContain("Nowe body z propozycji.");
  expect(out).toContain("Komornik dzwoni?");
});
