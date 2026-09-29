// Placeholder while this domain is being built.
import type { Ctx } from '../ctx';
import { EmptyState, Header, Screen } from '../kit';
import { TITLES } from '../flow';

export function ReviewCapture(ctx: Ctx) {
  return <Screen header={<Header title={TITLES.review_capture} onBack={ctx.back} />}><EmptyState title="Coming soon" /></Screen>;
}

export function AddRecord(ctx: Ctx) {
  return <Screen header={<Header title={TITLES.add_record} onBack={ctx.back} />}><EmptyState title="Coming soon" /></Screen>;
}

export function GuestReview(ctx: Ctx) {
  return <Screen header={<Header title={TITLES.guest_review} onBack={ctx.back} />}><EmptyState title="Coming soon" /></Screen>;
}

