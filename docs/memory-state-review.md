# Memory-state review (2026-11-03)

Checked every module-level or long-lived in-memory value in `apps/api/src` and `packages/*/src` for cross-athlete leaks, unbounded growth, cached rejections and stale state across the athlete's local day.

## Finding fixed

- `scheduler.ts` `failedAt` (key `athlete:kind:localDate`): deleted only on a successful delivery, so a read that fails every day (for example, Strava disconnected) left one mark per athlete per day for the life of the process. Now pruned at the start of each tick once past `RETRY_AFTER_MS`, after which a mark has no effect anyway. Test: `apps/api/test/scheduler-failed-prune.test.ts`.

## Checked, no change

- `strava.ts` / `oura.ts` token single-flight maps: keyed by athlete id, deleted in `finally`, so a rejection is never cached.
- `card-expand.ts` `SnapshotCache` (`index.ts` `readSnapshots`): keyed by athlete id, 10 minute TTL, 5000 cap. A tap just after local midnight interprets the read the athlete is looking at, which is the intended behavior.
- `delivery.ts` `clockFormats`: keyed by zone (not athlete data), cleared past 1000 zones; invalid zones cache `null`, which is deterministic.
- `push.ts` `cachedJwt`: one provider token, refreshed after 50 minutes; not athlete data.
- `scheduler.ts` `pendingReleases`: removed when the retry succeeds; bounded by stuck claims. `dueState`: two scalars.
- `voice/matcher.ts` `_ruleCache`: keyed by driver_rule source from the shipped pattern library (bounded). `voice/loader.ts` `_cache`, `index.ts` `_templates`: static files.
- Lazy Supabase clients (`push.ts`, `usage.ts`, `oura.ts`, `strava.ts`, `knowledge-retrieval.ts`, `index.ts` `_prefs` / `_planSb`): stateless per athlete; a missing env throws before caching.
- CDV daily quota (`usage.ts`): counted in the database, not memory.
