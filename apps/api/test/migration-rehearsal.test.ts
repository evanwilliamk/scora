// The merge of claude/integration-2026-10-28 into main, rehearsed from the
// database's side (2026-11-05). Starts from production's shape: main's five
// migrations with realistic rows. Applies the rest as Evan will, in the
// checklist's order, then pastes things twice and out of order. The precheck
// and the check after the migrations are read out of docs/merge-checklist.md,
// so what Evan pastes is what ran here. See also migrations.test.ts (the final
// schema) and migration-deploy-order.test.ts (code against each schema).
//
// PGlite is Postgres 18 with one superuser: the checklist's section 1 says
// what that cannot prove about Supabase.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PGlite } from '@electric-sql/pglite';
import { allMigrations, callDue, MAIN_MIGRATIONS, mainSchemaPglite, migrationSql, newMigrations } from './helpers/pglite-db';
import { catalog, catalogDiff, dataOf, emulateSupabaseRoles, seedMainRows, seedNewRows, tryExec } from './helpers/migration-rehearsal';

const checklist = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'docs', 'merge-checklist.md'), 'utf8');
const sqlBlock = (marker: string): string => {
  const m = new RegExp('```sql\\n-- ' + marker + '\\n([\\s\\S]*?)```').exec(checklist);
  assert.ok(m, `checklist has no sql block marked ${marker}`);
  return m![1];
};
const VERIFY = sqlBlock('verify');
const PRECHECK = sqlBlock('precheck');
const problems = async (db: PGlite, sql: string) => (await db.query<{ problem: string }>(sql)).rows.map((r) => r.problem);

// The new migrations in the order docs/merge-checklist.md section 1 lists them.
const checklistOrder = (): string[] =>
  [...checklist.slice(checklist.indexOf('## 1. Apply')).matchAll(/^\d+\. `(\d{14}_[a-z0-9_]+\.sql)`/gm)].map((m) => m[1]);

const opened: PGlite[] = [];
const copy = async (db: PGlite) => {
  const c = (await db.clone()) as unknown as PGlite;
  opened.push(c);
  return c;
};

let mainDb: PGlite; // main's schema and rows
let finalDb: PGlite; // then every migration, then rows in the new tables
let mainData: Record<string, string[]>;
let mainCatalog: Record<string, string>;
let finalCatalog: Record<string, string>;
let finalData: Record<string, string[]>;

before(async () => {
  mainDb = await mainSchemaPglite();
  opened.push(mainDb);
  await seedMainRows(mainDb);
  mainData = await dataOf(mainDb);
  mainCatalog = await catalog(mainDb);
  finalDb = await copy(mainDb);
  for (const f of checklistOrder()) await finalDb.exec(migrationSql(f));
  await seedNewRows(finalDb);
  finalCatalog = await catalog(finalDb);
  finalData = await dataOf(finalDb);
});
after(async () => {
  for (const db of opened) await db.close();
});

test('every migration applies over existing rows in the checklist order, and no existing row changes', async () => {
  const db = await copy(mainDb);
  for (const f of checklistOrder()) assert.equal(await tryExec(db, migrationSql(f)), null, f);
  const data = await dataOf(db);
  for (const t of Object.keys(mainData)) assert.deepEqual(data[t], mainData[t], t);
});

test('on the tables main has, only the RLS flag changes: no column, constraint or index', async () => {
  const changed = catalogDiff(mainCatalog, await catalog(await (async () => {
    const db = await copy(mainDb);
    for (const f of newMigrations()) await db.exec(migrationSql(f));
    return db;
  })())).filter((k) => Object.keys(mainCatalog).includes(k));
  assert.deepEqual(changed, ['activities', 'athletes', 'device_tokens', 'health_data', 'users', 'workouts'].map((t) => `rls ${t}`).sort());
});

test('existing devices with no preferences row read as due at 06:30 New York, once per athlete: why the merge avoids 06:00 to 08:00', async () => {
  const db = await copy(mainDb);
  for (const f of newMigrations()) await db.exec(migrationSql(f));
  const thu = await callDue(db, { p_now: '2026-11-05T11:30:00Z' });
  assert.deepEqual(thu.map((r) => [r.athlete_id, r.timezone, r.delivery_minute, r.daily, r.weekly]), [
    ['1001', 'America/New_York', 360, true, false],
    ['1002', 'America/New_York', 360, true, false],
    ['9999', 'America/New_York', 360, true, false],
  ]);
  const mon = await callDue(db, { p_now: '2026-11-09T11:30:00Z' });
  assert.ok(mon.every((r) => r.weekly === true));
  assert.deepEqual(await callDue(db, { p_now: '2026-11-05T13:30:00Z' }), [], '08:30 New York: nothing due, nothing sent twice');
  assert.deepEqual(await callDue(db, { p_now: '2026-11-05T10:30:00Z' }), [], '05:30 New York: not yet');
});

test('scora_due_deliveries runs in a read-only transaction, as PostgREST calls a stable function', async () => {
  const db = await copy(finalDb);
  await db.exec('begin read only');
  const r = await callDue(db, { p_now: '2026-11-05T11:30:00Z' });
  await db.exec('commit');
  assert.ok(r.length > 0);
});

test('a failed paste leaves nothing behind (as far as PGlite runs one paste as one transaction)', async () => {
  const db = await copy(mainDb);
  const before = await catalog(db);
  const err = await tryExec(db, `${migrationSql('20261017000000_knowledge_library.sql')}\nselect 1 / 0;`);
  assert.match(String(err), /22012/);
  assert.deepEqual(catalogDiff(before, await catalog(db)), []);
  assert.deepEqual(await dataOf(db), mainData);
});

test('migrations out of step fail loudly: 12 before 3 and 15 before 1 stop on the missing table', async () => {
  const a = await copy(mainDb);
  assert.match(String(await tryExec(a, migrationSql('20261101010000_due_deliveries.sql'))), /42P01.*athlete_preferences/);
  const b = await copy(mainDb);
  assert.match(String(await tryExec(b, migrationSql('20261103020000_knowledge_source_unique.sql'))), /42P01.*knowledge_sources/);
});

test('the unique index in migration 15 stops on duplicates an early ingest left, its header query finds them, and it applies once they are gone', async () => {
  const db = await copy(mainDb);
  const file = '20261103020000_knowledge_source_unique.sql';
  for (const f of newMigrations().filter((x) => x < file)) await db.exec(migrationSql(f));
  await db.exec(`insert into knowledge_sources (title, author) values ('Twice', null), ('Twice', null)`);
  assert.match(String(await tryExec(db, migrationSql(file))), /23505/);
  const dup = await db.query<{ title: string }>(
    /(select title, count\(\*\) from knowledge_sources[^;]*;)/.exec(migrationSql(file))![1]);
  assert.deepEqual(dup.rows.map((r) => r.title), ['Twice']);
  await db.exec(`delete from knowledge_sources where title = 'Twice'`);
  assert.equal(await tryExec(db, migrationSql(file)), null);
});

test('the same file pasted twice in a row changes nothing, for all 16', async () => {
  const db = await copy(mainDb);
  for (const f of newMigrations()) {
    await db.exec(migrationSql(f));
    const c = await catalog(db);
    const d = await dataOf(db);
    assert.equal(await tryExec(db, migrationSql(f)), null, f);
    assert.deepEqual(catalogDiff(c, await catalog(db)), [], f);
    assert.deepEqual(await dataOf(db), d, f);
  }
});

// What a late re-run puts back. Anything not listed changes nothing. The
// checklist names these six, with what each one breaks.
const LATE_RERUN_REGRESSES: Record<string, string[]> = {
  '20261017010000_manual_plans.sql': ['function replace_manual_plan(text,text,jsonb)', 'index training_plans_one_active_manual_idx'],
  '20261018020000_create_scora_plan.sql': ['function create_scora_plan(jsonb)'],
  '20261022000000_ical_plans.sql': ['function refresh_ical_plan(text,jsonb)', 'function replace_external_plan(text,text,text,jsonb)'],
  '20261030000000_ical_refresh_pairing.sql': ['function refresh_ical_plan(text,jsonb)'],
  '20261030010000_create_scora_plan_lock.sql': ['function create_scora_plan(jsonb)'],
  '20261103000000_ical_refresh_keeps_past.sql': ['function refresh_ical_plan(text,jsonb,date)'],
};

for (const f of allMigrations()) {
  test(`re-run late, with rows everywhere: ${f}`, async () => {
    const db = await copy(finalDb);
    const err = await tryExec(db, migrationSql(f));
    if (f === MAIN_MIGRATIONS[0]) assert.match(String(err), /42P07.*users/, 'init stops at once and rolls back');
    else assert.equal(err, null);
    assert.deepEqual(await dataOf(db), finalData, 'no row changes');
    const diff = catalogDiff(finalCatalog, await catalog(db));
    assert.deepEqual(diff, LATE_RERUN_REGRESSES[f] ?? []);
    if (diff.length) {
      const found = await problems(db, VERIFY);
      assert.ok(found.length > 0, 'the check after the migrations names it');
    } else {
      assert.deepEqual(await problems(db, VERIFY), []);
    }
    // The repair the checklist gives: every later file after it, in order.
    const later = newMigrations().filter((g) => g > f);
    for (const g of later) assert.equal(await tryExec(db, migrationSql(g)), null, g);
    assert.deepEqual(catalogDiff(finalCatalog, await catalog(db)), []);
    assert.deepEqual(await dataOf(db), finalData, 'the repair changes no row');
    assert.deepEqual(await problems(db, VERIFY), []);
  });
}

test('what a late re-run of migration 2 does: a paste over a calendar plan fails, over a SCORA plan leaves two active plans, and the repair stops both', async () => {
  const pasted = JSON.stringify([{ date: '2026-11-06', type: 'run', intensity: 'easy', duration_min: 30, distance_km: null, description: 'Pasted' }]);
  const active = async (db: PGlite) => (await db.query<{ n: number }>(
    `select count(*)::int as n from training_plans where athlete_id = '2004' and current_status = 'active'`)).rows[0].n;
  const hurt = await copy(finalDb);
  await hurt.exec(migrationSql('20261017010000_manual_plans.sql'));
  await hurt.query(`select replace_manual_plan('2004', 'over a SCORA plan', $1::jsonb)`, [pasted]);
  assert.equal(await active(hurt), 2);
  await assert.rejects(hurt.query(`select replace_manual_plan('2002', 'over a calendar plan', $1::jsonb)`, [pasted]), /duplicate key/);
  const healed = await copy(finalDb);
  await healed.exec(migrationSql('20261017010000_manual_plans.sql'));
  for (const g of newMigrations().filter((x) => x > '20261017010000_manual_plans.sql')) await healed.exec(migrationSql(g));
  await healed.query(`select replace_manual_plan('2004', 'over a SCORA plan', $1::jsonb)`, [pasted]);
  assert.equal(await active(healed), 1);
  await healed.query(`select replace_manual_plan('2002', 'over a calendar plan', $1::jsonb)`, [pasted]);
});

test('the check after the migrations: no rows on the final schema, and the hashes in the checklist match the files', async () => {
  assert.deepEqual(await problems(finalDb, VERIFY), []);
  const fns = await finalDb.query<{ n: number }>(
    `select count(*)::int as n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace join pg_language l on l.oid = p.prolang
     where ns.nspname = 'public' and l.lanname in ('plpgsql', 'sql')
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')`);
  assert.equal(fns.rows[0].n, (VERIFY.match(/^\s+\(?'[a-z_]+', \d, '[0-9a-f]{32}'\)/gm) ?? []).length, 'every function is in the check');
});

test('the check finds every migration left out, whenever leaving it out changes the final schema', async () => {
  const files = newMigrations();
  for (const skip of files) {
    const db = await copy(mainDb);
    for (const f of files) if (f !== skip) await tryExec(db, migrationSql(f));
    const diff = catalogDiff(finalCatalog, await catalog(db));
    const found = await problems(db, VERIFY);
    if (diff.length) assert.ok(found.length > 0, `${skip} left out changes ${diff.join(', ')} and the check says nothing`);
    else assert.deepEqual(found, [], skip);
  }
});

test('the check finds a file applied out of order: the Runna migration before the calendar one', async () => {
  const files = newMigrations();
  const a = files.indexOf('20261022000000_ical_plans.sql');
  const b = files.indexOf('20261104000000_runna_calendar_source.sql');
  [files[a], files[b]] = [files[b], files[a]];
  const db = await copy(mainDb);
  for (const f of files) await tryExec(db, migrationSql(f));
  const found = await problems(db, VERIFY);
  assert.ok(found.some((p) => p.includes('replace_external_plan')), found.join('\n'));
});

test('the precheck: no rows on main, a row when a migration on main is missing', async () => {
  assert.deepEqual(await problems(mainDb, PRECHECK), []);
  const db = await copy(mainDb);
  await db.exec(`alter table athletes drop column cdv_count`);
  await db.exec(`drop table device_tokens`);
  const found = await problems(db, PRECHECK);
  assert.deepEqual(found.sort(), ['missing, so a migration on main was not applied: athletes.cdv_count', 'missing, so a migration on main was not applied: device_tokens.token']);
});

test('no function runs with its owner\'s rights, so RLS applies inside every rpc', async () => {
  const r = await finalDb.query<{ proname: string }>(
    `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prosecdef`);
  assert.deepEqual(r.rows, []);
});

test('with Supabase-style roles, the anon key reads and writes nothing, through tables or functions; the service role sees it all', async () => {
  const db = await copy(finalDb);
  await emulateSupabaseRoles(db);
  const tables = Object.keys(finalData);
  assert.ok(tables.includes('plan_adaptations') && tables.includes('athletes'));
  const denied = /row-level security|permission denied/;
  await db.exec('set role anon');
  for (const t of tables) {
    const r = await db.query(`select 1 from "${t}"`);
    assert.equal(r.rows.length, 0, `anon reads ${t}`);
  }
  await assert.rejects(db.query(`insert into device_tokens (athlete_id, token) values ('1', 'x')`), denied);
  const rows = JSON.stringify([{ date: '2026-11-06', type: 'run', intensity: 'easy', duration_min: 30, distance_km: null, description: 'x' }]);
  await assert.rejects(db.query(`select replace_manual_plan('2001', 'x', $1::jsonb)`, [rows]), denied);
  await assert.rejects(db.query(`select replace_external_plan('2001', 'ical', null, $1::jsonb)`, [rows]), denied);
  assert.equal((await callDue(db, { p_now: '2026-11-05T11:30:00Z' })).length, 0, 'due deliveries see no devices');
  const refresh = await db.query<{ r: string | null }>(`select refresh_ical_plan('2002', $1::jsonb) as r`, [rows]);
  assert.equal(refresh.rows[0].r, null, 'the plan is invisible, so nothing is refreshed');
  const mark = await db.query<{ r: boolean }>(
    `select mark_workout_watch_sent('2004', '00000000-0000-0000-0000-000000000000') as r`);
  assert.equal(mark.rows[0].r, false);
  await db.exec('reset role');
  assert.deepEqual(await dataOf(db), finalData, 'anon changed nothing');
  await db.exec('set role service_role');
  for (const t of tables) {
    const r = await db.query(`select 1 from "${t}"`);
    assert.equal(r.rows.length, finalData[t].length, `service role reads ${t}`);
  }
  const w = await db.query<{ r: string }>(`select replace_manual_plan('2001', 'again', $1::jsonb) as r`, [rows]);
  assert.ok(w.rows[0].r);
  await db.exec('reset role');
});
