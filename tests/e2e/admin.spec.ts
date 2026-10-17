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

test("narrator: Eleven v4 by default, random voice from a collection, subtle fillers", async ({ request }) => {
  await adminRequest(request);
  const data = await demoProject(request);
  const pid = data.project.id;
  const project = (await (await request.get(`/api/admin/projects/${pid}`)).json()).project;
  expect(project.ttsModel).toBe("eleven_v4");
  const col = await (await request.post("/api/admin/voice-collections", { data: { name: "Lektorzy losowi" } })).json();
  for (const [v, label] of [["mock-voice-pl", "Pani Anna"], ["mock-voice-2", "Pan Marek"]]) expect((await request.post(`/api/admin/voice-collections/${col.id}/items`, { data: { voiceId: v, label } })).ok()).toBeTruthy();
  await request.patch(`/api/admin/projects/${pid}`, { data: { name: project.name, voiceCollectionId: col.id, naturalFillers: true } });
  const texts = Array.from({ length: 8 }, (_, i) => `Czy w sprawie numer ${i + 1} mogę złożyć wniosek, jeśli termin już minął?`);
  const created = await (await request.post(`/api/admin/projects/${pid}/questions`, { data: { items: texts.map((text) => ({ text })) } })).json();
  try {
    for (const q of created.items) expect((await request.post(`/api/admin/questions/${q.id}/narration`)).ok()).toBeTruthy();
    const stats = await (await request.get("http://127.0.0.1:4010/__stats", { headers: { "xi-api-key": "mock-key" } })).json();
    const calls = stats.tts.filter((c: { text: string }) => /sprawie numer/.test(c.text)).slice(-8);
    expect(calls).toHaveLength(8);
    for (const c of calls) {
      expect(c.model).toBe("eleven_v4");
      expect(["mock-voice-pl", "mock-voice-2"]).toContain(c.voiceId);
      expect(c.settings).not.toHaveProperty("style"); // v4 has no style control
      expect((c.text.match(/…/g) ?? []).length).toBeLessThanOrEqual(1);
    }
    // a woman asks ("mężowi") → only "Pani" voices; a man asks ("żonie") → only "Pan" voices
    const gendered = await (
      await request.post(`/api/admin/projects/${pid}/questions`, {
        data: { items: [1, 2, 3, 4].flatMap((i) => [{ text: `Jak powiedzieć mężowi o rozwodzie, wersja ${i}?` }, { text: `Jak powiedzieć żonie o rozwodzie, wersja ${i}?` }]) },
      })
    ).json();
    created.items.push(...gendered.items);
    for (const q of gendered.items) expect((await request.post(`/api/admin/questions/${q.id}/narration`)).ok()).toBeTruthy();
    const st2 = await (await request.get("http://127.0.0.1:4010/__stats", { headers: { "xi-api-key": "mock-key" } })).json();
    const g = st2.tts.filter((c: { text: string }) => /(mężowi|żonie).*rozwodzie.*wersja \d/.test(c.text));
    expect(g.length).toBe(8);
    for (const c of g) expect(c.voiceId).toBe(/mężowi/.test(c.text) ? "mock-voice-pl" : "mock-voice-2");
    // the same question always gets the same voice and wording (cached, consistent re-records)
    const again = await (await request.post(`/api/admin/questions/${created.items[0].id}/narration`)).json();
    const first = await (await request.post(`/api/admin/questions/${created.items[0].id}/narration`)).json();
    expect(again.assetId).toBe(first.assetId);
  } finally {
    await request.patch(`/api/admin/projects/${pid}`, { data: { name: project.name, voiceCollectionId: null } });
    for (const q of created.items) await request.delete(`/api/admin/questions/${q.id}`);
  }
});

test("Prompter CSV import: Kategoria;Podkategoria;Hook;Treść (Excel Windows-1250)", async ({ page, request }) => {
  await adminRequest(request);
  const project = await (await request.post("/api/admin/projects", { data: { name: "CSV prompter", format: "PROMPTER", preset: "pravna" } })).json();
  try {
    await login(page);
    await page.goto(`/admin/projects/${project.id}`);
    const csv = 'Kategoria;Podkategoria;Hook;Treść\r\nGrowth;sprzedaż;3 błędy, które kosztują Cię klientów;"Pierwszy błąd.\r\nDrugi błąd."\r\nGrowth;;Dlaczego reklamy nie działają?;Bo liczy się komunikat.\r\n';
    // encode as cp1250 the way Polish Excel saves "CSV (rozdzielany średnikami)"
    const cp: Record<string, number> = { ą: 0xb9, ć: 0xe6, ę: 0xea, ł: 0xb3, ń: 0xf1, ó: 0xf3, ś: 0x9c, ź: 0x9f, ż: 0xbf, Ś: 0x8c, Ż: 0xaf };
    const buf = Buffer.from([...csv].map((ch) => cp[ch] ?? ch.charCodeAt(0)));
    await page.locator('input[type="file"][accept*="csv"]').setInputFiles({ name: "skrypty.csv", mimeType: "text/csv", buffer: buf });
    await expect(page.getByText("Zaimportowano 2 skrypty")).toBeVisible();
    await expect(page.getByText("3 błędy, które kosztują Cię klientów")).toBeVisible();
    const d = await (await request.get(`/api/admin/projects/${project.id}`)).json();
    const s = d.questions.find((q: { text: string }) => q.text.startsWith("3 błędy"));
    expect(s.script).toBe("Pierwszy błąd.\nDrugi błąd.");
    expect(s).toMatchObject({ categoryName: "Growth", subcategoryName: "sprzedaż" });

    // nobody assigned yet → visible warning; then one click assigns them to the project's expert
    await expect(page.getByTestId("unassigned-banner")).toContainText("2 skrypty bez eksperta");
    const ex = (await (await request.post(`/api/admin/projects/${project.id}/experts`, { data: { name: "Ekspert CSV" } })).json()).expert;
    await page.reload();
    await page.getByRole("button", { name: "Przypisz do: Ekspert CSV" }).click();
    await expect(page.getByTestId("unassigned-banner")).toHaveCount(0);

    // with a single project expert, new imports are assigned to them automatically
    const more = Buffer.from("Hook;Treść\nTrzeci hook do nagrania;Krótka treść.\n");
    await page.locator('input[type="file"][accept*="csv"]').setInputFiles({ name: "wiecej.csv", mimeType: "text/csv", buffer: more });
    await expect(page.getByText("Zaimportowano 1 skrypt")).toBeVisible();
    await expect(page.getByTestId("unassigned-banner")).toHaveCount(0);

    // and the expert's recording link lists all three scripts
    const { token } = await newInvitation(request, project.id, ex.id);
    const session = await (await request.get(`/api/record/${token}`)).json();
    expect(session.questions).toHaveLength(3);
  } finally {
    await request.delete(`/api/admin/projects/${project.id}`);
  }
});

test("recordings list: statuses stand apart, sorting and status filter", async ({ page, request }) => {
  await adminRequest(request);
  const data = await demoProject(request);
  const [a, b] = data.questions;
  await request.patch(`/api/admin/questions/${a.id}`, { data: { status: "APPROVED" } });
  await request.patch(`/api/admin/questions/${b.id}`, { data: { status: "IN_PROGRESS" } });
  await login(page);
  await page.getByText("Pravna — Znaki Towarowe").click();
  // coloured per status
  await expect(page.locator('[data-status="APPROVED"]').first()).toBeVisible();
  await expect(page.locator('[data-status="IN_PROGRESS"]').first()).toBeVisible();
  // sorted by status: group headers, "W trakcie" before "Zatwierdzone"
  await page.getByLabel("Sortowanie").selectOption("status");
  const groups = page.getByTestId("status-group");
  const labels = await groups.allTextContents();
  expect(labels.findIndex((l) => l.includes("W trakcie"))).toBeLessThan(labels.findIndex((l) => l.includes("Zatwierdzone")));
  // filter: only approved
  await page.getByTestId("status-filter").getByRole("button", { name: /Zatwierdzone/ }).click();
  await expect(page.locator("[data-status]").first()).toHaveAttribute("data-status", "APPROVED");
  expect(await page.locator('[data-status]:not([data-status="APPROVED"])').count()).toBe(0);
});

test("hybrid project: mixed CSV (typ;kategoria;podkategoria;tytuł wideo;treść) and kind per item", async ({ page, request }) => {
  await adminRequest(request);
  const project = await (await request.post("/api/admin/projects", { data: { name: "Hybryda CSV", format: "HYBRID", preset: "pravna" } })).json();
  await login(page);
  await page.goto(`/admin/projects/${project.id}`);
  const csv = "pytania;Rozwody;dzieci;Kto decyduje o opiece?;Odpowiedz krótko\nprompter;Growth;;3 błędy sprzedaży;\"Pierwszy błąd.\nDrugi błąd.\"\npytaniazprompterem;Growth;ceny;Jak podnieść ceny?;Zacznij od nowych klientów.\n";
  await page.locator('input[type="file"][accept=".csv,text/csv"]').setInputFiles({ name: "hybryda.csv", mimeType: "text/csv", buffer: Buffer.from(csv, "utf-8") });
  await expect(page.getByText(/Zaimportowano 3 pozycje/)).toBeVisible();
  const badges = page.getByTestId("kind-badge");
  await expect(badges).toHaveCount(3);
  await expect(badges.nth(0)).toHaveText("Pytanie");
  await expect(badges.nth(1)).toHaveText("Prompter");
  await expect(badges.nth(2)).toHaveText("Pytanie + prompter");
  const d = await (await request.get(`/api/admin/projects/${project.id}`)).json();
  const qp = d.questions.find((x: { text: string }) => x.text === "Jak podnieść ceny?");
  expect(qp).toMatchObject({ kind: "QUESTION_PROMPTER", script: "Zacznij od nowych klientów.", subcategoryName: "ceny" });
});

test("bulk actions: select several (shift = range), change status, delete", async ({ page, request }) => {
  await adminRequest(request);
  const project = await (await request.post("/api/admin/projects", { data: { name: "Masowe akcje", preset: "pravna" } })).json();
  await request.post(`/api/admin/projects/${project.id}/questions`, { data: { items: ["Pierwsze pytanie testowe?", "Drugie pytanie testowe?", "Trzecie pytanie testowe?", "Czwarte pytanie testowe?"].map((text) => ({ text })) } });
  await login(page);
  await page.goto(`/admin/projects/${project.id}`);
  const boxes = page.getByTestId("row-select");
  await expect(boxes).toHaveCount(4);
  await boxes.nth(0).click();
  await boxes.nth(2).click({ modifiers: ["Shift"] }); // 1–3
  const bar = page.getByTestId("bulk-bar");
  await expect(bar).toContainText("Zaznaczono 3");
  await bar.getByLabel("Zmień status zaznaczonych").selectOption("APPROVED");
  await expect(page.getByText("Zmieniono status: 3")).toBeVisible();
  await expect(page.locator('[data-status="APPROVED"]')).toHaveCount(3);
  // delete two of them
  await boxes.nth(2).click();
  await expect(bar).toContainText("Zaznaczono 2");
  page.once("dialog", (d) => d.accept());
  await bar.getByTestId("bulk-delete").click();
  await expect(page.getByText("Usunięto: 2")).toBeVisible();
  await expect(page.getByTestId("row-select")).toHaveCount(2);
  await expect(page.getByTestId("bulk-bar")).toHaveCount(0);
  const d = await (await request.get(`/api/admin/projects/${project.id}`)).json();
  expect(d.questions.map((q: { text: string }) => q.text).sort()).toEqual(["Czwarte pytanie testowe?", "Trzecie pytanie testowe?"]);
});
