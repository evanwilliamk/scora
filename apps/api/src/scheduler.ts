import cron from 'node-cron';
import {
  apnsConfigured,
  getAthletesWithDevices,
  getDeviceTokens,
  removeDeviceToken,
  sendPush,
} from './push';
import { dueDeliveries } from './delivery';
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
async function pushToAthlete(
  baseUrl: string,
  athleteId: string,
  path: '/api/read' | '/api/weekly',
  title: string,
  localDate: string,
  log: Logger
): Promise<boolean> {
  const res = await fetch(`${baseUrl}${path}`, {
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
  if (!voice) return false;

  const tokens = await getDeviceTokens(athleteId);
  for (const token of tokens) {
    const r = await sendPush(token, { title, body: trimBody(voice) });
    if (r.reason === 'BadDeviceToken' || r.reason === 'Unregistered') {
      await removeDeviceToken(token);
    } else if (!r.ok) {
      log.warn(`scheduler: push to ${athleteId} failed (${r.status} ${r.reason ?? ''})`);
    }
  }
  return true;
}

export interface TickDeps {
  listAthletes(): Promise<string[]>;
  prefs: Pick<PrefsStore, 'getMany' | 'markSent'>;
  deliver(athleteId: string, kind: 'daily' | 'weekly', localDate: string): Promise<boolean>;
  log: Logger;
}

// One scheduler tick: every athlete whose local delivery time has come and
// who has not had today's read gets it; Monday also brings the weekly review.
export async function runTick(now: Date, deps: TickDeps): Promise<{ daily: number; weekly: number }> {
  let athletes: string[];
  try {
    athletes = await deps.listAthletes();
  } catch (e) {
    deps.log.error(`scheduler: failed to list athletes: ${e instanceof Error ? e.message : e}`);
    return { daily: 0, weekly: 0 };
  }
  if (athletes.length === 0) return { daily: 0, weekly: 0 };
  const prefs = await deps.prefs.getMany(athletes);
  const sent = { daily: 0, weekly: 0 };
  for (const athleteId of athletes) {
    const due = dueDeliveries(prefs.get(athleteId)!, now);
    for (const kind of ['daily', 'weekly'] as const) {
      if (!due[kind]) continue;
      try {
        if (await deps.deliver(athleteId, kind, due.localDate)) {
          await deps.prefs.markSent(athleteId, kind, due.localDate);
          sent[kind]++;
        }
      } catch (e) {
        deps.log.error(`scheduler: ${kind} for ${athleteId} threw: ${e instanceof Error ? e.message : e}`);
      }
    }
  }
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
  };
  cron.schedule('*/15 * * * *', () => { runTick(new Date(), deps); });
  log.info('scheduler: push scheduler started (every 15 min, per-athlete delivery time)');
}
