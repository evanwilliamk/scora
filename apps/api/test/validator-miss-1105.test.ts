import test from 'node:test';
import assert from 'node:assert/strict';
import { validateVoice } from '../src/validator';
import { postureClaimHits } from '../src/drivers';

const issues = (line: string, drivers: { metric: string; value: string; trend?: string }[]) => {
  const v = validateVoice(line, drivers);
  return [...v.bannedHits, ...v.unbackedNumbers, ...v.unbackedClaims];
};

test('a direction word with no trend behind it is not backed (CLAUDE.md 3.2)', () => {
  const noTrend = [{ metric: 'HRV', value: '52ms' }, { metric: 'Load', value: '412 min' }, { metric: 'Weekly volume', value: '38 mi' }];
  for (const line of ['HRV is climbing.', 'HRV is down.', 'HRV keeps falling.', 'Load is up.', 'Load is lower.', 'Volume is higher.', 'Weekly volume is down.']) {
    assert.notDeepEqual(issues(line, noTrend), [], line);
  }
  // A flat or zero trend gives no direction either.
  assert.notDeepEqual(issues('HRV is climbing.', [{ metric: 'HRV', value: '52ms', trend: '+0% wk' }]), []);
  assert.notDeepEqual(issues('Load is up.', [{ metric: 'Load', value: '412 min', trend: 'flat' }]), []);
  // No driver for it at all.
  assert.notDeepEqual(issues('Load is up.', [{ metric: 'Sleep', value: '7:12' }]), []);
});

test('the value alone, history, and plain usage still pass without a trend', () => {
  const noTrend = [{ metric: 'HRV', value: '52ms' }, { metric: 'Load', value: '412 min' }];
  for (const line of ['HRV is 52ms.', 'Load is 412 min.', 'HRV was lower last week.', 'The weeks load up fast.', 'Load held at 412 min.']) {
    assert.deepEqual(issues(line, noTrend), [], line);
  }
});

test('a direction with its trend still passes', () => {
  assert.deepEqual(issues('HRV is climbing.', [{ metric: 'HRV', value: '52ms', trend: '+8% wk' }]), []);
  assert.deepEqual(issues('HRV is down.', [{ metric: 'HRV', value: '52ms', trend: '-8% wk' }]), []);
  // Two baselines disagreeing back either word.
  const both = [{ metric: 'HRV', value: '52ms', trend: '+2% wk' }, { metric: 'HRV vs week', value: '-3%' }];
  assert.deepEqual(issues('HRV is up.', both), []);
  assert.deepEqual(issues('HRV is down.', both), []);
});

test('same-size signed drivers: same sign is checked, opposite signs stay open', () => {
  const sameSign = [{ metric: 'Load', value: '412 min', trend: '+8% wk' }, { metric: 'HRV', value: '52ms', trend: '+8% wk' }];
  assert.notDeepEqual(issues('Load fell 8%.', sameSign), []);
  assert.deepEqual(issues('Load rose 8%.', sameSign), []);
  const opposite = [{ metric: 'Load', value: '412 min', trend: '+8% wk' }, { metric: 'HRV', value: '52ms', trend: '-8% wk' }];
  assert.deepEqual(issues('HRV fell 8%.', opposite), []);
  assert.deepEqual(issues('Load rose 8%.', opposite), []);
});

test('"tapered off" is plain English, a taper claim is still a posture claim', () => {
  assert.deepEqual(postureClaimHits('Your miles tapered off late in the week.', 'steady'), []);
  assert.deepEqual(postureClaimHits('Volume tapers off on Sunday.', 'steady'), []);
  assert.deepEqual(postureClaimHits('You are tapering now.', 'steady'), ['posture taper']);
  assert.deepEqual(postureClaimHits('The taper has started.', 'steady'), ['posture taper']);
});

test('chat: a series in the data can back a direction, a sign still cannot be argued with', () => {
  const series = [{ metric: 'hrv', value: '52' }];
  assert.equal(validateVoice('HRV is climbing.', [{ metric: 'HRV', value: '52ms' }], { seriesInData: true }).ok, true);
  assert.equal(validateVoice('HRV is climbing.', series, { seriesInData: true }).ok, true);
  assert.equal(validateVoice('HRV is climbing.', [{ metric: 'HRV', value: '52ms', trend: '-8% wk' }], { seriesInData: true }).ok, false);
});
