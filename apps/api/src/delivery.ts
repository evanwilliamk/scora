// Per-athlete push timing (doc 09 §1.4). The scheduler ticks every minute
// (doc 10 gate 1.1.1 wants the read within 5 minutes of the set time); each athlete gets the daily read at their own local delivery time,
// once per local day, and the free tier's weekly review on Monday at the same
// time (Sunday's read, 24h delayed, CLAUDE.md §5.1).

const DEFAULT_TIMEZONE = 'America/New_York';
const DEFAULT_DELIVERY_MINUTE = 6 * 60;
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

// One formatter per zone: building an Intl.DateTimeFormat costs far more than
// using one, and the scheduler asks for every athlete every minute. Bounded
// (cleared past MAX_ZONES) so stray zone strings cannot grow it forever.
const MAX_ZONES = 1000;
const clockFormats = new Map<string, Intl.DateTimeFormat | null>();
function clockFormat(tz: string): Intl.DateTimeFormat | null {
  let f = clockFormats.get(tz);
  if (f !== undefined) return f;
  try {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short',
    });
  } catch {
    f = null;
  }
  if (clockFormats.size >= MAX_ZONES) clockFormats.clear();
  clockFormats.set(tz, f);
  return f;
}

export function isValidTimezone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || tz.length === 0 || tz.length > 64) return false;
  return clockFormat(tz) !== null;
}

export function isValidDeliveryMinute(m: unknown): m is number {
  return Number.isInteger(m) && (m as number) >= 0 && (m as number) <= 1439;
}

// Local date (YYYY-MM-DD), minute of day and weekday (0 = Sunday) in `tz`.
export function localClock(now: Date, tz: string): { date: string; minute: number; weekday: number } {
  const f = clockFormat(tz);
  if (!f) throw new RangeError(`Invalid time zone specified: ${tz}`);
  const parts = Object.fromEntries(f.formatToParts(now).map((p) => [p.type, p.value]));
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

// The calendar day before `date` (YYYY-MM-DD).
function previousDate(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export function dueDeliveries(prefs: DeliveryPrefs, now: Date): DueResult {
  const tz = isValidTimezone(prefs.timezone) ? prefs.timezone : DEFAULT_TIMEZONE;
  const { date, minute, weekday } = localClock(now, tz);
  const end = prefs.delivery_minute + LATE_WINDOW_MIN;
  if (minute >= prefs.delivery_minute && minute < end) {
    return {
      daily: prefs.last_daily_sent_on !== date,
      weekly: weekday === 1 && prefs.last_weekly_sent_on !== date,
      localDate: date,
    };
  }
  // A late delivery time (23:30) keeps its window past local midnight: the
  // retry is for yesterday's read, keyed by yesterday's date, so the claim
  // still allows one send per day. Never once a later day was sent.
  const yesterday = previousDate(date);
  if (minute + 1440 < end) {
    const notSince = (last: string | null) => last === null || last < yesterday;
    return {
      daily: notSince(prefs.last_daily_sent_on),
      weekly: (weekday + 6) % 7 === 1 && notSince(prefs.last_weekly_sent_on),
      localDate: yesterday,
    };
  }
  return { daily: false, weekly: false, localDate: date };
}

// The instant the athlete's local clock first reads the set time on
// `localDate`: the first of the two on a fall-back day, and the first minute
// after the gap when spring-forward skips it (02:30 -> 03:00), which is when
// dueDeliveries first sends it.
function setTimeInstant(prefs: Pick<DeliveryPrefs, 'timezone' | 'delivery_minute'>, localDate: string): number {
  const tz = isValidTimezone(prefs.timezone) ? prefs.timezone : DEFAULT_TIMEZONE;
  const wall = Date.parse(`${localDate}T00:00:00Z`) + prefs.delivery_minute * 60_000;
  const offset = (t: number) => {
    const c = localClock(new Date(t), tz);
    return Date.parse(`${c.date}T00:00:00Z`) + c.minute * 60_000 - Math.floor(t / 60_000) * 60_000;
  };
  // The offsets a day either side bracket any change; start from the earlier
  // candidate and walk forward to the first minute that reaches the set time.
  let t = Math.min(wall - offset(wall - 86_400_000), wall - offset(wall + 86_400_000));
  for (let i = 0; i < 1440; i++, t += 60_000) {
    const c = localClock(new Date(t), tz);
    if (c.date > localDate || (c.date === localDate && c.minute >= prefs.delivery_minute)) return t;
  }
  return t;
}

// Minutes from the set time on `localDate` to `at` by the clock, for the
// on-time gate (doc 10 1.1.1). Counted on the clock, not the wall: a read at
// 03:00 for a 02:30 that spring-forward skipped is on time, and one at the
// second 01:30 of a fall-back day is an hour late.
export function minutesLate(prefs: Pick<DeliveryPrefs, 'timezone' | 'delivery_minute'>, localDate: string, at: Date): number {
  return Math.floor((at.getTime() - setTimeInstant(prefs, localDate)) / 60_000);
}
