# @scora/posture

Deterministic daily posture (`primed`, `steady`, `moderate`, `back-off`, `rest`, `taper`) from a driver record. Rules and thresholds come from `07_SCORA_Architecture_Data_Model_v1.md` §8.3; v2 of that doc dropped the section, so this package is now the source of truth.

```ts
import { computePosture } from '@scora/posture';

const r = computePosture(drivers, { sleep_score_p25: 70, sleep_score_p75: 85 });
r.posture;   // 'moderate'
r.reasoning; // every rule checked, with the values and thresholds (daily_posture.reasoning_json)
```

- Rules run in order (taper, rest, back-off, moderate, primed); first match wins; default is steady.
- A clause needing a driver the user doesn't have is false. No data reads steady.
- All thresholds live in `src/constants.ts`. Change one, bump `POSTURE_ENGINE_VERSION`.
- Not yet wired into `apps/api`; the per-user driver record (doc 07 v1 §8.2) has to be computed first.

Tests: `npm test` (from this folder).
