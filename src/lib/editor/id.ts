let counter = 0;
/** Short unique id usable in both browser and Node. */
export function uid(prefix = "id"): string {
  counter = (counter + 1) % 1_000_000;
  const rnd = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${rnd}`;
}
