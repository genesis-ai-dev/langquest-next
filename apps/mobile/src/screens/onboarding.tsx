// Placeholder while this domain is being built.
import type { Ctx } from '../ctx';
import { EmptyState, Header, Screen } from '../kit';
import { TITLES } from '../flow';

export function Welcome(ctx: Ctx) {
  return <Screen header={<Header title={TITLES.welcome} onBack={ctx.back} />}><EmptyState title="Coming soon" /></Screen>;
}

