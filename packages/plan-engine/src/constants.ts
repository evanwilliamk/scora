// Every adaptation threshold lives here (doc 07 v2 §6.2, CLAUDE.md §6.2).
// Changing any value means bumping ADAPTATION_ENGINE_VERSION so stored
// adaptations stay explainable.

import type { Intensity } from './types';

export const ADAPTATION_ENGINE_VERSION = 'adaptation-v1.2.0';

// race_in_next_7d: freeze every automatic adaptation (T-7).
export const RACE_FREEZE_DAYS = 7;

// Weekly volume never adapts more than ±10% from the template call.
export const WEEKLY_VOLUME_TOLERANCE = 0.1;

// What counts as a hard session for the rest-posture move rule.
export const HARD_INTENSITIES: readonly Intensity[] = ['hard', 'intervals', 'threshold', 'tempo', 'long'];

// What a moved workout may displace. Anything else in the window blocks it.
export const DISPLACEABLE_INTENSITIES: readonly Intensity[] = ['easy', 'recovery'];
