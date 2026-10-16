import { afterEach, describe, expect, it } from "vitest";
import { env, higgsfieldConfigured } from "../../src/lib/server/env";

const KEYS = ["HIGGSFIELD_CREDENTIALS", "HF_CREDENTIALS", "HF_KEY", "HIGGSFIELD_API_KEY", "HF_API_KEY", "HIGGSFIELD_API_SECRET", "HF_API_SECRET"];
afterEach(() => KEYS.forEach((k) => delete process.env[k]));

describe("Higgsfield credentials from Railway variables", () => {
  it("accepts KEY_ID:KEY_SECRET, separate id + secret, or a single key", () => {
    process.env.HIGGSFIELD_CREDENTIALS = "abc123:secret456";
    expect(env.higgsfieldCredentials).toBe("abc123:secret456");
    delete process.env.HIGGSFIELD_CREDENTIALS;
    process.env.HIGGSFIELD_API_KEY = "abc123";
    process.env.HIGGSFIELD_API_SECRET = "secret456";
    expect(env.higgsfieldCredentials).toBe("abc123:secret456");
    delete process.env.HIGGSFIELD_API_SECRET;
    expect(env.higgsfieldCredentials).toBe("abc123");
    process.env.HIGGSFIELD_API_KEY = "hf_singlekey_0123456789";
    expect(higgsfieldConfigured()).toBe(true);
  });

  it("tolerates pasted quotes, 'Key ' prefixes and spaces", () => {
    process.env.HIGGSFIELD_CREDENTIALS = ' "Key abc123 : secret456" ';
    expect(env.higgsfieldCredentials).toBe("abc123:secret456");
  });

  it("is not configured without a key", () => {
    expect(higgsfieldConfigured()).toBe(false);
  });
});

describe("API keys pasted into Railway", () => {
  it("strips quotes, a copied NAME= prefix, Bearer and whitespace", async () => {
    const { cleanSecret } = await import("../../src/lib/server/env");
    expect(cleanSecret('"sk-proj-abc123"', "OPENAI_API_KEY")).toBe("sk-proj-abc123");
    expect(cleanSecret('OPENAI_API_KEY="sk-proj-abc123"', "OPENAI_API_KEY")).toBe("sk-proj-abc123");
    expect(cleanSecret("  'sk-proj-abc\n123' ", "OPENAI_API_KEY")).toBe("sk-proj-abc123");
    expect(cleanSecret("Bearer sk-ant-xyz", "ANTHROPIC_API_KEY")).toBe("sk-ant-xyz");
    expect(cleanSecret('""', "OPENAI_API_KEY")).toBe("");
  });
});
