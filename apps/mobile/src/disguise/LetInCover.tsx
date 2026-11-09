import { t } from '../i18n';
import { Text } from '../ui/text';
import { txt } from '../ui/textStyles';
import './disguiseWords';

/**
 * Let someone in on a phone that wears a cover (docs/nearby-sync-plan.md 14.4): two more lines, on
 * this screen only: the new phone will show the app until its person chooses another look under
 * More settings, and the browser that got the install file keeps where it came from. Nothing about
 * a cover crosses the link, and the help lines every carrier sees say nothing of one (decision
 * 171's amendment of 2026-10-29).
 */
export function LetInCover(props: { worn: boolean }) {
  if (!props.worn) return null;
  return (
    <>
      <Text style={txt.smMuted}>{t('disguise.nearby.letInLook')}</Text>
      <Text style={txt.smMuted}>{t('disguise.nearby.apkTrace')}</Text>
    </>
  );
}
