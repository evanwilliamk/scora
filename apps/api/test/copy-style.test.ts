// House style for user-facing copy (CLAUDE.md §3.7): no em dashes and no
// exclamation points. This walks every string literal in apps/api/src with
// the TypeScript parser, so code like `!==` or `!x` is never a match.
// Skipped: LLM prompt instructions (any value bound to a name containing
// "prompt") and tagged templates such as String.raw regex sources.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const src = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const files = readdirSync(src).filter((f) => f.endsWith('.ts')).map((f) => join(src, f));

const EM_DASH = /—/;
// '!' closing a sentence: after a word character, at the end of the string
// or before whitespace, a quote or a tag. CSS `!important` and `!=` do not match.
const EXCLAIM = /[\p{L}\p{N})]!(?=$|[\s"'<])/u;

function boundName(node: ts.Node): string | undefined {
  if (ts.isVariableDeclaration(node) || ts.isPropertyAssignment(node) || ts.isPropertyDeclaration(node)) {
    return node.name.getText();
  }
  return undefined;
}

function skipped(node: ts.Node): boolean {
  for (let p = node.parent; p; p = p.parent) {
    if (ts.isTaggedTemplateExpression(p)) return true;
    if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p)) return true;
    const name = boundName(p);
    if (name && /prompt/i.test(name)) return true;
  }
  return false;
}

test('user-facing strings in apps/api/src have no em dashes or exclamation points', () => {
  const hits: string[] = [];
  for (const file of files) {
    const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node) => {
      if (
        ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ||
        ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)
      ) {
        const text = node.text;
        if ((EM_DASH.test(text) || EXCLAIM.test(text)) && !skipped(node)) {
          const { line } = sf.getLineAndCharacterOfPosition(node.getStart());
          hits.push(`${file.slice(src.length + 1)}:${line + 1}: ${text.slice(0, 80)}`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  assert.deepEqual(hits, [], `copy style violations:\n${hits.join('\n')}`);
});

test('the copy-style patterns catch what they should and nothing else', () => {
  assert.ok(EM_DASH.test('Not found — please reconnect.'));
  assert.ok(EXCLAIM.test('All set!'));
  assert.ok(EXCLAIM.test('Connected! You can close this tab.'));
  assert.ok(EXCLAIM.test('<p>Done!</p>'));
  assert.ok(!EXCLAIM.test('a{color:red !important}'));
  assert.ok(!EXCLAIM.test('x !== y'));
  assert.ok(!EXCLAIM.test('Not connected. Please reconnect Strava.'));
});
