// Placeholder while this domain is being built.
import type { Ctx } from '../ctx';
import { EmptyState, Header, Screen } from '../kit';
import { TITLES } from '../flow';

export function Workspace(ctx: Ctx) {
  return <Screen header={<Header title={TITLES.workspace} onBack={ctx.back} />}><EmptyState title="Coming soon" /></Screen>;
}

export function BackTranslation(ctx: Ctx) {
  return <Screen header={<Header title={TITLES.back_translation} onBack={ctx.back} />}><EmptyState title="Coming soon" /></Screen>;
}

