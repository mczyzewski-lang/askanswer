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
