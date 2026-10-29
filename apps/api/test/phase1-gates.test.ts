// scripts/phase1-gates.sql (doc 10 2.1.1 and 2.1.9), run as written on PGlite.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';

const here = dirname(fileURLToPath(import.meta.url));
const SQL = readFileSync(join(here, '..', 'scripts', 'phase1-gates.sql'), 'utf8');

let db: PGlite;
before(async () => {
  db = new PGlite({ extensions: { vector } });
  const dir = join(here, '..', 'supabase', 'migrations');
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(join(dir, f), 'utf8'));
  }
});
after(async () => { await db.close(); });

const verdict = async () => (await db.query<any>(SQL)).rows[0].verdict as string;

test('no onboarded athletes: 2.1.1 fails, 2.1.9 has no data', async () => {
  assert.equal(await verdict(), '2.1.1 0 onboarded FAIL; 2.1.9 NO DATA');
});

test('counts onboarding in the phase and CDV use since its start', async () => {
  const athlete = async (strava: string, onboardedDaysAgo: number | null, cdvDaysAgo: number | null) => {
    await db.query(
      `insert into athletes (name, strava_id, cdv_count, cdv_count_date) values ($1, $1, 1, case when $2::int is null then null else current_date - $2::int end)`,
      [strava, cdvDaysAgo]);
    await db.query(
      `insert into athlete_preferences (athlete_id, onboarded_at) values ($1, case when $2::int is null then null else now() - make_interval(days => $2::int) end)`,
      [strava, onboardedDaysAgo]);
  };
  for (let i = 0; i < 6; i++) await athlete(`s${i}`, 5, i < 3 ? 2 : null); // 3 of 6 used CDV
  await athlete('old', 40, 1); // onboarded before the phase
  await athlete('never', null, 1); // not onboarded
  await athlete('stale', 5, 30); // used CDV only before the phase
  assert.equal(await verdict(), '2.1.1 7 onboarded FAIL; 2.1.9 42.9% used CDV FAIL');
  for (let i = 0; i < 3; i++) await athlete(`t${i}`, 3, 1);
  assert.equal(await verdict(), '2.1.1 10 onboarded PASS; 2.1.9 60.0% used CDV PASS');
});
