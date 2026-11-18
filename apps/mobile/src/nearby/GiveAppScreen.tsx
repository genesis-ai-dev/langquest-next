import { t } from '../i18n';
import type { Ctx } from '../shell/ctx';
import { Banner, Header, Screen } from '../ui/kit';

/**
 * Give the app (docs/nearby-sync-plan.md 14.5) where it cannot run: the web and an iPhone, which
 * cannot hand over an Android install file. Nothing opens it there (its ways in are Android's), but
 * the screen exists everywhere, so it says what to do instead. The screen is
 * GiveAppScreen.android.tsx.
 */
export function GiveAppScreen(ctx: Ctx) {
  return (
    <Screen header={<Header title={t('screens.give_app')} onBack={ctx.back} />}>
      <Banner icon="info" tone="amber" title={t('nearby.give.unsupported')} />
    </Screen>
  );
}
