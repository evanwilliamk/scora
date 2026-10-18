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

## Templates

`loadTemplates(TEMPLATE_DIR)` reads the YAML library in `packages/plan-templates` (format in its README) and refuses any template that breaks the schema or the plan bans, with a `TemplateError` naming the rule (`code`: `volume_jump`, `slot_unmapped`, `unknown_workout`, `duration_mismatch`, `unreviewed`, ...). Workout durations are derived from each structure, never trusted from the estimate. Drafts only load with `{ allowDrafts: true }`.

The library is empty: templates are coach-authored and reviewed (doc 07 v2 §8.3). `test/fixtures/four-week.yaml` is a test fixture, not training content.

## Assembler

```ts
const t = matchTemplate(templates, { sport: 'run', goal_type: 'half_marathon', experience_level: 'regular', current_weekly_km: 38 });
if (!t) return 'template not available yet'; // no LLM fallback
const plan = assemblePlan({ template: t, start_date: startDateForRace(t, race), goal_race_date: race });
plan.workouts;     // dated scheduled workouts with scaled structure (WorkoutKit) and stable ids
plan.week_minutes; // template call per week, the adaptation engine's template_week_minutes
```

- The plan starts on a Monday; the race must fall in the final week. Nothing is scheduled on or after race day.
- A week's `week_load_percent` scales warmup, steady and cooldown steps to whole minutes; interval reps and durations stay as authored.
- No athlete scaling beyond template choice: the volume range picks the template, and the template's numbers are used as written.

Not yet wired into `apps/api` (no `training_plans` table or `/plan/generate` route yet).

Tests: `npm test` (from this folder).
