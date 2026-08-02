# @scora/voice

The curated **pattern library** + deterministic **matcher** — the moat (CLAUDE.md §0, §9).
A versioned library of interpretations, matched deterministically to a driver
record, and rendered *from* (never invented by) the LLM. **Interpretation-only:
nothing here prescribes a workout** (§1.1).

## Pipeline (doc 06 §2)

```
posture ─┐
drivers ─┼─▶ selectPattern() ─▶ fillTemplate() ─▶ [LLM renders FROM template]
sched.  ─┘        (deterministic)                   ─▶ driver-existence + banned-phrase
                                                        validators live in apps/api (§3.2, §4)
```

The matcher never lets an LLM decide *which* pattern fires (§6.3). The LLM only
writes the plain-English rendering of the chosen entry's `template`, bounded by
its `tone_notes`/`llm_hint`, and the validators are the final guarantee.

## Layout

- `patterns/*.yaml` — the library. Authored/reviewed like code, one entry per file (Pattern Library v0.3 schema, doc 06 §3).
- `src/driver-rule.ts` — safe evaluator for `driver_rule` predicates (comparisons, arithmetic, `AND`/`OR`, `IS [NOT] NULL`, booleans). No `eval()`; a malformed rule fails at load, not at render. A **missing driver makes any comparison touching it false** (§3.2).
- `src/loader.ts` — parses + strictly validates every entry; compiles each rule; rejects duplicates. Fails loud.
- `src/matcher.ts` — `selectPattern` / `selectPatterns`: filter by posture, context, tier, scheduled-workout gates, data completeness, recent-fire suppression, then the driver rule; rank by priority.
- `src/render.ts` — `fillTemplate` for the numeric-first `{{slot}}` convention (doc 06 §7); reports unfilled slots instead of inventing values.

## Status — NOT yet wired into the live daily read

Every ported entry is a **plan-vs-body** pattern (`requires_scheduled_workout: true`).
Firing them live needs two upstream pieces that **do not exist in `apps/api` yet**:

1. a computed **posture** value (`packages/posture` / CLAUDE.md §9 is unbuilt), and
2. a **scheduled-workout source** (plan-aware reads are an unbuilt Phase-1 item).

Until both land, `apps/api` does **not** import this package, so the API deploy
path is unaffected. This package is proven standalone via `npm test` (36 cases:
driver-rule truth table, loader rejection, and synthetic-record matcher
selection per doc 06 §8). `MatchContext` is the seam: build one from real
metrics + posture + scheduled workout, call `selectPattern`, feed the result to
the render prompt.

## Test

```
npm test -w @scora/voice
```
