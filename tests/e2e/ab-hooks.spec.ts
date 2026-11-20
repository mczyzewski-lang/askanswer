import { expect, test } from "@playwright/test";
import { unzipSync } from "fflate";
import { adminRequest, demoProject, login, newInvitation, uploadFixtureTake, waitForTakes } from "./helpers";

/** Hooks proposed for an A/B test become versions of one edit (own title + own narration), exported as one MP4 each. */
test("studio A/B hooks: proposals → 3 versions with their own narration → 3 MP4s", async ({ page, request }) => {
  test.setTimeout(420_000);
  await adminRequest(request);
  const data = await demoProject(request);
  const anna = data.experts.find((e) => e.name === "Anna Kowalska")!;
  const q = data.questions.find((x) => x.expertId === anna.id && x.text.startsWith("Jak długo trwa"))!;
  const { token } = await newInvitation(request, data.project.id, anna.id);
  await uploadFixtureTake(request, token, q.id);
  const [take] = await waitForTakes(request, q.id, 1);
  const compId = (await (await request.get(`/api/admin/takes/${take.id}`)).json()).compositionIds[0];
  const doc = async () => (await (await request.get(`/api/admin/compositions/${compId}`)).json()).composition.document;

  await login(page);
  await page.goto(`/studio/${compId}`);
  await page.getByTestId("tab-question").click();
  // a narrator reads the question: every version gets its own narration
  await page.getByRole("button", { name: /Dodaj lektora/ }).click();
  await expect(page.getByText("Lektor zmieniony")).toBeVisible({ timeout: 30_000 });

  const ab = page.getByTestId("ab-hooks");
  await expect(ab).toContainText("Hook A (obecny): Jak długo trwa ochrona znaku?");
  await ab.getByTestId("ab-hooks-generate").click();
  await expect(ab.getByTestId("ab-hook-idea")).toHaveCount(3, { timeout: 30_000 });
  await expect(ab.getByTestId("ab-hooks-make")).toHaveText(/Utwórz wersje A\/B \(3\)/);
  await ab.getByTestId("ab-hooks-make").click();
  await expect(ab.getByTestId("ab-hooks-versions")).toContainText("Hook B: Alternatywny hook lęk", { timeout: 60_000 });

  await expect
    .poll(async () => {
      const d = await doc();
      return [d.hooks?.variants.length, d.hooks?.variants.filter((v: { narration?: unknown }) => v.narration).length, d.hooks?.narrationClipId === d.narration[0]?.id];
    }, { timeout: 30_000 })
    .toEqual([3, 2, true]);

  // switching a version swaps the title and the narration; the expert's recording stays
  const before = await doc();
  await page.getByTestId("hook-version").selectOption("1");
  await expect
    .poll(async () => {
      const d = await doc();
      const title = d.overlays.find((o: { role?: string }) => o.role === "question")?.text;
      return [title, d.narration[0].assetId !== before.narration[0].assetId, JSON.stringify(d.clips.map((c: { assetId: string }) => c.assetId)) === JSON.stringify(before.clips.map((c: { assetId: string }) => c.assetId))];
    }, { timeout: 20_000 })
    .toEqual(["Alternatywny hook lęk", true, true]);
  await page.getByTestId("hook-version").selectOption("0");

  // one MP4 per version
  await page.getByRole("button", { name: "Eksportuj" }).click();
  const exp = page.getByTestId("hook-versions-export");
  await exp.getByRole("button", { name: /Renderuj wszystkie wersje hooka \(3\)/ }).click();
  await expect(exp.getByTestId("hook-version-download")).toHaveCount(3, { timeout: 300_000 });
  const href = await exp.getByTestId("hook-version-download").nth(1).getAttribute("href");
  const mp4 = await request.get(href!);
  expect(mp4.status()).toBe(200);
  expect((await mp4.body()).subarray(4, 8).toString()).toBe("ftyp");

  // ...and all of them in one ZIP instead of a link per file
  const zipHref = await exp.getByTestId("hook-versions-zip").getAttribute("href");
  expect(zipHref).toMatch(/^\/api\/admin\/render-jobs\/zip\?ids=[\w,]+$/);
  const zipRes = await request.get(zipHref!);
  expect(zipRes.status()).toBe(200);
  expect(zipRes.headers()["content-type"]).toBe("application/zip");
  const entries = unzipSync(new Uint8Array(await zipRes.body()));
  const names = Object.keys(entries);
  expect(names).toHaveLength(3);
  expect(new Set(names).size).toBe(3);
  for (const n of names) {
    expect(n).toMatch(/\.mp4$/);
    expect(Buffer.from(entries[n]).subarray(4, 8).toString()).toBe("ftyp");
  }
  expect(Buffer.from(entries[names[1]]).length).toBe((await mp4.body()).length);
});
