import { t } from '../i18n';
import type { Ctx } from '../shell/ctx';
import { Header, Screen } from '../ui/kit';
import { NearbyIntro } from './NearbyIntro';

/**
 * Download the install file (docs/nearby-sync-plan.md 14.4) where it cannot run: the web and an
 * iPhone, which name no install file. Nothing opens it there (its ways in are Android's), but the
 * screen exists everywhere, so it says what the file is for, as the Android screen does with no
 * file to name. The screen is GetInstallFileScreen.android.tsx.
 */
export function GetInstallFileScreen(ctx: Ctx) {
  return (
    <Screen header={<Header title={t('screens.get_install_file')} onBack={ctx.back} />}>
      <NearbyIntro icon="download" text={t('nearby.installFile.intro')} />
    </Screen>
  );
}
