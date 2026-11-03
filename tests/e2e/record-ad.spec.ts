import { expect, test } from "@playwright/test";
import { adminRequest, newInvitation } from "./helpers";

const HOOKS = ["Masz długi i nie wiesz, czy powiedzieć o nich mężowi?", "Trzy rzeczy, które musisz wiedzieć, zanim powiesz o długach.", "Mąż nie wie o Twoich długach?"];
const BODY = `Pierwszy błąd to brak odpowiedzi w ciągu dwudziestu czterech godzin.
Drugi błąd to oferta bez konkretnej ceny i terminu realizacji.`;

/**
 * Ads tab: the expert reads every hook in turn (tapping "Dalej"), then the body, in one take — the take
 * becomes one edit whose hook switches between the hooks (the body edited once).
 */
test("ads: hook + prompter with three hooks — read in turn, one edit with interchangeable hooks", async ({ page, request, browserName }) => {
  test.skip(browserName !== "chromium", "fake media devices are Chromium-only");
  test.setTimeout(300_000);
  await adminRequest(request);
  const project = await (await request.post("/api/admin/projects", { data: { name: "Reklamy — długi", format: "HYBRID", adsRecording: true, preset: "duo-terapia" } })).json();
  const expert = (await (await request.post(`/api/admin/projects/${project.id}/experts`, { data: { name: "Ekspert Reklam" } })).json()).expert;
  const q = await (await request.post(`/api/admin/projects/${project.id}/questions`, { data: { text: "Długi a małżeństwo", kind: "HOOK_PROMPTER", hooks: HOOKS, script: BODY } })).json();
  // the "Reklamy" tab lists it (and the regular projects list does not)
  const tab = await (await request.get("/admin/reklamy")).text();
  expect(tab).toContain("Reklamy — długi");
  expect(await (await request.get("/admin")).text()).not.toContain("Reklamy — długi");

  const { url, token } = await newInvitation(request, project.id, expert.id);
  const session = await (await request.get(`/api/record/${token}`)).json();
  expect(session.questions[0].hooks).toEqual(HOOKS);

  await page.goto(url);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Rozpocznij nagrywanie" }).click();
  await page.getByRole("button", { name: /Gotowe/ }).click();
  await page.getByText("Długi a małżeństwo").click();
  await expect(page.getByTestId("ad-plan")).toContainText("Reklama · 3 hooki");
  await expect(page.getByText(/Reklama #1 z 1/)).toBeVisible();

  await page.getByRole("button", { name: "Rozpocznij nagrywanie odpowiedzi" }).click();
  await expect(page.getByText(/REC \d/)).toBeVisible({ timeout: 20_000 });
  const prompter = page.getByTestId("prompter");
  await expect(page.getByTestId("ad-part")).toHaveText("Hook 1 z 3");
  await expect(prompter).toContainText("Masz długi i nie wiesz");
  await page.waitForTimeout(1500);
  await page.getByTestId("ad-next").click();
  await expect(page.getByTestId("ad-part")).toHaveText("Hook 2 z 3");
  await expect(prompter).toContainText("Trzy rzeczy");
  await page.waitForTimeout(1500);
  await page.getByTestId("ad-next").click();
  await expect(page.getByTestId("ad-part")).toHaveText("Hook 3 z 3");
  await expect(page.getByTestId("ad-next")).toHaveText("Dalej: treść reklamy →");
  await page.waitForTimeout(1500);
  await page.getByTestId("ad-next").click();
  await expect(page.getByTestId("ad-part")).toHaveText("Treść reklamy");
  await expect(prompter).toContainText("Pierwszy błąd");
  await expect(page.getByTestId("ad-next")).toHaveCount(0);
  await page.waitForTimeout(2500);
  await page.getByRole("button", { name: "Zatrzymaj" }).click();
  await expect(page.getByText("Nagranie bezpiecznie zapisane")).toBeVisible({ timeout: 60_000 });

  // one edit: HOOK + BODY, the hook switching between the three hooks
  for (let i = 0; i < 90; i++) {
    const d = await (await request.get(`/api/admin/projects/${project.id}`)).json();
    const take = d.questions.find((x: { id: string }) => x.id === q.items[0].id).takes[0];
    if (take?.status === "FAILED") throw new Error("take failed");
    if (take?.compositionId) {
      const doc = (await (await request.get(`/api/admin/compositions/${take.compositionId}`)).json()).composition.document;
      expect(doc.clips.map((c: { label: string }) => c.label)).toEqual(["HOOK", "BODY"]);
      expect(doc.hooks.variants.map((v: { code: string }) => v.code)).toEqual(["Hook A", "Hook B", "Hook C"]);
      const v = doc.hooks.variants as Array<{ clip: { sourceIn: number; sourceOut: number } }>;
      // in order, one after another, the body after the last hook
      expect(v[0].clip.sourceOut).toBeLessThanOrEqual(v[1].clip.sourceIn + 0.31);
      expect(v[1].clip.sourceOut).toBeLessThanOrEqual(v[2].clip.sourceIn + 0.31);
      expect(doc.clips[1].sourceIn).toBeGreaterThanOrEqual(v[2].clip.sourceIn);
      expect(doc.overlays.find((o: { role?: string }) => o.role === "question").text).toBe("Długi a małżeństwo");
      return;
    }
    await page.waitForTimeout(2000);
  }
  throw new Error("composition was not created");
});

/** Question + prompter ad: the narrator reads every version of the question, the expert answers once. */
test("ads: question + prompter with two questions — the narrator reads both, one answer, versions with their own narration", async ({ page, request, browserName }) => {
  test.skip(browserName !== "chromium", "fake media devices are Chromium-only");
  test.setTimeout(300_000);
  await adminRequest(request);
  const project = await (await request.post("/api/admin/projects", { data: { name: "Reklamy — pytania", format: "HYBRID", adsRecording: true } })).json();
  const expert = (await (await request.post(`/api/admin/projects/${project.id}/experts`, { data: { name: "Ekspert Pytań" } })).json()).expert;
  const QS = ["Czy mam powiedzieć mężowi o długach?", "Mąż nie wie o moich długach. Co robić?"];
  const q = await (await request.post(`/api/admin/projects/${project.id}/questions`, { data: { text: "Długi i mąż", kind: "QUESTION_PROMPTER", hooks: QS, script: BODY } })).json();
  const { url } = await newInvitation(request, project.id, expert.id);

  await page.goto(url);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Rozpocznij nagrywanie" }).click();
  await page.getByRole("button", { name: /Gotowe/ }).click();
  await page.getByText("Długi i mąż").click();
  await expect(page.getByTestId("ad-plan")).toContainText("Reklama · 2 wersje pytania");
  const start = page.getByRole("button", { name: "Rozpocznij nagrywanie odpowiedzi" });
  await expect(start).toBeEnabled({ timeout: 30_000 });
  await start.click();
  // both questions read in turn, then the prompter, then the answer
  await expect(page.getByTestId("qp-question")).toContainText("Pytanie 1/2: Czy mam powiedzieć mężowi o długach?");
  await expect(page.getByTestId("qp-question")).toContainText("Pytanie 2/2: Mąż nie wie", { timeout: 20_000 });
  await expect(page.getByText(/REC \d/)).toBeVisible({ timeout: 40_000 });
  await page.waitForTimeout(3000);
  await page.getByRole("button", { name: "Zatrzymaj" }).click();
  await expect(page.getByText("Nagranie bezpiecznie zapisane")).toBeVisible({ timeout: 60_000 });

  for (let i = 0; i < 90; i++) {
    const d = await (await request.get(`/api/admin/projects/${project.id}`)).json();
    const take = d.questions.find((x: { id: string }) => x.id === q.items[0].id).takes[0];
    if (take?.status === "FAILED") throw new Error("take failed");
    if (take?.compositionId) {
      const doc = (await (await request.get(`/api/admin/compositions/${take.compositionId}`)).json()).composition.document;
      expect(doc.narration).toHaveLength(1);
      expect(doc.hooks.variants).toHaveLength(2);
      expect(doc.hooks.narrationClipId).toBe(doc.narration[0].id);
      // version B: its own narration of the second question, the same title on screen
      expect(doc.hooks.variants[1].narration.clip.assetId).not.toBe(doc.narration[0].assetId);
      expect(doc.hooks.variants.map((v: { title: string }) => v.title)).toEqual(["Długi i mąż", "Długi i mąż"]);
      return;
    }
    await page.waitForTimeout(2000);
  }
  throw new Error("composition was not created");
});
