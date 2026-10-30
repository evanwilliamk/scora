import cron from 'node-cron';
import {
  apnsConfigured,
  getAthletesWithDevices,
  getDeviceTokens,
  removeDeviceToken,
  sendPush,
} from './push';
import { dueDeliveries, minutesLate } from './delivery';
import { pushDeliveryLine, pushSentLine } from './telemetry';
import { pushBody } from './numeric-line';
import type { PrefsStore } from './preferences';

// Scheduled push delivery — the free-tier doorbell (§5.1).
//
// To avoid duplicating (or destabilising) the read-generation code, each job
// calls the app's own /api/read and /api/weekly endpoints over localhost per
// athlete, then pushes the resulting voice. So pushes go through the exact same
// validated pipeline as the in-app reads, with zero code divergence.
//
// Timing (free tier): daily read at each athlete's own delivery time (default
// 06:00 America/New_York until they pick one in onboarding); the Sunday weekly
// review is delivered 24h delayed, Monday at the same time. See delivery.ts.

type Logger = { info: (m: string) => void; warn: (m: string) => void; error: (m: string) => void };

// APNs alert bodies truncate around ~178 chars; keep the read tidy.
function trimBody(text: string, max = 178): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : t.slice(0, max - 1).trimEnd() + '…';
}

// Generate the read through the app's own endpoint and push it. Returns true
// once a read was generated and handed to APNs, so the day is marked done even
// if a device rejects it (a retry would only spend another LLM call).
export interface PushIo {
  now?: () => Date;
  fetch: typeof fetch;
  getDeviceTokens: typeof getDeviceTokens;
  sendPush: typeof sendPush;
  removeDeviceToken: typeof removeDeviceToken;
}
const realIo: PushIo = { fetch: (...a) => fetch(...a), getDeviceTokens, sendPush, removeDeviceToken };

export async function pushToAthlete(
  baseUrl: string,
  athleteId: string,
  path: '/api/read' | '/api/weekly',
  title: string,
  localDate: string,
  log: Logger,
  io: PushIo = realIo,
): Promise<boolean> {
  const { getDeviceTokens, sendPush, removeDeviceToken } = io;
  const res = await io.fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ athleteId, today: localDate }),
  });
  if (!res.ok) {
    log.warn(`scheduler: ${path} for ${athleteId} returned ${res.status}, skipping`);
    return false;
  }
  const body: any = await res.json();
  const voice: string | undefined = body?.read?.voice;
  const numbers: string = typeof body?.read?.numbers === 'string' ? body.read.numbers : '';
  const today: string = typeof body?.read?.today === 'string' ? body.read.today : '';
  if (!voice) return false;

  const kind = path === '/api/read' ? 'daily' : 'weekly';
  const sentAt = Math.floor((io.now?.() ?? new Date()).getTime() / 1000);
  const tokens = await getDeviceTokens(athleteId);
  let accepted = 0;
  for (const token of tokens) {
    // Numbers first (PRD §5.A.2); the weekly read has none and sends the voice.
    const r = await sendPush(
      token,
      { title, body: numbers || today ? pushBody(numbers, voice, 178, today) : trimBody(voice) },
      { kind, date: localDate, sent_at: sentAt },
    );
    if (r.ok) accepted++;
    if (r.reason === 'BadDeviceToken' || r.reason === 'Unregistered') {
      await removeDeviceToken(token);
    } else if (!r.ok) {
      log.warn(`scheduler: push to ${athleteId} failed (${r.status} ${r.reason ?? ''})`);
    }
  }
  log.info(pushSentLine({ kind, athleteId, localDate, numericFirst: Boolean(numbers), devices: tokens.length, accepted }));
  return true;
}

export interface TickDeps {
  listAthletes(): Promise<string[]>;
  prefs: Pick<PrefsStore, 'getMany' | 'claim' | 'release'>;
  deliver(athleteId: string, kind: 'daily' | 'weekly', localDate: string): Promise<boolean>;
  log: Logger;
  // When a delivery finished, for the on-time telemetry. Defaults to the wall clock.
  clock?: () => Date;
  // athlete:kind:date -> when its last try failed (ms), kept across ticks.
  failedAt?: Map<string, number>;
  // Claims whose release threw, retried at the start of each tick so the
  // stuck claim does not cost the athlete the day's read.
  pendingReleases?: Map<string, PendingRelease>;
}

export interface PendingRelease {
  athleteId: string;
  kind: 'daily' | 'weekly';
  localDate: string;
  previous: string | null;
}

export const RETRY_AFTER_MS = 15 * 60_000;
export const DELIVERY_CONCURRENCY = 4;

// One scheduler tick: every athlete whose local delivery time has come and
// who has not had today's read gets it; Monday also brings the weekly review.
export async function runTick(now: Date, deps: TickDeps): Promise<{ daily: number; weekly: number }> {
  // Before loading preferences, so a released claim reads as not yet sent.
  // A release only resets a column still holding its own date, so a late
  // retry cannot undo another send.
  for (const [key, r] of deps.pendingReleases ?? []) {
    try {
      await deps.prefs.release(r.athleteId, r.kind, r.localDate, r.previous);
      deps.pendingReleases!.delete(key);
    } catch (e) {
      deps.log.error(`scheduler: release retry for ${r.athleteId} ${r.kind} failed: ${e instanceof Error ? e.message : e}`);
    }
  }
  let athletes: string[];
  let prefs: Awaited<ReturnType<PrefsStore['getMany']>>;
  try {
    athletes = await deps.listAthletes();
    if (athletes.length === 0) return { daily: 0, weekly: 0 };
    prefs = await deps.prefs.getMany(athletes);
  } catch (e) {
    deps.log.error(`scheduler: failed to load athletes: ${e instanceof Error ? e.message : e}`);
    return { daily: 0, weekly: 0 };
  }
  const sent = { daily: 0, weekly: 0 };
  const one = async (athleteId: string) => {
    const p = prefs.get(athleteId)!;
    const due = dueDeliveries(p, now);
    for (const kind of ['daily', 'weekly'] as const) {
      if (!due[kind]) continue;
      const previous = kind === 'daily' ? p.last_daily_sent_on : p.last_weekly_sent_on;
      const key = `${athleteId}:${kind}:${due.localDate}`;
      const failed = deps.failedAt?.get(key);
      // A failed read is retried every RETRY_AFTER_MS, not every tick: each
      // try can be an LLM call.
      if (failed !== undefined && now.getTime() - failed < RETRY_AFTER_MS) continue;
      try {
        // Claim first: a slow tick, an overlapping tick or a second server
        // cannot send the same read twice.
        if (!(await deps.prefs.claim(athleteId, kind, due.localDate))) continue;
        let delivered = false;
        try {
          delivered = await deps.deliver(athleteId, kind, due.localDate);
        } finally {
          if (!delivered) {
            deps.failedAt?.set(key, now.getTime());
            try {
              await deps.prefs.release(athleteId, kind, due.localDate, previous);
            } catch (e) {
              // Left claimed, no later tick would try again: queue the release.
              deps.log.error(`scheduler: release of ${kind} for ${athleteId} failed: ${e instanceof Error ? e.message : e}`);
              deps.pendingReleases?.set(key, { athleteId, kind, localDate: due.localDate, previous });
            }
          }
          // After the release: telemetry must never cost a read.
          try {
            const at = deps.clock?.() ?? new Date();
            deps.log.info(pushDeliveryLine({
              kind, athleteId, localDate: due.localDate, lateMin: minutesLate(p, due.localDate, at), delivered,
            }));
          } catch { /* a broken log transport is not a failed delivery */ }
        }
        if (delivered) {
          sent[kind]++;
          deps.failedAt?.delete(key);
        }
      } catch (e) {
        deps.log.error(`scheduler: ${kind} for ${athleteId} threw: ${e instanceof Error ? e.message : e}`);
      }
    }
  };
  // A few athletes at a time: one by one, the last of many 06:00 reads would
  // land well past the 5-minute bar (each read is an LLM call).
  const queue = [...athletes];
  await Promise.all(Array.from({ length: Math.min(DELIVERY_CONCURRENCY, queue.length) }, async () => {
    for (let id = queue.shift(); id !== undefined; id = queue.shift()) await one(id);
  }));
  if (sent.daily || sent.weekly) deps.log.info(`scheduler: sent ${sent.daily} daily, ${sent.weekly} weekly`);
  return sent;
}

// Start the scheduler. Idle (no-op) until APNs is configured, so it's safe to
// run in every environment; it activates once APNS_* env is present.
export function startScheduler(port: number, log: Logger, prefs: PrefsStore): void {
  if (!apnsConfigured()) {
    log.info('scheduler: APNs not configured, push scheduler idle');
    return;
  }
  const baseUrl = `http://localhost:${port}`;
  const deps: TickDeps = {
    listAthletes: getAthletesWithDevices,
    prefs,
    deliver: (athleteId, kind, localDate) =>
      kind === 'daily'
        ? pushToAthlete(baseUrl, athleteId, '/api/read', 'Today’s read', localDate, log)
        : pushToAthlete(baseUrl, athleteId, '/api/weekly', 'This week', localDate, log),
    log,
    failedAt: new Map(),
    pendingReleases: new Map(),
  };
  // Skip a tick while the last one is still running; never let a rejection
  // escape the cron callback (an unhandled rejection kills the process).
  let running = false;
  // Every minute: a 15-minute tick put a 6:05 read at 6:15, outside doc 10's
  // 5-minute bar. A tick with nothing due is two small queries.
  cron.schedule('* * * * *', () => {
    if (running) return;
    running = true;
    runTick(new Date(), deps)
      .catch((e) => log.error(`scheduler: tick failed: ${e instanceof Error ? e.message : e}`))
      .finally(() => { running = false; });
  });
  log.info('scheduler: push scheduler started (every minute, per-athlete delivery time)');
}
