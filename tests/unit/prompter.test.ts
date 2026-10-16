import { describe, expect, it } from "vitest";
import { normWord, ScriptFollower, similarity, spokenWords, tokenize } from "../../src/lib/prompter";

const HOOK = "Trzy błędy, które kosztują Cię klientów.";
const SCRIPT = `Pierwszy błąd to brak odpowiedzi w ciągu dwudziestu czterech godzin.
Drugi błąd to oferta bez konkretnej ceny i terminu realizacji.
Trzeci błąd to brak follow-upu po spotkaniu z klientem.`;

function feed(f: ScriptFollower, text: string) {
  // simulate realtime partials: words arrive one by one
  const words = spokenWords(text);
  const heard: string[] = [];
  for (const w of words) {
    heard.push(w);
    f.update(heard);
  }
  return f.pos;
}
const at = (f: ScriptFollower) => f.words.slice(Math.max(0, f.pos - 1), f.pos).map((w) => w.norm)[0];

describe("prompter: normalisation", () => {
  it("folds Polish diacritics and punctuation", () => {
    expect(normWord("Błędy,")).toBe("bledy");
    expect(normWord("Cię")).toBe("cie");
  });
  it("matches inflected forms and typos but not short unrelated words", () => {
    expect(similarity("umowa", "umowy")).toBeGreaterThan(0);
    expect(similarity("klientow", "klientami")).toBeGreaterThan(0);
    expect(similarity("to", "na")).toBe(0);
    expect(similarity("oferta", "spotkanie")).toBe(0);
  });
});

describe("prompter: following speech", () => {
  it("follows straight reading to the end", () => {
    const f = new ScriptFollower(tokenize(HOOK, SCRIPT));
    feed(f, `${HOOK} ${SCRIPT}`);
    expect(f.pos).toBe(f.words.length);
  });

  it("ignores ad-libs and fillers ('tak myślę, że', 'eee')", () => {
    const f = new ScriptFollower(tokenize(HOOK, SCRIPT));
    feed(f, "Trzy błędy, które kosztują Cię klientów. Eee, tak myślę, że pierwszy błąd to no wiecie brak odpowiedzi w ciągu dwudziestu czterech godzin");
    expect(at(f)).toBe("godzin");
  });

  it("does not move on unrelated chatter", () => {
    const f = new ScriptFollower(tokenize(HOOK, SCRIPT));
    feed(f, "dzień dobry, sprawdźmy czy mikrofon działa, raz dwa raz dwa");
    expect(f.pos).toBe(0);
  });

  it("survives recognition errors and inflection", () => {
    const f = new ScriptFollower(tokenize(HOOK, SCRIPT));
    feed(f, "trzy błędów które kosztuje cie klientami pierwszy blad to brak odpowiedzi");
    expect(at(f)).toBe("odpowiedzi");
  });

  it("catches up when a whole sentence is skipped", () => {
    const f = new ScriptFollower(tokenize(HOOK, SCRIPT));
    feed(f, `${HOOK} Pierwszy błąd to brak odpowiedzi w ciągu dwudziestu czterech godzin.`);
    // skips sentence 2
    feed(f, "Trzeci błąd to brak follow-upu po spotkaniu z klientem");
    expect(f.pos).toBe(f.words.length);
  });

  it("dropped words inside a sentence do not stop it", () => {
    const f = new ScriptFollower(tokenize(HOOK, SCRIPT));
    feed(f, `${HOOK} Drugi błąd to oferta bez ceny i terminu realizacji`);
    expect(at(f)).toBe("realizacji");
  });

  it("manual jump, then continues from there", () => {
    const f = new ScriptFollower(tokenize(HOOK, SCRIPT));
    const idx = f.words.findIndex((w) => w.norm === "trzeci");
    f.jump(idx);
    feed(f, "Trzeci błąd to brak follow-upu");
    expect(at(f)).toBe("followupu");
  });

  it("goes back when the expert re-reads a sentence", () => {
    const f = new ScriptFollower(tokenize(HOOK, SCRIPT));
    feed(f, `${HOOK} Pierwszy błąd to brak odpowiedzi w ciągu dwudziestu czterech godzin. Drugi błąd to oferta bez konkretnej ceny`);
    feed(f, "przepraszam jeszcze raz. Pierwszy błąd to brak odpowiedzi w ciągu");
    expect(at(f)).toBe("ciagu");
  });
});
