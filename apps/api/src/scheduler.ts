import cron from 'node-cron';
import {
  apnsConfigured,
  getAthletesWithDevices,
  getDeviceTokens,
  removeDeviceToken,
  sendPush,
} from './push';

// Scheduled push delivery — the free-tier doorbell (§5.1).
//
// To avoid duplicating (or destabilising) the read-generation code, each job
// calls the app's own /api/read and /api/weekly endpoints over localhost per
// athlete, then pushes the resulting voice. So pushes go through the exact same
// validated pipeline as the in-app reads, with zero code divergence.
//
// Timing (free tier): daily read at 6am; the Sunday weekly review is delivered
// 24h delayed, i.e. Monday 6am. Times are in PUSH_TZ (default America/New_York).

type Logger = { info: (m: string) => void; warn: (m: string) => void; error: (m: string) => void };

// APNs alert bodies truncate around ~178 chars; keep the read tidy.
function trimBody(text: string, max = 178): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : t.slice(0, max - 1).trimEnd() + '…';
}

async function pushToAthlete(
  baseUrl: string,
  athleteId: string,
  path: '/api/read' | '/api/weekly',
  title: string,
  log: Logger
): Promise<void> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ athleteId }),
  });
  if (!res.ok) {
    log.warn(`scheduler: ${path} for ${athleteId} returned ${res.status} — skipping`);
    return;
  }
  const body: any = await res.json();
  const voice: string | undefined = body?.read?.voice;
  if (!voice) return;

  const tokens = await getDeviceTokens(athleteId);
  for (const token of tokens) {
    const r = await sendPush(token, { title, body: trimBody(voice) });
    if (r.reason === 'BadDeviceToken' || r.reason === 'Unregistered') {
      await removeDeviceToken(token);
    } else if (!r.ok) {
      log.warn(`scheduler: push to ${athleteId} failed (${r.status} ${r.reason ?? ''})`);
    }
  }
}

async function runJob(
  baseUrl: string,
  path: '/api/read' | '/api/weekly',
  title: string,
  log: Logger
): Promise<void> {
  let athletes: string[];
  try {
    athletes = await getAthletesWithDevices();
  } catch (e) {
    log.error(`scheduler: failed to list athletes: ${e instanceof Error ? e.message : e}`);
    return;
  }
  log.info(`scheduler: ${path} run for ${athletes.length} athlete(s)`);
  for (const athleteId of athletes) {
    try {
      await pushToAthlete(baseUrl, athleteId, path, title, log);
    } catch (e) {
      log.error(`scheduler: ${path} for ${athleteId} threw: ${e instanceof Error ? e.message : e}`);
    }
  }
}

// Start the cron jobs. Idle (no-op) until APNs is configured, so it's safe to
// run in every environment — it simply activates once APNS_* env is present.
export function startScheduler(port: number, log: Logger): void {
  if (!apnsConfigured()) {
    log.info('scheduler: APNs not configured — push scheduler idle');
    return;
  }
  const tz = process.env.PUSH_TZ || 'America/New_York';
  const baseUrl = `http://localhost:${port}`;

  // Daily read — every day at 06:00.
  cron.schedule('0 6 * * *', () => runJob(baseUrl, '/api/read', 'Today’s read', log), { timezone: tz });
  // Weekly review — Monday 06:00 (free tier's 24h-delayed Sunday read).
  cron.schedule('0 6 * * 1', () => runJob(baseUrl, '/api/weekly', 'This week', log), { timezone: tz });

  log.info(`scheduler: push scheduler started (tz=${tz})`);
}
