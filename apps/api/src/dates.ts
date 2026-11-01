// Calendar-day helpers on 'YYYY-MM-DD' strings, all in UTC so a day never
// shifts with the server's time zone. The caller has already resolved the
// athlete's local day.

const DAY = 86_400_000;

// A real calendar day: Date.parse rolls 2026-02-30 over to March 2, so the
// parsed day must print back as the same string.
export const isCalendarDay = (v: unknown): v is string => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const t = Date.parse(`${v}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === v;
};

export const addDays = (day: string, n: number): string =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

// The Monday that opens the Monday-to-Sunday week holding day.
export const mondayOf = (day: string): string => {
  const t = Date.parse(`${day}T00:00:00Z`);
  return new Date(t - ((new Date(t).getUTCDay() + 6) % 7) * DAY).toISOString().slice(0, 10);
};
