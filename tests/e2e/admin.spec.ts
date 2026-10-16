import { expect, test } from "@playwright/test";
import { adminRequest, demoProject, login, newInvitation } from "./helpers";

test("Test 1 — admin creates a category and a question that persist after refresh", async ({ page }) => {
  await login(page);
  await page.getByText("Pravna — Znaki Towarowe").click();
  await expect(page.getByRole("tab", { name: "Pytania i nagrania" })).toBeVisible();
  await page.getByLabel("Nowa kategoria").fill("Prawo pracy");
  await page.getByRole("button", { name: "Dodaj", exact: true }).click();
  await expect(page.getByText("Dodano kategorię")).toBeVisible();

  await page.getByRole("button", { name: "Dodaj pytanie" }).click();
  await page.getByLabel("Treść pytania").fill("Czy pracodawca może zakazać konkurencji po rozwiązaniu umowy?");
  await page.getByLabel("Kategoria", { exact: true }).selectOption({ label: "Prawo pracy" });
  await page.getByRole("button", { name: "Dodaj pytanie", exact: true }).last().click();
  await expect(page.getByText("Dodano pytanie")).toBeVisible();

  await page.reload();
  await expect(page.getByText("Czy pracodawca może zakazać konkurencji po rozwiązaniu umowy?")).toBeVisible();
  const row = page.locator("div").filter({ hasText: /^Czy pracodawca może zakazać konkurencji/ }).first();
  await expect(row).toBeVisible();
  await expect(page.locator("span", { hasText: "Prawo pracy" }).first()).toBeVisible();

  // invitation link with "Kopiuj link"
  await page.getByRole("tab", { name: "Eksperci i linki" }).click();
  await expect(page.getByRole("button", { name: "Kopiuj link" }).first()).toBeVisible();
});

test("bulk paste adds several questions", async ({ page }) => {
  await login(page);
  await page.getByText("Pravna — Znaki Towarowe").click();
  await page.getByRole("button", { name: "Wklej wiele" }).click();
  await page.getByRole("textbox", { name: "Pytania" }).fill("1. Czym jest znak słowno-graficzny?\n2. Czy logo musi być w kolorze?");
  await page.getByRole("button", { name: /Dodaj 2/ }).click();
  await expect(page.getByText("Dodano 2 pytania")).toBeVisible();
  await expect(page.getByText("Czym jest znak słowno-graficzny?")).toBeVisible();
});

test("theme settings: AI scene style per category with theme colours", async ({ page }) => {
  await login(page);
  await page.goto("/admin/themes");
  const card = page.getByTestId("ai-style-card");
  await expect(card).toBeVisible();
  const row = card.getByTestId("category-style").first();
  await row.getByRole("button", { name: "Wstaw styl tuszu" }).click();
  await row.getByRole("button", { name: "Zapisz" }).click();
  await expect(page.getByText(/Zapisano styl kategorii/)).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("category-style").first().getByRole("textbox")).toHaveValue(/Hand-drawn editorial ink animation/);
  // the theme default shows the style with this theme's colours filled in
  await card.getByRole("button", { name: "Rysunek tuszem (editorial)" }).click();
  await expect(card.locator("p", { hasText: "Po podstawieniu kolorów" })).toContainText(/deep \w+/);
});

test("expert's daily list mixes categories evenly", async ({ request }) => {
  await adminRequest(request);
  const data = await demoProject(request);
  const pid = data.project.id;
  const expert = await (await request.post("/api/admin/experts", { data: { name: "Ekspert Dzienny" } })).json();
  const items = ["Alfa", "Beta", "Gamma"].flatMap((cat) => [1, 2, 3, 4].map((i) => ({ text: `${cat} pytanie numer ${i}?`, categoryName: `Dzienna ${cat}`, expertId: expert.id })));
  expect((await request.post(`/api/admin/projects/${pid}/questions`, { data: { items } })).ok()).toBeTruthy();
  const before = await (await request.get(`/api/admin/projects/${pid}`)).json();
  const limit = before.project.dailyQuestionLimit;
  await request.patch(`/api/admin/projects/${pid}`, { data: { name: before.project.name, dailyQuestionLimit: 4 } });
  try {
    const { token } = await newInvitation(request, pid, expert.id);
    const session = await (await request.get(`/api/record/${token}`)).json();
    expect(session.dailyPlan).toMatchObject({ limit: 4, pendingTotal: 12 });
    const cats = session.questions.map((q: { category: string }) => q.category);
    expect(cats).toHaveLength(4);
    expect(new Set(cats).size).toBe(3); // every category on today's list
    for (let i = 1; i < cats.length; i++) expect(cats[i]).not.toBe(cats[i - 1]);
  } finally {
    await request.patch(`/api/admin/projects/${pid}`, { data: { name: before.project.name, dailyQuestionLimit: limit } });
  }
});
