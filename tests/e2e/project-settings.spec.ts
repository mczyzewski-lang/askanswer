import { expect, test } from "@playwright/test";
import { adminRequest, login } from "./helpers";

/** Projekt → Ustawienia: theme, people (with experts), narrator voice, general — from the menu under the project. */
test("project settings: theme, people and voices under the project", async ({ page, request }) => {
  test.setTimeout(180_000);
  await adminRequest(request);
  const p = (await (await request.post("/api/admin/projects", { data: { name: "Projekt ustawień", preset: "pravna" } })).json()).id as string;
  await login(page);
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto(`/admin/projects/${p}`);
  const group = page.getByTestId("nav-project-settings");
  await expect(group).toContainText("Motyw projektu");
  await expect(group).toContainText("Osoby i eksperci");
  await expect(group).toContainText("Głosy (lektor)");

  await group.getByRole("link", { name: "Motyw projektu" }).click();
  await expect(page.getByTestId("project-settings")).toBeVisible();
  await expect(page.getByText("Kolor główny")).toBeVisible();
  // only this project's theme — no list of the other projects' themes, no categories it does not use
  await expect(page.getByTestId("theme-list")).toHaveCount(0);
  await expect(page.getByText(/Kategorie projektu/)).toHaveCount(0);

  await group.getByRole("link", { name: "Osoby i eksperci" }).click();
  const people = page.getByTestId("project-people");
  await people.getByLabel("E-mail nowej osoby").fill("ekspertka@firma.pl");
  await people.getByLabel("Rola nowej osoby").selectOption("EXPERT");
  await people.getByTestId("project-person-add").click();
  await expect(people.getByTestId("project-person")).toContainText("ekspertka@firma.pl");
  await expect(people.getByTestId("project-person")).toContainText("Ekspert");
  // the experts who record for the project are on the same page
  await expect(page.getByText("Eksperci projektu").first()).toBeVisible();
  // the new person can open this project only
  const users = (await (await request.get("/api/admin/users")).json()).users as Array<{ email: string; projectIds: string[] }>;
  expect(users.find((u) => u.email === "ekspertka@firma.pl")!.projectIds).toEqual([p]);

  await group.getByRole("link", { name: "Głosy (lektor)" }).click();
  await expect(page.getByText("Lektor ElevenLabs")).toBeVisible();
  await expect(page.getByText("Format projektu")).toHaveCount(0);
});

test("themes: one per project, the unused ones (after deleted projects) folded and removable", async ({ page, request }) => {
  await adminRequest(request);
  const gone = (await (await request.post("/api/admin/projects", { data: { name: "Projekt do usunięcia", preset: "pravna" } })).json()).id as string;
  expect((await request.delete(`/api/admin/projects/${gone}`)).ok()).toBeTruthy();
  // a new project starts with one neutral category, not a list of legal ones
  const fresh = (await (await request.post("/api/admin/projects", { data: { name: "Nowy czysty", preset: "pravna" } })).json()).id as string;
  const cats = (await (await request.get(`/api/admin/projects/${fresh}`)).json()).categories as Array<{ name: string }>;
  expect(cats.map((c) => c.name)).toEqual(["Ogólne"]);

  await login(page);
  await page.goto("/admin/themes");
  await expect(page.getByTestId("theme-list")).not.toContainText("nieużywany");
  await expect(page.getByTestId("unused-themes")).toContainText("Pokaż nieużywane");
  page.once("dialog", (d) => void d.accept());
  await page.getByTestId("delete-unused-themes").click();
  await expect(page.getByText(/Usunięto \d+ nieużywanych motywów/)).toBeVisible();
  await expect(page.getByTestId("unused-themes")).toHaveCount(0);
  const themes = (await (await request.get("/api/admin/themes")).json()) as Array<{ name: string }>;
  expect(themes.some((t) => t.name.includes("Projekt do usunięcia"))).toBe(false);
});
