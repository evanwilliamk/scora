# plan-templates

The coach-authored plan template library (doc 07 v2 §4.2, §8; CLAUDE.md §6.1). One YAML file per template, grouped by sport and goal: `running/half-marathon/run-half-marathon-12wk-regular.yaml`.

Empty on purpose. Templates are written by Evan or a partner coach and signed off by a qualified coach before ship (90-day plan §3.2). Agents never write training content here.

`@scora/plan-engine` loads this folder with `loadTemplates(TEMPLATE_DIR)` and refuses any file that breaks the schema or the plan bans, with a named error.

## Format

```yaml
slug: run-half-marathon-12wk-regular     # kebab-case, unique
sport: run                               # run | ride | swim | tri
goal_type: half_marathon
duration_weeks: 12
experience_level: regular                # first_timer | regular | competitive
weekly_volume_range_km: [30, 50]         # [min, max)
author: Coach Name
version: 1.0.0                           # athletes stay pinned to the version they start on
status: reviewed                         # draft until signed off; drafts do not load in production
reviewed_by: Reviewer Name
reviewed_on: 2026-11-01
phases:                                  # cover weeks 1..N once each, in order
  - { name: Base, weeks: [1, 2, 3, 4], focus: aerobic development }
week_load_percent: [100, 105, 110, 85]   # optional, one per week; default 100
weekly_pattern:                          # all seven days; "rest" or a slot name
  monday: rest
  tuesday: quality_a
  # ...
workout_types_by_phase:                  # every slot, every phase; cycles in order week to week
  Base:
    quality_a: [strides_session]
workout_definitions:
  strides_session:
    intensity: easy                      # scheduled_workouts.planned_intensity
    structure:                           # warmup | steady | interval | cooldown
      - { type: steady, duration_min: 35, intensity: easy }
      - { type: interval, reps: 6, work_duration_min: 0.5, work_intensity: sprint, rest_duration_min: 1.5, rest_intensity: easy }
    total_duration_est_min: 45           # optional; must agree with the structure within 5 min
```

Load checks include: no week more than 10% over the highest earlier week (CLAUDE.md §4.3), every slot filled in every phase with a defined workout, durations derived from the structure.
