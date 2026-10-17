import { describe, expect, it } from "vitest";
import { createCanvas } from "@napi-rs/canvas";
import { parseHybridCsv } from "../../src/lib/csv-import";
import { effectiveKind, kindFromCsv } from "../../src/lib/question-kinds";
import { buildInitialDocument } from "../../src/lib/editor/factory";
import { DEFAULT_THEME } from "../../src/lib/themes";
import { contentDuration, docDuration } from "../../src/lib/editor/timeline";
import { applyEndCard } from "../../src/lib/end-card";
import { drawFrame, type Ctx } from "../../src/lib/render/compositor";

describe("hybrid projects", () => {
  it("reads the mixed CSV without a header", () => {
    const rows = parseHybridCsv(
      'pytania;Rozwody;dzieci;Kto decyduje o opiece?;Odpowiedz krótko\nprompter;Growth;;3 błędy sprzedaży;"Pierwszy błąd.\nDrugi błąd."\npytaniazprompterem;Growth;ceny;Jak podnieść ceny?;Zacznij od nowych klientów.',
    )!;
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ kind: "QUESTION", text: "Kto decyduje o opiece?", instructions: "Odpowiedz krótko", categoryName: "Rozwody", subcategoryName: "dzieci" });
    expect(rows[1]).toMatchObject({ kind: "PROMPTER", text: "3 błędy sprzedaży", script: "Pierwszy błąd.\nDrugi błąd." });
    expect(rows[2]).toMatchObject({ kind: "QUESTION_PROMPTER", text: "Jak podnieść ceny?", script: "Zacznij od nowych klientów.", subcategoryName: "ceny" });
  });

  it("6 columns: the video title and, separately, the question the narrator reads", () => {
    const rows = parseHybridCsv(
      'pytaniazprompterem;Growth;ceny;Jak podnieść ceny?;Chcę podnieść ceny, ale boję się, że klienci odejdą. Co robić?;"Zacznij od nowych klientów.\nPotem reszta."\npytania;Rozwody;;Kto decyduje o opiece?;;Odpowiedz krótko\nprompter;Growth;;3 błędy;;Pierwszy błąd.',
    )!;
    expect(rows[0]).toMatchObject({ kind: "QUESTION_PROMPTER", text: "Jak podnieść ceny?", spokenText: "Chcę podnieść ceny, ale boję się, że klienci odejdą. Co robić?", script: "Zacznij od nowych klientów.\nPotem reszta." });
    expect(rows[1]).toMatchObject({ kind: "QUESTION", text: "Kto decyduje o opiece?", spokenText: null, instructions: "Odpowiedz krótko" });
    expect(rows[2]).toMatchObject({ kind: "PROMPTER", text: "3 błędy", script: "Pierwszy błąd." });
    const withHeader = parseHybridCsv("Typ;Kategoria;Podkategoria;Tytuł wideo;Pytanie (czyta lektor);Treść\npytaniazprompterem;Growth;;Tytuł;Pełne pytanie klienta?;Odpowiedź z promptera")!;
    expect(withHeader[0]).toMatchObject({ text: "Tytuł", spokenText: "Pełne pytanie klienta?", script: "Odpowiedź z promptera" });
  });

  it("reads it with a header too, and leaves other files to the old parser", () => {
    const rows = parseHybridCsv("Typ;Kategoria;Podkategoria;Tytuł wideo;Treść\nPrompter;Growth;;Hook tutaj;Treść tutaj")!;
    expect(rows[0]).toMatchObject({ kind: "PROMPTER", text: "Hook tutaj", script: "Treść tutaj" });
    expect(parseHybridCsv("Kategoria;Podkategoria;Pytanie\nA;;Czy to działa?")).toBeNull();
    expect(kindFromCsv("Pytania z prompterem")).toBe("QUESTION_PROMPTER");
    expect(effectiveKind(null, "PROMPTER")).toBe("PROMPTER");
    expect(effectiveKind(null, "HYBRID")).toBe("QUESTION");
  });
});

describe("CTA end card", () => {
  it("adds seconds after the content and draws the card there", () => {
    const doc = buildInitialDocument({ questionText: "Q", theme: DEFAULT_THEME, mode: "ANSWER_ONLY", recording: { assetId: "rec", duration: 10 }, segments: [], pauses: [], visibility: "FULL", questionSeconds: 4 });
    doc.width = 270;
    doc.height = 480;
    applyEndCard(doc, { ctaEnabled: true, ctaUrl: "kancelaria.pl", ctaText: "Umów konsultację", ctaSeconds: 3 });
    expect(contentDuration(doc)).toBeCloseTo(10);
    expect(docDuration(doc)).toBeCloseTo(13);
    const c = createCanvas(270, 480);
    drawFrame(c.getContext("2d") as unknown as Ctx, doc, 12, { getFrame: () => null, getImage: () => null });
    const px = c.getContext("2d").getImageData(135, 240, 1, 1).data;
    expect(px[3]).toBe(255);
    applyEndCard(doc, { ctaEnabled: false, ctaUrl: "kancelaria.pl", ctaText: null, ctaSeconds: 3 });
    expect(docDuration(doc)).toBeCloseTo(10);
  });
});

describe("question + prompter recording", () => {
  it("keeps the expert listening during the narration and cuts the wait for the prompter", () => {
    const doc = buildInitialDocument({
      questionText: "Q",
      theme: DEFAULT_THEME,
      mode: "CONTINUOUS",
      recording: { assetId: "rec", duration: 30 },
      narration: { assetId: "tts", duration: 4 },
      narrationWindow: { start: 0.2, end: 4.3 },
      answerFrom: 6.1,
      segments: [],
      pauses: [],
      visibility: "FULL",
      questionSeconds: 4,
    });
    expect(doc.clips.map((c) => [c.start, c.sourceIn, c.sourceOut, c.muted])).toEqual([
      [0, 0, 4.3, true],
      [4.3, 6.1, 30, false],
    ]);
    expect(contentDuration(doc)).toBeCloseTo(28.2);
  });
});
