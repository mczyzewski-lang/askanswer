/**
 * Daily recording list for an expert with many questions: an even mix of categories instead of
 * one category at a time.
 *
 * - Questions recorded TODAY stay on today's list (and count towards the limit), so the list does
 *   not reshuffle while the expert works through it.
 * - Remaining slots are filled round-robin: one question per category per round, the least
 *   recorded categories first (so small or neglected categories catch up over the days), ties by
 *   category order. "To fix" questions go first inside their category.
 * - With no limit, or when everything left fits within it, the plan is not applied.
 */
export interface PlanQuestion {
  id: string;
  categoryKey: string; // category id, or "" for uncategorised
  categoryOrder: number;
  order: number;
  recorded: boolean; // has a usable take and is not waiting for a re-record
  recordedToday: boolean;
  needsFix: boolean;
}

export interface DailyPlan {
  ids: string[];
  applied: boolean;
  pendingTotal: number;
}

export function dailyPlan(questions: PlanQuestion[], limit: number | null | undefined): DailyPlan {
  const pending = questions.filter((q) => !q.recorded);
  const today = questions.filter((q) => q.recorded && q.recordedToday);
  if (!limit || limit <= 0 || pending.length + today.length <= limit) {
    return { ids: questions.map((q) => q.id), applied: false, pendingTotal: pending.length };
  }

  const recordedPerCat = new Map<string, number>();
  for (const q of questions) if (q.recorded) recordedPerCat.set(q.categoryKey, (recordedPerCat.get(q.categoryKey) ?? 0) + 1);

  const queues = new Map<string, PlanQuestion[]>();
  for (const q of [...pending].sort((a, b) => Number(b.needsFix) - Number(a.needsFix) || a.order - b.order)) {
    queues.set(q.categoryKey, [...(queues.get(q.categoryKey) ?? []), q]);
  }
  const catOrder = new Map(questions.map((q) => [q.categoryKey, q.categoryOrder]));
  // today's recordings already "used" a turn of their category
  const usedToday = new Map<string, number>();
  for (const q of today) usedToday.set(q.categoryKey, (usedToday.get(q.categoryKey) ?? 0) + 1);
  const cats = [...queues.keys()].sort(
    (a, b) =>
      (usedToday.get(a) ?? 0) - (usedToday.get(b) ?? 0) ||
      (recordedPerCat.get(a) ?? 0) - (recordedPerCat.get(b) ?? 0) ||
      (catOrder.get(a) ?? 0) - (catOrder.get(b) ?? 0) ||
      a.localeCompare(b),
  );

  const slots = Math.max(0, limit - today.length);
  const picks: string[] = [];
  for (let round = 0; picks.length < slots; round++) {
    let took = false;
    for (const c of cats) {
      const q = queues.get(c)?.[round];
      if (!q) continue;
      picks.push(q.id);
      took = true;
      if (picks.length >= slots) break;
    }
    if (!took) break;
  }
  return { ids: [...picks, ...today.map((q) => q.id)], applied: true, pendingTotal: pending.length };
}

/** Midnight of the current day in the given time zone, as a Date (UTC instant). */
export function startOfDay(now: Date, timeZone = "Europe/Warsaw"): Date {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  const offset = asUtc - Math.floor(now.getTime() / 1000) * 1000; // zone offset in ms
  return new Date(Date.UTC(+parts.year, +parts.month - 1, +parts.day) - offset);
}
