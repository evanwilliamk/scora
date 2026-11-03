// startScheduler with APNs unconfigured (the default in every test run):
// it logs once that it is idle and schedules nothing. The active path
// is tested with a fake timer in scheduler-start-active.test.ts.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blankEnv } from './helpers/test-env';

blankEnv();

test('without APNs the scheduler stays idle and says so once', async () => {
  const { startScheduler } = await import('../src/scheduler');
  const { apnsConfigured } = await import('../src/push');
  assert.equal(apnsConfigured(), false);
  const lines: string[] = [];
  const log = { info: (m: string) => lines.push(`info ${m}`), warn: (m: string) => lines.push(`warn ${m}`), error: (m: string) => lines.push(`error ${m}`) };
  startScheduler(3000, log as any, {} as any);
  assert.deepEqual(lines, ['info scheduler: APNs not configured, push scheduler idle']);
});
