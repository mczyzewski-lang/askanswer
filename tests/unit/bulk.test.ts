import { describe, expect, it } from "vitest";
import { parseBulk, parseBulkLine } from "@/lib/bulk-questions";

describe("Wklej wiele — parser", () => {
  it("reads [subcategory] prefixes and strips numbering", () => {
    expect(parseBulkLine("1. [dzieci] Kto decyduje o opiece nad dzieckiem?")).toEqual({ text: "Kto decyduje o opiece nad dzieckiem?", category: undefined, subcategory: "dzieci" });
    expect(parseBulkLine("[dzieci]Pytanie jakieś?")).toEqual({ text: "Pytanie jakieś?", category: undefined, subcategory: "dzieci" });
  });
  it("supports [Kategoria/podkategoria]", () => {
    expect(parseBulkLine("- [Rozwody / majątek] Jak dzieli się majątek?")).toEqual({ text: "Jak dzieli się majątek?", category: "Rozwody", subcategory: "majątek" });
  });
  it("lines without brackets have no subcategory; empty lines are skipped", () => {
    const r = parseBulk("Ile trwa rozwód?\n\n[dzieci] Alimenty?\n[x]");
    expect(r).toEqual([
      { text: "Ile trwa rozwód?", category: undefined, subcategory: undefined },
      { text: "Alimenty?", category: undefined, subcategory: "dzieci" },
    ]);
  });
});

describe("bulk paste — Prompter scripts", () => {
  it("splits blocks on empty lines: first line = hook (with [temat]), rest = treść", async () => {
    const { parseBulkScripts } = await import("../../src/lib/bulk-questions");
    const out = parseBulkScripts("[sprzedaż] 3 błędy, które kosztują Cię klientów\nPierwszy błąd…\nDrugi błąd…\n\n\nHook: Dlaczego reklamy nie działają?\nTreść: Najczęściej problemem nie jest budżet.\n\nSam hook bez treści");
    expect(out).toEqual([
      { text: "3 błędy, które kosztują Cię klientów", subcategory: "sprzedaż", category: undefined, script: "Pierwszy błąd…\nDrugi błąd…" },
      { text: "Dlaczego reklamy nie działają?", subcategory: undefined, category: undefined, script: "Najczęściej problemem nie jest budżet." },
      { text: "Sam hook bez treści", subcategory: undefined, category: undefined, script: "" },
    ]);
  });
});
