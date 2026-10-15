import { expect, test } from "@playwright/test";
import { login } from "./helpers";

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
