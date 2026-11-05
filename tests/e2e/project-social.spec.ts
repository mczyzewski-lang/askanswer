import { expect, test } from "@playwright/test";
import { execSync } from "node:child_process";
import { adminRequest, login } from "./helpers";

const sql = (q: string) => execSync(`psql "${process.env.DATABASE_URL!.replace("?schema=public", "")}" -At -c ${JSON.stringify(q)}`).toString().trim();

/** A project shows the schedule of its Social Media Studio project; the global schedule shows them all. */
test("social schedule under the project and globally", async ({ page, request }) => {
  test.setTimeout(180_000);
  await adminRequest(request);
  const project = (await (await request.post("/api/admin/projects", { data: { name: "Projekt z harmonogramem", preset: "pravna" } })).json()).id as string;
  const org = (await (await request.post("/api/social/orgs", { data: { name: "Klient Harmonogram" } })).json()).id as string;
  const sp = (await (await request.post(`/api/social/orgs/${org}/projects`, { data: { name: "Kanały klienta" } })).json()).id as string;
  // one planned publication (tomorrow at 18:00 UTC) and one from the past week
  const t = new Date(Date.now() + 86400e3).toISOString().slice(0, 10);
  sql(`INSERT INTO "ProviderProfile" (id, "projectId", username, "updatedAt") VALUES ('pp_h', '${sp}', 'project_h', now());
       INSERT INTO "SocialAccount" (id, "projectId", "providerProfileId", platform, "displayName", "updatedAt") VALUES ('sa_h', '${sp}', 'pp_h', 'INSTAGRAM', 'Konto IG', now());
       INSERT INTO "SocialMedia" (id, "projectId", "storageKey", title, "updatedAt") VALUES ('sm_h', '${sp}', 'x/h.mp4', 'Film', now());
       INSERT INTO "ContentItem" (id, "projectId", "mediaId", title, "updatedAt") VALUES ('ci_h', '${sp}', 'sm_h', 'Czy komornik zabierze pensję?', now()), ('ci_h2', '${sp}', 'sm_h', 'Opublikowany wczoraj', now());
       INSERT INTO "PlatformPost" (id, "contentItemId", "projectId", "socialAccountId", platform, status, "scheduledAt", "updatedAt") VALUES ('pt_h', 'ci_h', '${sp}', 'sa_h', 'INSTAGRAM', 'SCHEDULED', '${t}T18:00:00Z', now());
       INSERT INTO "PlatformPost" (id, "contentItemId", "projectId", "socialAccountId", platform, status, "publishedAt", "updatedAt") VALUES ('pt_h2', 'ci_h2', '${sp}', 'sa_h', 'INSTAGRAM', 'PUBLISHED', now() - interval '1 day', now());`);

  await login(page);
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto(`/admin/projects/${project}`);
  await page.getByTestId("nav-project").getByRole("link", { name: "Harmonogram social" }).click();
  await expect(page.getByTestId("project-social")).toBeVisible();
  await expect(page.getByText("nie połączono")).toBeVisible();
  await page.getByTestId("social-link").selectOption(sp);
  await expect(page.getByTestId("social-post")).toHaveCount(2);
  await expect(page.getByText("Zaplanowane (1)")).toBeVisible();
  await expect(page.getByTestId("social-post").first()).toContainText("Czy komornik zabierze pensję?");
  await expect(page.getByTestId("social-post").first()).toContainText("Zaplanowane");
  await expect(page.getByText("Ostatnie 7 dni")).toBeVisible();
  // the project's calendar in Social Media Studio
  await expect(page.getByTestId("open-project-calendar")).toHaveAttribute("href", `/social/calendar?project=${sp}`);
  // the global schedule: every project
  await page.goto(`/admin`);
  await page.getByTestId("nav-tools").getByRole("link", { name: "Harmonogram social" }).click();
  await expect(page).toHaveURL(/\/social\/calendar\?project=all/);
  const all = await (await request.get("/api/social/calendar")).json();
  expect(all.posts.some((p: { id: string }) => p.id === "pt_h")).toBe(true);
});
