import { RECENCY_DAYS, type PaceBand, type PassageWork, type RecencyBand } from '@langquest-next/core';
import type { Tone } from './ui';

/** Words and tones for the report's bands, as the web dashboard had them (decision 41). */

export const WORK_LABEL: Record<PassageWork, string> = {
  not_started: 'Not started',
  drafting: 'Being recorded',
  in_review: 'In review',
  feedback: 'Feedback to answer',
  done: 'Done'
};

export const WORK_TONE: Record<PassageWork, Tone> = {
  not_started: 'gray', drafting: 'brand', in_review: 'brand', feedback: 'amber', done: 'green'
};

export const RECENCY_LABEL: Record<RecencyBand, string> = {
  active: 'Active', check_in: 'Check in', reminder: 'Send a reminder', four_weeks: 'Four weeks quiet',
  five_weeks: 'Five weeks quiet', inactive: 'Inactive', not_started: 'No uploads yet'
};

export const RECENCY_ADVICE: Record<RecencyBand, string> = {
  active: 'Uploaded in the last two weeks.',
  check_in: 'Two weeks without an upload. Ask how it is going.',
  reminder: 'Three weeks without an upload. Send a clear reminder that you need an update.',
  four_weeks: 'Four weeks without an upload. Find out what is blocking the team, and whether their devices are syncing.',
  five_weeks: 'Five weeks without an upload. Talk to the team lead this week.',
  inactive: 'No uploads in 45 days or more.',
  not_started: 'Nothing has reached the server yet: still onboarding.'
};

export const RECENCY_TONE: Record<RecencyBand, Tone> = {
  active: 'green', check_in: 'amber', reminder: 'amber', four_weeks: 'red', five_weeks: 'red', inactive: 'gray', not_started: 'brand'
};

export const PACE_LABEL: Record<PaceBand | 'no_target', string> = {
  ahead: 'Ahead', on_pace: 'On pace', behind: 'Behind', stalled: 'Stalled', complete: 'Complete', no_target: 'No target set'
};

export const PACE_TONE: Record<PaceBand | 'no_target', Tone> = {
  ahead: 'green', on_pace: 'brand', behind: 'amber', stalled: 'red', complete: 'green', no_target: 'gray'
};

export const PACE_ADVICE: Record<PaceBand | 'no_target', string> = {
  ahead: 'More than 10 points ahead of a straight line to the target.',
  on_pace: 'Within 5 points behind to 10 points ahead of plan.',
  behind: 'More than 5 points behind, but the last eight weeks’ rate still finishes by the target date.',
  stalled: 'Behind, and at the last eight weeks’ rate it will not finish by the target date.',
  complete: 'The target is fully recorded.',
  no_target: 'Set a target on the language page to measure pace.'
};

/** "14–20 days", "45+ days". */
export function recencyDaysLabel(band: Exclude<RecencyBand, 'not_started'>): string {
  const [lo, hi] = RECENCY_DAYS[band];
  return `${lo}${Number.isFinite(hi) ? `–${hi}` : '+'} days`;
}
