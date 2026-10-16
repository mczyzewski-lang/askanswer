import { describe, expect, it } from "vitest";
import { detectSpeakerGender, genderFromVoiceName } from "../../src/lib/speaker-gender";

describe("who asks the question", () => {
  it.each([
    ["Jak powiedzieć MĘŻOWI o rozwodzie?", "female"],
    ["Czy mój mąż może zabrać dzieci za granicę?", "female"],
    ["Co zrobić, gdy były mąż nie płaci alimentów?", "female"],
    ["Zostałam zwolniona w ciąży — co mogę zrobić?", "female"],
    ["Czy mogłabym wrócić do panieńskiego nazwiska?", "female"],
    ["Jestem sama z dzieckiem, jakie mam prawa?", "female"],
    ["Czy żona dostanie połowę mieszkania?", "male"],
    ["Jak powiedzieć żonie, że chcę rozwodu?", "male"],
    ["Podpisałem umowę bez czytania, co teraz?", "male"],
    ["Jako ojciec chcę ustalić kontakty z dzieckiem", "male"],
  ])("%s → %s", (q, g) => expect(detectSpeakerGender(q)).toBe(g));

  it.each([
    "Ile trwa sprawa rozwodowa?",
    "Czy mogę zastrzec znak towarowy w UE?",
    "Kto decyduje o opiece nad dzieckiem?",
    "Czy mąż i żona mogą mieć rozdzielność majątkową?", // both → no hint
    "Jak przygotować się do rozprawy w sądzie?",
    "Czy pracodawca może mnie zwolnić na L4?",
  ])("no hint: %s", (q) => expect(detectSpeakerGender(q)).toBeNull());

  it("does not take nouns ending in -łam/-łem for verbs", () => {
    expect(detectSpeakerGender("Czy kłamstwo w sądzie to przestępstwo?")).toBeNull();
  });
});

describe("voice gender from the collection name", () => {
  it("Pani = female, Pan = male, otherwise unknown", () => {
    expect(genderFromVoiceName("Pani Anna — ciepły")).toBe("female");
    expect(genderFromVoiceName("pan Marek")).toBe("male");
    expect(genderFromVoiceName("Panika")).toBeNull();
    expect(genderFromVoiceName("Lektor 1")).toBeNull();
    expect(genderFromVoiceName(null)).toBeNull();
  });
});
