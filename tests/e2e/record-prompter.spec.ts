import { expect, test } from "@playwright/test";
import { adminRequest, newInvitation } from "./helpers";

const HOOK = "Trzy błędy, które kosztują Cię klientów.";
const SCRIPT = `Pierwszy błąd to brak odpowiedzi w ciągu dwudziestu czterech godzin.
Drugi błąd to oferta bez konkretnej ceny i terminu realizacji.
Trzeci błąd to brak follow-upu po spotkaniu z klientem.`;

/**
 * Prompter format: Hook + Treść, expert assigned to the project in settings, teleprompter that follows
 * the voice through Scribe v2 Realtime (mock speech has an ad-lib and skips sentence 2).
 */
test("prompter: script scrolls with the expert's voice, recording is saved", async ({ page, request, browserName }) => {
  test.skip(browserName !== "chromium", "fake media devices are Chromium-only");
  await adminRequest(request);
  const project = await (await request.post("/api/admin/projects", { data: { name: "Growth — rolki", format: "PROMPTER", preset: "pravna" } })).json();
  // the expert is created and added to the project from its settings (no questions needed)
  const add = await request.post(`/api/admin/projects/${project.id}/experts`, { data: { name: "Marek Prompter" } });
  expect(add.ok()).toBeTruthy();
  const expert = (await add.json()).expert;
  const before = await (await request.get(`/api/admin/projects/${project.id}`)).json();
  expect(before.project.format).toBe("PROMPTER");
  expect(before.projectExpertIds).toContain(expert.id);

  const q = await (await request.post(`/api/admin/projects/${project.id}/questions`, { data: { text: HOOK, script: SCRIPT } })).json();
  // the project's only expert gets new scripts automatically (nothing left for "Przypisz bez eksperta")
  expect(q.items[0].expertId).toBe(expert.id);
  const assigned = await (await request.post(`/api/admin/projects/${project.id}/experts/${expert.id}`, { data: { scope: "unassigned" } })).json();
  expect(assigned.assigned).toBe(0);

  const { url, token } = await newInvitation(request, project.id, expert.id);
  const session = await (await request.get(`/api/record/${token}`)).json();
  expect(session.project.format).toBe("PROMPTER");
  expect(session.questions[0]).toMatchObject({ text: HOOK, script: SCRIPT });

  await page.goto(url);
  await expect(page.getByText(/Masz 1 skrypt/)).toBeVisible();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Rozpocznij nagrywanie" }).click();
  await page.getByRole("button", { name: /Gotowe/ }).click();
  await page.getByText(HOOK).click();

  const prompter = page.getByTestId("prompter");
  await expect(prompter).toBeVisible();
  await expect(prompter).toHaveAttribute("data-pos", "0");
  await page.getByRole("button", { name: "Rozpocznij nagrywanie odpowiedzi" }).click();
  // recording waits until ElevenLabs listens (mock starts the session after 1.5 s): no REC yet
  await expect(page.getByTestId("prompter-connecting")).toBeVisible();
  await expect(page.getByText(/^REC /)).toHaveCount(0);
  await expect(page.getByTestId("stt-state")).toHaveText("Słucham", { timeout: 15_000 });
  await expect(page.getByTestId("prompter-connecting")).toHaveCount(0);
  await expect(page.getByText(/REC \d/)).toBeVisible({ timeout: 10_000 });

  // the last word of the mock speech is the last word of the script → position reaches the end
  const total = await prompter.locator("[data-i]").count();
  await expect.poll(async () => Number(await prompter.getAttribute("data-pos")), { timeout: 40_000 }).toBe(total);
  await expect(prompter).toHaveAttribute("data-mode", "voice");

  await page.getByRole("button", { name: "Zatrzymaj" }).click();
  await expect(page.getByText("Nagranie bezpiecznie zapisane")).toBeVisible({ timeout: 60_000 });

  // manual skip: tap a word in the next take → position jumps there
  await page.getByRole("button", { name: "Nagraj ponownie" }).click();
  await prompter.locator("[data-i]", { hasText: "Trzeci" }).click();
  const idx = Number(await prompter.locator("[data-i]", { hasText: "Trzeci" }).getAttribute("data-i"));
  await expect(prompter).toHaveAttribute("data-pos", String(idx));

  // the composition uses the hook as the title and has no narration
  for (let i = 0; i < 90; i++) {
    const d = await (await request.get(`/api/admin/projects/${project.id}`)).json();
    const take = d.questions.find((x: { id: string }) => x.id === q.items[0].id).takes[0];
    if (take?.status === "FAILED") throw new Error("take failed");
    if (take?.compositionId) {
      const comp = await (await request.get(`/api/admin/compositions/${take.compositionId}`)).json();
      const doc = comp.composition.document;
      expect(doc.narration).toHaveLength(0);
      expect(doc.overlays.find((o: { role?: string }) => o.role === "question").text).toBe(HOOK);
      expect(doc.clips[0].start).toBe(0);
      return;
    }
    await page.waitForTimeout(2000);
  }
  throw new Error("composition was not created");
});

/**
 * Hybrid project: the narrator reads the client's question, then the expert answers from the
 * prompter; the video gets the narration, the question as its title and the CTA end card.
 */
test("hybrid: question read by the narrator, answer from the prompter, CTA end card", async ({ page, request, browserName }) => {
  test.skip(browserName !== "chromium", "fake media devices are Chromium-only");
  await adminRequest(request);
  const QUESTION = "Jak klient może szybciej dostać odpowiedź?";
  // what the narrator reads differs from the title on the video
  const SPOKEN = "Dzień dobry, moi klienci czekają na odpowiedź kilka dni. Jak to przyspieszyć?";
  const project = await (await request.post("/api/admin/projects", { data: { name: "Hybryda — rolki", format: "HYBRID", preset: "pravna" } })).json();
  const cta = await request.patch(`/api/admin/projects/${project.id}`, { data: { ctaEnabled: true, ctaUrl: "kancelaria.pl", ctaText: "Umów konsultację", ctaSeconds: 3 } });
  expect(cta.ok()).toBeTruthy();
  const expert = (await (await request.post(`/api/admin/projects/${project.id}/experts`, { data: { name: "Ewa Hybryda" } })).json()).expert;
  const q = await (
    await request.post(`/api/admin/projects/${project.id}/questions`, {
      data: { items: [{ kind: "QUESTION_PROMPTER", text: QUESTION, spokenText: SPOKEN, script: SCRIPT }, { kind: "PROMPTER", text: HOOK, script: SCRIPT }, { kind: "QUESTION", text: "Czy to pytanie ma lektora?" }] },
    })
  ).json();
  const { url, token } = await newInvitation(request, project.id, expert.id);
  const session = await (await request.get(`/api/record/${token}`)).json();
  expect(session.questions.map((x: { kind: string }) => x.kind)).toEqual(["QUESTION_PROMPTER", "PROMPTER", "QUESTION"]);

  await page.goto(url);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Rozpocznij nagrywanie" }).click();
  await page.getByRole("button", { name: /Gotowe/ }).click();
  await page.getByText(QUESTION).click();
  await expect(page.getByTestId("qp-question")).toHaveText(QUESTION);
  const prompter = page.getByTestId("prompter");
  await expect(prompter).toBeVisible();
  await page.getByRole("button", { name: "Rozpocznij nagrywanie odpowiedzi" }).click();
  // the narrator reads the question first, then the prompter connects and the recording starts
  await expect(page.getByText("Lektor czyta pytanie…")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("stt-state")).toHaveText("Słucham", { timeout: 30_000 });
  await expect(page.getByText(/REC \d/)).toBeVisible({ timeout: 10_000 });
  const total = await prompter.locator("[data-i]").count();
  await expect.poll(async () => Number(await prompter.getAttribute("data-pos")), { timeout: 40_000 }).toBe(total);
  await page.getByRole("button", { name: "Zatrzymaj" }).click();
  await expect(page.getByText("Nagranie bezpiecznie zapisane")).toBeVisible({ timeout: 60_000 });

  for (let i = 0; i < 90; i++) {
    const d = await (await request.get(`/api/admin/projects/${project.id}`)).json();
    const take = d.questions.find((x: { id: string }) => x.id === q.items[0].id).takes[0];
    if (take?.status === "FAILED") throw new Error("take failed");
    if (take?.compositionId) {
      const comp = await (await request.get(`/api/admin/compositions/${take.compositionId}`)).json();
      const doc = comp.composition.document;
      expect(doc.narration).toHaveLength(1); // the narrator's question is in the video
      // the expert is on camera while the narrator reads (muted), then the answer follows without a gap
      expect(doc.meta.mode).toBe("CONTINUOUS");
      expect(doc.clips[0]).toMatchObject({ start: 0, muted: true, label: "Słuchanie pytania" });
      expect(doc.clips[1].start).toBeCloseTo(doc.clips[0].sourceOut, 2);
      expect(doc.clips[1].sourceIn).toBeGreaterThanOrEqual(doc.clips[0].sourceOut);
      expect(doc.narration[0].start).toBeLessThan(1);
      expect(doc.overlays.find((o: { role?: string }) => o.role === "question").text).toBe(QUESTION);
      const stats = await (await request.get("http://127.0.0.1:4010/__stats", { headers: { "xi-api-key": "mock-key" } })).json();
      expect(JSON.stringify(stats.tts)).toContain("moi klienci czekają na odpowiedź kilka dni");
      expect(doc.endCard).toMatchObject({ url: "kancelaria.pl", text: "Umów konsultację", seconds: 3 });
      // a slow narrator × 1.15: re-timed file (pitch kept), shorter by the same factor
      const nAsset = comp.assets.find((x: { id: string }) => x.id === doc.narration[0].assetId);
      const fast = await (await request.post(`/api/admin/compositions/${take.compositionId}/narration-speed`, { data: { baseAssetId: nAsset.id, speed: 1.15 } })).json();
      expect(fast.id).not.toBe(nAsset.id);
      expect(fast.durationSec).toBeGreaterThan(nAsset.durationSec / 1.15 - 0.2);
      expect(fast.durationSec).toBeLessThan(nAsset.durationSec / 1.15 + 0.2);
      return;
    }
    await page.waitForTimeout(2000);
  }
  throw new Error("composition was not created");
});
