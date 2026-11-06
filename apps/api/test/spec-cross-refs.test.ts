// A spec that names another spec must name a file that exists (spec audit
// 2026-11-06): the repo's files use underscores in versions, v1_4 not v1.4.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

test('every spec named inside a numbered spec is a file in the repo', () => {
  // CLAUDE.md and README_DOC_INDEX.md are left out on purpose: CLAUDE.md is
  // Evan's to edit, and the index also lists old versions kept outside the repo.
  const specs = readdirSync(ROOT).filter((f) => /^\d{2}_SCORA_.*\.md$/.test(f));
  assert.ok(specs.length >= 8, `found ${specs.length} specs`);
  const missing: string[] = [];
  for (const spec of specs) {
    for (const [name] of readFileSync(join(ROOT, spec), 'utf8').matchAll(/\b\d{2}_SCORA_[A-Za-z0-9_.-]+\.md/g)) {
      if (!existsSync(join(ROOT, name))) missing.push(`${spec} -> ${name}`);
    }
  }
  assert.deepEqual(missing, []);
});
