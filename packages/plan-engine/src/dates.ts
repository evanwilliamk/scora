// Calendar-date helpers on 'YYYY-MM-DD' strings. All arithmetic is in UTC so
// a date never shifts with the server's timezone; the caller has already
// resolved "today" in the athlete's timezone.

const DAY_MS = 86_400_000;

export function parseDate(d: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error(`invalid date: ${d}`);
  const ms = Date.parse(`${d}T00:00:00Z`);
  // Date.parse rolls 2026-02-30 over to March; a real date round-trips.
  if (Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== d) throw new Error(`invalid date: ${d}`);
  return ms;
}

export function addDays(d: string, n: number): string {
  return new Date(parseDate(d) + n * DAY_MS).toISOString().slice(0, 10);
}

// Whole days from a to b (positive when b is later).
export function daysBetween(a: string, b: string): number {
  return Math.round((parseDate(b) - parseDate(a)) / DAY_MS);
}

// The Monday that opens the Monday-to-Sunday week holding d.
export function weekStart(d: string): string {
  const dow = new Date(parseDate(d)).getUTCDay(); // 0 = Sunday
  return addDays(d, dow === 0 ? -6 : 1 - dow);
}

// The Sunday that closes the Monday-to-Sunday week holding d.
export function weekEnd(d: string): string {
  const dow = new Date(parseDate(d)).getUTCDay(); // 0 = Sunday
  return addDays(d, dow === 0 ? 0 : 7 - dow);
}
