// Placeholder while this domain is being built.
import type { Ctx } from '../ctx';
import { EmptyState, Header, Screen } from '../kit';
import { TITLES } from '../flow';

export function StudyGuide(ctx: Ctx) {
  return <Screen header={<Header title={TITLES.study_guide} onBack={ctx.back} />}><EmptyState title="Coming soon" /></Screen>;
}

export function StudyStep(ctx: Ctx) {
  return <Screen header={<Header title={TITLES.study_step} onBack={ctx.back} />}><EmptyState title="Coming soon" /></Screen>;
}

