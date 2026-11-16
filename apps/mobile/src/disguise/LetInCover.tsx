import { t } from '../i18n';
import { Text } from '../ui/text';
import { txt } from '../ui/textStyles';
import './disguiseWords';

/**
 * Joining without internet on a phone that wears a cover (docs/nearby-sync-plan.md 14.4): one more
 * line on each of two screens. Let someone in (`look`) says the new phone will show the app until
 * its person chooses another look under More settings; Get the install file (`file`) says the
 * browser that got the file keeps where it came from. Nothing about a cover crosses the link, and
 * the help lines every carrier sees say nothing of one (decision 171's amendment of 2026-10-29).
 */
export function LetInCover(props: { worn: boolean; part: 'look' | 'file' }) {
  if (!props.worn) return null;
  return <Text style={txt.smMuted}>{t(props.part === 'look' ? 'disguise.nearby.letInLook' : 'disguise.nearby.apkTrace')}</Text>;
}
