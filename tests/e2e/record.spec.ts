import { expect, test } from "@playwright/test";
import { adminRequest, demoProject, login, newInvitation, waitForTakes } from "./helpers";

/**
 * Tests 2–7: invitation scoping, real camera recording (Chromium fake media device fed with a
 * generated TEST FIXTURE), ElevenLabs narration as a separate asset (mock API), pause/resume,
 * retakes and transcription with word timestamps.
 */
test("expert records answers on a phone via the invitation link", async ({ page, request, browser, browserName }) => {
  test.skip(browserName !== "chromium", "fake media devices are Chromium-only");
  await adminRequest(request);
  const data = await demoProject(request);
  const anna = data.experts.find((e) => e.name === "Anna Kowalska")!;

  // another expert's question in the same project must not be visible (Test 2)
  const jan = await (await request.post("/api/admin/experts", { data: { name: "Jan Nowak" } })).json();
  await request.post(`/api/admin/projects/${data.project.id}/questions`, { data: { text: "Pytanie przypisane innemu ekspertowi", expertId: jan.id } });
  const fresh = await demoProject(request);
  const foreign = fresh.questions.find((q) => q.text === "Pytanie przypisane innemu ekspertowi")!;

  const { url, token } = await newInvitation(request, data.project.id, anna.id);
  const annaQuestions = fresh.questions.filter((q) => q.expertId === anna.id);

  const session = await (await request.get(`/api/record/${token}`)).json();
  expect(session.questions.map((q: { id: string }) => q.id).sort()).toEqual(annaQuestions.map((q) => q.id).sort());
  const forbidden = await request.post(`/api/record/${token}/narration`, { data: { questionId: foreign.id } });
  expect(forbidden.status()).toBe(403);
  const bad = await request.get(`/api/record/invalidtoken0000000000000000000`);
  expect(bad.status()).toBe(404);

  // the admin keeps the project open on a desktop — it must update live, without a reload
  const adminCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false });
  const admin = await adminCtx.newPage();
  await login(admin);
  await admin.goto(`/admin/projects/${data.project.id}`);
  const greenTakes = admin.locator("[data-testid=takes-toggle].bg-emerald-50");
  await expect(admin.getByTestId("takes-toggle").first()).toBeVisible();
  await expect(greenTakes).toHaveCount(0);

  await page.goto(url);
  await expect(page.getByText(/Masz \d+ pyta/)).toBeVisible();
  await expect(page.getByText("Pytanie przypisane innemu ekspertowi")).toHaveCount(0);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Rozpocznij nagrywanie" }).click();
  await expect(page.getByText("Przygotuj kamerę")).toBeVisible();
  // live camera preview is playing
  await expect.poll(async () => page.evaluate(() => (document.querySelector("video") as HTMLVideoElement | null)?.videoWidth ?? 0)).toBeGreaterThan(0);
  await page.getByRole("button", { name: /Gotowe/ }).click();

  const q1 = annaQuestions[0];
  await page.getByText(q1.text).click();
  const start = page.getByRole("button", { name: "Rozpocznij nagrywanie odpowiedzi" });
  await expect(start).toBeEnabled({ timeout: 30_000 });
  await start.click();
  // Mode A: camera rolls, ElevenLabs narration plays from its own asset, then the answer cue
  await expect(page.getByText("Lektor czyta pytanie…")).toBeVisible();
  await expect(page.getByText("Twoja kolej — odpowiedz")).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(2000);
  // Test 5: pause / resume keeps the beginning
  await page.getByRole("button", { name: "Pauza" }).click();
  await expect(page.getByText(/PAUZA/)).toBeVisible();
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: "Wznów" }).click();
  await page.waitForTimeout(2500);
  await page.getByRole("button", { name: "Zatrzymaj" }).click();
  await expect(page.getByText("Nagranie bezpiecznie zapisane")).toBeVisible({ timeout: 60_000 });

  // live admin update: mini-notification + pastel-green recordings button, no page reload
  await expect(admin.getByTestId("upload-notification")).toContainText("Nowe nagranie", { timeout: 20_000 });
  await expect(admin.getByTestId("upload-notification")).toContainText(q1.text.slice(0, 20));
  await expect(greenTakes).toHaveCount(1, { timeout: 20_000 });
  await adminCtx.close();

  // Test 6: second take of the same answer
  await page.getByRole("button", { name: "Nagraj ponownie" }).click();
  await expect(start).toBeEnabled();
  await start.click();
  await expect(page.getByText("Twoja kolej — odpowiedz")).toBeVisible({ timeout: 15_000 });
  // > the longest pause in the fake microphone signal (2 s), so the answer always contains speech
  await page.waitForTimeout(5000);
  await page.getByRole("button", { name: "Zatrzymaj" }).click();
  await expect(page.getByText("Nagranie bezpiecznie zapisane")).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "Zakończ nagrywanie" }).click();
  await expect(page.getByText("Dziękujemy! Twoje odpowiedzi zostały nagrane.")).toBeVisible();

  // processing pipeline: both takes processed and kept
  const takes = await waitForTakes(request, q1.id, 2);
  expect(takes).toHaveLength(2);
  const first = await (await request.get(`/api/admin/takes/${takes[takes.length - 1].id}`)).json();
  const second = await (await request.get(`/api/admin/takes/${takes[0].id}`)).json();
  for (const t of [first, second]) {
    expect(t.mode).toBe("CONTINUOUS");
    // narration stored as its own asset, not recorded through the microphone
    expect(t.assets.some((a: { kind: string }) => a.kind === "NARRATION")).toBeTruthy();
    expect(t.markers.narrationEnd).toBeGreaterThan(0.5);
    const original = t.assets.find((a: { kind: string }) => a.kind === "RECORDING_ORIGINAL");
    const normalized = t.assets.find((a: { kind: string }) => a.kind === "RECORDING_NORMALIZED");
    expect(original.sizeBytes).toBeGreaterThan(10_000);
    expect(normalized.hasAudio).toBeTruthy();
    // Test 7: transcribed with word timestamps
    expect(t.transcriptWords).toBeGreaterThan(0);
    expect(t.compositionIds.length).toBe(1);
  }
  // Test 5: recorded duration covers the time before and after the pause (pause excluded)
  expect(first.durationSec).toBeGreaterThan(5);
  expect(first.durationSec).toBeLessThan(first.markers.narrationEnd + 2 + 2.5 + 3);

  // films in editing / approved: the expert can watch them from the list
  const pr = await request.patch(`/api/admin/questions/${q1.id}`, { data: { status: "IN_PROGRESS" } });
  expect(pr.ok()).toBeTruthy();
  await page.reload();
  const vids = page.getByTestId("expert-videos");
  await expect(vids).toBeVisible({ timeout: 20_000 });
  await expect(vids.getByTestId("expert-video").first()).toContainText("W trakcie montażu");
  await vids.getByTestId("expert-video").first().click();
  const player = page.getByTestId("expert-video-player");
  await expect(player.locator("video")).toHaveAttribute("src", /.+/);
  await player.getByRole("button", { name: "Zamknij film" }).click();
  await expect(player).toBeHidden();
});

