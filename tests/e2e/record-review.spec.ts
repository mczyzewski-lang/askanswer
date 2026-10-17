import { expect, test } from "@playwright/test";
import { adminRequest, newInvitation } from "./helpers";

const LONG = Array.from({ length: 40 }, (_, i) => `Zdanie numer ${i + 1} długiej treści promptera, które trzeba przewinąć.`).join("\n");

/** The expert reads the content before recording: swipe cards on the phone, a table on the desktop. */
test("expert reviews and accepts content (phone swipe + desktop table)", async ({ page, request, browser }) => {
  await adminRequest(request);
  const project = await (await request.post("/api/admin/projects", { data: { name: "Akceptacja treści", format: "HYBRID", preset: "pravna" } })).json();
  const expert = (await (await request.post(`/api/admin/projects/${project.id}/experts`, { data: { name: "Olga Recenzja" } })).json()).expert;
  const q = await (
    await request.post(`/api/admin/projects/${project.id}/questions`, {
      data: {
        items: [
          { kind: "QUESTION", text: "Pierwsze pytanie do akceptacji" },
          { kind: "PROMPTER", text: "Drugi hook", script: LONG },
          { kind: "QUESTION_PROMPTER", text: "Trzecie pytanie", spokenText: "Lektor czyta trzecie", script: "Odpowiedź trzecia." },
        ],
      },
    })
  ).json();
  const ids: string[] = q.items.map((x: { id: string }) => x.id);
  const { url, token } = await newInvitation(request, project.id, expert.id);
  const approved = async () => {
    // long content: a real finger scrolls it vertically and still swipes the card sideways
  const cdp = await page.context().newCDPSession(page);
  const touch = async (from: [number, number], to: [number, number]) => {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: from[0], y: from[1] }] });
    for (let i = 1; i <= 10; i++)
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: from[0] + ((to[0] - from[0]) * i) / 10, y: from[1] + ((to[1] - from[1]) * i) / 10 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  };
  const body = page.getByTestId("review-card-body");
  expect(await body.evaluate((el) => el.scrollHeight > el.clientHeight + 100)).toBe(true);
  const cb = (await card.boundingBox())!;
  const mid: [number, number] = [cb.x + cb.width / 2, cb.y + cb.height * 0.7];
  await touch(mid, [mid[0], mid[1] - 200]);
  await expect.poll(() => body.evaluate((el) => el.scrollTop)).toBeGreaterThan(50);
  await touch(mid, [mid[0] - 220, mid[1] + 10]);
  await expect(page.getByTestId("review-edit-sheet")).toBeVisible();
  await page.getByRole("button", { name: "Anuluj edycję" }).click();
  await expect(card).toContainText("Drugi hook");

  const s = await (await request.get(`/api/record/${token}`)).json();
    return s.review.filter((r: { approved: boolean }) => r.approved).map((r: { id: string }) => r.id).sort();
  };

  // ── phone: swipe right accepts, "Pomiń" keeps the item in the pool, swipe left opens editing
  await page.goto(url);
  await expect(page.getByTestId("review-button")).toContainText("3");
  await page.getByTestId("review-button").click();
  const card = page.getByTestId("review-card");
  await expect(card).toContainText("Pierwsze pytanie do akceptacji");
  const swipe = async (dx: number) => {
    const b = (await card.boundingBox())!;
    const y = b.y + b.height / 2;
    await page.mouse.move(b.x + b.width / 2, y);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(b.x + b.width / 2 + (dx * i) / 8, y);
    await page.mouse.up();
  };
  await swipe(200);
  await expect(card).toContainText("Drugi hook");
  await expect.poll(approved).toEqual([ids[0]].sort());
  await page.getByTestId("review-skip").click();
  await expect(card).toContainText("Trzecie pytanie");
  await swipe(-200);
  const sheet = page.getByTestId("review-edit-sheet");
  await expect(sheet).toBeVisible();
  await sheet.getByLabel("Pytanie czytane przez lektora").fill("Lektor czyta poprawione trzecie");
  await page.getByTestId("review-save-accept").click();
  // the skipped one came back
  await expect(card).toContainText("Drugi hook");
  await expect.poll(approved).toEqual([ids[0], ids[2]].sort());
  const s = await (await request.get(`/api/record/${token}`)).json();
  expect(s.review.find((r: { id: string }) => r.id === ids[2]).spokenText).toBe("Lektor czyta poprawione trzecie");

  // another expert's item cannot be touched
  const other = await request.patch(`/api/record/${token}/questions/not-a-real-id`, { data: { approve: true } });
  expect(other.status()).toBeGreaterThanOrEqual(400);

  // ── desktop: table like the CSV, edit in place + [Zatwierdź]
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false });
  const desk = await ctx.newPage();
  await desk.goto(url);
  await desk.getByTestId("review-button").click();
  await expect(desk.getByTestId("review-table")).toBeVisible();
  const row = desk.getByTestId("review-row");
  await expect(row).toHaveCount(1);
  await expect(row).toHaveAttribute("data-approved", "false");
  await row.getByLabel("Treść").fill("Treść drugiego skryptu, poprawiona.");
  await row.getByTestId("review-row-accept").click();
  await expect.poll(approved).toEqual([...ids].sort());
  const s2 = await (await request.get(`/api/record/${token}`)).json();
  expect(s2.review.find((r: { id: string }) => r.id === ids[1]).script).toBe("Treść drugiego skryptu, poprawiona.");

  // ── admin sees it; an admin content change withdraws the approval
  const data = await (await request.get(`/api/admin/projects/${project.id}`)).json();
  expect(data.questions.every((x: { contentApproved: boolean }) => x.contentApproved)).toBe(true);
  await request.patch(`/api/admin/questions/${ids[0]}`, { data: { text: "Pierwsze pytanie — zmienione przez admina" } });
  await expect.poll(approved).toEqual([ids[1], ids[2]].sort());
  await ctx.close();
});
