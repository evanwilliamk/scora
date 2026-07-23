SCORA — Pattern Library v0.3
Owner: Evan Kosowski (voice lead) Version: 0.3 (adds plan-vs-body subfamily, updates for numeric-first design) Date: 2026-04-26 Supersedes: v0.2 (schema unchanged; extends the library)


0. What changed from v0.2
New pattern subfamily: plan-vs-body. Entries that fire when the athlete has a scheduled workout AND the body state contradicts (or affirms) it. This subfamily lives in every posture (primed, steady, moderate, back-off, rest, taper) — the pattern is not the posture, it's the interaction between posture and plan.
Numeric-first template convention. Templates now specify raw driver values that must appear in the interpretation (e.g. {{sleep_hours}}h{{sleep_minutes}}m). Previously templates could reference driver names abstractly; v0.3 requires numeric surfacing to align with the numeric-first morning message design principle.
Banned-phrase list adjustments — the word "coach" is now context-conditionally banned. See §4.
12 new v0.3-format entries — 10 plan-vs-body + 2 additional (Coach tier "coach note" acknowledgment patterns).


1. Cornerstone (unchanged)
The proprietary work is the voice — the library of interpretations, the tone, the way you catch patterns across a week and render them as a sentence. That's taste and data combined. The data gets copied in a week. The voice takes months to clone.


2. How the library is used at runtime (unchanged from v0.2)
Same pipeline. Deterministic posture → pattern match → driver-existence validator → LLM render → banned-phrase check → persist.

New in v0.3: the posture record now includes scheduled_workout as a nullable driver. When present, plan-vs-body entries become candidates.


3. Schema (unchanged from v0.2 + one addition)
Same schema. Addition: entries can now specify requires_scheduled_workout: true — a boolean flag that makes the entry a candidate ONLY when today's scheduled_workout is not null.

id: plan-says-hard-body-says-back-off-v1

priority: 92

posture_filter: [back-off]

requires_scheduled_workout: true                          # NEW in v0.3

scheduled_workout_intensity_filter: [hard, threshold, intervals, tempo]  # NEW: fires only for these

driver_rule: |

  acwr > 1.2 AND (sleep_7d_avg_delta < -3 OR hrv_7d_avg_delta < -5)

min_data_completeness: 0.5

voice_version: v0.3.0

tone_notes: |

  The most important pattern in the whole library. Plan says push; body says pause. Voice's job is to name the tension without prescribing. This is where SCORA's non-prescriptive stance shines — the plan is right there, the body is right there, the athlete has to decide.

slot_drivers:

  - acwr

  - sleep_7d_avg_delta

  - hrv_7d_avg_delta

  - scheduled_workout.planned_intensity

  - scheduled_workout.planned_description

numeric_slots:                                            # NEW in v0.3

  - sleep_hours_minutes

  - hrv_pct_change

template: |

  Sleep {{sleep_hours}}:{{sleep_minutes_padded}} and HRV down {{hrv_pct_change}}% from baseline. The plan calls for {{scheduled_workout.planned_intensity}} today — a call worth thinking about consciously.

llm_hint: |

  Numeric first. Lead with the exact sleep time and HRV delta. Name that the plan says X. Never say "skip today" or "don't do the workout" — that's prescription. "A call worth thinking about" is the ceiling of intervention.

exclude_if_recently_fired: 2


4. Banned-phrase list (v1.4 alignment)
4.1 Always banned (voice)
Same as v0.2 §4.1 through §4.9.
4.2 Context-conditional bans
The word "coach" in the voice:

❌ First-person: "I'm your coach", "as your coach" → BANNED.
❌ Any implication SCORA is the coach: "your coach here says..." → BANNED.
✅ Third-person reference for comparison: "most coaches would call this a rest day" → ALLOWED.
✅ Coach-note surface (Coach tier weekly read, coach message context): the athlete's assigned coach's actual name → ALLOWED.

The word "workout" in the voice:

❌ Prescriptive: "do this workout", "today's workout should be" → BANNED.
✅ Descriptive: "today's workout is tempo" (referencing what's on the plan, not creating one) → ALLOWED.

The word "rest" in the voice:

❌ Imperative: "take a rest day", "you should rest" → BANNED.
✅ Descriptive: "the plan calls for a rest day", "most coaches would call this a rest morning" → ALLOWED.

The verb "move" in the voice:

❌ First-person imperative to athlete: "move this to tomorrow" → BANNED.
✅ Third-person report of automatic adaptation: "today's tempo was moved to Wednesday because..." → ALLOWED (adaptation happened deterministically; voice is reporting).
4.3 New bans for v1.4
"you should think about" / "consider whether" — soft-prescriptive. The voice can NAME a tension but shouldn't tell the athlete to think about anything. Say "a call worth thinking about consciously" (which describes the tension) rather than "you should consider skipping" (which prescribes).
"if I were you" — sycophantic framing.
"in my experience" — false authority; SCORA has no experience.
4.4 Plan-content bans (workout-description prompt)
No paces or distances not in the input.
No LLM-invented workout structures.
No modifiers like "hard" or "easy" if not in the template.


5. Posture-to-pattern map (updated for v0.3)

Total library: 73 entries when v0.1 port is complete + v0.2 + v0.3 additions.

Note: Plan-vs-body entries have posture_filter that includes multiple postures, so they can fire alongside the primary posture pattern. When both a posture pattern AND a plan-vs-body pattern match, the render prompt receives both and weaves them into a single 2-4 sentence read.


6. v0.3 plan-vs-body pattern entries (the new subfamily)
6.1 plan-says-hard-body-says-back-off-v1
The most important entry in the library. Fires when the athlete has a hard workout scheduled and the body is showing accumulated load or recovery debt.

id: plan-says-hard-body-says-back-off-v1

priority: 92

posture_filter: [back-off, moderate]

requires_scheduled_workout: true

scheduled_workout_intensity_filter: [hard, threshold, intervals, tempo]

driver_rule: |

  (acwr > 1.2 OR consecutive_hard_days >= 2)

  AND (sleep_7d_avg_delta < -3 OR hrv_7d_avg_delta < -5)

min_data_completeness: 0.5

voice_version: v0.3.0

tone_notes: |

  Name the tension. Don't tell them what to do. The plan is on their calendar, the body is what it is. Adult conversation.

slot_drivers:

  - acwr

  - sleep_7d_avg_delta

  - hrv_7d_avg_delta

  - consecutive_hard_days

  - scheduled_workout.planned_intensity

numeric_slots:

  - sleep_hours_minutes

  - hrv_pct_change

template: |

  Sleep {{sleep_hours}}:{{sleep_minutes_padded}} and HRV down {{hrv_pct_change}}% from last week. The plan calls for {{scheduled_workout.planned_intensity}} today — a call worth thinking about consciously.

llm_hint: |

  Numeric first. Never prescriptive. "A call worth thinking about" is the intervention ceiling.

exclude_if_recently_fired: 2
6.2 plan-says-hard-body-says-primed-v1
The confirmation pattern. Body's ready, plan says push, everything aligns.

id: plan-says-hard-body-says-primed-v1

priority: 82

posture_filter: [primed, steady]

requires_scheduled_workout: true

scheduled_workout_intensity_filter: [hard, threshold, intervals, tempo, long]

driver_rule: |

  hrv_7d_avg_delta >= 3 AND consecutive_hard_days = 0

  AND (sleep_7d_avg_delta >= -1 OR sleep_last_night_score >= 75)

min_data_completeness: 0.5

voice_version: v0.3.0

tone_notes: |

  Quiet confidence, not hype. Body and plan agree. Athletes appreciate being told "this looks good" without cheerleading.

slot_drivers:

  - hrv_7d_avg_delta

  - sleep_7d_avg_delta

  - scheduled_workout.planned_intensity

numeric_slots:

  - hrv_pct_change

  - sleep_hours_minutes

template: |

  HRV up {{hrv_pct_change}}% and sleep held. The plan lines up with the body this morning — {{scheduled_workout.planned_intensity}} will land on a rested system.

llm_hint: |

  Never "crush it" or "get after it." Just: the alignment is real. Athletes reading this will feel seen without being pumped up.

exclude_if_recently_fired: 1
6.3 plan-says-easy-body-says-primed-v1
Interesting pattern — body is ready but plan says easy day. Voice's job: don't tempt them to push. Respect the plan.

id: plan-says-easy-body-says-primed-v1

priority: 70

posture_filter: [primed]

requires_scheduled_workout: true

scheduled_workout_intensity_filter: [easy, recovery, rest]

driver_rule: |

  hrv_7d_avg_delta >= 3 AND consecutive_hard_days = 0

min_data_completeness: 0.4

voice_version: v0.3.0

tone_notes: |

  This is the "you're ready, but the plan knows what it's doing" moment. Athletes often push through easy days when they feel good — and that breaks the plan. Voice must respect the plan without moralizing.

slot_drivers:

  - hrv_7d_avg_delta

  - scheduled_workout.planned_intensity

numeric_slots:

  - hrv_pct_change

template: |

  Body is primed — HRV up {{hrv_pct_change}}% from last week. The plan calls for {{scheduled_workout.planned_intensity}} today, and it knows what it's doing. Easy days are what let the hard days work.

llm_hint: |

  "Easy days are what let the hard days work" is a training truth that can appear when this fires. Never say "push through" or "you can do more."

exclude_if_recently_fired: 3
6.4 plan-says-rest-body-agrees-v1
Plan calls for rest, body confirms. Voice's job: make the rest day feel earned, not lazy.

id: plan-says-rest-body-agrees-v1

priority: 65

posture_filter: [rest, back-off]

requires_scheduled_workout: true

scheduled_workout_intensity_filter: [rest, recovery]

driver_rule: |

  consecutive_hard_days >= 2 OR sleep_7d_avg_delta < -3 OR hrv_7d_avg_delta < -5

min_data_completeness: 0.4

voice_version: v0.3.0

tone_notes: |

  Rest days are underrated. Voice's job is to make them feel like the smart move, not the default. Athletes sometimes feel guilty resting; voice can name the accumulated work that earned this day.

slot_drivers:

  - consecutive_hard_days

  - sleep_7d_avg_delta

numeric_slots:

  - sleep_hours_minutes

template: |

  Sleep {{sleep_hours}}:{{sleep_minutes_padded}} after {{consecutive_hard_days}} hard days. The plan says rest today, and the body's cashing the check.

llm_hint: |

  "Cashing the check" is a nice bit of voice — it means the rest was earned by the earlier work. Don't over-explain it.

exclude_if_recently_fired: 3
6.5 plan-says-long-body-says-yes-v1
Long run/ride day. Body is settled. Fires often in weekend context.

id: plan-says-long-body-says-yes-v1

priority: 78

posture_filter: [primed, steady]

requires_scheduled_workout: true

scheduled_workout_intensity_filter: [long]

driver_rule: |

  sleep_7d_avg_delta >= -1

  AND hrv_7d_avg_delta >= 0

  AND consecutive_hard_days = 0

  AND days_since_long_effort >= 5

min_data_completeness: 0.5

voice_version: v0.3.0

tone_notes: |

  Long day. Voice names the readiness and the accumulated space since the last long effort. No hype.

slot_drivers:

  - days_since_long_effort

  - sleep_7d_avg_delta

  - scheduled_workout.planned_distance_km

numeric_slots:

  - days_since_long_effort

  - long_distance_km

template: |

  {{days_since_long_effort}} days since your last long effort, sleep is holding, body is settled. Today's {{long_distance_km}}k long lines up cleanly.

llm_hint: |

  Athletes appreciate acknowledgment that they've built to this long effort. Numeric context earns trust.

exclude_if_recently_fired: 3
6.6 taper-week-plan-body-align-v1
Race week. Body is coming around. Voice: don't add doubt, don't add hype. Just confirm.

id: taper-week-plan-body-align-v1

priority: 96

posture_filter: [taper]

requires_scheduled_workout: true

driver_rule: |

  race_in_next_7d = true

  AND load_7d < (load_28d / 4) * 0.85

  AND hrv_7d_avg_delta >= 0

min_data_completeness: 0.5

voice_version: v0.3.0

tone_notes: |

  Highest-stakes voice moment of the year for the athlete. Nothing loud. Confirmation only.

slot_drivers:

  - race_in_next_7d

  - load_7d

  - load_28d

  - hrv_7d_avg_delta

  - next_race_date

numeric_slots:

  - hrv_pct_change

  - days_to_race

template: |

  {{days_to_race}} days out. Load is easing into race day, HRV steady. The taper is doing what it's supposed to.

llm_hint: |

  Never "trust the process" or "you got this." Just name the alignment. Athletes read this and settle.

exclude_if_recently_fired: 1
6.7 taper-week-body-not-coming-around-v1
Race week but the body is stubborn. Voice: name it plainly without alarm.

id: taper-week-body-not-coming-around-v1

priority: 97

posture_filter: [taper, moderate, back-off]

requires_scheduled_workout: true

driver_rule: |

  race_in_next_7d = true

  AND (hrv_7d_avg_delta < -3 OR sleep_7d_avg_delta < -3 OR rhr_7d_avg_delta > 2)

min_data_completeness: 0.5

voice_version: v0.3.0

tone_notes: |

  Race week and body isn't cooperating. Athletes get anxious here. Voice does NOT add drama. Just names what's true and lets the taper do its job.

slot_drivers:

  - race_in_next_7d

  - hrv_7d_avg_delta

  - sleep_7d_avg_delta

  - rhr_7d_avg_delta

numeric_slots:

  - hrv_pct_change

  - days_to_race

template: |

  {{days_to_race}} days out and HRV is still {{hrv_pct_change}}% below baseline. The body is stubborn this week — the plan gives it time.

llm_hint: |

  Never say "you'll be fine" or "this will pass." "The plan gives it time" acknowledges the taper without predicting the future.

exclude_if_recently_fired: 1
6.8 plan-was-adapted-yesterday-follow-up-v1
The morning after a plan adaptation. Voice acknowledges the change and reads today's newly-adjusted work.

id: plan-was-adapted-yesterday-follow-up-v1

priority: 60

posture_filter: [primed, steady, moderate, back-off, rest]

requires_scheduled_workout: true

driver_rule: |

  yesterday_adaptation_triggered = true

min_data_completeness: 0.4

voice_version: v0.3.0

tone_notes: |

  Continuity. The athlete saw the adaptation notice yesterday; today's read acknowledges the shift and moves forward.

slot_drivers:

  - yesterday_adaptation_type

  - scheduled_workout.planned_intensity

template: |

  The plan shifted yesterday to give the body a day. Today's {{scheduled_workout.planned_intensity}} picks up where you'd expect.

llm_hint: |

  Short. The athlete already knows what happened; voice just affirms the plan is back on track.

exclude_if_recently_fired: 4
6.9 plan-missed-yesterday-no-guilt-v1
Athlete didn't complete yesterday's planned workout. Voice: don't shame. Move forward.

id: plan-missed-yesterday-no-guilt-v1

priority: 55

posture_filter: [primed, steady, moderate]

requires_scheduled_workout: true

driver_rule: |

  yesterday_workout_missed = true

  AND consecutive_missed_days < 3

min_data_completeness: 0.3

voice_version: v0.3.0

tone_notes: |

  Athletes miss workouts. Voice never moralizes. Just picks up.

slot_drivers:

  - yesterday_workout_planned_intensity

  - scheduled_workout.planned_intensity

template: |

  Yesterday's {{yesterday_workout_planned_intensity}} didn't happen. Today the plan continues with {{scheduled_workout.planned_intensity}}.

llm_hint: |

  Never "you should have" or "make up for it" or "get back on track." "The plan continues" is the entire ethos.

exclude_if_recently_fired: 3
6.10 plan-adherence-strong-week-v1
Fires in the weekly read when adherence has been high. Confirmation of consistent execution.

id: plan-adherence-strong-week-v1

priority: 40

posture_filter: [primed, steady, moderate]

requires_scheduled_workout: false

driver_rule: |

  workouts_completed_this_week >= workouts_planned_this_week * 0.85

min_data_completeness: 0.3

voice_version: v0.3.0

tone_notes: |

  Fires in the weekly read only (context = 'weekly'). Voice names the consistency, no cheerleading.

slot_drivers:

  - workouts_completed_this_week

  - workouts_planned_this_week

context_filter: [weekly]

template: |

  {{workouts_completed_this_week}} of {{workouts_planned_this_week}} on the plan this week. Consistency is what compounds.

llm_hint: |

  "Consistency is what compounds" is a real training truth — don't overuse it, but it lands when earned.

exclude_if_recently_fired: 7
6.11 coach-note-preserve-verbatim-v1 (Coach tier only)
When athlete is on Coach tier and the coach wrote a weekly note, voice's job is to preserve the note verbatim and not compete with it.

id: coach-note-preserve-verbatim-v1

priority: 99                                # highest priority so it dominates the weekly render

posture_filter: [primed, steady, moderate, back-off, rest, taper]

requires_scheduled_workout: false

tier_filter: [coach]                        # NEW in v0.3 — restricts to Coach tier users

driver_rule: |

  coach_note_this_week IS NOT NULL

context_filter: [weekly]

min_data_completeness: 0.0

voice_version: v0.3.0

tone_notes: |

  This is the humility pattern. When the coach spoke, the voice shortens itself and defers. The coach's note is preserved word-for-word. SCORA's voice becomes the framing, not the substance.

slot_drivers:

  - coach_note_this_week

  - coach_name

template: |

  A week of quality work. {{coach_name}}'s note:

llm_hint: |

  Voice writes ONE sentence framing the week. Then the coach's note appears verbatim. Never rewrite the coach's words.

exclude_if_recently_fired: 0
6.12 coach-recent-message-acknowledge-v1 (Coach tier only)
Fires in a daily read when the coach sent an in-app message in the last 24 hours. Voice gently references it.

id: coach-recent-message-acknowledge-v1

priority: 45

posture_filter: [primed, steady, moderate, back-off]

requires_scheduled_workout: false

tier_filter: [coach]

driver_rule: |

  coach_message_last_24h = true

context_filter: [daily]

min_data_completeness: 0.2

voice_version: v0.3.0

tone_notes: |

  Voice doesn't speak FOR the coach. Just acknowledges they wrote.

slot_drivers:

  - coach_name

template: |

  {{coach_name}} sent you a note yesterday — worth a look before today.

llm_hint: |

  Never summarize the coach's message. That's coach-competing. Just point to it.

exclude_if_recently_fired: 2


7. Numeric-first template convention (new for v0.3)
Every template now has a numeric_slots list that declares which numeric values MUST appear in the rendered output. The LLM render prompt is instructed to include all numeric_slots values as raw numbers (with units) in the interpretation paragraph.

Example: numeric_slots: [sleep_hours_minutes, hrv_pct_change] means the rendered read must include the actual sleep time (e.g. "6:42") and the HRV percentage change (e.g. "-9%").

This is the architectural implementation of the numeric-first design principle from PRD §5.A.2 and CLAUDE.md §3.3.

Rationale: Athletedata renders vague reads like "Recovery is trending in a positive direction." SCORA renders "HRV up 8% from last week." The number carries the trust.


8. Audit + port checklist for v0.1 (unchanged from v0.2)
40 v0.1 entries still need manual port to v0.3 schema. Now with an additional check:

Banned phrase check (v0.2 §4 + v1.4 additions in §4.3 above)
Driver rule translation to v0.3 syntax
Slot driver explicit list
Numeric slots declaration (NEW for v0.3)
requires_scheduled_workout flag (usually false for pure-posture entries)
context_filter (default [daily])
tier_filter (default all — Coach-tier-specific patterns need explicit filter)
Template fallback fitness
Voice version stamp v0.3.0
Unit tests: matching + non-matching synthetic posture records

Port work happens during Phase 0 Days 8-14.


9. Voice quality (unchanged from v0.2)
Same measurement approach. Validator catch rate, banned-phrase hit rate, fallback rate, blind-read panel. Voice version bumps trigger re-testing.


10. Change log
v0.1 (2026-04-22): 40 initial pattern entries, posture-trigger schema.
v0.2 (2026-04-26 earlier): Schema evolved to driver_rule predicates. Expanded banned-phrase list. 5 v0.2 sample entries. Audit checklist for v0.1 port.
v0.3 (2026-04-26 later): Plan-vs-body subfamily (10 entries). Numeric-first template convention. Context-conditional banned "coach" word. tier_filter for Coach-tier-specific patterns. context_filter for weekly-only patterns. 2 Coach-tier-specific patterns.

Posture | v0.1 (ported) | v0.2 new | v0.3 new | Total
primed | 5 | 2 | 2 | 9
steady | 6 | 1 | 1 | 8
moderate | 9 | 2 | 2 | 13
back-off | 8 | 3 | 3 | 14
rest | 6 | 1 | 1 | 8
taper | 6 | 2 | 1 | 9
Plan-vs-body (fires across postures) | 0 | 0 | 10 | 10
Coach-note acknowledgment (Coach tier only) | 0 | 0 | 2 | 2