import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, scriptString, resultPage, oauthErrorMessage } from '../src/pages';

test('escapeHtml neutralizes markup and quotes', () => {
  assert.equal(escapeHtml(`<img src=x onerror="alert('x')">&`), '&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt;&amp;');
});

test('scriptString cannot close the script tag or the string', () => {
  const s = scriptString(`'</script><script>alert(1)</script>`);
  assert.doesNotMatch(s, /<\/script>/i);
  assert.equal(JSON.parse(s.replace(/\\u003c/g, '<').replace(/\\u003e/g, '>')), `'</script><script>alert(1)</script>`);
});

test('a hostile oauth error param renders as text, not markup', () => {
  const html = resultPage({ title: 'Oura not connected', lines: ['Oura said: <script>alert(1)</script>'] });
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /Oura said: &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /window\.location/, 'no deep link, no redirect');
});

test('a page with a deep link opens it and keeps a fallback button', () => {
  const html = resultPage({ title: 'Oura connected', deepLink: 'scora://oura/success' });
  assert.match(html, /<a href="scora:\/\/oura\/success">Open SCORA<\/a>/);
  assert.match(html, /window\.location\.href = "scora:\/\/oura\/success"/);
});

test('deep link query strings are escaped in the href', () => {
  const html = resultPage({ title: 'x', deepLink: 'scora://oura/failed?reason=a&b="c"' });
  assert.match(html, /href="scora:\/\/oura\/failed\?reason=a&amp;b=&quot;c&quot;"/);
});

test('result pages carry no exclamation points or emoji (CLAUDE.md 3.7)', () => {
  const html = resultPage({ title: 'Oura connected', lines: ['Opening SCORA...'], deepLink: 'scora://oura/success' });
  const body = html.replace(/<style>[\s\S]*?<\/style>/, '').replace(/<!doctype html>/i, '');
  assert.doesNotMatch(body, /!(?!=)/);
});

test('OAuth error codes map to fixed copy; anything else never echoes', () => {
  assert.equal(oauthErrorMessage('access_denied'), 'Access was not granted.');
  assert.match(oauthErrorMessage('server_error'), /try again/i);
  assert.match(oauthErrorMessage('server_error', 'Strava'), /^Strava is having trouble/);
  assert.equal(oauthErrorMessage('Your account is locked, call 555-0100'), 'The connection did not complete.');
});
