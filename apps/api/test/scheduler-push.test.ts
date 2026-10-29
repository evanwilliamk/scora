// pushToAthlete: the read is generated through the app's own endpoint, then
// pushed to every device; dead tokens are pruned. All I/O is stubbed here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pushToAthlete, type PushIo } from '../src/scheduler';

const quiet = { info: () => {}, warn: () => {}, error: () => {} };

function io(response: { status: number; body?: any }, results: Record<string, { ok: boolean; status: number; reason?: string }>) {
  const calls = { fetch: [] as any[], sent: [] as any[], removed: [] as string[] };
  const stub: PushIo = {
    fetch: (async (url: any, init: any) => {
      calls.fetch.push([String(url), JSON.parse(init.body)]);
      return new Response(JSON.stringify(response.body ?? {}), { status: response.status });
    }) as typeof fetch,
    getDeviceTokens: async () => Object.keys(results),
    sendPush: async (token, alert) => { calls.sent.push([token, alert]); return results[token]; },
    removeDeviceToken: async (token) => { calls.removed.push(token); },
  };
  return { stub, calls };
}

test('daily read: numbers first, pushed to every device, dead tokens pruned', async () => {
  const { stub, calls } = io(
    { status: 200, body: { read: { voice: 'Body is settled.', numbers: 'Sleep 7:12 · HRV 52ms' } } },
    { good: { ok: true, status: 200 }, gone: { ok: false, status: 410, reason: 'Unregistered' }, bad: { ok: false, status: 400, reason: 'BadDeviceToken' }, flaky: { ok: false, status: 503 } },
  );
  const done = await pushToAthlete('http://127.0.0.1:3000', 'a1', '/api/read', 'Today', '2026-10-22', quiet, stub);
  assert.equal(done, true);
  assert.deepEqual(calls.fetch, [['http://127.0.0.1:3000/api/read', { athleteId: 'a1', today: '2026-10-22' }]]);
  assert.deepEqual(calls.sent.map(([t]) => t), ['good', 'gone', 'bad', 'flaky']);
  assert.equal(calls.sent[0][1].body, 'Sleep 7:12 · HRV 52ms\nBody is settled.');
  assert.deepEqual(calls.removed, ['gone', 'bad'], 'a temporary failure keeps its token');
});

test('weekly read has no numbers line: the voice alone, trimmed for a notification', async () => {
  const long = 'A steady week. '.repeat(20);
  const { stub, calls } = io({ status: 200, body: { read: { voice: long } } }, { t: { ok: true, status: 200 } });
  assert.equal(await pushToAthlete('http://x', 'a1', '/api/weekly', 'This week', '2026-10-26', quiet, stub), true);
  const body: string = calls.sent[0][1].body;
  assert.ok(body.length <= 178 && body.endsWith('…'));
  assert.ok(!body.includes('\n'));
});

test('a failed or empty read pushes nothing and is not marked done', async () => {
  for (const response of [{ status: 500 }, { status: 200, body: { read: {} } }]) {
    const { stub, calls } = io(response, { t: { ok: true, status: 200 } });
    assert.equal(await pushToAthlete('http://x', 'a1', '/api/read', 'Today', '2026-10-22', quiet, stub), false);
    assert.equal(calls.sent.length, 0);
  }
});

test('each push carries kind, date and send time, and one push_sent line counts accepted devices', async () => {
  const lines: string[] = [];
  const log = { info: (m: string) => lines.push(m), warn: () => {}, error: () => {} };
  const { stub, calls } = io(
    { status: 200, body: { read: { voice: 'Body is settled.', numbers: 'Sleep 7:12' } } },
    { good: { ok: true, status: 200 }, flaky: { ok: false, status: 503 } },
  );
  stub.now = () => new Date(Date.UTC(2026, 9, 22, 10, 0));
  const data: unknown[] = [];
  const send = stub.sendPush;
  stub.sendPush = async (token, alert, d) => { data.push(d); return send(token, alert, d); };
  await pushToAthlete('http://x', 'a1', '/api/read', 'Today', '2026-10-22', log, stub);
  assert.equal(calls.sent.length, 2);
  const sentAt = Date.UTC(2026, 9, 22, 10, 0) / 1000;
  assert.deepEqual(data, [{ kind: 'daily', date: '2026-10-22', sent_at: sentAt }, { kind: 'daily', date: '2026-10-22', sent_at: sentAt }]);
  const events = lines.filter((l) => l.startsWith('telemetry ')).map((l) => JSON.parse(l.slice(10)));
  assert.deepEqual(events, [{ event: 'push_sent', kind: 'daily', athlete: 'a1', date: '2026-10-22', numeric_first: true, devices: 2, accepted: 1 }]);
});
