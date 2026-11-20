import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/lib/server/db", () => ({ prisma: {} }));

describe("the reel and hook in a clip's file name", () => {
  it("reads the code at the start of the name, in any case and with any separator", async () => {
    const { hookCodeOf } = await import("../../src/lib/server/ads");
    expect(hookCodeOf("p01-h05_ela-15-minut.mp4")).toBe("p01-h05");
    expect(hookCodeOf("P11 H10 Agnieszka.mov")).toBe("p11-h10");
    expect(hookCodeOf("p02_h05-agnieszka.mp4")).toBe("p02-h05");
    expect(hookCodeOf("P17;h05.mp4")).toBe("p17-h05");
  });
  it("refuses names without a reel and a hook at the start", async () => {
    const { hookCodeOf } = await import("../../src/lib/server/ads");
    expect(hookCodeOf("wywiad-ela.mp4")).toBeNull();
    expect(hookCodeOf("klip_p01-h05.mp4")).toBeNull();
    expect(hookCodeOf("p01.mp4")).toBeNull();
  });
});
