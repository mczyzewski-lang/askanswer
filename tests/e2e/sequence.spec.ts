import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { unzipSync } from "fflate";
import { adminRequest, demoProject, login } from "./helpers";

/**
 * Sekwencja: a package of ready-cut clips + manifest.json becomes films (in versions), each an
 * ordinary 1:1 Studio edit that can be reviewed and exported; all exports come as one ZIP.
 */
test("sequence: a package of clips → films in versions → review → 1:1 exports in one ZIP", async ({ page, request }) => {
  test.setTimeout(420_000);
  await adminRequest(request);
  const { project } = await demoProject(request);
  // the project has its own CTA end card: the films of a sequence go without it
  expect((await request.patch(`/api/admin/projects/${project.id}`, { data: { ctaEnabled: true, ctaUrl: "kancelaria.pl", ctaText: "Umów konsultację", ctaSeconds: 3, autoBlur: true } })).ok()).toBe(true);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "seq-"));
  // three square clips cut from the fixture; the card has no sound
  const cut = (name: string, ss: number, t: number, audio = true) =>
    execFileSync("ffmpeg", ["-v", "error", "-y", "-ss", String(ss), "-t", String(t), "-i", "tests/fixtures/generated/sample-take.mp4", "-vf", "crop=min(iw\\,ih):min(iw\\,ih),scale=540:540,fps=30", ...(audio ? ["-c:a", "aac"] : ["-an"]), "-c:v", "libx264", "-preset", "ultrafast", path.join(dir, name)]);
  cut("k1_kamil-otwarcie.mp4", 0, 2);
  cut("k1_kamil-otwarcie_v2.mp4", 2, 2.5);
  cut("c1_klient.mp4", 5, 1.5);
  cut("p1_plansza.mp4", 7, 1, false);
  const manifest = {
    films: [
      {
        code: "1",
        title: "Ile kosztuje rozwód?",
        subject: "[1 z 7] Ile kosztuje rozwód?",
        versions: [
          { version: "A", note: "Pierwsze ujęcie otwarcia", parts: [{ clip: "p1_plansza.mp4", label: "PLANSZA" }, { clip: "k1_kamil-otwarcie.mp4", label: "KAMIL" }, { clip: "c1_klient.mp4", label: "KLIENT" }] },
          { version: "B", note: "Drugie ujęcie otwarcia", parts: [{ clip: "p1_plansza.mp4", label: "PLANSZA" }, { clip: "k1_kamil-otwarcie_v2.mp4", label: "KAMIL" }, { clip: "c1_klient.mp4", label: "KLIENT" }] },
        ],
      },
      { code: "2", title: "Największy błąd", versions: [{ version: "A", parts: [{ clip: "k1_kamil-otwarcie.mp4", label: "KAMIL" }, { clip: "brak.mp4", label: "KLIENT" }] }] },
    ],
    words: { "k1_kamil-otwarcie.mp4": [{ text: "Najdroższy", start: 0.2, end: 0.7 }, { text: "rozwód.", start: 0.8, end: 1.4 }], "c1_klient.mp4": [{ text: "Byłam", start: 0.1, end: 0.5 }, { text: "przerażona.", start: 0.6, end: 1.2 }] },
  };
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest));

  await login(page);
  await page.goto(`/admin/projects/${project.id}`);
  await page.getByRole("link", { name: "Sekwencja" }).click();
  await expect(page.getByTestId("sequence")).toBeVisible();
  await page.getByTestId("sequence-input").setInputFiles(fs.readdirSync(dir).map((f) => path.join(dir, f)));
  const status = page.getByTestId("sequence-upload-status");
  await expect(status).toContainText("Filmy: 3 wersji - 2 nowych", { timeout: 180_000 });
  await expect(status).toContainText("Film 2A: brakuje klipów brak.mp4");

  // two films; film 1 in two versions with their lengths, film 2 waits for its missing clip
  await expect(page.getByTestId("sequence-film")).toHaveCount(2);
  const v = page.getByTestId("sequence-film").first().getByTestId("sequence-version");
  await expect(v).toHaveCount(2);
  await expect(v.nth(0)).toContainText("PLANSZA ×1, KAMIL ×1, KLIENT ×1");
  await expect(v.nth(0)).toContainText("0:05");
  await expect(v.nth(1)).toContainText("Drugie ujęcie otwarcia");
  await expect(page.getByTestId("sequence-film").nth(1)).toContainText("Brakuje klipów: brak.mp4");
  await expect(page.getByTestId("sequence-film").nth(1).getByTestId("sequence-open")).toHaveCount(0);

  // each version is a 1:1 Studio edit: the clips in order, subtitles from the manifest's words, no question card
  const data = await (await request.get(`/api/admin/sequence/${project.id}`)).json();
  const a = data.films.find((f: { code: string; version: string }) => f.code === "1" && f.version === "A");
  const doc = (await (await request.get(`/api/admin/compositions/${a.compositionId}`)).json()).composition.document;
  expect([doc.width, doc.height]).toEqual([1080, 1080]);
  expect(doc.clips.map((c: { label: string }) => c.label)).toEqual(["PLANSZA", "KAMIL", "KLIENT"]);
  expect(doc.clips[1].start).toBeCloseTo(1, 1);
  expect(doc.clips[2].start).toBeCloseTo(3, 1);
  expect(doc.subtitles.segments.flatMap((s: { words: Array<{ text: string }> }) => s.words.map((w) => w.text)).join(" ")).toBe("Najdroższy rozwód. Byłam przerażona.");
  expect(doc.overlays.some((o: { role?: string }) => o.role === "question")).toBe(false);
  expect(doc.subtitles.style.y).toBeCloseTo(0.86, 2);
  expect(doc.noEndCard).toBe(true);
  // ...and without the project's automatic background blur: the clips come ready
  expect(doc.clips.some((c: { background?: unknown }) => c.background)).toBe(false);
  expect(doc.endCard).toBeUndefined();
  // the cut to the client's words gets the quick stair wipe without a title, its middle on the cut; card → expert stays a plain cut
  const wipes = doc.overlays.filter((o: { kind: string; preset?: string }) => o.kind === "typo" && o.preset === "stairWipe");
  expect(wipes).toHaveLength(1);
  expect(wipes[0].text).toBe("");
  expect((wipes[0].start + wipes[0].end) / 2).toBeCloseTo(3, 1);
  expect(wipes[0].end - wipes[0].start).toBeCloseTo(1.2, 1);
  expect(doc.overlays.some((o: { preset?: string }) => o.preset === "stairMark")).toBe(false);

  // review marks, then the Studio opens the edit
  await page.getByLabel("Ocena wersji 1B").selectOption("OK");
  await expect(v.nth(1)).toHaveAttribute("data-review", "OK");
  if (process.env.LP_SHOTS) await page.screenshot({ path: `${process.env.LP_SHOTS}/sequence.png`, fullPage: true });

  // the same package again changes nothing; a version edited in the Studio is not laid out again
  const again = await (await request.post(`/api/admin/sequence/${project.id}/manifest`, { data: manifest })).json();
  expect(again).toMatchObject({ created: 0, updated: 0, kept: 2 });

  // explainers: sent later with a manifest that says where they go - they become layers, switched on and off per version
  cut("E1a.mp4", 8, 2, false);
  const withExpl = { ...manifest, films: manifest.films.map((f) => ({ ...f, versions: f.versions.map((vv) => (f.code === "1" ? { ...vv, overlays: [{ clip: "E1a.mp4", at: 1.5, until: 2.8 }, { clip: "E9z.mp4", at: 3.2, until: 4.3 }] } : vv)) })) };
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(withExpl));
  await page.getByTestId("sequence-input").setInputFiles([path.join(dir, "E1a.mp4"), path.join(dir, "manifest.json")]);
  await expect(status).toContainText("Explainery: dodano 2 warstw do filmów", { timeout: 120_000 });
  await expect(status).toContainText("2 bez zmian");
  const ex = v.nth(0).getByTestId("sequence-explainers");
  await expect(ex).toContainText("1 z 1 włączonych");
  await expect(ex).toContainText("czekają na pliki: E9z.mp4");
  const layersOf = async () => (await (await request.get(`/api/admin/compositions/${a.compositionId}`)).json()).composition.document.overlays.filter((o: { id: string }) => o.id.startsWith("expl_"));
  // from its moment, for the clip's length but never past `until`; full frame, quiet
  expect(await layersOf()).toMatchObject([{ kind: "video", start: 1.5, end: 2.8, w: 1, h: 1, fit: "cover", volume: 0.4 }]);
  await v.nth(0).getByTestId("sequence-explainers-toggle").click();
  await expect(ex).toContainText("0 z 1 włączonych");
  expect((await layersOf())[0].hidden).toBe(true);
  await v.nth(0).getByTestId("sequence-explainers-toggle").click();
  await expect(ex).toContainText("1 z 1 włączonych");
  // sending the same again adds nothing
  expect((await (await request.post(`/api/admin/sequence/${project.id}/explainers`)).json()).added).toBe(0);

  await expect(page.getByTestId("sequence-explainer-files")).toContainText("Explainery w bibliotece: 1 z 2 (E1a)");
  // an explainer sent under another spelling of its name ("e9z final.MP4") is still found
  cut("e9z final.mp4", 8, 1.2, false);
  await page.getByTestId("sequence-input").setInputFiles([path.join(dir, "e9z final.mp4")]);
  await expect(status).toContainText("Explainery: dodano 2 warstw do filmów.", { timeout: 120_000 });
  await expect(ex).toContainText("2 z 2 włączonych");

  // outro: a ready clip uploaded once, added to every film as its last clip (or to one), and taken out again
  cut("moje-outro.mp4", 6, 1);
  await page.getByTestId("sequence-outro-input").setInputFiles([path.join(dir, "moje-outro.mp4")]);
  await expect(page.getByTestId("sequence-outro-file")).toContainText("moje-outro.mp4", { timeout: 120_000 });
  await page.getByTestId("sequence-outro-all").click();
  await expect(v.nth(0)).toContainText("Outro: jest na końcu");
  await expect(v.nth(1)).toContainText("Outro: jest na końcu");
  const clipsOf = async () => (await (await request.get(`/api/admin/compositions/${a.compositionId}`)).json()).composition.document.clips as Array<{ label: string; start: number; assetId: string }>;
  expect((await clipsOf()).map((c) => c.label)).toEqual(["PLANSZA", "KAMIL", "KLIENT", "OUTRO"]);
  expect((await clipsOf())[3].start).toBeCloseTo(4.5, 1);

  // a clip uploaded again under the same name is a new file: the edits that use it are laid out again - with their explainers and outro
  const before = (await clipsOf())[2].assetId;
  cut("c1_klient.mp4", 5.2, 1.5);
  await page.getByTestId("sequence-input").setInputFiles([path.join(dir, "c1_klient.mp4"), path.join(dir, "manifest.json")]);
  await expect(status).toContainText("2 zaktualizowanych", { timeout: 120_000 });
  expect((await clipsOf())[2].assetId).not.toBe(before);
  expect((await clipsOf()).map((c) => c.label)).toEqual(["PLANSZA", "KAMIL", "KLIENT", "OUTRO"]);
  expect(await layersOf()).toHaveLength(2);
  // new word times alone (the manifest sent again) also lay the subtitles out again
  const retimed = { ...withExpl, words: { ...manifest.words, "c1_klient.mp4": [{ text: "Byłam", start: 0.3, end: 0.7 }, { text: "przerażona.", start: 0.8, end: 1.4 }] } };
  expect(await (await request.post(`/api/admin/sequence/${project.id}/manifest`, { data: retimed })).json()).toMatchObject({ updated: 2, kept: 0 });
  const subs = (await (await request.get(`/api/admin/compositions/${a.compositionId}`)).json()).composition.document.subtitles.segments.flatMap((sg: { words: Array<{ text: string; start: number }> }) => sg.words);
  expect(subs.find((w: { text: string }) => w.text === "Byłam").start).toBeCloseTo(0.3, 2);
  expect(await (await request.post(`/api/admin/sequence/${project.id}/manifest`, { data: retimed })).json()).toMatchObject({ updated: 0, kept: 2 });
  await v.nth(0).getByTestId("sequence-outro-toggle").click();
  await expect(v.nth(0)).toContainText("Outro: brak");
  await v.nth(1).getByTestId("sequence-outro-toggle").click();
  await expect(v.nth(1)).toContainText("Outro: brak");
  expect((await clipsOf()).map((c) => c.label)).toEqual(["PLANSZA", "KAMIL", "KLIENT"]);

  // export all: one 1:1 MP4 per version, then one ZIP
  await page.getByTestId("sequence-render-all").click();
  await expect(page.getByTestId("sequence-zip")).toBeVisible({ timeout: 300_000 });
  const zip = await request.get((await page.getByTestId("sequence-zip").getAttribute("href"))!);
  expect(zip.status()).toBe(200);
  const entries = unzipSync(new Uint8Array(await zip.body()));
  const names = Object.keys(entries);
  expect(names).toHaveLength(2);
  const out = path.join(dir, "out.mp4");
  fs.writeFileSync(out, Buffer.from(entries[names[0]]));
  const probe = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", out]).toString());
  const vs = probe.streams.find((s: { codec_type: string }) => s.codec_type === "video");
  expect([vs.width, vs.height]).toEqual([1080, 1080]);
  expect(Math.abs(Number(probe.format.duration) - 4.5)).toBeLessThan(0.5);
  expect(probe.streams.some((s: { codec_type: string }) => s.codec_type === "audio")).toBe(true);

  // film 2 waited for a clip: sent later on its own (no manifest), the film is laid out
  cut("brak.mp4", 4, 1.2);
  await page.getByTestId("sequence-input").setInputFiles([path.join(dir, "brak.mp4")]);
  await expect(page.getByTestId("sequence-film").nth(1).getByTestId("sequence-open")).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId("sequence-film").nth(1)).not.toContainText("Brakuje klipów");

  await page.getByTestId("sequence-film").first().getByTestId("sequence-open").first().click();
  await page.waitForURL(`**/studio/${a.compositionId}`);
  await expect(page.getByTestId("save-status")).toBeVisible();
  if (process.env.LP_SHOTS) await page.screenshot({ path: `${process.env.LP_SHOTS}/sequence-studio.png` });
  fs.rmSync(dir, { recursive: true, force: true });
});

/** Testimoniale: the same package mechanics in its own tab - clients signed by name, a cover to download per film. */
test("testimonials: films with client captions and a downloadable cover", async ({ page, request, playwright }) => {
  test.setTimeout(780_000);
  await adminRequest(request);
  const { project } = await demoProject(request);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "testi-"));
  const cut = (name: string, ss: number, t: number) => execFileSync("ffmpeg", ["-v", "error", "-y", "-ss", String(ss), "-t", String(t), "-i", "tests/fixtures/generated/sample-take.mp4", "-vf", "crop=min(iw\\,ih):min(iw\\,ih),scale=540:540,fps=30", "-c:a", "aac", "-c:v", "libx264", "-preset", "ultrafast", path.join(dir, name)]);
  cut("t_agnieszka.mp4", 0, 3);
  cut("t_mariusz.mp4", 3, 2.5);
  cut("t_plansza.mp4", 6, 1);
  // the package's own dressing: the steps animation for the corner and the gradient under the subtitles
  cut("t_schodki.mp4", 1, 2);
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=0x163028@0.5:s=270x270,format=rgba", "-frames:v", "1", path.join(dir, "t_gradient.png")]);
  execFileSync("ffmpeg", ["-v", "error", "-y", "-ss", "1", "-i", "tests/fixtures/generated/sample-take.mp4", "-frames:v", "1", "-vf", "crop=min(iw\\,ih):min(iw\\,ih),scale=540:540", path.join(dir, "F1_okladka.jpg")]);
  const manifest = {
    kind: "testimonial",
    films: [{ code: "F1", title: "Od czego zaczynałem", subject: "Zaczyna: Agnieszka", cover: "F1_okladka.jpg", versions: [{ version: "A", parts: [
      { clip: "t_agnieszka.mp4", label: "KLIENT", caption: { title: "Agnieszka", subtitle: "klientka Nowego Etapu" } },
      { clip: "t_mariusz.mp4", label: "KLIENT", caption: { title: "Mariusz", subtitle: "klient Nowego Etapu" } },
      { clip: "t_plansza.mp4", label: "PLANSZA" },
    ] }] }],
  };
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest));
  await login(page);
  await page.goto(`/admin/projects/${project.id}`);
  await page.getByRole("link", { name: "Testimoniale" }).click();
  await expect(page.getByRole("heading", { name: "Testimoniale" })).toBeVisible();
  await page.getByTestId("sequence-input").setInputFiles(fs.readdirSync(dir).map((f) => path.join(dir, f)));
  await expect(page.getByTestId("sequence-upload-status")).toContainText("Filmy: 1 wersji - 1 nowych", { timeout: 120_000 });
  // the film is listed here (not under Sekwencja), with its cover to download
  await expect(page.getByTestId("sequence-film")).toHaveCount(1);
  await expect(page.getByTestId("sequence-film")).toContainText("Film 1 · Od czego zaczynałem");
  await expect(page.getByTestId("sequence-cover")).toBeVisible();
  await expect.poll(() => page.getByTestId("sequence-cover").evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  const cover = await request.get((await page.getByTestId("sequence-cover-download").getAttribute("href"))!);
  expect(cover.status()).toBe(200);
  expect((await cover.body()).subarray(0, 2).toString("hex")).toBe("ffd8");
  expect(cover.headers()["content-disposition"]).toContain("F1_okladka.jpg");
  const data = await (await request.get(`/api/admin/sequence/${project.id}?kind=testimonial`)).json();
  expect((await (await request.get(`/api/admin/sequence/${project.id}`)).json()).films.some((f: { code: string }) => f.code === "F1")).toBe(false);
  // the edit is named after its tab (the Studio header and the exported file show it)
  expect((await (await request.get(`/api/admin/compositions/${data.films[0].compositionId}`)).json()).composition.name).toBe("Testimonial F1A - Od czego zaczynałem");
  const doc = (await (await request.get(`/api/admin/compositions/${data.films[0].compositionId}`)).json()).composition.document;
  // every client is signed when the clip starts: the name as the title, "klient Nowego Etapu" under it
  const caps = doc.overlays.filter((o: { kind: string }) => o.kind === "lowerThird");
  expect(caps.map((o: { title: string; subtitle: string }) => [o.title, o.subtitle])).toEqual([["Agnieszka", "klientka Nowego Etapu"], ["Mariusz", "klient Nowego Etapu"]]);
  // (after the quick wipe that covers the cut between the two clients)
  expect(caps[1].start).toBeCloseTo(3.7, 1);
  // one wipe between the two clients, one into the end card
  expect(doc.overlays.filter((o: { preset?: string }) => o.preset === "stairWipe")).toHaveLength(2);
  // the brand's steps in the top right corner over the clients, switched off and on from the list
  const markOf = async () => (await (await request.get(`/api/admin/compositions/${data.films[0].compositionId}`)).json()).composition.document.overlays.find((o: { id: string }) => o.id.startsWith("mark_"));
  // the package's animation, as a rounded quiet tile exactly as high (and at the height) of the client's name plate
  expect(await markOf()).toMatchObject({ kind: "video", loop: false, y: caps[0].y, h: caps[0].h });
  expect((await markOf()).x + (await markOf()).w).toBeCloseTo(1 - caps[0].x, 2);
  expect((await markOf()).volume).toBeLessThan(0.5);
  expect((await markOf()).radius).toBeGreaterThan(0);
  // the gradient lies under everything else, from the start to the end card
  expect(doc.overlays.findIndex((o: { id: string }) => o.id.startsWith("shade_"))).toBeLessThan(doc.overlays.findIndex((o: { kind: string }) => o.kind === "lowerThird"));
  expect(doc.overlays.find((o: { id: string }) => o.id.startsWith("shade_"))).toMatchObject({ kind: "image", start: 0, end: 5.5, w: 1, h: 1 });
  // the same package again changes nothing
  expect(await (await request.post(`/api/admin/sequence/${project.id}/manifest`, { data: manifest })).json()).toMatchObject({ updated: 0, kept: 1 });
  await expect(page.getByTestId("sequence-version")).toContainText("Schodki w narożniku: włączone");
  await page.getByTestId("sequence-mark-toggle").click();
  await expect(page.getByTestId("sequence-version")).toContainText("Schodki w narożniku: wyłączone");
  expect((await markOf()).hidden).toBe(true);
  await page.getByTestId("sequence-mark-toggle").click();
  await expect(page.getByTestId("sequence-version")).toContainText("Schodki w narożniku: włączone");
  expect(caps[0].titleSize).toBeGreaterThan(caps[0].subtitleSize * 1.5);
  // export without the end card: the film ends on the last client (the edit itself keeps its card)
  expect(doc.clips.map((c: { label: string }) => c.label)).toEqual(["KLIENT", "KLIENT", "PLANSZA"]);
  await page.getByTestId("sequence-no-card").check();
  const started = page.waitForResponse((r) => r.url().includes("/render") && r.request().method() === "POST");
  await page.getByTestId("sequence-render-all").click();
  const job = (await (await started).json()).jobs[0];
  let done: { status: string; downloadUrl?: string; duration?: number } = { status: "QUEUED" };
  await expect.poll(async () => (done = await (await request.get(`/api/admin/render-jobs/${job.id}`)).json()).status, { timeout: 180_000, intervals: [3000] }).toMatch(/SUCCEEDED|FAILED/);
  expect(done.status).toBe("SUCCEEDED");
  expect(done.duration).toBeCloseTo(5.5, 0);
  expect(done.duration!).toBeLessThan(6);
  const after = (await (await request.get(`/api/admin/compositions/${data.films[0].compositionId}`)).json()).composition.document;
  expect(after.clips).toHaveLength(3);
  // embedding: publish the files (with and without the end card), take the codes, watch one, see the numbers
  await page.getByTestId("sequence-embed-publish").click({ timeout: 20_000 });
  await expect(page.getByTestId("sequence-embed-codes")).toBeVisible({ timeout: 240_000 });
  const txt = await (await request.get((await page.getByTestId("sequence-embed-codes").getAttribute("href"))!)).text();
  expect(txt).toContain("Z planszą końcową:");
  expect(txt).toContain("Bez planszy końcowej:");
  const srcs = [...txt.matchAll(/<iframe src="([^"]+)"/g)].map((m) => m[1]);
  expect(srcs).toHaveLength(2);
  expect(srcs[0]).toMatch(/\/embed\/t\/[\w-]+\?p=1$/);
  expect(srcs[1]).toMatch(/\?p=0$/);
  // the player is public and may be framed by any site; the admin pages may not
  const anon = await playwright.request.newContext();
  const player = await anon.get(srcs[0]);
  expect(player.status()).toBe(200);
  expect(player.headers()["x-frame-options"]).toBeUndefined();
  expect(player.headers()["content-security-policy"]).toContain("frame-ancestors *");
  expect((await request.get(`/admin/testimoniale/${project.id}`)).headers()["x-frame-options"]).toBe("SAMEORIGIN");
  expect(await player.text()).toContain("Odtwórz film: Od czego zaczynałem");
  const tokenUrl = srcs[0].replace(/\?p=1$/, "");
  const lengthOf = async (p: number) => {
    const f = path.join(dir, `embed-${p}.mp4`);
    fs.writeFileSync(f, await (await anon.get(`${tokenUrl}/video?p=${p}`)).body());
    return Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString());
  };
  expect(await lengthOf(1)).toBeCloseTo(6.5, 0);
  expect(await lengthOf(0)).toBeCloseTo(5.5, 0);
  expect((await anon.get(`${tokenUrl}/cover`)).headers()["content-type"]).toContain("image/jpeg");
  expect((await anon.get(tokenUrl.replace(/[\w-]+$/, "nie-ma-takiego-filmu"))).status()).toBe(404);
  await anon.dispose();
  // a visitor opens the page with the player, presses play and watches to the end
  const visitor = await page.context().browser()!.newContext();
  const vp = await visitor.newPage();
  // (a page of the same host: the browser does not let a made-up public site frame localhost)
  const host = new URL(srcs[1]).origin;
  await vp.route(`${host}/strona-klienta/**`, (r) => r.fulfill({ contentType: "text/html", body: `<html><body style="margin:0"><iframe id="f" src="${srcs[1]}" style="width:480px;height:480px;border:0" allow="autoplay"></iframe></body></html>` }));
  await vp.goto(`${host}/strona-klienta/referencje`);
  const fr = vp.frameLocator("#f");
  await expect(fr.locator("img")).toBeVisible();
  await expect.poll(() => fr.locator("img").evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  if (process.env.LP_SHOTS) await vp.screenshot({ path: `${process.env.LP_SHOTS}/embed-player.png` });
  await fr.getByRole("button", { name: /Odtwórz film/ }).click();
  await expect.poll(() => fr.locator("video").evaluate((v) => (v as HTMLVideoElement).ended), { timeout: 60_000 }).toBe(true);
  await visitor.close();
  await expect
    .poll(async () => (await (await request.get(`/api/admin/sequence/${project.id}/embed?kind=testimonial`)).json()).films[0].nocard, { timeout: 30_000 })
    .toMatchObject({ loads: 1, plays: 1, viewers: 1, ends: 1, avgPercent: 100 });
  await page.reload();
  await expect(page.getByTestId("sequence-embed-film")).toContainText("1 odtworzeń (1 osoba) · średnio 100% filmu · 1 do końca");
  await expect(page.getByTestId("sequence-embed-film")).toContainText("opublikowany");
  await expect(page.getByTestId("sequence-embed-film")).toContainText("/strona-klienta/referencje (1)");
  await page.getByTestId("sequence-embed-recent-toggle").click();
  await expect(page.getByTestId("sequence-embed-recent")).toContainText("F1A bez planszy · obejrzane 100%");
  if (process.env.LP_SHOTS) await page.screenshot({ path: `${process.env.LP_SHOTS}/testimoniale.png`, fullPage: true });
  fs.rmSync(dir, { recursive: true, force: true });
});
