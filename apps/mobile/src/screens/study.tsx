// Avatar U. Study guide (FIA) and one study step, before drafting.
// Placeholders (Phase 0 of docs/ux/mobbin-overhaul/CHECKLIST.md).
import type { Ctx } from '../ctx';
import { Placeholder } from './record';

export function StudyGuide(ctx: Ctx) {
  return <Placeholder ctx={ctx} id="study_guide" />;
}

export function StudyStep(ctx: Ctx) {
  return <Placeholder ctx={ctx} id="study_step" />;
}

import { contractsFor } from '../screenContracts';
export const contracts = contractsFor('study_guide', 'study_step');
