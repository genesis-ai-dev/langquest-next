import { t } from '../i18n';
import type { Ctx } from '../shell/ctx';
import { Card, Header, Screen } from '../ui/kit';
import { Text } from '../ui/text';
import { txt } from '../ui/textStyles';

/**
 * Get the install file (docs/nearby-sync-plan.md 14.4) where it cannot run: the web and an iPhone,
 * which name no install file. Nothing opens it there (its ways in are Android's), but the screen
 * exists everywhere, so it says what the file is for, as the Android screen does with no file to
 * name. The screen is GetInstallFileScreen.android.tsx.
 */
export function GetInstallFileScreen(ctx: Ctx) {
  return (
    <Screen header={<Header title={t('screens.get_install_file')} onBack={ctx.back} />}>
      <Card>
        <Text style={txt.sm}>{t('nearby.installFile.intro')}</Text>
      </Card>
    </Screen>
  );
}
