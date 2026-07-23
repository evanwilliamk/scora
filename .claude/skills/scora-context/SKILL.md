---
name: scora-context
description: Re-establish full SCORA working context after a window reload or at the start of a fresh session. Loads the canonical docs (CLAUDE.md + Master Context), surfaces current project state from memory and git, and presents the full documentation map. Use when the user types /scora-context, asks to "load context" / "catch up" / "where were we", or begins working on SCORA in a new session.
---

# Load SCORA context

When this skill runs, re-establish full working context for SCORA before doing anything else. Steps:

## 1. Read the canonical docs fully
These two define what the product is and the rules the codebase lives by — read both:
- **`CLAUDE.md`** — standing orders: voice-vs-plan distinction, tier scope, banned phrases, tech stack, out-of-scope list.
- **`docs/scora-master-context-rev5.md`** — canonical positioning (Rev 5): the calibrated-forecaster thesis (predict → verify → calibrate → restraint), the Daily Call, feel-before-reveal, the third witness, the named Score, exit-to-Strava. **This ENRICHES CLAUDE.md, not replaces it** — read the reconciliation note at the top for Evan's standing clarifications (free tier kept for now; not road-only; Strava stays integrated; "paid-only" is analysis, not a locked decision).

## 2. Surface current state from memory
Read the memory index and the files it points to (recent decisions, open items, blockers):
- `/Users/everettkosowski/.claude/projects/-Users-everettkosowski-Documents-scora/memory/MEMORY.md`

## 3. Check where we left off (git)
Run: `git status --short` and `git log --oneline -6`. Note branch, uncommitted changes, and recent commits.

## 4. The rest of the documentation — available on demand, do NOT read unless asked
| Doc | Path | What it is |
|---|---|---|
| **Doc index** | `README_DOC_INDEX.md` | Master index — what every doc is + reading order (v1.4; describes the old tier model, pre Rev-5 strategy) |
| PRD | `02_SCORA_PRD_v1_4.md` | Product spec (tiers, features) |
| Execution Plan / Timeline | `01_SCORA_90-Day_Execution_Plan_v1_4.md` | 90-day plan / timeline |
| Architecture | `07_SCORA_Architecture_Data_Model_v2.md` | System architecture + DB schemas |
| LLM Prompt Spec | `08_SCORA_LLM_Prompt_Spec_v2.md` | Production prompts + validators |
| Pattern Library | `06_SCORA_Pattern_Library_v0_3.md` | Voice patterns + plan-vs-body subfamily |
| Onboarding | `09_SCORA_Onboarding_Flow_v2.md` | Onboarding flow |
| Acceptance | `10_SCORA_Acceptance_Criteria_v2.md` | Acceptance criteria |
| Training Canon | `docs/scora-flow-doctrine.md` | Two-wing training doctrine (flow/perception + structure/load) informing the voice + score priors |
| Business Lenses | `docs/scora-business-model-lenses.md` | Four-lens strategic analysis (Thiel / bold-solo / Strava / exit) |
| API reference | `apps/api/README.md` | Backend endpoints, env vars, migrations, data flow |
| Design TODOs | `memory/design-todos.md` | Frontend/UX todo list (post-auth flows, iOS screens) |
| Project log | `MEMORY.md` + `memory/*.md` | Long-term project log / phase history / session notes |

(Also present but ancillary: `AGENTS.md`, `HEARTBEAT.md`, `IDENTITY.md`, `SOUL.md`, `TOOLS.md`, `USER.md` — agent/workspace config, not product docs.)

## 5. Brief the user
After loading 1-3, give a tight briefing:
- **What SCORA is** — 2 lines (native iOS calibrated forecaster; multi-source readiness verdict with a visible accuracy record; north star = acquisition by Strava).
- **Where we left off** — from memory + git (recent work, current branch, uncommitted changes).
- **Open decisions / blockers** — from memory (e.g. Apple Developer enrollment gate; the intervention-threshold design question; which Rev 5 elements to formally adopt).
- **Offer the doc menu** — mention "say 'load everything' for a full read of the PRD, architecture, LLM spec, canon, and lenses."

## Full read (only if asked)
If the user says "load everything" / "full context" / "read all the docs," additionally read the PRD (02), Architecture (07), LLM Prompt Spec (08), Training Canon, and Business Lenses.
