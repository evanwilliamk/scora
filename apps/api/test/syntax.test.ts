// Every API source file must at least parse. Most routes live in index.ts,
// which no other test imports (importing it starts the server), so without
// this a broken merge there passes the suite.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const here = dirname(fileURLToPath(import.meta.url));
const dirs = ['src', 'scripts'].map((d) => join(here, '..', d));

const files = dirs.flatMap((d) => {
  try {
    return readdirSync(d).filter((f) => f.endsWith('.ts')).map((f) => join(d, f));
  } catch {
    return [];
  }
});

test('there are API sources to check', () => {
  assert.ok(files.some((f) => f.endsWith('index.ts')));
});

for (const file of files) {
  test(`parses: ${file.slice(file.indexOf('apps/api/'))}`, () => {
    const out = ts.transpileModule(readFileSync(file, 'utf8'), {
      fileName: file,
      reportDiagnostics: true,
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
    });
    const errors = (out.diagnostics ?? []).map((d) => {
      const pos = d.file && d.start != null ? d.file.getLineAndCharacterOfPosition(d.start) : null;
      return `${pos ? `${pos.line + 1}:${pos.character + 1} ` : ''}${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`;
    });
    assert.deepEqual(errors, []);
  });
}

test('the guard catches a dropped closing brace', () => {
  const out = ts.transpileModule("fastify.put('/x', async () => {\n  try { a(); } catch (e) { b();\n", {
    reportDiagnostics: true,
  });
  assert.ok((out.diagnostics ?? []).length > 0);
});
