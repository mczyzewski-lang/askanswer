import { expect, type APIRequestContext, type Page } from "@playwright/test";
import fs from "node:fs";

export async function login(page: Page) {
  await page.goto("/login");
  await page.fill("#email", "admin@askby.local");
  await page.fill("#password", "askby-admin");
  await page.click("button[type=submit]");
  await page.waitForURL("**/admin");
}

export async function adminRequest(request: APIRequestContext) {
  const res = await request.post("/api/auth/login", { data: { email: "admin@askby.local", password: "askby-admin" } });
  expect(res.ok()).toBeTruthy();
}

export async function demoProject(request: APIRequestContext) {
  const res = await request.get("/api/admin/projects");
  expect(res.ok()).toBeTruthy();
  const list = (await res.json()) as Array<{ id: string; name: string }>;
  const p = list.find((x) => x.name === "Pravna — Znaki Towarowe");
  expect(p).toBeTruthy();
  const data = await (await request.get(`/api/admin/projects/${p!.id}`)).json();
  return data as {
    project: { id: string };
    experts: Array<{ id: string; name: string }>;
    questions: Array<{ id: string; text: string; expertId: string | null; takes: Array<{ id: string; status: string; compositionId: string | null }> }>;
  };
}

export async function waitForTakes(request: APIRequestContext, questionId: string, count: number, timeout = 180_000) {
  const start = Date.now();
  for (;;) {
    const data = await demoProject(request);
    const q = data.questions.find((x) => x.id === questionId)!;
    const ready = q.takes.filter((t) => t.status === "READY");
    if (ready.length >= count) return ready;
    const failed = q.takes.find((t) => t.status === "FAILED");
    if (failed) throw new Error(`Take ${failed.id} failed processing`);
    if (Date.now() - start > timeout) throw new Error(`Timed out waiting for ${count} READY takes (have ${ready.length})`);
    await new Promise((r) => setTimeout(r, 1500));
  }
}

/** Upload the clearly-labelled TEST FIXTURE through the real expert upload API (chunked, resumable). */
export async function uploadFixtureTake(request: APIRequestContext, token: string, questionId: string, mode: "CONTINUOUS" | "ANSWER_ONLY" = "ANSWER_ONLY") {
  const buf = fs.readFileSync("tests/fixtures/generated/sample-take.mp4");
  const clientId = `fixture${Date.now()}`;
  const created = await request.post(`/api/record/${token}/takes`, { data: { questionId, clientId, mimeType: "video/mp4", mode, markers: {} } });
  expect(created.ok()).toBeTruthy();
  const { takeId } = await created.json();
  const SLICE = 2 * 1024 * 1024;
  const total = Math.ceil(buf.length / SLICE);
  for (let i = 0; i < total; i++) {
    const r = await request.put(`/api/record/${token}/takes/${takeId}/chunks/${i}`, { data: buf.subarray(i * SLICE, (i + 1) * SLICE), headers: { "content-type": "application/octet-stream" } });
    expect(r.ok()).toBeTruthy();
  }
  const done = await request.post(`/api/record/${token}/takes/${takeId}/complete`, { data: { totalChunks: total, durationSec: 12 } });
  expect(done.ok()).toBeTruthy();
  return takeId as string;
}

export async function newInvitation(request: APIRequestContext, projectId: string, expertId: string) {
  const r = await request.post(`/api/admin/projects/${projectId}/invitations`, { data: { expertId } });
  expect(r.ok()).toBeTruthy();
  const { url } = await r.json();
  return { url: url as string, token: (url as string).split("/record/")[1] };
}
