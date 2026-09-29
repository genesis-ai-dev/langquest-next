// Placeholder while this domain is being built.
import type { Ctx } from '../ctx';
import { EmptyState, Header, Screen } from '../kit';
import { TITLES } from '../flow';

export function StatusHome(ctx: Ctx) {
  return <Screen header={<Header title={TITLES.status_home} onBack={ctx.back} />}><EmptyState title="Coming soon" /></Screen>;
}

export function MapHome(ctx: Ctx) {
  return <Screen header={<Header title={TITLES.map_home} onBack={ctx.back} />}><EmptyState title="Coming soon" /></Screen>;
}

export function BookMap(ctx: Ctx) {
  return <Screen header={<Header title={TITLES.book_map} onBack={ctx.back} />}><EmptyState title="Coming soon" /></Screen>;
}

