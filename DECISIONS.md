# DECISIONS.md

Decision log for agent work on SCORA. Product decisions from April 2026 live in `01_SCORA_90-Day_Execution_Plan_v1_4.md` §8. Newest first.

### 2026-10-13: CDV chart WebView loads Vega from a pinned CDN
- Status: DECIDED
- Branch: claude/cdv-chart-webview
- Context: ChatView needs Vega-Lite to render CDV charts; the night worker does not download files, so the libraries are not bundled.
- Choice: the chart page loads vega 5.30.0, vega-lite 5.21.0 and vega-embed 6.26.0 from cdn.jsdelivr.net. Specs with any `url` or `href` key are rejected, so charts only use inline data. API contract: optional `chart` field (a Vega-Lite object) on the /api/cdv response.
- Why: smallest change that works today. Alternative: bundle the three JS files in the app so charts render offline and nothing loads from a third party.
- To reverse: swap the three script tags in `CDVChart.html(for:)` for bundled files.

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
