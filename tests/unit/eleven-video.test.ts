import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/lib/server/db", () => ({ prisma: {} }));

describe("ElevenLabs video (flows)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("a model refusing an optional field (422) is asked again with a simpler body", async () => {
    process.env.ELEVENLABS_API_KEY = "k";
    process.env.ELEVENLABS_BASE_URL = "http://el.test";
    const bodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
      const b = JSON.parse(init.body);
      bodies.push(b);
      if ("generate_audio" in b) return new Response(JSON.stringify({ detail: "Extra inputs are not permitted" }), { status: 422 });
      return new Response(JSON.stringify({ id: "gen_1", status: "pending" }), { status: 200 });
    });
    const { submitElVideo } = await import("../../src/lib/server/eleven-video");
    expect(await submitElVideo({ prompt: "A courtroom corridor", model: "veo-3.1-fast-generate-001", duration: 6, aspect: "9:16" })).toBe("gen_1");
    expect(bodies[1]).toEqual({ model_id: "veo-3.1-fast-generate-001", prompt: "A courtroom corridor", aspect_ratio: "9:16", duration_secs: 6 });
  });

  it("a missing paid plan is a clear, final error", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ detail: { status: "paid_plan_required" } }), { status: 402 }));
    const { submitElVideo, ElVideoError } = await import("../../src/lib/server/eleven-video");
    const e = await submitElVideo({ prompt: "x scene here", model: "veo-3.1-generate-001", duration: 8, aspect: "9:16" }).catch((x) => x);
    expect(e).toBeInstanceOf(ElVideoError);
    expect(e.permanent).toBe(true);
    expect(e.message).toContain("płatnego planu");
  });

  it("waits for the generation and returns its URL; a failed one says why", async () => {
    process.env.EL_VIDEO_POLL_MS = "1";
    let n = 0;
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify(++n < 3 ? { status: "generating" } : { status: "completed", content_url: "https://cdn.test/v.mp4" }), { status: 200 }));
    const { waitForElVideo } = await import("../../src/lib/server/eleven-video");
    expect(await waitForElVideo("gen_1")).toBe("https://cdn.test/v.mp4");
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ status: "failed", error_message: "content policy" }), { status: 200 }));
    await expect(waitForElVideo("gen_2")).rejects.toThrow("content policy");
  });
});
