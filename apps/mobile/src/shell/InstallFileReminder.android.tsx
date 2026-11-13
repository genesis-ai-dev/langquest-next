import { View } from 'react-native';
import { t } from '../i18n';
import { APK_REMINDER_WORDS, apkReminder } from '../nearby/carriedApkModel';
import { useCarriedApk } from '../nearby/useCarriedApk';
import { useLetInOffered } from '../nearby/useLetIn';
import { HelpInfo, Ico, LinkBtn } from '../ui/kit';
import { Text } from '../ui/text';
import { txt } from '../ui/textStyles';
import { space, TINT } from '../ui/theme';
import type { Ctx } from './ctx';

/**
 * The install file line on Sync's Ready for offline card (docs/nearby-sync-plan.md 14.4,
 * "Reminded while online"): for someone Share nearby shows A new person to, while online, and only
 * while this phone has not got the file it needs now, never or for an older version
 * (`apkReminder`). Get it opens Get the install file; the line goes once the right file is got.
 */
export function InstallFileReminder(props: { ctx: Ctx }) {
  const { ctx } = props;
  const letIn = useLetInOffered(ctx);
  const apk = useCarriedApk();
  const reminder = apkReminder({ letIn, needed: apk.needed, url: apk.url, opened: apk.opened, online: ctx.language.online });
  if (reminder === null) return null;
  const line = t(APK_REMINDER_WORDS[reminder]);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
      <HelpInfo label={line} detail={t('nearby.installFile.lineHelp')} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <Ico name="warning" size={20} color={TINT.amberText} />
        <Text style={[txt.sm, { flex: 1 }]}>{line}</Text>
      </HelpInfo>
      <LinkBtn label={t('nearby.installFile.getIt')} help={t('nearby.installFile.linkHelp')} onPress={() => ctx.go('get_install_file')} />
    </View>
  );
}
