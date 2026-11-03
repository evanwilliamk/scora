// loadPatterns failure paths on a scratch directory, and the cached
// getPatterns. The shipped patterns/ directory is only read, never written.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPatterns, getPatterns, PatternSchemaError } from '../src/loader';

const shipped = join(dirname(fileURLToPath(import.meta.url)), '..', 'patterns');
const sample = 'plan-adherence-strong-week.yaml';

function scratch(fill: (dir: string) => void): string {
  const dir = mkdtempSync(join(tmpdir(), 'scora-patterns-'));
  fill(dir);
  return dir;
}

test('malformed YAML is a schema error naming the file', () => {
  const dir = scratch((d) => writeFileSync(join(d, 'broken.yaml'), 'id: [unclosed\n  - : :'));
  try {
    assert.throws(() => loadPatterns(dir), (e: unknown) => {
      assert.ok(e instanceof PatternSchemaError);
      assert.match((e as Error).message, /invalid YAML/);
      assert.match((e as Error).message, /broken\.yaml/);
      return true;
    });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the same id in two files is refused, naming both files', () => {
  const dir = scratch((d) => {
    copyFileSync(join(shipped, sample), join(d, 'a.yaml'));
    copyFileSync(join(shipped, sample), join(d, 'b.yml'));
  });
  try {
    assert.throws(() => loadPatterns(dir), (e: unknown) => {
      assert.ok(e instanceof PatternSchemaError);
      assert.match((e as Error).message, /duplicate id ".+" \(also in a\.yaml\)/);
      assert.match((e as Error).message, /b\.yml/);
      return true;
    });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('non-YAML files are ignored; an empty directory loads nothing', () => {
  const dir = scratch((d) => writeFileSync(join(d, 'README.md'), '# not a pattern'));
  try {
    assert.deepEqual(loadPatterns(dir), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('getPatterns loads the shipped library once and returns the cached list', () => {
  const a = getPatterns();
  assert.ok(a.length > 0);
  assert.equal(getPatterns(), a);
  assert.deepEqual(a.map((p) => p.id), loadPatterns().map((p) => p.id));
});
