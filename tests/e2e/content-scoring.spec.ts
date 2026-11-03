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
  // what is there now, next to what the swap puts in
  await expect(page.getByTestId("compare-before-hook")).toContainText("Masz długi i komornika?");
  await expect(page.getByTestId("compare-before-rest")).toContainText("Stary skrypt eksperta.");
  await expect(page.getByTestId("compare-after-rest")).toContainText("Nowe body z propozycji.");
  await page.getByTestId("review-compare").screenshot({ path: test.info().outputPath("compare.png") });
  if (process.env.COMPARE_SHOT) await page.getByRole("dialog").screenshot({ path: process.env.COMPARE_SHOT });
  await page.getByTestId("ads-apply-all").click();
  await expect.poll(async () => (await items()).find((q) => q.text.startsWith("Nowy hook"))?.script).toBe("Nowe body z propozycji.\n\nWyślij to komuś, kto ma komornika.");
  await page.keyboard.press("Escape");
  // the list shows it was swapped in, and "score unscored" now includes it (the new text has no score yet)
  const first = page.getByTestId("content-score").first();
  await expect(first).toHaveText("✓ Podmieniono treść · było 54");
  await expect(first).toHaveAttribute("data-state", "applied");
  await expect(page.getByTestId("scoring-counts")).toContainText("podmienione 1 (do ponownej oceny)");
  await expect(page.getByTestId("content-review-missing")).toHaveText(/Oceń nieocenione do nagrania \(1\)/);
  await page.getByTestId("content-score-again").first().click();
  await expect(first).toHaveAttribute("data-state", "rescored", { timeout: 60_000 });
  await expect(first).toContainText("· było 54");
  await expect(page.getByTestId("scoring-counts")).toContainText("ocenione po podmianie 1");
  if (process.env.LIST_SHOT) await page.screenshot({ path: process.env.LIST_SHOT, fullPage: true });

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

test("content scoring: the CTA points to a lead magnet from the project's list", async ({ page, request }) => {
  test.setTimeout(120_000);
  await adminRequest(request);
  const project = await (await request.post("/api/admin/projects", { data: { name: "DUO — lead magnety", format: "PROMPTER", preset: "duo-terapia" } })).json();
  await request.post(`/api/admin/projects/${project.id}/questions`, { data: { text: "Ciągle się kłócimy o głupoty", script: "Każda kłótnia wygląda tak samo." } });

  await login(page);
  await page.goto(`/admin/projects/${project.id}`);
  const lm = page.getByTestId("lead-magnets");
  await lm.getByRole("button", { name: /Wczytaj: DUO Terapia/ }).click();
  await expect(page.getByText("Zapisano lead magnety (10)")).toBeVisible();
  const saved = (await (await request.get(`/api/admin/projects/${project.id}`)).json()).project.leadMagnets;
  expect(saved).toHaveLength(10);

  await page.getByTestId("content-review-missing").click();
  await expect(page.getByTestId("content-score")).toHaveCount(1, { timeout: 60_000 });
  // the scoring prompt carries the list; the model's choice is shown with its DM keyword
  const stats = await (await request.get("http://127.0.0.1:4010/__stats", { headers: { "xi-api-key": "mock-key" } })).json();
  const prompt = (stats.openai as Array<{ prompt: string }>).map((c) => c.prompt).reverse().find((p) => p.includes("Ciągle się kłócimy"))!;
  expect(prompt).toContain("- PLAN | Trudna rozmowa bez kłótni |");
  await page.getByTestId("content-score").click();
  await expect(page.getByTestId("review-lead-magnet")).toContainText("Trudna rozmowa bez kłótni");
  await expect(page.getByTestId("review-lead-magnet")).toContainText("PLAN");
  await expect(page.getByTestId("compare-after-rest")).toContainText("Napisz PLAN w komentarzu albo w wiadomości");
});
