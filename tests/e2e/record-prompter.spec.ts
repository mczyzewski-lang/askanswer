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
  await expect(page.getByTestId("stt-state")).toHaveText("Słucham", { timeout: 15_000 });

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
