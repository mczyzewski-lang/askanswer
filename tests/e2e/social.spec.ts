import crypto from "node:crypto";
import fs from "node:fs";
import { execSync } from "node:child_process";
import { expect, request as pwRequest, test, type APIRequestContext, type Page } from "@playwright/test";
import { adminRequest } from "./helpers";

/**
 * Social Media Studio — the 24 acceptance scenarios, end to end: the real Next.js app + worker, the
 * real Upload-Post adapter talking HTTP to the local Upload-Post MOCK (tests/mock/upload-post-mock.ts)
 * and the OpenAI mock. Nothing is published on real accounts.
 */
const MOCK = "http://127.0.0.1:4010/uploadpost";
const SECRET = "whsec_e2e_secret_0123456789";
const FILM = "tests/fixtures/generated/sample-take.mp4";

const sql = (q: string) => execSync(`psql "${process.env.DATABASE_URL!.replace("?schema=public", "")}" -At -c ${JSON.stringify(q)}`).toString().trim();

async function j<T = Record<string, unknown>>(r: APIRequestContext, method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE", url: string, data?: unknown, status?: number): Promise<T> {
  const res = await r.fetch(url, { method, data });
  if (status !== undefined) expect(res.status(), `${method} ${url}: ${await res.text()}`).toBe(status);
  else expect(res.ok(), `${method} ${url}: ${res.status()} ${await res.text()}`).toBeTruthy();
  const t = await res.text();
  return (t ? JSON.parse(t) : null) as T;
}

async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, label: string, timeout = 60_000): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error(`timeout: ${label}`);
    await new Promise((r) => setTimeout(r, 750));
  }
}

async function uploadFilm(r: APIRequestContext, projectId: string, title: string) {
  const buf = fs.readFileSync(FILM);
  const { id } = await j<{ id: string }>(r, "POST", `/api/social/projects/${projectId}/media`, { name: "film.mp4", size: buf.length, title, description: "Film testowy o długach" });
  const res = await r.fetch(`/api/social/media/${id}/chunks/0`, { method: "PUT", data: buf, headers: { "content-type": "application/octet-stream" } });
  expect(res.ok()).toBeTruthy();
  await j(r, "POST", `/api/social/media/${id}/complete`, { totalChunks: 1 });
  return waitFor(async () => {
    const m = (await j<{ media: { status: string; checks: Record<string, { ok: boolean }> | null } }>(r, "GET", `/api/social/media/${id}`)).media;
    if (m.status === "FAILED") throw new Error("media failed");
    return m.status === "READY" ? { id, media: m } : null;
  }, "media READY", 90_000);
}

interface Post {
  id: string;
  platform: string;
  status: string;
  description: string;
  hashtags: string[];
  revision: number;
  approvedRevision: number | null;
  publishedUrl: string | null;
  errorMessage: string | null;
  account: { id: string };
  approvals: Array<{ decision: string; invalidatedAt: string | null }>;
  publications: Array<{ status: string; jobId: string | null; externalId: string }>;
}
const content = (r: APIRequestContext, id: string) => j<{ posts: Post[] }>(r, "GET", `/api/social/content/${id}`);
const post = async (r: APIRequestContext, contentId: string, platform: string) => (await content(r, contentId)).posts.find((p) => p.platform === platform)!;
const tomorrow = (h = 18) => {
  const d = new Date(Date.now() + 86400e3);
  return `${d.toISOString().slice(0, 10)}T${String(h).padStart(2, "0")}:00`;
};

function signed(body: string, ts = Math.floor(Date.now() / 1000)) {
  const sig = crypto.createHmac("sha256", SECRET).update(`${ts}.${body}`).digest("hex");
  return { "content-type": "application/json", "x-upload-post-signature": `sha256=${sig}`, "x-upload-post-timestamp": String(ts) };
}

async function loginAs(page: Page, email: string, password: string) {
  await page.goto("/login?next=/social");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click("button[type=submit]");
  await page.waitForURL((u) => u.pathname.startsWith("/social"));
}

test.describe.serial("Social Media Studio", () => {
  let api: APIRequestContext;
  let approver: APIRequestContext;
  let orgA = "";
  let projectA = "";
  let projectB = "";
  let mediaB = "";
  let contentA = "";
  let ig = "";
  let tt = "";
  const approverEmail = `klient.${Date.now()}@example.com`;
  const approverPassword = "haslo-klienta-123";

  test.beforeAll(async ({ playwright }) => {
    api = await playwright.request.newContext({ baseURL: "http://localhost:3100" });
    await adminRequest(api);
  });

  test("1–3: organization, project, Instagram + TikTok connected through the hosted connect page", async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto("/login?next=/social/projects");
    await page.fill("#email", "admin@askby.local");
    await page.fill("#password", "askby-admin");
    await page.click("button[type=submit]");
    await page.waitForURL("**/social/projects");
    // 1. organization
    await page.getByTestId("new-org").click();
    await page.getByLabel("Nazwa").fill("Klient A");
    await page.getByRole("button", { name: "Utwórz" }).click();
    await expect(page.getByTestId("org-panel").filter({ hasText: "Klient A" })).toBeVisible();
    // 2. project
    await page.getByTestId("org-panel").filter({ hasText: "Klient A" }).getByTestId("new-project").click();
    await page.getByLabel("Nazwa").fill("Nowy Etap");
    await page.getByRole("button", { name: "Utwórz" }).click();
    await page.waitForURL(/\/social\/projects\/[^/?]+\?tab=accounts/);
    projectA = new URL(page.url()).pathname.split("/")[3];
    // 3. connect Instagram + TikTok (provider page → back → sync)
    await page.getByTestId("connect-account").click();
    await page.getByRole("dialog").locator("label").filter({ hasText: "Instagram" }).locator("input").check();
    await page.getByRole("dialog").locator("label").filter({ hasText: "TikTok" }).locator("input").check();
    await page.getByTestId("connect-go").click();
    await page.waitForURL(/tab=accounts/, { timeout: 60_000 });
    await expect(page.getByTestId("account-card")).toHaveCount(2);
    await expect(page.locator('[data-testid="account-card"][data-platform="INSTAGRAM"][data-status="CONNECTED"]')).toBeVisible();
    await expect(page.locator('[data-testid="account-card"][data-platform="TIKTOK"][data-status="CONNECTED"]')).toBeVisible();
    const p = await j<{ project: { isDemo: boolean; organization: { id: string } }; accounts: Array<{ platform: string; handle: string }> }>(api, "GET", `/api/social/projects/${projectA}`);
    expect(p.project.isDemo).toBe(false);
    orgA = p.project.organization.id;
    // a stable provider profile per project
    const prof = sql(`SELECT username FROM "ProviderProfile" WHERE "projectId" = '${projectA}'`);
    expect(prof).toBe(`project_${projectA}`);
  });

  test("4–5: a second client's project is invisible to the first client's approver", async ({ playwright }) => {
    test.setTimeout(180_000);
    // 4. second organization + project with Instagram
    const orgB = await j<{ id: string }>(api, "POST", "/api/social/orgs", { name: "Klient B" }, 201);
    projectB = (await j<{ id: string }>(api, "POST", `/api/social/orgs/${orgB.id}/projects`, { name: "Risify" }, 201)).id;
    const { url } = await j<{ url: string }>(api, "POST", `/api/social/projects/${projectB}/accounts`, { platforms: ["INSTAGRAM"] });
    const back = await fetch(url, { redirect: "manual" });
    expect(back.status).toBe(302);
    await j(api, "POST", `/api/social/projects/${projectB}/accounts/sync`, {});
    mediaB = (await uploadFilm(api, projectB, "Film klienta B")).id;
    // 5. an approver invited only to project A
    const inv = await j<{ url: string }>(api, "POST", `/api/social/projects/${projectA}/members`, { email: approverEmail, role: "APPROVER" }, 201);
    const token = inv.url.split("/invite/")[1];
    approver = await pwRequest.newContext({ baseURL: "http://localhost:3100" });
    void playwright;
    await j(approver, "POST", `/api/invite/${token}`, { name: "Klient Akceptujący", password: approverPassword });
    const me = await j<{ projects: Array<{ id: string }> }>(approver, "GET", "/api/social/me");
    expect(me.projects.map((x) => x.id)).toEqual([projectA]);
    await j(approver, "GET", `/api/social/projects/${projectB}`, undefined, 404);
    await j(approver, "GET", `/api/social/media/${mediaB}`, undefined, 404);
    await j(approver, "GET", `/api/social/projects/${projectB}/media`, undefined, 404);
    const cal = await j<{ posts: unknown[]; projects: Array<{ id: string }> }>(approver, "GET", `/api/social/calendar?project=${projectB}`);
    expect(cal.projects).toEqual([]);
    // the video tools are closed to client accounts
    expect((await approver.fetch("/api/admin/projects")).status()).toBe(403);
    // an approver cannot upload / edit
    await j(approver, "POST", `/api/social/projects/${projectA}/media`, { name: "x.mp4", size: 10 }, 403);
  });

  test("6–9: upload, two different AI texts, edit, send for approval", async () => {
    test.setTimeout(180_000);
    const { id: mediaId, media } = await uploadFilm(api, projectA, "Czy komornik może zabrać całą pensję?");
    expect(media.checks!.INSTAGRAM.ok).toBe(true);
    const accounts = (await j<{ accounts: Array<{ id: string; platform: string }> }>(api, "GET", `/api/social/projects/${projectA}/accounts`)).accounts;
    const created = await j<{ id: string; jobId: string }>(api, "POST", `/api/social/projects/${projectA}/content`, { mediaId, accountIds: accounts.map((a) => a.id), goal: "zgłoszenia na analizę" }, 201);
    contentA = created.id;
    // 7. AI: a separate text per platform
    const c = await waitFor(async () => {
      const x = await content(api, contentA);
      return x.posts.every((p) => p.description.startsWith("Opis")) ? x : null;
    }, "AI texts");
    const igp = c.posts.find((p) => p.platform === "INSTAGRAM")!;
    const ttp = c.posts.find((p) => p.platform === "TIKTOK")!;
    ig = igp.id;
    tt = ttp.id;
    expect(igp.description).not.toBe(ttp.description);
    expect(igp.hashtags).toContain("#test");
    expect(igp.hashtags).not.toContain("#viral");
    // 8. edit
    const before = igp.revision;
    const e = await j<{ revision: number }>(api, "PATCH", `/api/social/posts/${ig}`, { description: "Komornik nie może zabrać wszystkiego. Sprawdź, ile zostaje." });
    expect(e.revision).toBe(before + 1);
    // 9. a date + send for approval
    for (const id of [ig, tt]) await j(api, "PATCH", `/api/social/posts/${id}`, { scheduledAt: tomorrow(18) });
    const s = await j<{ results: Array<{ ok: boolean; errors: string[] }> }>(api, "POST", "/api/social/posts/submit", { postIds: [ig, tt] });
    expect(s.results.every((r) => r.ok), JSON.stringify(s.results)).toBe(true);
    expect((await post(api, contentA, "INSTAGRAM")).status).toBe("PENDING_APPROVAL");
  });

  test("10: publishing without approval is refused and nothing reaches the provider", async () => {
    const r = await api.fetch(`/api/social/posts/${ig}/schedule`, { method: "POST" });
    expect(r.status()).toBe(409);
    const log = await (await fetch(`${MOCK}/_log`)).json();
    expect(log.uploads.filter((u: { user: string }) => u.user === `project_${projectA}`)).toHaveLength(0);
  });

  test("11–12: the client approves both in the approval queue → two separate orders", async ({ browser }) => {
    test.setTimeout(120_000);
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await loginAs(page, approverEmail, approverPassword);
    await page.goto("/social/approvals");
    await expect(page.getByTestId("approval-item")).toHaveCount(2);
    await expect(page.getByTestId("final-caption").first()).toContainText(/Komornik nie może|Opis TIKTOK/);
    for (const box of await page.getByLabel("Zaznacz do zbiorczej akceptacji").all()) await box.check();
    await page.getByTestId("approve-selected").click();
    await expect(page.getByTestId("approval-item")).toHaveCount(0, { timeout: 20_000 });
    await ctx.close();
    // the exact version, by the approver
    const igp = await post(api, contentA, "INSTAGRAM");
    expect(igp.approvedRevision).toBe(igp.revision);
    // 12. each target gets its own order
    await waitFor(async () => ((await post(api, contentA, "INSTAGRAM")).status === "SCHEDULED" && (await post(api, contentA, "TIKTOK")).status === "SCHEDULED" ? true : null), "both SCHEDULED");
    const log = await (await fetch(`${MOCK}/_log`)).json();
    const mine = log.uploads.filter((u: { user: string }) => u.user === `project_${projectA}`);
    expect(mine.map((u: { platform: string }) => u.platform).sort()).toEqual(["instagram", "tiktok"]);
    expect(new Set(mine.map((u: { idempotencyKey: string }) => u.idempotencyKey)).size).toBe(2);
    const approverName = sql(`SELECT u.name FROM "Approval" a JOIN "User" u ON u.id = a."userId" WHERE a."platformPostId" = '${ig}' AND a.decision = 'APPROVED'`);
    expect(approverName).toBe("Klient Akceptujący");
  });

  test("13: a repeated request (lost response, re-trigger) never creates a second post", async () => {
    test.setTimeout(120_000);
    const jobsBefore = (await (await fetch(`${MOCK}/_log`)).json()).jobs.length;
    // a lost response: the app no longer knows the job id → the RECONCILER re-sends with the SAME key
    sql(`UPDATE "ScheduledPublication" SET status = 'UNKNOWN', "providerJobId" = NULL, "updatedAt" = now() - interval '10 minutes' WHERE "platformPostId" = '${tt}'`);
    await waitFor(async () => (sql(`SELECT status || ':' || coalesce("providerJobId", '') FROM "ScheduledPublication" WHERE "platformPostId" = '${tt}'`).startsWith("SCHEDULED:job_") ? true : null), "re-sent and recovered", 90_000);
    expect(Number(sql(`SELECT count(*) FROM "Job" WHERE type = 'social-check'`))).toBeGreaterThan(0);
    // an explicit re-trigger of an already scheduled post
    const { jobId } = await j<{ jobId: string }>(api, "POST", `/api/social/posts/${tt}/schedule`, undefined, 202);
    await waitFor(async () => (sql(`SELECT status FROM "Job" WHERE id = '${jobId}'`) === "SUCCEEDED" ? true : null), "re-trigger done");
    const log = await (await fetch(`${MOCK}/_log`)).json();
    const ttUploads = log.uploads.filter((u: { user: string; platform: string }) => u.user === `project_${projectA}` && u.platform === "tiktok");
    expect(ttUploads.length).toBe(2);
    expect(new Set(ttUploads.map((u: { idempotencyKey: string }) => u.idempotencyKey)).size).toBe(1);
    expect(ttUploads[1].duplicate).toBe(true);
    expect(log.jobs.length).toBe(jobsBefore);
    expect(Number(sql(`SELECT count(*) FROM "ScheduledPublication" WHERE "platformPostId" = '${tt}'`))).toBe(1);
  });

  test("14: cancel a scheduled publication", async () => {
    const jobId = (await post(api, contentA, "TIKTOK")).publications[0].jobId!;
    await j(api, "POST", `/api/social/posts/${tt}/cancel`);
    await waitFor(async () => ((await post(api, contentA, "TIKTOK")).status === "CANCELLED" ? true : null), "CANCELLED");
    const log = await (await fetch(`${MOCK}/_log`)).json();
    expect(log.cancels).toContain(jobId);
  });

  let deliveredBody = "";
  let deliveredHeaders: Record<string, string> = {};
  test("15: success webhook → published, URL and native id stored (state read back from the API)", async () => {
    const jobId = (await post(api, contentA, "INSTAGRAM")).publications[0].jobId!;
    await fetch(`${MOCK}/_control`, { method: "POST", body: JSON.stringify({ jobId, state: "completed" }) });
    deliveredBody = JSON.stringify({ event: "upload_completed", job_id: jobId, delivery_id: `d_${jobId}` });
    deliveredHeaders = { ...signed(deliveredBody), "x-upload-post-delivery": `d_${jobId}` };
    const r = await api.fetch("/api/hooks/upload-post", { method: "POST", data: deliveredBody, headers: deliveredHeaders });
    expect(r.status()).toBe(200);
    const p = await waitFor(async () => {
      const x = await post(api, contentA, "INSTAGRAM");
      return x.status === "PUBLISHED" ? x : null;
    }, "PUBLISHED");
    expect(p.publishedUrl).toMatch(/^https:\/\/instagram\.example\/p\//);
    expect(sql(`SELECT "platformPostId" FROM "PlatformPost" WHERE id = '${ig}'`)).toMatch(/^instagrampost_/);
  });

  test("16: failure webhook → PUBLISH_FAILED with the platform's error", async () => {
    test.setTimeout(120_000);
    const accounts = (await j<{ accounts: Array<{ id: string; platform: string }> }>(api, "GET", `/api/social/projects/${projectA}/accounts`)).accounts;
    const mediaId = sql(`SELECT "mediaId" FROM "ContentItem" WHERE id = '${contentA}'`);
    const c2 = (await j<{ id: string }>(api, "POST", `/api/social/projects/${projectA}/content`, { mediaId, accountIds: [accounts.find((a) => a.platform === "TIKTOK")!.id], generate: false }, 201)).id;
    const p = (await content(api, c2)).posts[0];
    await j(api, "PATCH", `/api/social/posts/${p.id}`, { description: "Film, który się nie uda.", scheduledAt: tomorrow(19) });
    await j(api, "POST", "/api/social/posts/submit", { postIds: [p.id] });
    const fresh = (await content(api, c2)).posts[0];
    await j(api, "POST", "/api/social/posts/decide", { items: [{ postId: p.id, revision: fresh.revision }], decision: "APPROVED", comment: "" });
    const scheduled = await waitFor(async () => {
      const x = (await content(api, c2)).posts[0];
      return x.status === "SCHEDULED" ? x : null;
    }, "SCHEDULED");
    const jobId = scheduled.publications[0].jobId!;
    await fetch(`${MOCK}/_control`, { method: "POST", body: JSON.stringify({ jobId, state: "failed", error: "Video too long for this account" }) });
    const body = JSON.stringify({ event: "upload_completed", job_id: jobId });
    expect((await api.fetch("/api/hooks/upload-post", { method: "POST", data: body, headers: signed(body) })).status()).toBe(200);
    const failed = await waitFor(async () => {
      const x = (await content(api, c2)).posts[0];
      return x.status === "PUBLISH_FAILED" ? x : null;
    }, "PUBLISH_FAILED");
    expect(failed.errorMessage).toContain("Video too long");
    expect(Number(sql(`SELECT count(*) FROM "Notification" WHERE type = 'post_failed' AND "projectId" = '${projectA}'`))).toBeGreaterThan(0);
  });

  test("17: replayed / forged / stale webhooks are not processed again", async () => {
    const r = await api.fetch("/api/hooks/upload-post", { method: "POST", data: deliveredBody, headers: deliveredHeaders });
    expect(r.status()).toBe(200);
    expect((await r.json()).duplicate).toBe(true);
    const jobId = JSON.parse(deliveredBody).job_id;
    expect(sql(`SELECT count(*) FROM "WebhookEvent" WHERE "rawBody" LIKE '%${jobId}%'`)).toBe("1");
    const forged = await api.fetch("/api/hooks/upload-post", { method: "POST", data: deliveredBody, headers: { ...deliveredHeaders, "x-upload-post-signature": "sha256=" + "0".repeat(64), "x-upload-post-delivery": "other" } });
    expect(forged.status()).toBe(401);
    const old = JSON.stringify({ event: "upload_completed", job_id: "x" });
    const stale = await api.fetch("/api/hooks/upload-post", { method: "POST", data: old, headers: signed(old, Math.floor(Date.now() / 1000) - 3600) });
    expect(stale.status()).toBe(401);
    expect((await post(api, contentA, "INSTAGRAM")).status).toBe("PUBLISHED");
  });

  test("18: analytics — reported metrics stored, missing ones stay empty (not 0)", async () => {
    await j(api, "POST", `/api/social/posts/${ig}/metrics`);
    const r = await j<{ latest: { views: number; likes: number; reach: number | null; saves: number | null; unsupported: string[] } }>(api, "GET", `/api/social/posts/${ig}/results`);
    expect(r.latest.views).toBe(1234);
    expect(r.latest.reach).toBeNull();
    expect(r.latest.saves).toBeNull();
    expect(r.latest.unsupported).toContain("reach");
    const a = await j<{ current: { views: number; reach: number | null; published: number }; lastUpdated: string }>(api, "GET", `/api/social/projects/${projectA}/analytics?days=30`);
    expect(a.current.views).toBe(1234);
    expect(a.current.reach).toBeNull();
    expect(a.lastUpdated).toBeTruthy();
  });

  let leadId = "";
  test("19–21: comments fetched and classified; AI draft; a person approves and it is sent", async ({ browser }) => {
    test.setTimeout(120_000);
    await j(api, "POST", `/api/social/projects/${projectA}/comments/refresh`, undefined, 202);
    const list = await waitFor(async () => {
      const x = await j<{ comments: Array<{ id: string; category: string | null; isLead: boolean; status: string; needsHuman: boolean }> }>(api, "GET", `/api/social/comments?project=${projectA}`);
      return x.comments.length >= 3 && x.comments.every((c) => c.category) ? x.comments : null;
    }, "3 classified comments");
    const lead = list.find((c) => c.isLead)!;
    leadId = lead.id;
    expect(lead.status).toBe("NEEDS_REPLY");
    expect(list.find((c) => c.needsHuman)!.status).toBe("ESCALATED");
    // the inbox UI: draft by AI, edit, approve & send
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await loginAs(page, "admin@askby.local", "askby-admin");
    await page.goto(`/social/comments?project=${projectA}&comment=${leadId}`);
    await expect(page.getByTestId("comment-detail")).toContainText("Ile kosztuje");
    await page.getByTestId("ai-draft").click();
    await expect(page.getByTestId("reply-text")).toHaveValue(/Dziękujemy/);
    await page.getByTestId("reply-text").fill("Dziękujemy! Szczegóły i wycenę wyślemy w wiadomości prywatnej.");
    const sentRes = page.waitForResponse((r) => r.url().includes(`/api/social/comments/${leadId}/reply`) && r.request().method() === "POST");
    await page.getByTestId("send-reply").click();
    expect((await sentRes).status()).toBe(202);
    await ctx.close();
    await waitFor(async () => sql(`SELECT status FROM "CommentReply" WHERE "commentId" = '${leadId}' AND status = 'SENT'`) === "SENT", "reply SENT");
    const log = await (await fetch(`${MOCK}/_log`)).json();
    const sent = log.replies.find((r: { body: { message: string } }) => r.body.message.includes("wycenę"));
    expect(sent.path).toBe("/api/uploadposts/comments/public-reply");
    expect(sql(`SELECT status FROM "SocialComment" WHERE id = '${leadId}'`)).toBe("REPLIED");
    // nothing was sent automatically (auto-reply is off by default)
    expect(Number(sql(`SELECT count(*) FROM "CommentReply" WHERE source = 'AUTO'`))).toBe(0);
  });

  let c3 = "";
  let p3 = "";
  test("22–23: lost authorization holds publications; reconnecting brings them back", async () => {
    test.setTimeout(120_000);
    const accounts = (await j<{ accounts: Array<{ id: string; platform: string }> }>(api, "GET", `/api/social/projects/${projectA}/accounts`)).accounts;
    const mediaId = sql(`SELECT "mediaId" FROM "ContentItem" WHERE id = '${contentA}'`);
    c3 = (await j<{ id: string }>(api, "POST", `/api/social/projects/${projectA}/content`, { mediaId, accountIds: [accounts.find((a) => a.platform === "INSTAGRAM")!.id], generate: false }, 201)).id;
    p3 = (await content(api, c3)).posts[0].id;
    await j(api, "PATCH", `/api/social/posts/${p3}`, { description: "Trzecia publikacja.", scheduledAt: tomorrow(20) });
    await j(api, "POST", "/api/social/posts/submit", { postIds: [p3] });
    await j(api, "POST", "/api/social/posts/decide", { items: [{ postId: p3, revision: (await content(api, c3)).posts[0].revision }], decision: "APPROVED", comment: "" });
    await waitFor(async () => ((await content(api, c3)).posts[0].status === "SCHEDULED" ? true : null), "SCHEDULED");
    // 22. the platform withdraws the authorization
    await fetch(`${MOCK}/_reauth`, { method: "POST", body: JSON.stringify({ username: `project_${projectA}`, platform: "instagram", reauth: true }) });
    await j(api, "POST", `/api/social/projects/${projectA}/accounts/sync`, {});
    const acc = (await j<{ accounts: Array<{ platform: string; status: string }> }>(api, "GET", `/api/social/projects/${projectA}/accounts`)).accounts.find((a) => a.platform === "INSTAGRAM")!;
    expect(acc.status).toBe("REAUTH_REQUIRED");
    expect((await content(api, c3)).posts[0].status).toBe("REAUTH_REQUIRED");
    expect(Number(sql(`SELECT count(*) FROM "Notification" WHERE type = 'reauth_required' AND "projectId" = '${projectA}'`))).toBeGreaterThan(0);
    // 23. reconnected
    await fetch(`${MOCK}/_reauth`, { method: "POST", body: JSON.stringify({ username: `project_${projectA}`, platform: "instagram", reauth: false }) });
    await j(api, "POST", `/api/social/projects/${projectA}/accounts/sync`, {});
    await waitFor(async () => ((await content(api, c3)).posts[0].status === "SCHEDULED" ? true : null), "back to SCHEDULED");
    expect((await j<{ accounts: Array<{ platform: string; status: string }> }>(api, "GET", `/api/social/projects/${projectA}/accounts`)).accounts.find((a) => a.platform === "INSTAGRAM")!.status).toBe("CONNECTED");
  });

  test("24: an edit after approval withdraws it, holds the order, and needs a new approval", async () => {
    const before = (await content(api, c3)).posts[0];
    const jobId = before.publications[0].jobId!;
    await j(api, "PATCH", `/api/social/posts/${p3}`, { description: "Trzecia publikacja — poprawiona po akceptacji." });
    const after = (await content(api, c3)).posts[0];
    expect(after.status).toBe("PENDING_APPROVAL");
    expect(after.approvedRevision).toBeNull();
    expect(after.approvals.find((a) => a.decision === "APPROVED")!.invalidatedAt).toBeTruthy();
    await waitFor(async () => ((await (await fetch(`${MOCK}/_log`)).json()).cancels.includes(jobId) ? true : null), "order held (cancelled) at the provider");
    expect((await api.fetch(`/api/social/posts/${p3}/schedule`, { method: "POST" })).status()).toBe(409);
    // the approver sees the new version and approves exactly that one → a new order (new key)
    const fresh = (await content(api, c3)).posts[0];
    await j(approver, "POST", "/api/social/posts/decide", { items: [{ postId: p3, revision: fresh.revision }], decision: "APPROVED", comment: "OK" });
    await waitFor(async () => ((await content(api, c3)).posts[0].status === "SCHEDULED" ? true : null), "re-scheduled");
    const pubs = (await content(api, c3)).posts[0].publications;
    expect(pubs[0].jobId).not.toBe(jobId);
    // a stale revision cannot be approved
    const stale = await j<{ results: Array<{ ok: boolean }> }>(approver, "POST", "/api/social/posts/decide", { items: [{ postId: p3, revision: before.revision }], decision: "APPROVED", comment: "" });
    expect(stale.results[0].ok).toBe(false);
  });

  test("DEMO: demo data never reaches the provider; screens render", async ({ browser }) => {
    test.setTimeout(240_000);
    const uploadsBefore = (await (await fetch(`${MOCK}/_log`)).json()).uploads.length;
    await j(api, "POST", "/api/social/demo");
    const me = await j<{ projects: Array<{ id: string; name: string; isDemo: boolean }> }>(api, "GET", "/api/social/me");
    const demo = me.projects.filter((p) => p.isDemo);
    expect(demo.map((p) => p.name).sort()).toEqual(["Nowy Etap", "Pravna", "Risify"]);
    // approve a demo draft: it goes to the DEMO provider only
    const q = await j<{ posts: Array<{ id: string; revision: number; project: { id: string } }> }>(api, "GET", `/api/social/approvals?project=${demo[0].id}`);
    expect(q.posts.length).toBeGreaterThan(0);
    await j(api, "POST", "/api/social/posts/decide", { items: [{ postId: q.posts[0].id, revision: q.posts[0].revision }], decision: "APPROVED", comment: "" });
    await waitFor(async () => (sql(`SELECT status FROM "PlatformPost" WHERE id = '${q.posts[0].id}'`) === "SCHEDULED" ? true : null), "demo SCHEDULED");
    expect(sql(`SELECT "providerJobId" FROM "ScheduledPublication" WHERE "platformPostId" = '${q.posts[0].id}'`)).toMatch(/^demo_job_/);
    expect((await (await fetch(`${MOCK}/_log`)).json()).uploads.length).toBe(uploadsBefore);
    // screens
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await loginAs(page, "admin@askby.local", "askby-admin");
    await page.goto(`/social/calendar?project=${projectA}`);
    await expect(page.getByTestId("calendar-month")).toBeVisible();
    await page.getByRole("button", { name: "Lista" }).click();
    await expect(page.getByTestId("calendar-list")).toBeVisible();
    await page.goto(`/social/content/${contentA}`);
    await expect(page.getByTestId("platform-tab")).toHaveCount(2);
    await expect(page.getByTestId("target-account-name")).toBeVisible();
    await page.goto(`/social/analytics?project=${projectA}`);
    await expect(page.getByTestId("analytics")).toBeVisible();
    await page.goto(`/social/publications?project=${projectA}`);
    await expect(page.getByTestId("publication-row").first()).toBeVisible();
    await page.goto("/social");
    await page.getByRole("button", { name: "Motyw" }).click();
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toMatch(/light|dark/);
    await ctx.close();
  });
});
