# Coverage pass, 2026-11-03

Branch: `claude/coverage-1103` (from `claude/integration-2026-10-28`). Tests only; no source changed.

## How it was measured

```
cd apps/api && node --enable-source-maps --import tsx --test --experimental-test-coverage test/*.test.ts
cd packages/<pkg> && node --enable-source-maps --import tsx --test --experimental-test-coverage test/*.test.ts
```

`--enable-source-maps` matters. Without it Node reports line numbers in the tsx-transpiled output, so the "uncovered lines" column points at the wrong lines, and files that a test imports after setting env (push.ts) read as about 67% when they are close to 100%. Even with source maps, a few lines near the top of each file (imports, comments) and an odd single line are listed as uncovered; treat those as noise.

`index.ts` (route wiring) was left out on purpose. The packages are already near full coverage in their own suites; `packages/plan-templates` has no code (README only) and there is no `packages/validator` or `packages/llm-prompts` in this tree.

## Files targeted (line % / branch %)

| File | Before | After | New test file |
|---|---|---|---|
| apps/api/src/oura.ts | 90.6 / 80.0 | 99.4 / 92.4 | test/oura-coverage.test.ts |
| apps/api/src/knowledge-retrieval.ts | 93.8 / 82.5 | 96.5 / 98.7 | test/knowledge-retrieval-coverage.test.ts |
| apps/api/src/plan-store.ts | 95.0 / 78.4 | 97.2 / 95.7 | test/plan-store-coverage.test.ts |
| apps/api/src/plan-adapt.ts | 96.9 / 87.0 | 98.1 / 94.4 | test/supabase-adapt-coverage.test.ts |
| apps/api/src/preferences.ts | 97.1 / 86.0 | 98.3 / 94.9 | test/supabase-prefs-coverage.test.ts |
| packages/voice/src/loader.ts | 96.1 / 94.6 | 99.4 / 98.7 | packages/voice/test/loader-coverage.test.ts |

Also added `apps/api/test/scheduler-start.test.ts` (idle start without APNs). Run alone it covers that line; the merged full-run report still lists it, which looks like a Node coverage merge quirk. The active `startScheduler` path registers a real node-cron job and needs module mocking (`--experimental-test-module-mocks`), which `npm test` does not pass, so it stays uncovered.

apps/api all files: 93.4 / 87.6 before, 93.9 / 89.0 after.

## Test counts

- apps/api: 788 to 828 tests (826 pass, 2 existing todo, 0 fail).
- packages/voice: 69 to 73 tests, all pass.

## Findings

None. Every new test passed against current behavior, so no `FAILING finding` tests were added.
