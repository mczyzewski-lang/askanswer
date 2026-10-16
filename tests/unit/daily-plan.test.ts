import { describe, expect, it } from "vitest";
import { dailyPlan, startOfDay, type PlanQuestion } from "../../src/lib/daily-plan";

function make(cats: number, perCat: number, recorded: (c: number, i: number) => boolean = () => false): PlanQuestion[] {
  const out: PlanQuestion[] = [];
  for (let c = 0; c < cats; c++)
    for (let i = 0; i < perCat; i++) out.push({ id: `c${c}q${i}`, categoryKey: `c${c}`, categoryOrder: c, order: c * 100 + i, recorded: recorded(c, i), recordedToday: false, needsFix: false });
  return out;
}
const catOf = (id: string) => id.split("q")[0];

describe("daily recording plan", () => {
  it("20 categories × 20 questions, 20 a day → exactly one per category", () => {
    const plan = dailyPlan(make(20, 20), 20);
    expect(plan.applied).toBe(true);
    expect(plan.ids).toHaveLength(20);
    expect(new Set(plan.ids.map(catOf)).size).toBe(20);
  });

  it("4 categories, 10 a day → 3/3/2/2, interleaved (never two from one category in a row)", () => {
    const plan = dailyPlan(make(4, 20), 10);
    const counts = plan.ids.reduce<Record<string, number>>((m, id) => ({ ...m, [catOf(id)]: (m[catOf(id)] ?? 0) + 1 }), {});
    expect(Object.values(counts).sort()).toEqual([2, 2, 3, 3]);
    for (let i = 1; i < plan.ids.length; i++) expect(catOf(plan.ids[i])).not.toBe(catOf(plan.ids[i - 1]));
  });

  it("with fewer slots than categories, the least recorded categories come first (rotation over days)", () => {
    // categories 0–4 already have recordings, 5–9 none
    const qs = make(10, 5, (c, i) => c < 5 && i === 0);
    const plan = dailyPlan(qs, 5);
    expect(plan.ids.map(catOf).sort()).toEqual(["c5", "c6", "c7", "c8", "c9"]);
  });

  it("keeps today's recordings on the list so it does not reshuffle during the day", () => {
    const qs = make(3, 10);
    qs[0] = { ...qs[0], recorded: true, recordedToday: true };
    const plan = dailyPlan(qs, 3);
    expect(plan.ids).toContain("c0q0");
    expect(plan.ids).toHaveLength(3);
    // category 0 already had its turn today → the other two fill the remaining slots
    expect(plan.ids.filter((id) => id !== "c0q0").map(catOf).sort()).toEqual(["c1", "c2"]);
  });

  it("is not applied when everything fits or the limit is 0", () => {
    expect(dailyPlan(make(2, 3), 10).applied).toBe(false);
    expect(dailyPlan(make(20, 20), 0).applied).toBe(false);
  });

  it("puts 'to fix' questions first within their category", () => {
    const qs = make(2, 10);
    qs[5] = { ...qs[5], needsFix: true };
    expect(dailyPlan(qs, 4).ids[0]).toBe("c0q5");
  });

  it("day starts at midnight Europe/Warsaw", () => {
    expect(startOfDay(new Date("2026-10-16T01:30:00Z")).toISOString()).toBe("2026-10-15T22:00:00.000Z"); // CEST, UTC+2
    expect(startOfDay(new Date("2026-12-01T12:00:00Z")).toISOString()).toBe("2026-11-30T23:00:00.000Z"); // CET, UTC+1
  });
});
