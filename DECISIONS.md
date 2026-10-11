# DECISIONS.md

Decision log for agent work on SCORA. Product decisions from April 2026 live in `01_SCORA_90-Day_Execution_Plan_v1_4.md` §8. Newest first.

### 2026-10-11: Who pushes, and where OpenClaw's workspace files live
- Status: NEEDS EVAN
- Branch: none
- Context: OpenClaw's AGENTS.md lets it commit and push on its own; Claude Code's rules say only Evan pushes or merges to main.
- Options: (a) both agents work on branches, Evan pushes and merges (recommended); (b) OpenClaw keeps pushing, Claude stays branch-only. Separately: keep AGENTS.md, SOUL.md, IDENTITY.md, USER.md, TOOLS.md, HEARTBEAT.md in the repo, or make `~/scora` the OpenClaw workspace with the repo at `~/scora/app`.
- Why: two agents with different push rules on one repo will collide on main.
- To reverse: n/a until decided.

### 2026-10-11: Shared agent workflow lives in the repo
- Status: DECIDED
- Branch: claude/agent-workflow-docs
- Context: Claude Code and OpenClaw both work on this repo and kept separate memory.
- Choice: CLAUDE.md §9.1 holds the workflow rules; PLAN.md, DECISIONS.md, MEMORY.md and memory/ are the shared state both agents read and write. Private per-tool memory is not a source of truth.
- Why: git is the only thing both agents and both machines share.
- To reverse: delete §9.1, PLAN.md and DECISIONS.md.
