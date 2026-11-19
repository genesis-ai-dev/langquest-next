import { languageName } from '@langquest-next/core';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '../ui/text';
import type { Ctx } from '../shell/ctx';
import type { InstallItem } from '../nearby/carriedApkModel';
import { HelpInfo, LinkBtn, ProgressBar, type IconName } from '../ui/kit';
import { txt } from '../ui/textStyles';
import { endsSentence } from '../helpMode/helpContext';
import { t } from '../i18n';
import { STUDY_FILES_OFFLINE } from '../study/studyFiles';
import { C, onColor, space, TINT } from '../ui/theme';
import { Block } from './offline';
import { installBlock } from './syncScreenModel';
import { offlineLine, sentences, type OfflineOverview } from './offlineText';
import { isOffline } from './uploadsModel';

/**
 * Inside Sync's Ready for offline fold (decisions.md 61, docs/decisions/2026-11-18-sync-and-offline-one-screen.md):
 * what to pack before a trip, as a short list. Kept passages: how many are on this device, with
 * the first download's progress while it runs (decisions.md 147) and the recordings no device
 * can fetch yet. The install file, for someone who can let a new person in (`installFileItem`):
 * never got, too old, downloaded but not chosen, or ready, with the next step (`installBlock`).
 * Then what always works offline and what needs a connection, folded, since it never changes.
 */
export function ReadyForOffline(props: { ctx: Ctx; s: OfflineOverview | null; install: InstallItem | null; installKeeps: boolean }) {
  const { ctx, s } = props;
  const [always, setAlways] = useState(false);
  const offline = isOffline(ctx.language.online);
  const install = props.install ? installBlock(props.install, props.installKeeps, offline) : null;
  const fill = ctx.language.fill;
  const filling = !!fill && fill.total > 0 && fill.filled < fill.total;
  const ready = !!s && s.kept > 0 && s.ready === s.kept;
  const language = ctx.languageId ? languageName(ctx.org.state, ctx.languageId) : t('offline.card.thisLanguage');
  const head = ready && !filling
    ? { icon: 'onPhone' as IconName, tint: onColor.green, bg: TINT.green }
    : (s?.kept || filling) && !offline ? { icon: 'download' as IconName, tint: C.primary, bg: C.light }
    : { icon: 'notOnPhone' as IconName, tint: TINT.amberText, bg: TINT.amber };
  const finish = filling || (s && s.kept && !ready) ? (offline ? t('offline.connectToFinish') : t('offline.stayConnected')) : null;
  // The first download outranks the kept count: until it ends, a passage may not be here at all (decisions.md 147).
  const line = filling ? t('offline.fill.count', { filled: fill.filled, total: fill.total }) : offlineLine(s);
  return (
    <View style={styles.list}>
      <Block icon={head.icon} tint={head.tint} bg={head.bg} title={t('offline.card.keptTitle')}
        body={sentences(endsSentence(line) ? line : t('offline.card.lineAsSentence', { line }), finish)} />
      {filling ? (
        <HelpInfo label={t('offline.fill.title')} detail={t('offline.fill.barHelp')}>
          <ProgressBar value={(fill.filled / fill.total) * 100} />
        </HelpInfo>
      ) : s && s.kept ? (
        <HelpInfo label={t('offline.card.keptTitle')} detail={t('offline.card.barHelp')}>
          <ProgressBar value={(s.ready / s.kept) * 100} {...(ready ? { color: onColor.green } : {})} />
        </HelpInfo>
      ) : null}
      {s && s.notSent ? <Text style={txt.xs}>{t('offline.card.notSent', { count: s.notSent })}</Text> : null}
      {install ? (
        <>
          <Block icon={install.good ? 'check' : 'warning'} tint={install.good ? onColor.green : TINT.amberText} bg={install.good ? TINT.green : TINT.amber}
            title={t('nearby.installFile.title')} body={install.body} />
          {install.way === 'offline' ? <Text style={[txt.xs, { color: TINT.amberText }]}>{t('nearby.letIn.getOffline')}</Text>
            : install.way !== null ? (
              <LinkBtn label={install.way === 'choose' ? t('nearby.letIn.choose') : t('screens.get_install_file')} help={t('nearby.installFile.linkHelp')}
                onPress={() => ctx.go('get_install_file')} style={{ alignSelf: 'flex-start' }} />
            ) : null}
        </>
      ) : null}
      <LinkBtn label={t('offline.card.worksOffline')} help={t('offline.card.worksOfflineHelp')} expanded={always}
        onPress={() => setAlways((o) => !o)} style={{ alignSelf: 'flex-start' }} />
      {always ? (
        <>
          <Block icon="check" tint={onColor.green} bg={TINT.green} title={t('offline.card.alwaysTitle')}
            body={STUDY_FILES_OFFLINE ? t('offline.card.alwaysBodyStudy', { language }) : t('offline.card.alwaysBody', { language })} />
          <Block icon="cloud" tint={TINT.amberText} bg={TINT.amber} title={t('offline.card.needsTitle')}
            body={[
              STUDY_FILES_OFFLINE ? t('offline.card.needsNotDownloadedStudy') : t('offline.card.needsNotDownloaded'),
              STUDY_FILES_OFFLINE ? t('offline.card.needsFilms') : t('offline.card.needsStudyWeb'),
              t('offline.card.needsReports'),
              t('offline.card.needsOtherLanguages')
            ].map((l) => t('offline.card.bullet', { line: l })).join('\n')} />
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { padding: space.lg, gap: space.md }
});
