import { describe, expect, it } from "vitest";
import { typesetHeadline } from "../../src/lib/adwords/draw";

const NB = " ";
describe("headline typography", () => {
  it("the prefix before a colon, numbers kept with their word, one-letter words not ending a line, a final full stop", () => {
    expect(typesetHeadline("Rozwód: 4 lata czy 3 miesiące?")).toEqual({ prefix: "Rozwód:", body: `4${NB}lata czy 3${NB}miesiące?` });
    expect(typesetHeadline("Rozwód bez wojny")).toEqual({ prefix: null, body: "Rozwód bez wojny." });
    expect(typesetHeadline("Rozwód bez walki w sądzie")).toEqual({ prefix: null, body: `Rozwód bez walki w${NB}sądzie.` });
    expect(typesetHeadline("Najpierw plan i ustalenia. Dopiero potem pozew o rozwód.").body).toBe(`Najpierw plan i${NB}ustalenia. Dopiero potem pozew o${NB}rozwód.`);
    // a long phrase before a colon is not a prefix
    expect(typesetHeadline("To jest bardzo długie zdanie przed dwukropkiem: reszta").prefix).toBeNull();
  });
});
