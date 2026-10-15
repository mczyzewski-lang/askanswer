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
