// Avatar U for the passage record and the work screens; Avatar P for Ask someone and Log what happened.
// Placeholders (Phase 0 of docs/ux/mobbin-overhaul/CHECKLIST.md): each shows
// its passage and says it is not wired yet. Later phases build them out.
import type { Ctx } from '../ctx';
import { TITLES, type ScreenId } from '../flow';
import { Header, NotWired, Screen } from '../pui';

/** The passage a screen is about, from `unitId` in its params. */
export function passageLabel(ctx: Ctx): string {
  const unitId = ctx.params['unitId'] ?? '';
  return ctx.project.state?.units[unitId]?.label ?? unitId;
}

export function Placeholder(props: { ctx: Ctx; id: ScreenId }) {
  return (
    <Screen>
      <Header title={TITLES[props.id]} sub={passageLabel(props.ctx) || undefined} onBack={props.ctx.back} />
      <NotWired what={TITLES[props.id]} />
    </Screen>
  );
}

export function PassageRecord(ctx: Ctx) {
  return <Placeholder ctx={ctx} id="passage_record" />;
}

export function AskSomeone(ctx: Ctx) {
  return <Placeholder ctx={ctx} id="ask_someone" />;
}

export function AddRecord(ctx: Ctx) {
  return <Placeholder ctx={ctx} id="add_record" />;
}

export function Workspace(ctx: Ctx) {
  return <Placeholder ctx={ctx} id="workspace" />;
}

export function ReviewCapture(ctx: Ctx) {
  return <Placeholder ctx={ctx} id="review_capture" />;
}

export function BackTranslate(ctx: Ctx) {
  return <Placeholder ctx={ctx} id="back_translation" />;
}

import { contractsFor } from '../screenContracts';
export const contracts = contractsFor('passage_record', 'ask_someone', 'add_record', 'workspace', 'review_capture', 'back_translation');
