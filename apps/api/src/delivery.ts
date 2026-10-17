// Per-athlete push timing (doc 09 §1.4). The scheduler ticks every 15
// minutes; each athlete gets the daily read at their own local delivery time,
// once per local day, and the free tier's weekly review on Monday at the same
// time (Sunday's read, 24h delayed, CLAUDE.md §5.1).

export const DEFAULT_TIMEZONE = 'America/New_York';
export const DEFAULT_DELIVERY_MINUTE = 6 * 60;
// A read that would land more than this late (server down, deploy) is skipped
// rather than arriving mid-morning.
export const LATE_WINDOW_MIN = 120;

export interface DeliveryPrefs {
  timezone: string;
  delivery_minute: number;
  last_daily_sent_on: string | null;
  last_weekly_sent_on: string | null;
}

export const defaultPrefs = (): DeliveryPrefs => ({
  timezone: DEFAULT_TIMEZONE,
  delivery_minute: DEFAULT_DELIVERY_MINUTE,
  last_daily_sent_on: null,
  last_weekly_sent_on: null,
});

export function isValidTimezone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || tz.length === 0 || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function isValidDeliveryMinute(m: unknown): m is number {
  return Number.isInteger(m) && (m as number) >= 0 && (m as number) <= 1439;
}

// Local date (YYYY-MM-DD), minute of day and weekday (0 = Sunday) in `tz`.
export function localClock(now: Date, tz: string): { date: string; minute: number; weekday: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short',
    }).formatToParts(now).map((p) => [p.type, p.value])
  );
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minute: Number(parts.hour) * 60 + Number(parts.minute),
    weekday,
  };
}

export interface DueResult {
  daily: boolean;
  weekly: boolean;
  localDate: string;
}

export function dueDeliveries(prefs: DeliveryPrefs, now: Date): DueResult {
  const tz = isValidTimezone(prefs.timezone) ? prefs.timezone : DEFAULT_TIMEZONE;
  const { date, minute, weekday } = localClock(now, tz);
  const inWindow = minute >= prefs.delivery_minute && minute < prefs.delivery_minute + LATE_WINDOW_MIN;
  return {
    daily: inWindow && prefs.last_daily_sent_on !== date,
    weekly: inWindow && weekday === 1 && prefs.last_weekly_sent_on !== date,
    localDate: date,
  };
}
