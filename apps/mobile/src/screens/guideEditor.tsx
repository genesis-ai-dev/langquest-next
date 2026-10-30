// Write a guide (app only; the editor is guides/GuideEditor.tsx), a screen
// of its own module so it loads the first time it is opened, not with the
// study screens: few people write guides, and the editor is one of the
// largest screens (src/shell/lazyScreens.tsx, scripts/export-web.mjs).
import type { Ctx } from '../shell/ctx';
import { contractsFor } from '../shell/screenContracts';
import { GuideEditorScreen } from '../guides/GuideEditor';

export function GuideEditor(ctx: Ctx) {
  return <GuideEditorScreen ctx={ctx} />;
}

export const contracts = contractsFor('guide_editor');
