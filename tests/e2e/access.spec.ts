import { expect, test, type Browser } from "@playwright/test";
import { adminRequest, login } from "./helpers";

const MOCK = "http://127.0.0.1:4010";

/** "Zaloguj przez Google" in a fresh browser as the given Google account (the mock answers at once). */
async function googleSignIn(browser: Browser, email: string) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  await page.request.post(`${MOCK}/google/next`, { data: { email, name: email.split("@")[0] } });
  await page.goto("/login");
  await page.getByTestId("google-login").click();
  await page.waitForLoadState("networkidle");
  return { ctx, page };
}

test("Google sign-in, roles and per-project access", async ({ browser, page, request }) => {
  test.setTimeout(240_000);
  await adminRequest(request);
  const mk = async (name: string) => (await (await request.post("/api/admin/projects", { data: { name, preset: "pravna" } })).json()).id as string;
  const a = await mk("Dostęp A");
  const b = await mk("Dostęp B");

  // the owner's Google account becomes an administrator at the first sign-in
  const owner = await googleSignIn(browser, "mczyzewski@epravna.pl");
  await expect(owner.page).toHaveURL(/\/admin$/);
  await expect(owner.page.getByTestId("my-role")).toHaveText("Administrator");
  await owner.page.goto("/admin/users");
  await expect(owner.page.getByTestId("user-row").filter({ hasText: "mczyzewski@epravna.pl" })).toContainText("Google");

  // an unknown Google account does not get in
  const stranger = await googleSignIn(browser, "obcy@gmail.com");
  await expect(stranger.page).toHaveURL(/\/login\?error=no_account/);
  await expect(stranger.page.getByTestId("login-error")).toContainText("Poproś administratora");
  await stranger.ctx.close();

  // the admin adds a viewer with access to project A only (in the Users page)
  await owner.page.getByLabel("E-mail (konto Google)").fill("widz@firma.pl");
  await owner.page.getByLabel("Rola", { exact: true }).selectOption("VIEWER");
  await owner.page.getByTestId("project-picker").getByLabel("Szukaj projektu").fill("Dostęp A");
  await owner.page.getByTestId("project-picker").getByRole("checkbox").first().check();
  await owner.page.getByTestId("user-add").click();
  await expect(owner.page.getByTestId("user-row").filter({ hasText: "widz@firma.pl" })).toContainText("1 projekt");

  const viewer = await googleSignIn(browser, "widz@firma.pl");
  await expect(viewer.page).toHaveURL(/\/admin$/);
  await expect(viewer.page.getByTestId("my-role")).toHaveText("Przeglądający");
  // only their project, in the list and in the project picker
  await expect(viewer.page.getByText("Dostęp A").first()).toBeVisible();
  await expect(viewer.page.getByText("Dostęp B")).toHaveCount(0);
  await viewer.page.getByTestId("project-switcher").first().click();
  const menu = viewer.page.getByTestId("project-switcher-menu");
  await expect(menu).toContainText("Dostęp A");
  await expect(menu).not.toContainText("Dostęp B");
  await menu.getByRole("button", { name: "Dostęp A" }).click();
  await expect(viewer.page).toHaveURL(new RegExp(`/admin/projects/${a}`));
  await expect(viewer.page.getByTestId("nav-project")).toContainText("Przegląd");
  // no global tools / settings for a viewer
  await expect(viewer.page.getByTestId("nav-settings")).toHaveCount(0);
  await expect(viewer.page.getByTestId("nav-tools")).not.toContainText("EduStudio");
  // the other project: neither its page nor its API
  await viewer.page.goto(`/admin/projects/${b}`);
  await expect(viewer.page.getByTestId("access-denied")).toBeVisible();
  expect((await viewer.page.request.get(`/api/admin/projects/${b}`)).status()).toBe(403);
  expect((await viewer.page.request.get(`/api/admin/projects/${a}`)).status()).toBe(200);
  // looking only: no changes, no users page, no EduStudio
  const edit = await viewer.page.request.patch(`/api/admin/projects/${a}`, { data: { name: "Zmienione" } });
  expect(edit.status()).toBe(403);
  expect((await edit.json()).error).toContain("podglądu");
  expect((await viewer.page.request.get("/api/admin/users")).status()).toBe(403);
  expect((await viewer.page.request.get("/api/admin/edu")).status()).toBe(403);
  const list = (await (await viewer.page.request.get("/api/admin/projects")).json()) as Array<{ id: string }>;
  expect(list.map((p) => p.id)).toEqual([a]);

  // the admin makes them an editor of B too → they can edit B
  const users = (await (await owner.page.request.get("/api/admin/users")).json()).users as Array<{ id: string; email: string }>;
  const vid = users.find((u) => u.email === "widz@firma.pl")!.id;
  expect((await owner.page.request.patch(`/api/admin/users/${vid}`, { data: { role: "EDITOR", projectIds: [a, b] } })).ok()).toBeTruthy();
  expect((await viewer.page.request.patch(`/api/admin/projects/${b}`, { data: { name: "Dostęp B2" } })).ok()).toBeTruthy();
  // the admin cannot demote themselves
  const me = users.find((u) => u.email === "mczyzewski@epravna.pl")!.id;
  expect((await owner.page.request.patch(`/api/admin/users/${me}`, { data: { role: "VIEWER" } })).status()).toBe(400);
  await viewer.ctx.close();
  await owner.ctx.close();

  // the password sign-in still works (the seeded admin)
  await login(page);
  await expect(page.getByTestId("admin-sidebar").getByTestId("nav-settings")).toContainText("Użytkownicy");
});
