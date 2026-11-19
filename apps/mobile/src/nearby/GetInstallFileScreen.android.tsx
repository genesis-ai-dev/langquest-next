import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { t } from '../i18n';
import type { Ctx } from '../shell/ctx';
import { LetInCoverNote } from '../shell/LetInCoverNote';
import { useAppCovered } from '../shell/useAppCovered';
import { Badge, Card, GhostBtn, Header, Ico, PrimaryBtn, Screen } from '../ui/kit';
import { Text } from '../ui/text';
import { txt } from '../ui/textStyles';
import { C, space, TINT } from '../ui/theme';
import { apkGet, apkShown, apkStart, apkStep, type KeepResult } from './carriedApkModel';
import { useCarriedApk } from './useCarriedApk';

/**
 * Get the install file, from Share nearby and Let someone in: the job done online before a trip.
 * The carried build this phone's versions need, by its exact name, so a carrier can compare it with
 * the file they hold; a word when the file they got before is for an older version; and how the
 * file reaches the new phone. Its main button follows the job (`apkStep`): the browser download
 * while online, then, once they have gone to get it, choosing the downloaded file, which checks it
 * and keeps a copy for Give the app, with the download offered again beside it; none once the file
 * is in hand. Check my file stays for a file got another way. Nothing here downloads or installs anything.
 */
export function GetInstallFileScreen(ctx: Ctx) {
  const apk = useCarriedApk();
  const { worn } = useAppCovered();
  const get = apkGet({ needed: apk.needed, url: apk.url, online: ctx.language.online });
  const step = apkStep({ needed: apk.needed, opened: apk.opened, kept: apk.kept, canGive: apk.canGive, right: apk.checked?.result === 'right' });
  const keeping = apk.checked?.keep === 'keeping';
  // What keeping the chosen file came to this visit, or a copy kept on an earlier one.
  const keep = apk.checked?.keep ?? (step === 'done' && apk.kept ? 'kept' : undefined);
  const footer = step === 'choose'
    ? <PrimaryBtn label={t('nearby.letIn.choose')} icon="folder" disabled={keeping} help={t('nearby.letIn.chooseHelp')} onPress={apk.actions.check} />
    : step === 'get' && get !== null
      ? <PrimaryBtn label={t('nearby.letIn.get')} icon="download" disabled={get === 'offline'} help={t('nearby.letIn.getHelp')} onPress={apk.actions.get} />
      : undefined;
  return (
    <Screen header={<Header title={t('screens.get_install_file')} onBack={ctx.back} />} footer={footer}>
      <Card>
        <View style={styles.line}>
          <Ico name="download" size={22} color={C.primary} />
          <Text style={[txt.body, { flex: 1, fontWeight: '700' }]}>{t('screens.get_install_file')}</Text>
          <Badge label={t('nearby.experimental')} tone="amber" />
        </View>
        <Text style={txt.sm}>{t('nearby.installFile.intro')}</Text>
      </Card>
      {apk.needed !== null ? (
        <>
          <Card>
            <Text style={txt.body}>{t('nearby.letIn.file', { file: apkShown(apk.needed) })}</Text>
            <Text style={txt.sm}>{t('nearby.letIn.fileStart', { start: apkStart(apk.needed) })}</Text>
            {apk.stale ? (
              <View style={styles.line}>
                <Ico name="warning" size={20} color={TINT.amberText} />
                <Text style={[txt.sm, { flex: 1 }]}>{t('nearby.letIn.fileOld')}</Text>
              </View>
            ) : null}
            {get === 'offline' ? <Text style={[txt.sm, { color: TINT.amberText }]}>{t('nearby.letIn.getOffline')}</Text> : null}
          </Card>
          <Card>
            {step === 'choose' ? (
              <>
                <Text style={txt.sm}>{t('nearby.letIn.chooseLine')}</Text>
                {get !== null ? (
                  <GhostBtn label={t('nearby.letIn.getAgain')} icon="download" disabled={get === 'offline'} help={t('nearby.letIn.getAgainHelp')} onPress={apk.actions.get} />
                ) : null}
              </>
            ) : (
              <GhostBtn label={t('nearby.letIn.check')} icon="folder" help={t('nearby.letIn.checkHelp')} onPress={apk.actions.check} disabled={keeping} />
            )}
            {apk.checked ? (
              <View style={styles.line}>
                <Ico name={apk.checked.result === 'right' ? 'check' : 'warning'} size={20} color={apk.checked.result === 'right' ? TINT.greenText : TINT.amberText} />
                <View style={{ flex: 1 }}>
                  <Text style={txt.sm}>{apk.checked.result === 'right' ? t('nearby.letIn.checkRight') : t('nearby.letIn.checkOther', { file: apkShown(apk.needed) })}</Text>
                  <Text style={txt.smMuted}>{t('nearby.letIn.checkChose', { name: apk.checked.name })}</Text>
                </View>
              </View>
            ) : null}
            {keep ? <KeepLine keep={keep} /> : null}
          </Card>
          <Card>
            <Text style={txt.sm}>{t('nearby.letIn.getLine')}</Text>
            <Text style={txt.smMuted}>{t('nearby.letIn.fileHelp')}</Text>
            <LetInCoverNote worn={worn} part="file" />
          </Card>
        </>
      ) : null}
    </Screen>
  );
}

/** What keeping a copy of the chosen file came to, under Check my file (14.5). */
const KEEP_WORDS = {
  keeping: 'nearby.letIn.keep.keeping',
  kept: 'nearby.letIn.keep.kept',
  'not-ours': 'nearby.letIn.keep.notOurs',
  'no-space': 'nearby.letIn.keep.noSpace',
  unreadable: 'nearby.letIn.keep.unreadable',
  failed: 'nearby.letIn.keep.failed',
  unsupported: 'nearby.letIn.keep.unsupported'
} as const satisfies Record<KeepResult, string>;

function KeepLine(props: { keep: KeepResult }) {
  const { keep } = props;
  const good = keep === 'kept';
  return (
    <View style={styles.line}>
      {keep === 'keeping' ? <ActivityIndicator color={C.primary} />
        : <Ico name={good ? 'check' : 'warning'} size={20} color={good ? TINT.greenText : TINT.amberText} />}
      <Text style={[txt.sm, { flex: 1 }]}>{t(KEEP_WORDS[keep])}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  line: { flexDirection: 'row', alignItems: 'center', gap: space.md }
});
