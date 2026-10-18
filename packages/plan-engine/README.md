# @scora/plan-engine

Deterministic plan adaptation (doc 07 v2 §6.2 and §9, CLAUDE.md §6.2). Given today's posture and tomorrow's scheduled workout, decide whether the plan changes. No LLM decides; the adaptation-reason prompt only words the decision, citing `facts`.

```ts
import { evaluateAdaptation } from '@scora/plan-engine';

const r = evaluateAdaptation({ posture: 'rest', workout: tomorrow, plan: { source: 'scora_ai', goal_race_date, week, template_week_minutes }, today });
r.type; // 'moved' | 'downgraded' | 'none'
```

Rules:
- `rest` + hard session (hard, intervals, threshold, tempo, long): move it to the next clear day in the same Monday-to-Sunday week; the original day becomes rest. A clear day is a rest day or a single easy/recovery session, not next to another hard day.
- `back-off` + intervals or threshold: steady state, same duration. `back-off` + tempo: endurance, same duration.
- `primed`, `steady`, `moderate`, `taper`: no change. The engine never pushes past the plan.

Guards: only SCORA's own plans (never a coach's or an external plan), only future uncompleted workouts, race week (T-7 to race day) freezes everything, a change may not move weekly minutes more than 10% from the template call, long runs keep their distance. A guard that stops a rule returns `blocked_rule` so frozen and skipped adaptations show up in telemetry.

Thresholds live in `src/constants.ts`. Change one, bump `ADAPTATION_ENGINE_VERSION`.

Not yet wired into `apps/api` (no `training_plans` table or plan generation yet). Template loader and assembler come next.

Tests: `npm test` (from this folder).
