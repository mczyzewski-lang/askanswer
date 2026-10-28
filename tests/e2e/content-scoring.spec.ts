import { expect, test } from "@playwright/test";
import { adminRequest, login } from "./helpers";

/**
 * Scoring of the prompter scripts in a regular project, before recording: only items read from the
 * prompter get a score; the new version swaps the hook (title / narrator's question) and the script.
 */
test("content scoring: prompter scripts are scored and the new version swapped in", async ({ page, request }) => {
  test.setTimeout(180_000);
  await adminRequest(request);
  const project = await (await request.post("/api/admin/projects", { data: { name: "Hybryda — scoring", format: "HYBRID", preset: "pravna" } })).json();
  const add = (data: Record<string, unknown>) => request.post(`/api/admin/projects/${project.id}/questions`, { data });
  await add({ text: "Masz długi i komornika?", kind: "PROMPTER", script: "Stary skrypt eksperta." });
  await add({ text: "Czy mogę ogłosić upadłość?", kind: "QUESTION_PROMPTER", spokenText: "Mam długi po firmie, czy mogę ogłosić upadłość?", script: "Stara odpowiedź eksperta." });
  await add({ text: "Pytanie bez promptera", kind: "QUESTION" });

  await login(page);
  await page.goto(`/admin/projects/${project.id}`);
  const bar = page.getByTestId("content-scoring");
  await expect(bar).toBeVisible();
  // the free answer (narrator only) is not scored
  await expect(page.getByTestId("content-score-one")).toHaveCount(2);
  await bar.getByTestId("content-review-missing").click();
  await expect(page.getByTestId("content-score")).toHaveCount(2, { timeout: 60_000 });
  await expect(page.getByTestId("content-score").first()).toHaveText("54/100 → 78");

  const items = async () => (await (await request.get(`/api/admin/projects/${project.id}`)).json()).questions as Array<{ id: string; text: string; spokenText: string | null; script: string | null; reviewedAt: string | null }>;
  page.on("dialog", (d) => void d.accept());

  // PROMPTER: the hook is the title, body + CTA the script
  await page.getByTestId("content-score").first().click();
  await expect(page.getByTestId("ads-review")).toContainText("Hook ogólny");
  await page.getByTestId("ads-apply-all").click();
  await expect.poll(async () => (await items()).find((q) => q.text.startsWith("Nowy hook"))?.script).toBe("Nowe body z propozycji.\n\nWyślij to komuś, kto ma komornika.");
  await page.keyboard.press("Escape");

  // QUESTION_PROMPTER: an alternative hook goes to what the narrator reads, the title stays
  await page.getByTestId("content-score").nth(1).click();
  await page.getByTestId("ads-apply-hook").nth(1).click();
  await expect.poll(async () => (await items()).find((q) => q.text === "Czy mogę ogłosić upadłość?")?.spokenText).toBe("Alternatywny hook liczba");
  await page.keyboard.press("Escape");

  // editing the script afterwards: the old score no longer applies
  const q = (await items()).find((x) => x.text === "Czy mogę ogłosić upadłość?")!;
  await request.patch(`/api/admin/questions/${q.id}`, { data: { script: "Zupełnie nowa odpowiedź." } });
  expect((await items()).find((x) => x.id === q.id)!.reviewedAt).toBeNull();
});
