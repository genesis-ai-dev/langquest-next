// Placeholder while this domain is being built.
import type { Ctx } from '../ctx';
import { EmptyState, Header, Screen } from '../kit';
import { TITLES } from '../flow';

export function PassageRecord(ctx: Ctx) {
  return <Screen header={<Header title={TITLES.passage_record} onBack={ctx.back} />}><EmptyState title="Coming soon" /></Screen>;
}

export function VersionDetail(ctx: Ctx) {
  return <Screen header={<Header title={TITLES.version_detail} onBack={ctx.back} />}><EmptyState title="Coming soon" /></Screen>;
}

export function ReviewDetail(ctx: Ctx) {
  return <Screen header={<Header title={TITLES.review_detail} onBack={ctx.back} />}><EmptyState title="Coming soon" /></Screen>;
}

export function AskSomeone(ctx: Ctx) {
  return <Screen header={<Header title={TITLES.ask_someone} onBack={ctx.back} />}><EmptyState title="Coming soon" /></Screen>;
}

