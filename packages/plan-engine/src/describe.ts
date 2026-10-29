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
// "2:30". Fractions under a minute become seconds.
export function spokenDuration(min: number): string {
  if (Number.isInteger(min)) return `${min} ${min === 1 ? 'minute' : 'minutes'}`;
  const secs = Math.round(min * 60);
  if (secs < 120) return `${secs} seconds`;
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
}

function step(s: WorkoutStep): string {
  if (s.type === 'interval') {
    return `${s.reps} × ${spokenDuration(s.work_duration_min)} at ${s.work_intensity}, ${spokenDuration(s.rest_duration_min)} ${s.rest_intensity} between`;
  }
  const at = s.intensity === 'easy' || s.intensity === 'recovery' || s.intensity === 'steady' ? s.intensity : `at ${s.intensity}`;
  return `${spokenDuration(s.duration_min)} ${at}`;
}

export function describeWorkout(intensity: string, structure: WorkoutStep[] | null | undefined): string | null {
  if (intensity === 'rest') return 'Rest day.';
  if (!structure || structure.length === 0) return null;
  const total = Math.round(structureMinutes(structure));
  const kind = SESSION[intensity] ?? intensity.replace(/_/g, ' ');
  const head = `${total}-minute ${kind}.`;
  if (structure.length === 1 && structure[0].type !== 'interval') return head;
  const parts = structure.map(step);
  return `${head} ${parts[0].charAt(0).toUpperCase()}${parts[0].slice(1)}${parts.length > 1 ? ', ' + parts.slice(1).join(', ') : ''}.`;
}
