# DECISIONS.md

Decision log for agent work on SCORA. Product decisions from April 2026 live in `01_SCORA_90-Day_Execution_Plan_v1_4.md` §8. Newest first.

### 2026-10-11: Voice pattern library review notes
- Status: NEEDS EVAN (none block merging)
- Branch: claude/voice-pattern-library
- Context: reviewed feat/voice-pattern-library merged onto current main; 71 tests pass, Railway install path checked locally.
- Choice (or options):
  1. Templates say "HRV down {{hrv_pct_change}}%" and "{{hrv_pct_change}}% below baseline", so the caller must pass a magnitude, not a signed value, or reads say "down -7%". Proposed: slot values are always unsigned; direction lives in the template wording.
  2. numeric_slots do not match templates: `sleep_hours_minutes` is declared but templates use `sleep_hours` + `sleep_minutes_padded`, and plan-says-hard-body-says-primed declares it with no sleep slot at all. Copied from doc 06 as written. Fix in doc 06 or the YAML.
  3. Templates contain em dashes (copied verbatim from doc 06). Left as is since it is voice copy.
  4. Root package.json becomes an npm workspace (apps/*, packages/*). `cd apps/api && npm install` still works, but the first Railway deploy after merge is worth watching.
- Why: voice copy and production deploys are Evan's call.
- To reverse: n/a.

### 2026-10-11: Agents push branches, Evan merges to main
- Status: DECIDED (by Evan)
- Branch: claude/push-policy
- Context: OpenClaw's AGENTS.md lets it commit and push on its own; Claude Code was not pushing at all.
- Choice: every agent pushes its own branch to origin when ready for review. Only Evan pushes to or merges into main, on GitHub. No force-pushes.
- Why: Evan reviews everything before it lands; two agents pushing to main would collide.
- To reverse: edit CLAUDE.md §9.1.

### 2026-10-11: OpenClaw workspace files in the repo
- Status: NEEDS EVAN (Evan is handling OpenClaw)
- Branch: none
- Context: AGENTS.md, SOUL.md, IDENTITY.md, USER.md, TOOLS.md, HEARTBEAT.md sit in the repo root and are on GitHub.
- Options: keep them, or make `~/scora` the OpenClaw workspace with the repo at `~/scora/app`.
- Why: USER.md holds personal context; OpenClaw's AGENTS.md also still says to push on its own.
- To reverse: n/a until decided.

### 2026-10-11: Shared agent workflow lives in the repo
- Status: DECIDED
- Branch: claude/agent-workflow-docs
- Context: Claude Code and OpenClaw both work on this repo and kept separate memory.
- Choice: CLAUDE.md §9.1 holds the workflow rules; PLAN.md, DECISIONS.md, MEMORY.md and memory/ are the shared state both agents read and write. Private per-tool memory is not a source of truth.
- Why: git is the only thing both agents and both machines share.
- To reverse: delete §9.1, PLAN.md and DECISIONS.md.
