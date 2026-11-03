import { describe, expect, it } from "vitest";
import { fillReply, fold, isShortTrigger, matchesKeyword } from "@/lib/social/automation";

describe("comment automations", () => {
  it("matches the keyword as a word, any case, without diacritics", () => {
    expect(matchesKeyword("PLAN 🙏", "PLAN")).toBe(true);
    expect(matchesKeyword("poproszę plan!", "PLAN")).toBe(true);
    expect(matchesKeyword("#plan", "plan")).toBe(true);
    expect(matchesKeyword("planuję", "PLAN")).toBe(false);
    expect(matchesKeyword("petla", "PĘTLA")).toBe(true);
    expect(matchesKeyword("Wpływ", "WPŁYW")).toBe(true);
    expect(matchesKeyword("chcę 7 dni", "7 dni")).toBe(true);
    expect(fold("Łódź!!")).toBe("lodz");
  });
  it("only short comments trigger it", () => {
    expect(isShortTrigger("PLAN")).toBe(true);
    expect(isShortTrigger("Plan! A dlaczego mój mąż ciągle krzyczy, kiedy próbuję spokojnie porozmawiać o pieniądzach?")).toBe(false);
  });
  it("fills in the first name, or leaves it out cleanly", () => {
    expect(fillReply("{imię}, dziękuję! Link: x", "Anna Nowak")).toBe("Anna, dziękuję! Link: x");
    expect(fillReply("{imię}, dziękuję! Link: x", "")).toBe("Dziękuję! Link: x");
    expect(fillReply("Cześć {imię}! Tu:", null)).toBe("Cześć! Tu:");
    expect(fillReply("Cześć {imię}! Tu:", "ania_k")).toBe("Cześć! Tu:");
  });
});
