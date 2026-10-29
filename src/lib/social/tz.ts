/**
 * Dates: stored in UTC, shown and entered in the project's time zone (default Europe/Warsaw).
 * Pure Intl arithmetic, the same in the browser and on the server.
 */
export const DEFAULT_TZ = "Europe/Warsaw";

function parts(d: Date, tz: string) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const o: Record<string, number> = {};
  for (const p of f.formatToParts(d)) if (p.type !== "literal") o[p.type] = Number(p.value);
  return { y: o.year, m: o.month, d: o.day, h: o.hour === 24 ? 0 : o.hour, mi: o.minute, s: o.second };
}

/** offset of the zone from UTC at that instant, in minutes (Warsaw: +60 / +120) */
export function tzOffsetMinutes(d: Date, tz: string): number {
  const p = parts(d, tz);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
  return Math.round((asUtc - Math.floor(d.getTime() / 1000) * 1000) / 60000);
}

/** "2026-11-03T18:30" read as wall-clock time in `tz` → the UTC instant */
export function zonedToUtc(local: string, tz: string = DEFAULT_TZ): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(local.trim());
  if (!m) throw new Error(`Nieprawidłowa data: ${local}`);
  const [y, mo, d, h, mi, s] = m.slice(1).map((x) => Number(x ?? 0));
  const guess = Date.UTC(y, mo - 1, d, h, mi, s || 0);
  // two passes settle DST edges (the offset at the guessed instant may differ from the real one)
  let t = guess - tzOffsetMinutes(new Date(guess), tz) * 60000;
  t = guess - tzOffsetMinutes(new Date(t), tz) * 60000;
  return new Date(t);
}

/** UTC instant → "YYYY-MM-DDTHH:mm" in `tz` (for datetime-local inputs) */
export function utcToZonedInput(d: Date | string, tz: string = DEFAULT_TZ): string {
  const p = parts(new Date(d), tz);
  const z = (n: number) => String(n).padStart(2, "0");
  return `${p.y}-${z(p.m)}-${z(p.d)}T${z(p.h)}:${z(p.mi)}`;
}

/** calendar day key "YYYY-MM-DD" of the instant in `tz` */
export function dayKey(d: Date | string, tz: string = DEFAULT_TZ): string {
  return utcToZonedInput(d, tz).slice(0, 10);
}

export function formatInTz(d: Date | string, tz: string = DEFAULT_TZ, opts: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" }): string {
  return new Intl.DateTimeFormat("pl-PL", { timeZone: tz, ...opts }).format(new Date(d));
}

export function hourInTz(d: Date | string, tz: string = DEFAULT_TZ): number {
  return parts(new Date(d), tz).h;
}

export function weekdayInTz(d: Date | string, tz: string = DEFAULT_TZ): number {
  // 0 = Monday … 6 = Sunday
  const p = parts(new Date(d), tz);
  const wd = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
  return (wd + 6) % 7;
}
