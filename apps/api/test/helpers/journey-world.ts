// The outside world for the end-to-end journey simulation
// (test/journey-sim.test.ts): one fetch that stands in for Strava, Oura and
// OpenAI, keyed by each athlete's own token, reading the simulated clock. Any
// host that is not one of these or the local Supabase stand-in throws, so
// nothing can leave the machine. No file here reads .env or a real key.
//
// The fake model reads the prompt it was sent, so a draft only cites what that
// prompt offered, and each day has a mode: clean drafts, prescriptive drafts,
// invented numbers, a first draft that is caught and a retry that passes, or an
// outage. So all of the voice's paths run in the same journey.

import http2 from 'node:http2';

export interface SimRun {
  name: string;
  startMs: number; // true UTC
  offsetSec: number; // the zone's offset at the start
  seconds: number; // moving time
  meters: number;
  hr: number;
  workoutType?: number; // Strava: 1 race
}

export interface Night {
  day: string; // the morning the night ends, as Oura dates it
  sleepSeconds: number;
  score: number;
  hrv: number;
  rhr: number;
  readiness: number;
}

export type LlmMode = 'clean' | 'prescriptive' | 'invented' | 'first_bad' | 'down';

export interface LlmCall {
  system: string;
  user: string;
  reply: string | null;
  // The Strava or Oura athlete is not on an OpenAI call; set by who the sim is
  // acting for, so a leak between athletes shows up on the prompt.
  actingFor: string | null;
}

const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

// The wall-clock offset of `tz` at an instant, in seconds.
export function zoneOffsetSec(tz: string, at: number): number {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(at)).map((x) => [x.type, x.value]));
  return (Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(at / 1000) * 1000) / 1000;
}

// The instant `tz` reads `date` at `minute` past midnight.
export function zonedInstant(date: string, minute: number, tz: string): number {
  const wall = Date.parse(`${date}T00:00:00Z`) + minute * 60_000;
  let t = wall - zoneOffsetSec(tz, wall) * 1000;
  t = wall - zoneOffsetSec(tz, t) * 1000;
  return t;
}

export class World {
  runs = new Map<string, SimRun[]>();
  nights = new Map<string, Map<string, Night>>();
  // Oura lets a night be read from this local minute of its morning.
  zones = new Map<string, string>();
  llmMode: LlmMode = 'clean';
  llmCalls: LlmCall[] = [];
  actingFor: string | null = null;
  // Requests each vendor saw for the wrong or no token.
  badTokens: string[] = [];
  hosts = new Set<string>();
  private stravaTokens = new Map<string, string>();
  private stravaRefresh = new Map<string, string>();
  private ouraTokens = new Map<string, string>();
  private ouraRefresh = new Map<string, string>();
  private serial = 0;
  private realFetch = globalThis.fetch;
  private realConnect = http2.connect;

  constructor(private restOrigin: string) {}

  addRun(athlete: string, r: SimRun) {
    const list = this.runs.get(athlete) ?? [];
    list.push(r);
    this.runs.set(athlete, list);
  }

  // A run at a local wall time in the zone it happened in.
  addLocalRun(athlete: string, date: string, minute: number, tz: string, r: Omit<SimRun, 'startMs' | 'offsetSec'>) {
    const startMs = zonedInstant(date, minute, tz);
    this.addRun(athlete, { ...r, startMs, offsetSec: zoneOffsetSec(tz, startMs) });
  }

  private tokenAthlete(map: Map<string, string>, headers: any): string | null {
    const auth = String(headers?.Authorization ?? headers?.authorization ?? '').replace(/^Bearer /, '');
    return map.get(auth) ?? null;
  }

  private issueStrava(athlete: string) {
    const n = ++this.serial;
    const access = `strava-access-${athlete}-${n}`;
    const refresh = `strava-refresh-${athlete}-${n}`;
    this.stravaTokens.set(access, athlete);
    this.stravaRefresh.set(refresh, athlete);
    return {
      access_token: access, refresh_token: refresh, expires_at: Math.floor(Date.now() / 1000) + 6 * 3600,
      athlete: { id: Number(athlete), firstname: `A${athlete}`, lastname: 'Sim' },
    };
  }

  private issueOura(athlete: string) {
    const n = ++this.serial;
    const access = `oura-access-${athlete}-${n}`;
    const refresh = `oura-refresh-${athlete}-${n}`;
    this.ouraTokens.set(access, athlete);
    this.ouraRefresh.set(refresh, athlete);
    return { access_token: access, refresh_token: refresh, expires_in: 24 * 3600 };
  }

  private strava(u: URL, init: RequestInit | undefined): Response {
    if (u.pathname === '/oauth/token') {
      const body = JSON.parse(String(init?.body ?? '{}'));
      if (body.grant_type === 'authorization_code') return json(200, this.issueStrava(String(body.code).replace(/^code-/, '')));
      const who = this.stravaRefresh.get(body.refresh_token);
      if (!who) { this.badTokens.push('strava refresh'); return json(400, { message: 'bad refresh token' }); }
      return json(200, this.issueStrava(who));
    }
    const who = this.tokenAthlete(this.stravaTokens, init?.headers);
    if (!who) { this.badTokens.push(`strava ${u.pathname}`); return json(401, { message: 'Authorization Error' }); }
    if (u.pathname === '/api/v3/athlete') return json(200, { id: Number(who), weight: 70 });
    if (u.pathname === '/api/v3/athlete/activities') {
      if (Number(u.searchParams.get('page') ?? '1') > 1) return json(200, []);
      const after = Number(u.searchParams.get('after') ?? '0') * 1000;
      const now = Date.now();
      // Only what has been recorded by now, oldest first as Strava sends with `after`.
      const list = (this.runs.get(who) ?? [])
        .filter((r) => r.startMs >= after && r.startMs + r.seconds * 1000 <= now)
        .sort((a, b) => a.startMs - b.startMs)
        .map((r) => ({
          type: 'Run', sport_type: 'Run', name: r.name,
          start_date: iso(r.startMs), start_date_local: iso(r.startMs + r.offsetSec * 1000), utc_offset: r.offsetSec,
          distance: r.meters, moving_time: r.seconds, elapsed_time: r.seconds, average_heartrate: r.hr, max_heartrate: r.hr + 12,
          total_elevation_gain: 40, ...(r.workoutType != null ? { workout_type: r.workoutType } : {}),
        }));
      return json(200, list);
    }
    throw new Error(`journey world: unknown Strava path ${u.pathname}`);
  }

  private oura(u: URL, init: RequestInit | undefined): Response {
    if (u.pathname === '/oauth/token') {
      const form = new URLSearchParams(String(init?.body ?? ''));
      if (form.get('grant_type') === 'authorization_code') return json(200, this.issueOura(String(form.get('code')).replace(/^oura-/, '')));
      const who = this.ouraRefresh.get(String(form.get('refresh_token')));
      if (!who) { this.badTokens.push('oura refresh'); return json(400, { detail: 'bad refresh token' }); }
      return json(200, this.issueOura(who));
    }
    const who = this.tokenAthlete(this.ouraTokens, init?.headers);
    if (!who) { this.badTokens.push(`oura ${u.pathname}`); return json(401, { detail: 'unauthorized' }); }
    const from = u.searchParams.get('start_date') ?? '0000';
    const to = u.searchParams.get('end_date') ?? '9999';
    const tz = this.zones.get(who) ?? 'UTC';
    const now = Date.now();
    // A night is readable from 05:00 local on the morning it ends.
    const nights = [...(this.nights.get(who)?.values() ?? [])]
      .filter((n) => n.day >= from && n.day <= to && zonedInstant(n.day, 300, tz) <= now);
    const route = u.pathname.split('/').pop();
    if (route === 'sleep') {
      return json(200, { data: nights.map((n) => ({ day: n.day, type: 'long_sleep', total_sleep_duration: n.sleepSeconds, average_hrv: n.hrv, lowest_heart_rate: n.rhr })) });
    }
    if (route === 'daily_sleep') return json(200, { data: nights.map((n) => ({ day: n.day, score: n.score })) });
    if (route === 'daily_readiness') return json(200, { data: nights.map((n) => ({ day: n.day, score: n.readiness })) });
    throw new Error(`journey world: unknown Oura path ${u.pathname}`);
  }

  // A draft that cites only what the prompt offered.
  private draft(user: string): string {
    const lines = user.split('\n');
    const start = lines.findIndex((l) => l.startsWith('DRIVERS'));
    const drivers = lines.slice(start + 1).filter((l) => l.startsWith('- ')).map((l) => {
      const m = /^- ([^:]+): (.*?)(?: \(([^()]*)\))?$/.exec(l)!;
      return { metric: m[1], value: m[2] };
    });
    const out: string[] = [];
    for (const d of drivers.filter((x) => x.metric !== 'Plan change').slice(0, 3)) out.push(`${d.metric} reads ${d.value}.`);
    const posture = /^POSTURE \(decided[^:]*: (\S+)/m.exec(user)?.[1] ?? /^POSTURE[^:]*: (\S+)/m.exec(user)?.[1];
    if (posture) out.push(`The posture reads ${posture}.`);
    const change = /^PLAN CHANGE \([^)]*\): (.*)$/m.exec(user)?.[1];
    if (change) out.push(change);
    return out.join(' ') || 'Nothing in the record stands out this morning.';
  }

  private bad(mode: LlmMode): string {
    return mode === 'invented'
      ? 'Load reads 9999 min, and sleep held at 11:47 for the third night.'
      : 'You should do an easy run today and skip the tempo. Let me know if that resonates.';
  }

  private openAi(init: RequestInit | undefined): Response {
    const body = JSON.parse(String(init?.body ?? '{}'));
    const system: string = body.messages?.[0]?.content ?? '';
    const user: string = body.messages?.[1]?.content ?? '';
    const call: LlmCall = { system, user, reply: null, actingFor: this.actingFor };
    this.llmCalls.push(call);
    // Plan transcription is not a voice surface: it works in every mode but an outage.
    if (system.startsWith('You transcribe')) {
      const text = user.slice(user.indexOf('PLAN TEXT:'));
      const workouts = text.split('\n').flatMap((line) => {
        const m = /^(\d{4}-\d{2}-\d{2}): (.*)$/.exec(line.trim());
        if (!m) return [];
        const mi = /([\d.]+) mi\b/.exec(m[2]);
        const min = /(\d+) min\b/.exec(m[2]);
        const intensity = /tempo/.test(m[2]) ? 'tempo' : /long/.test(m[2]) ? 'long' : /rest/.test(m[2]) ? 'rest' : 'easy';
        return [{
          date: m[1], type: intensity === 'rest' ? 'other' : 'run', intensity,
          duration_min: min ? Number(min[1]) : null, distance: mi ? Number(mi[1]) : null, distance_unit: mi ? 'mi' : null, description: m[2],
        }];
      });
      call.reply = JSON.stringify({ workouts });
      return json(200, { choices: [{ message: { role: 'assistant', content: call.reply } }] });
    }
    const mode = this.llmMode;
    if (mode === 'down') return json(500, { error: { message: 'canned outage' } });
    const retry = /rejected|previous draft|was replaced|Rewrite/i.test(user);
    const bad = mode === 'prescriptive' || mode === 'invented' || (mode === 'first_bad' && !retry);
    let reply: string;
    if (system.startsWith('You write one short line')) {
      // The adaptation reason: a clean line naming the change and one driver, or an advising one.
      const change = /^CHANGE: (\w+): (\w+)'s .*? to ([\w ]+?)(?:, |\.|$)/m.exec(user);
      const day = change?.[2] ?? 'Tomorrow';
      const driver = /^- [^:]+: (\S+)/m.exec(user)?.[1] ?? '';
      const cited = driver ? ` The record reads ${driver}.` : '';
      reply = bad ? `You should skip ${day}.` : change?.[1] === 'MOVED'
        ? `${day}'s session moved to ${change[3]}.${cited}`
        : `${day}'s session is now ${change?.[3] ?? 'lighter'}.${cited}`;
    } else if (system.includes('voice layer')) {
      // Chat: the data block's own numbers, in the output format.
      const data = JSON.parse(user.slice(user.indexOf('Data (JSON):') + 12, user.indexOf('Answer THIS')).trim());
      reply = bad ? this.bad(mode) : `${data.thisWeek.miles} mi across ${data.thisWeek.runs} runs this past week.\nMETRIC: Weekly miles | VALUE: ${data.thisWeek.miles} mi | TREND: flat\nCHART: weekly_miles`;
    } else {
      reply = bad ? this.bad(mode) : this.draft(user);
    }
    call.reply = reply;
    return json(200, { choices: [{ message: { role: 'assistant', content: reply } }] });
  }

  install() {
    const real = this.realFetch;
    const origin = this.restOrigin;
    globalThis.fetch = (async (input: any, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const u = new URL(url);
      if (u.origin === origin) return real(input, init);
      this.hosts.add(u.hostname);
      if (u.hostname === 'www.strava.com') return this.strava(u, init);
      if (u.hostname === 'api.ouraring.com') return this.oura(u, init);
      if (u.hostname === 'api.openai.com') return this.openAi(init);
      throw new Error(`journey world: blocked request to ${u.hostname}`);
    }) as typeof fetch;
    (http2 as any).connect = (authority: any) => {
      throw new Error(`journey world: blocked http2 to ${String(authority)}`);
    };
  }

  restore() {
    globalThis.fetch = this.realFetch;
    (http2 as any).connect = this.realConnect;
  }
}
