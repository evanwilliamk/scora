// Plain-English description of a plan session (CLAUDE.md §6.4), built from
// the template's own structure: every number is the template's, nothing is
// added, so no LLM and no validator are needed. "45-minute tempo. 10 minutes
// easy, 25 minutes at tempo, 10 minutes easy."

import type { WorkoutStep } from './template-types';
import { structureMinutes } from './template-loader';

const SESSION: Record<string, string> = {
  rest: 'rest day', recovery: 'recovery run', easy: 'easy run', moderate: 'moderate run', endurance: 'endurance run',
  steady_state: 'steady-state run', tempo: 'tempo', threshold: 'threshold session', intervals: 'interval session',
  hard: 'hard session', long: 'long run',
};

// Minutes as a reader says them: "10 minutes", "1 minute", "90 seconds",
// "2:30 minutes", "2 hours 5 minutes". Rounded to the second first, so 1.999
// reads "2 minutes", not "2:00".
export function spokenDuration(min: number): string {
  const secs = Math.round(min * 60);
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
  if (secs % 60 === 0) {
    const m = secs / 60;
    if (m < 60) return plural(m, 'minute');
    const h = Math.floor(m / 60);
    return m % 60 === 0 ? plural(h, 'hour') : `${plural(h, 'hour')} ${plural(m % 60, 'minute')}`;
  }
  if (secs < 120) return `${secs} seconds`;
  if (secs < 3600) return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')} minutes`;
  return spokenDuration(Math.round(min)); // over an hour, the nearest minute
}

// How a step's intensity reads after "at".
const EFFORT: Record<string, string> = {
  moderate: 'moderate effort', tempo: 'tempo', threshold: 'threshold', vo2max: 'VO2max effort', sprint: 'sprint effort',
};
const plain = (i: string) => i === 'easy' || i === 'recovery' || i === 'steady';

function step(s: WorkoutStep): string {
  if (s.type === 'interval') {
    const work = `${s.reps} × ${spokenDuration(s.work_duration_min)} at ${EFFORT[s.work_intensity] ?? s.work_intensity}`;
    return s.reps > 1 && s.rest_duration_min > 0
      ? `${work}, ${spokenDuration(s.rest_duration_min)} ${plain(s.rest_intensity) ? s.rest_intensity : `at ${EFFORT[s.rest_intensity] ?? s.rest_intensity}`} between`
      : work;
  }
  return `${spokenDuration(s.duration_min)} ${plain(s.intensity) ? s.intensity : `at ${EFFORT[s.intensity] ?? s.intensity}`}`;
}

export function describeWorkout(intensity: string, structure: WorkoutStep[] | null | undefined): string | null {
  if (intensity === 'rest') return 'Rest day.';
  if (!structure || structure.length === 0) return null;
  const total = Math.round(structureMinutes(structure));
  const kind = SESSION[intensity] ?? intensity.replace(/_/g, ' ');
  const head = `${total}-minute ${kind}.`;
  // One step at the session's own pace says nothing the head does not.
  const only = structure.length === 1 ? structure[0] : null;
  if (only && only.type !== 'interval' && (plain(only.intensity) || only.intensity === intensity)) return head;
  const parts = structure.map(step);
  return `${head} ${parts[0].charAt(0).toUpperCase()}${parts[0].slice(1)}${parts.length > 1 ? ', ' + parts.slice(1).join(', ') : ''}.`;
}
