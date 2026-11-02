// Guards that the API code and the migrations agree (2026-11-01 schema check).
// Evan applies migrations to Supabase by hand, so a column the code names but
// no migration creates only shows up as an outage. This scans every
// supabase-js chain in src/ (`.from('t')` and `.rpc('fn', {...})`) and checks
// it against the schema built from every migration on PGlite:
//   - the table exists, and every column in select/filter/order calls exists
//     (embedded tables like `training_plans!inner(...)` included);
//   - insert/upsert/update object literals name real columns, and an
//     insert or upsert writes every NOT NULL column without a default;
//   - an upsert's onConflict target is exactly a unique constraint's columns;
//   - rpc names a function whose argument names match the call's keys.
// Computed keys and template-literal filters (`[col]`, `.or(\`...\`)`) are skipped.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const migrations = join(root, 'supabase', 'migrations');
const srcDir = join(root, 'src');

let db: PGlite;
const columns = new Map<string, Map<string, { notNull: boolean; hasDefault: boolean }>>();
const uniques = new Map<string, string[][]>();
const functions = new Map<string, { names: string[]; required: string[] }[]>();

before(async () => {
  db = new PGlite({ extensions: { vector } });
  for (const f of readdirSync(migrations).filter((x) => x.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(join(migrations, f), 'utf8'));
  }
  const cols = await db.query<{ t: string; c: string; nn: string; d: string | null }>(
    `select table_name t, column_name c, is_nullable nn, column_default d
     from information_schema.columns where table_schema = 'public'`);
  for (const r of cols.rows) {
    if (!columns.has(r.t)) columns.set(r.t, new Map());
    columns.get(r.t)!.set(r.c, { notNull: r.nn === 'NO', hasDefault: r.d != null });
  }
  // Unique constraints and non-partial unique indexes (ON CONFLICT can use either).
  const u = await db.query<{ t: string; cols: string[] }>(
    `select c.relname t, array(select a.attname from unnest(i.indkey) k join pg_attribute a
       on a.attrelid = i.indrelid and a.attnum = k order by a.attname) cols
     from pg_index i join pg_class c on c.oid = i.indrelid join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and i.indisunique and i.indpred is null`);
  for (const r of u.rows) uniques.set(r.t, [...(uniques.get(r.t) ?? []), r.cols]);
  // Input arguments come first in proargnames (RETURNS TABLE columns follow);
  // the last pronargdefaults of them may be left out of a call.
  const fns = await db.query<{ name: string; args: string[] | null; defaults: number }>(
    `select p.proname name, (p.proargnames)[1:p.pronargs] args, p.pronargdefaults::int defaults
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'`);
  for (const r of fns.rows) {
    const names = r.args ?? [];
    functions.set(r.name, [...(functions.get(r.name) ?? []), { names, required: names.slice(0, names.length - r.defaults) }]);
  }
});

after(async () => {
  await db.close();
});

// --- A small scanner over the TypeScript source ---------------------------

interface Chain { file: string; line: number; table: string; text: string }
interface Rpc { file: string; line: number; name: string; args: string }

// From an opening bracket at `start`, the index just past its match. Skips
// strings and line comments.
function matchBracket(s: string, start: number): number {
  const open = s[start];
  const close = open === '(' ? ')' : open === '{' ? '}' : ']';
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (ch === "'" || ch === '"' || ch === '`') {
      for (i++; i < s.length && s[i] !== ch; i++) if (s[i] === '\\') i++;
      continue;
    }
    if (ch === '/' && s[i + 1] === '/') {
      while (i < s.length && s[i] !== '\n') i++;
      continue;
    }
    if (ch === open) depth++;
    else if (ch === close && --depth === 0) return i + 1;
  }
  return s.length;
}

// The supabase-js call chain that starts at `start`: `.name(args)` links, any
// whitespace or line comments between them, until something else.
function chainFrom(s: string, start: number): string {
  let i = start;
  for (;;) {
    // Links may be split by line comments ("// Only over the token we spent").
    const m = /^(?:\s|\/\/[^\n]*\n)*\.\s*([A-Za-z_]\w*)\s*\(/.exec(s.slice(i));
    if (!m) return s.slice(start, i);
    i = matchBracket(s, i + m[0].length - 1);
  }
}

const lineOf = (s: string, i: number) => s.slice(0, i).split('\n').length;

function scan(): { chains: Chain[]; rpcs: Rpc[] } {
  const chains: Chain[] = [];
  const rpcs: Rpc[] = [];
  for (const f of readdirSync(srcDir).filter((x) => x.endsWith('.ts'))) {
    const s = readFileSync(join(srcDir, f), 'utf8');
    for (const m of s.matchAll(/\.from\(\s*'([a-z_]+)'\s*\)/g)) {
      const end = m.index! + m[0].length;
      chains.push({ file: f, line: lineOf(s, m.index!), table: m[1], text: chainFrom(s, end) });
    }
    for (const m of s.matchAll(/\.rpc\(\s*'([a-z_]+)'\s*,\s*/g)) {
      const at = m.index! + m[0].length;
      const args = s[at] === '{' ? s.slice(at, matchBracket(s, at)) : '';
      rpcs.push({ file: f, line: lineOf(s, m.index!), name: m[1], args });
    }
  }
  return { chains, rpcs };
}

// Top-level keys of an object literal `{ ... }` (computed keys are skipped).
function literalKeys(obj: string): string[] {
  const body = obj.slice(1, -1);
  const keys: string[] = [];
  let i = 0;
  while (i < body.length) {
    const rest = body.slice(i);
    const m = /^\s*(?:\.\.\.[^,]*|\[[^\]]*\]\s*:|([A-Za-z_]\w*)\s*(:|,|$)|'([A-Za-z_]\w*)'\s*:)/.exec(rest);
    if (m && (m[1] || m[3])) keys.push(m[1] ?? m[3]);
    // Skip to the next top-level comma.
    let j = i;
    for (; j < body.length && body[j] !== ','; j++) {
      if ('({['.includes(body[j])) j = matchBracket(body, j) - 1;
      else if (body[j] === "'" || body[j] === '"' || body[j] === '`') {
        const q = body[j];
        for (j++; j < body.length && body[j] !== q; j++) if (body[j] === '\\') j++;
      }
    }
    i = j + 1;
  }
  return keys;
}

// The object literal written to a table: inline, inside `xs.map((...) => ({...}))`,
// or a `const <name> ... = {` defined earlier in the same file.
function payload(file: string, chainText: string, method: string): string | null {
  const m = new RegExp(`\\.${method}\\(\\s*`).exec(chainText);
  if (!m) return null;
  const at = m.index + m[0].length;
  const head = chainText.slice(at);
  if (head.startsWith('{')) return chainText.slice(at, matchBracket(chainText, at));
  const mapped = /^[\w.]+\.map\(\s*\([^)]*\)\s*=>\s*\(\s*\{/.exec(head);
  if (mapped) {
    const b = at + mapped[0].length - 1;
    return chainText.slice(b, matchBracket(chainText, b));
  }
  const ident = /^([A-Za-z_]\w*)\s*[,)]/.exec(head);
  if (ident) {
    const s = readFileSync(join(srcDir, file), 'utf8');
    const def = new RegExp(`const ${ident[1]}\\b[^=]*=\\s*\\{`).exec(s);
    if (def) {
      const b = def.index + def[0].length - 1;
      return s.slice(b, matchBracket(s, b));
    }
  }
  return null;
}

// Columns named in a select string, per table: `a, b, rel!inner(c, d)`.
function selectColumns(table: string, sel: string, out: [string, string][]) {
  let depth = 0;
  let cur = '';
  const parts: string[] = [];
  for (const ch of sel) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch;
  }
  parts.push(cur);
  for (const raw of parts.map((p) => p.trim()).filter(Boolean)) {
    const embed = /^([a-z_]+)(?:![a-z_]+)?\((.*)\)$/s.exec(raw);
    if (embed) { out.push([embed[1], '*']); selectColumns(embed[1], embed[2], out); continue; }
    if (raw === '*') continue;
    out.push([table, raw.split(/[:\s]/)[0].replace(/::.*$/, '')]);
  }
}

function usedColumns(c: Chain): [string, string][] {
  const out: [string, string][] = [];
  for (const m of c.text.matchAll(/\.select\(\s*(?:'([^']*)'|([A-Z_]+))/g)) {
    let sel: string | undefined = m[1];
    if (sel === undefined) {
      const s = readFileSync(join(srcDir, c.file), 'utf8');
      sel = new RegExp(`const ${m[2]}\\s*=\\s*'([^']*)'`).exec(s)?.[1];
      assert.ok(sel !== undefined, `${c.file}:${c.line} select(${m[2]}) is not a string constant in the file`);
    }
    selectColumns(c.table, sel, out);
  }
  for (const m of c.text.matchAll(/\.(?:eq|neq|gt|gte|lt|lte|in|is|not|like|ilike|order|contains|overlaps)\(\s*'([a-z_.]+)'/g)) {
    const [t, col] = m[1].includes('.') ? m[1].split('.') : [c.table, m[1]];
    out.push([t, col]);
  }
  for (const m of c.text.matchAll(/onConflict:\s*'([^']+)'/g)) {
    for (const col of m[1].split(',')) out.push([c.table, col.trim()]);
  }
  return out;
}

// --- Tests -----------------------------------------------------------------

test('the scanner finds the supabase-js calls (so a refactor cannot silently empty it)', () => {
  const { chains, rpcs } = scan();
  const tables = new Set(chains.map((c) => c.table));
  for (const t of ['athletes', 'athlete_preferences', 'device_tokens', 'scheduled_workouts', 'training_plans', 'plan_adaptations', 'knowledge_chunks', 'read_citations']) {
    assert.ok(tables.has(t), `no .from('${t}') found`);
  }
  assert.ok(chains.length >= 40, `only ${chains.length} chains found`);
  assert.ok(rpcs.length >= 6, `only ${rpcs.length} rpc calls found`);
});

test('every table and column the code reads or filters on exists in the migrations', () => {
  const missing: string[] = [];
  for (const c of scan().chains) {
    for (const [t, col] of [[c.table, '*'] as [string, string], ...usedColumns(c)]) {
      const cols = columns.get(t);
      if (!cols) missing.push(`${c.file}:${c.line} table ${t}`);
      else if (col !== '*' && !cols.has(col)) missing.push(`${c.file}:${c.line} ${t}.${col}`);
    }
  }
  assert.deepEqual([...new Set(missing)], [], 'add a migration (or fix the name in code)');
});

test('every insert, upsert and update writes real columns, and inserts cover NOT NULL columns', () => {
  const problems: string[] = [];
  let checked = 0;
  for (const c of scan().chains) {
    const cols = columns.get(c.table);
    if (!cols) continue;
    for (const method of ['insert', 'upsert', 'update']) {
      if (!c.text.includes(`.${method}(`)) continue;
      const obj = payload(c.file, c.text, method);
      assert.ok(obj, `${c.file}:${c.line} .${method}() payload is not an object literal the scan can read`);
      checked++;
      const keys = literalKeys(obj);
      for (const k of keys) if (!cols.has(k)) problems.push(`${c.file}:${c.line} ${method} ${c.table}.${k}`);
      if (method === 'update') continue;
      // An upsert that only ever updates still inserts when the row is new.
      for (const [col, info] of cols) {
        if (info.notNull && !info.hasDefault && !keys.includes(col)) {
          problems.push(`${c.file}:${c.line} ${method} into ${c.table} leaves NOT NULL ${col} unset`);
        }
      }
    }
  }
  assert.ok(checked >= 15, `only ${checked} writes checked`);
  assert.deepEqual(problems, []);
});

test('every upsert onConflict target is a unique constraint on exactly those columns', () => {
  const problems: string[] = [];
  for (const c of scan().chains) {
    for (const m of c.text.matchAll(/onConflict:\s*'([^']+)'/g)) {
      const target = m[1].split(',').map((x) => x.trim()).sort();
      const ok = (uniques.get(c.table) ?? []).some((u) => u.join(',') === target.join(','));
      if (!ok) problems.push(`${c.file}:${c.line} ${c.table} on conflict (${target.join(', ')})`);
    }
  }
  assert.deepEqual(problems, [], 'ON CONFLICT needs a unique constraint or non-partial unique index on exactly these columns');
});

test('every rpc names a migrated function with matching argument names', () => {
  const problems: string[] = [];
  for (const r of scan().rpcs) {
    const sigs = functions.get(r.name);
    if (!sigs) { problems.push(`${r.file}:${r.line} rpc ${r.name} has no function`); continue; }
    assert.ok(r.args, `${r.file}:${r.line} rpc ${r.name} arguments are not an object literal the scan can read`);
    const keys = literalKeys(r.args);
    // PostgREST picks the overload by named arguments: every key must be an
    // argument, and every argument without a default must be passed.
    const fits = sigs.some((s) => keys.every((k) => s.names.includes(k)) && s.required.every((k) => keys.includes(k)));
    if (!fits) {
      problems.push(`${r.file}:${r.line} rpc ${r.name}(${keys.join(',')}) vs ${sigs.map((s) => `(${s.names.join(',')})`).join(' ')}`);
    }
  }
  assert.deepEqual(problems, []);
});

test('every migration after init re-runs cleanly and leaves the schema unchanged', async () => {
  // Only the init file uses plain "create table"; every later one says
  // "if not exists" / "create or replace" / "drop ... if exists", so Evan can
  // re-apply one by hand without breaking anything.
  const files = readdirSync(migrations).filter((x) => x.endsWith('.sql')).sort();
  const snapshot = async (d: PGlite) => {
    const r = await d.query<{ x: string }>(
      `select x from (
         select 'col ' || table_name || '.' || column_name || ' ' || data_type || ' ' || is_nullable || ' ' || coalesce(column_default, '') x
         from information_schema.columns where table_schema = 'public'
         union all
         select 'con ' || conrelid::regclass::text || ' ' || conname || ' ' || pg_get_constraintdef(oid)
         from pg_constraint where connamespace = 'public'::regnamespace
         union all
         select 'idx ' || indexdef from pg_indexes where schemaname = 'public'
         union all
         select 'fn ' || p.proname || '(' || pg_get_function_arguments(p.oid) || ') ' || md5(p.prosrc)
         from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
           and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
       ) s order by x`);
    return r.rows.map((row) => row.x);
  };
  const d = new PGlite({ extensions: { vector } });
  try {
    for (const f of files) await d.exec(readFileSync(join(migrations, f), 'utf8'));
    const first = await snapshot(d);
    for (const f of files.slice(1)) {
      await d.exec(readFileSync(join(migrations, f), 'utf8')).catch((e) => assert.fail(`${f} does not re-run: ${e.message}`));
    }
    assert.deepEqual(await snapshot(d), first);
  } finally {
    await d.close();
  }
});
