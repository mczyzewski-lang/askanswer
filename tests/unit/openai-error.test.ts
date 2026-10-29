import { describe, expect, it } from "vitest";
import { openaiErrorText } from "@/lib/server/reel-review";

describe("openaiErrorText", () => {
  it("explains an empty balance", () => {
    expect(openaiErrorText(429, { error: { code: "insufficient_quota", message: "You exceeded your current quota, please check your plan and billing details." } })).toMatch(/brak środków/);
  });
  it("explains a bad key", () => {
    expect(openaiErrorText(401, { error: { code: "invalid_api_key", message: "Incorrect API key provided" } })).toMatch(/klucz API jest nieprawidłowy/);
  });
  it("passes other errors through", () => {
    expect(openaiErrorText(500, {})).toBe("OpenAI: HTTP 500");
  });
});

import { reviewInputOf } from "@/lib/server/question-review";
import { REEL_EDITOR_GUIDELINES, reviewUserMessage } from "@/lib/server/reel-review";

describe("scoring keeps who speaks the hook", () => {
  const q = { text: "Czy mam powiedzieć mężowi o długach?", spokenText: null, script: "To zależy od…", kind: null };
  it("question + prompter: the hook is the client's question", () => {
    const msg = reviewUserMessage({ ...reviewInputOf(q, "QUESTION_PROMPTER"), brief: null });
    expect(msg).toContain("FORMAT: [PYTANIE KLIENTA]");
    expect(msg).toMatch(/hook = pytanie klienta/);
    expect(msg).toContain("[HOOK (PYTANIE KLIENTA, CZYTA LEKTOR)] Czy mam powiedzieć mężowi o długach?");
  });
  it("prompter: the expert speaks the hook", () => {
    const msg = reviewUserMessage({ ...reviewInputOf({ ...q, text: "3 najważniejsze rzeczy, gdy masz długi" }, "PROMPTER"), brief: null });
    expect(msg).toContain("FORMAT: [EKSPERT]");
    expect(msg).toMatch(/mówi ekspert/);
  });
  it("the guidelines define both voices", () => {
    expect(REEL_EDITOR_GUIDELINES).toContain("ZASADY DLA FORMATU [PYTANIE KLIENTA]");
    expect(REEL_EDITOR_GUIDELINES).toContain("ZASADY DLA FORMATU [EKSPERT]");
  });
});
