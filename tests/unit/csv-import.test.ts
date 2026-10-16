import { describe, expect, it } from "vitest";
import { csvTemplate, decodeCsv, parseImportCsv } from "../../src/lib/csv-import";

describe("CSV import — Prompter", () => {
  it("reads Kategoria;Podkategoria;Hook;Treść with a multi-line quoted Treść", () => {
    const csv = 'Kategoria;Podkategoria;Hook;Treść\r\nGrowth;sprzedaż;3 błędy, które kosztują Cię klientów;"Pierwszy błąd…\r\nDrugi błąd…"\r\nGrowth;;Dlaczego reklamy nie działają?;Bo komunikat.\r\n';
    expect(parseImportCsv(csv, true)).toEqual([
      { text: "3 błędy, które kosztują Cię klientów", script: "Pierwszy błąd…\nDrugi błąd…", categoryName: "Growth", subcategoryName: "sprzedaż", instructions: null, expertName: undefined, maxDurationSec: null },
      { text: "Dlaczego reklamy nie działają?", script: "Bo komunikat.", categoryName: "Growth", subcategoryName: undefined, instructions: null, expertName: undefined, maxDurationSec: null },
    ]);
  });

  it("accepts commas, any column order and headers without Polish letters", () => {
    const rows = parseImportCsv("tresc,hook,kategoria\nTekst skryptu,Mój hook,Growth\n", true);
    expect(rows[0]).toMatchObject({ text: "Mój hook", script: "Tekst skryptu", categoryName: "Growth" });
  });

  it("decodes Windows-1250 files from Polish Excel", () => {
    // "Treść;Hook\nżółć;ąę" in cp1250
    const bytes = new Uint8Array([0x54, 0x72, 0x65, 0x9c, 0xe6, 0x3b, 0x48, 0x6f, 0x6f, 0x6b, 0x0a, 0xbf, 0xf3, 0xb3, 0xe6, 0x3b, 0xb9, 0xea, 0x65, 0x65]);
    const text = decodeCsv(bytes.buffer);
    expect(text).toBe("Treść;Hook\nżółć;ąęee");
    expect(parseImportCsv(text, true)[0]).toMatchObject({ text: "ąęee", script: "żółć" });
  });

  it("the downloadable template imports back", () => {
    const rows = parseImportCsv(csvTemplate(true), true);
    expect(rows).toHaveLength(2);
    expect(rows[0].script).toContain("\n");
  });
});
