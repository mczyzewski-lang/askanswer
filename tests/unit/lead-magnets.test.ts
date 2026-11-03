import { describe, expect, it } from "vitest";
import { DUO_LEAD_MAGNETS, foreignKeywords, formatLeadMagnets, parseLeadMagnets } from "@/lib/lead-magnets";
import { reviewUserMessage, REEL_EDITOR_GUIDELINES } from "@/lib/server/reel-review";

describe("lead magnets", () => {
  it("round-trips the text form", () => {
    const back = parseLeadMagnets(formatLeadMagnets(DUO_LEAD_MAGNETS));
    expect(back).toHaveLength(10);
    expect(back[4]).toMatchObject({ keyword: "PLAN", name: "Trudna rozmowa bez kłótni", url: "/wiedza/trudna-rozmowa" });
    expect(parseLeadMagnets("#pętla | Pętla konfliktu | cykl kłótni")[0]).toMatchObject({ keyword: "PĘTLA", name: "Pętla konfliktu", url: null });
  });
  it("flags a DM keyword that is not on the list", () => {
    expect(foreignKeywords("Napisz PLAN w wiadomości.", DUO_LEAD_MAGNETS)).toEqual([]);
    expect(foreignKeywords("Chcesz arkusz? Napisz MAPA w wiadomości.", DUO_LEAD_MAGNETS)).toEqual([]);
    expect(foreignKeywords("Napisz do nas słowo ZGODA, a podeślę checklistę.", DUO_LEAD_MAGNETS)).toEqual(["ZGODA"]);
    expect(foreignKeywords("Zapisz to i wyślij partnerowi.", DUO_LEAD_MAGNETS)).toEqual([]);
  });
  it("puts the list into the scoring prompt with the rule to use only these", () => {
    const msg = reviewUserMessage({ title: "T", parts: [{ role: "hook", text: "Ciągle się kłócimy" }], format: "[EKSPERT]", brief: null, leadMagnets: DUO_LEAD_MAGNETS });
    expect(msg).toContain("LEAD MAGNETY (SŁOWO do DM | nazwa | o czym):");
    expect(msg).toContain("- PĘTLA | Pętla konfliktu |");
    expect(REEL_EDITOR_GUIDELINES).toContain("Używaj WYŁĄCZNIE słów i nazw z listy");
    expect(REEL_EDITOR_GUIDELINES).toContain("„Napisz SŁOWO w komentarzu albo w wiadomości”");
    expect(reviewUserMessage({ title: "T", parts: [], format: "[EKSPERT]", brief: null })).not.toContain("LEAD MAGNETY");
  });
});
