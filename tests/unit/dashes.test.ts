import { describe, expect, it } from "vitest";
import { plainDashes, plainDashesDeep } from "../../src/lib/dashes";

describe("plain dashes in content", () => {
  it("long dash and en dash become a hyphen, spacing kept sensible", () => {
    expect(plainDashes("Rozwód — najpierw plan")).toBe("Rozwód - najpierw plan");
    expect(plainDashes("3–5 dni")).toBe("3-5 dni");
    expect(plainDashes("plan—pozew")).toBe("plan-pozew");
    expect(plainDashes("Rozwód — plan")).toBe("Rozwód - plan");
    expect(plainDashes("bez zmian - ok")).toBe("bez zmian - ok");
  });
  it("deep: objects and arrays", () => {
    expect(plainDashesDeep({ a: "x — y", b: ["1–2", 3], c: { d: "z—w" } })).toEqual({ a: "x - y", b: ["1-2", 3], c: { d: "z-w" } });
  });
});
