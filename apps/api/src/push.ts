import crypto from 'crypto';
import http2 from 'http2';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

// APNs push sender. Signs a provider JWT (ES256) with the .p8 auth key using
// Node's built-in crypto — no extra dependency — and delivers over HTTP/2.
//
// Required env:
//   APNS_KEY_ID    — the 10-char Key ID of the .p8 auth key
//   APNS_TEAM_ID   — your Apple Developer Team ID
//   APNS_BUNDLE_ID — the app bundle id (apns-topic), e.g. app.scora.Scora
//   APNS_KEY       — the .p8 contents (PEM). Literal "\n" are normalised.
//   APNS_ENV       — "production" | "sandbox" (default sandbox for dev builds)

const KEY_ID = process.env.APNS_KEY_ID || '';
const TEAM_ID = process.env.APNS_TEAM_ID || '';
const BUNDLE_ID = process.env.APNS_BUNDLE_ID || '';
const KEY_PEM = (process.env.APNS_KEY || '').replace(/\\n/g, '\n');
// APNS_TEST_HOST points the sender at a local HTTP/2 server in tests only;
// it is ignored outside NODE_ENV=test.
const APNS_HOST =
  process.env.NODE_ENV === 'test' && process.env.APNS_TEST_HOST
    ? process.env.APNS_TEST_HOST
    : (process.env.APNS_ENV || 'sandbox') === 'production'
      ? 'https://api.push.apple.com'
      : 'https://api.sandbox.push.apple.com';

export function apnsConfigured(): boolean {
  return Boolean(KEY_ID && TEAM_ID && BUNDLE_ID && KEY_PEM);
}

const b64url = (buf: Buffer | string) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// Provider tokens are valid up to 1h; Apple rejects tokens older than that and
// throttles minting new ones. Cache and refresh ~every 50 minutes.
let cachedJwt: { token: string; iat: number } | null = null;

// Exported for tests: the token's shape and signature are what APNs checks.
export function providerJwt(): string {
  const now = Math.floor(Date.now() / 1000);
  if (cachedJwt && now - cachedJwt.iat < 3000) return cachedJwt.token;

  const header = b64url(JSON.stringify({ alg: 'ES256', kid: KEY_ID }));
  const payload = b64url(JSON.stringify({ iss: TEAM_ID, iat: now }));
  // dsaEncoding 'ieee-p1363' gives the raw R||S signature JOSE/JWT expects
  // (not the default DER), so no manual conversion is needed.
  const signature = crypto.sign(
    'sha256',
    Buffer.from(`${header}.${payload}`),
    { key: KEY_PEM, dsaEncoding: 'ieee-p1363' }
  );
  const token = `${header}.${payload}.${b64url(signature)}`;
  cachedJwt = { token, iat: now };
  return token;
}

export interface PushResult {
  ok: boolean;
  status: number;
  reason?: string; // APNs failure reason, e.g. BadDeviceToken, Unregistered
}

// Send one alert push to a device token. Resolves with the APNs status; never
// throws for a rejected push (returns ok:false) so callers can prune tokens.
// `extra` rides along under `scora` (kind, date, send time) so the app can
// report the open (doc 10 1.1.2).
export function sendPush(
  deviceToken: string,
  alert: { title: string; body: string },
  extra?: Record<string, string | number>
): Promise<PushResult> {
  return new Promise((resolve) => {
    if (!apnsConfigured()) {
      resolve({ ok: false, status: 0, reason: 'APNs not configured' });
      return;
    }

    const client = http2.connect(APNS_HOST);
    client.on('error', (e) => resolve({ ok: false, status: 0, reason: String(e) }));

    const body = JSON.stringify({
      aps: { alert, sound: 'default' },
      ...(extra ? { scora: extra } : {}),
    });

    const req = client.request({
      ':method': 'POST',
      ':path': `/3/device/${deviceToken}`,
      authorization: `bearer ${providerJwt()}`,
      'apns-topic': BUNDLE_ID,
      'apns-push-type': 'alert',
      'content-type': 'application/json',
    });

    let status = 0;
    let data = '';
    req.on('response', (headers) => {
      status = Number(headers[':status']) || 0;
    });
    req.setEncoding('utf8');
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => {
      client.close();
      if (status === 200) {
        resolve({ ok: true, status });
      } else {
        let reason: string | undefined;
        try {
          reason = JSON.parse(data).reason;
        } catch {
          reason = data || undefined;
        }
        resolve({ ok: false, status, reason });
      }
    });
    req.on('error', (e) => {
      client.close();
      resolve({ ok: false, status: 0, reason: String(e) });
    });
    req.end(body);
  });
}

// --- Device-token storage ------------------------------------------------

let _supabase: SupabaseClient | null = null;
function getSupabase(): SupabaseClient {
  if (_supabase) return _supabase;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Supabase env not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).');
  }
  _supabase = createClient(url, key);
  return _supabase;
}

export async function registerDeviceToken(athleteId: string, token: string): Promise<void> {
  const { error } = await getSupabase()
    .from('device_tokens')
    .upsert(
      { athlete_id: String(athleteId), token, platform: 'ios', updated_at: new Date().toISOString() },
      { onConflict: 'token' }
    );
  if (error) throw new Error(`Failed to store device token: ${error.message}`);
}

// Sign-out on a phone: that athlete's pushes stop reaching it. Only the
// athlete's own row for this token is removed.
export async function unregisterDeviceToken(athleteId: string, token: string): Promise<void> {
  const { error } = await getSupabase()
    .from('device_tokens')
    .delete()
    .eq('athlete_id', String(athleteId))
    .eq('token', token);
  if (error) throw new Error(`Failed to remove device token: ${error.message}`);
}

export async function getDeviceTokens(athleteId: string): Promise<string[]> {
  const { data, error } = await getSupabase()
    .from('device_tokens')
    .select('token')
    .eq('athlete_id', String(athleteId));
  if (error) throw new Error(`Failed to read device tokens: ${error.message}`);
  return (data || []).map((r: any) => r.token);
}

// Drop a token APNs has told us is dead (BadDeviceToken / Unregistered).
export async function removeDeviceToken(token: string): Promise<void> {
  await getSupabase().from('device_tokens').delete().eq('token', token);
}

// Distinct athlete ids that have at least one registered device — the audience
// for scheduled pushes. Paged: Supabase answers at most 1000 rows a request
// (the project's max-rows setting), and a short page would drop athletes.
export const DEVICE_PAGE = 1000;
export async function getAthletesWithDevices(): Promise<string[]> {
  const ids = new Set<string>();
  for (let from = 0; ; from += DEVICE_PAGE) {
    const { data, error } = await getSupabase()
      .from('device_tokens')
      .select('athlete_id')
      .order('id')
      .range(from, from + DEVICE_PAGE - 1);
    if (error) throw new Error(`Failed to list device athletes: ${error.message}`);
    for (const r of data || []) ids.add(String((r as any).athlete_id));
    if ((data || []).length < DEVICE_PAGE) return [...ids];
  }
}

// The athletes whose push is due at `now`, from scora_due_deliveries
// (migration 20261101010000): one request per 1000 due athletes, none per
// idle athlete. Throws MissingRpcError until the migration is applied, so the
// scheduler can fall back to reading every athlete's preferences.
export interface DueRow {
  athlete_id: string;
  timezone: string;
  delivery_minute: number;
  last_daily_sent_on: string | null;
  last_weekly_sent_on: string | null;
  local_date: string;
  daily: boolean;
  weekly: boolean;
}

export class MissingRpcError extends Error {}

// PostgREST says PGRST202 when the function is not in its schema cache;
// Postgres says 42883 when no function matches the call. A 42883 about some
// other function or operator comes from inside a broken scora_due_deliveries
// and is a failure to log every tick, not a migration still to apply.
export function isMissingFunction(error: { code?: string; message?: string }): boolean {
  const message = error.message ?? '';
  if (error.code === 'PGRST202') return true;
  if (/could not find the function/i.test(message)) return true;
  return /function (?:public\.)?scora_due_deliveries\b[^]* does not exist/i.test(message);
}

export const DUE_PAGE = 1000;
export async function getDueDeliveries(now: Date, windowMinutes: number): Promise<DueRow[]> {
  const out: DueRow[] = [];
  let after: string | null = null;
  for (;;) {
    const { data, error } = await getSupabase().rpc('scora_due_deliveries', {
      p_now: now.toISOString(),
      p_window_minutes: windowMinutes,
      p_after: after,
      p_limit: DUE_PAGE,
    });
    if (error) {
      if (isMissingFunction(error)) throw new MissingRpcError(`scora_due_deliveries: ${error.message}`);
      throw new Error(`Failed to list due deliveries: ${error.message}`);
    }
    const rows = (data ?? []) as any[];
    for (const r of rows) {
      out.push({
        athlete_id: String(r.athlete_id),
        timezone: r.timezone,
        delivery_minute: Number(r.delivery_minute),
        last_daily_sent_on: r.last_daily_sent_on ?? null,
        last_weekly_sent_on: r.last_weekly_sent_on ?? null,
        local_date: r.local_date,
        daily: r.daily === true,
        weekly: r.weekly === true,
      });
    }
    if (rows.length < DUE_PAGE) return out;
    after = out[out.length - 1].athlete_id;
  }
}
