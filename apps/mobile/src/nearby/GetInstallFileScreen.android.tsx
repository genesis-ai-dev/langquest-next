import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { t } from '../i18n';
import type { Ctx } from '../shell/ctx';
import { LetInCoverNote } from '../shell/LetInCoverNote';
import { useAppCovered } from '../shell/useAppCovered';
import { Banner, Card, GhostBtn, Header, Ico, PrimaryBtn, Screen } from '../ui/kit';
import { Text } from '../ui/text';
import { txt } from '../ui/textStyles';
import { C, space, TINT } from '../ui/theme';
import { apkGet, apkShown, apkStep, type KeepResult } from './carriedApkModel';
import { NearbyIntro } from './NearbyIntro';
import { useCarriedApk } from './useCarriedApk';

/**
 * Download the install file (`get_install_file`), from Share nearby, Let someone in and Sync: the
 * job done online before a trip. Its main button follows the job (`apkStep`): the browser download
 * while online; then, once the person has gone to get it, choosing the downloaded file, which
 * checks it and keeps a copy for Give the app, with the download offered again beside it; and none
 * once the file is in hand, when a green line says it is ready. Check my file stays for a file got
 * another way. The file's name shows only when a wrong one is chosen, since the app checks the
 * file, not the person. Last, how the file reaches the new phone. Nothing here downloads or
 * installs anything.
 */
export function GetInstallFileScreen(ctx: Ctx) {
  const apk = useCarriedApk();
  const { worn } = useAppCovered();
  const get = apkGet({ needed: apk.needed, url: apk.url, online: ctx.language.online });
  const step = apkStep({ needed: apk.needed, opened: apk.opened, kept: apk.kept, canGive: apk.canGive, right: apk.right });
  const keeping = apk.checked?.keep === 'keeping';
  // What is said of a file in hand: a copy kept, or why this phone keeps none.
  const inHand: KeepResult = apk.cannotGive === 'android' ? 'needs-android' : apk.cannotGive === 'update' ? 'needs-update' : 'kept';
  const footer = step === 'choose'
    ? <PrimaryBtn label={t('nearby.letIn.choose')} icon="folder" disabled={keeping} help={t('nearby.letIn.chooseHelp')} onPress={apk.actions.check} />
    : step === 'get' && get !== null
      ? <PrimaryBtn label={t('nearby.letIn.get')} icon="download" disabled={get === 'offline'} help={t('nearby.letIn.getHelp')} onPress={apk.actions.get} />
      : undefined;
  const waiting = step !== null && step !== 'done';
  return (
    <Screen header={<Header title={t('screens.get_install_file')} onBack={ctx.back} />} footer={footer}>
      <NearbyIntro icon="download" text={t('nearby.installFile.intro')} />
      {apk.needed !== null ? (
        <>
          {waiting && (apk.stale || get === 'offline') ? (
            <Card>
              {apk.stale ? (
                <View style={styles.line}>
                  <Ico name="warning" size={20} color={TINT.amberText} />
                  <Text style={[txt.sm, { flex: 1 }]}>{t('nearby.installFile.old')}</Text>
                </View>
              ) : null}
              {get === 'offline' ? <Text style={[txt.sm, { color: TINT.amberText }]}>{t('nearby.letIn.getOffline')}</Text> : null}
            </Card>
          ) : null}
          {step === 'done' ? <Banner icon="check" tone="green" title={t('nearby.installFile.done')} body={t(KEEP_WORDS[inHand])} /> : null}
          {waiting ? (
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
              {apk.checked?.result === 'other' ? (
                <View style={styles.line}>
                  <Ico name="warning" size={20} color={TINT.amberText} />
                  <View style={{ flex: 1 }}>
                    <Text style={txt.sm}>{t('nearby.letIn.checkOther', { file: apkShown(apk.needed) })}</Text>
                    <Text style={txt.smMuted}>{t('nearby.letIn.checkChose', { name: apk.checked.name })}</Text>
                  </View>
                </View>
              ) : null}
              {/* A right name: only what keeping it came to, since a kept copy says the rest. */}
              {apk.checked?.result === 'right' && apk.checked.keep ? <KeepLine keep={apk.checked.keep} /> : null}
            </Card>
          ) : null}
          <Card>
            <Text style={txt.sm}>{t(apk.canGive ? 'nearby.letIn.getLine' : 'nearby.letIn.getLineOther')}</Text>
            {/* Only a phone that keeps no copy has one file to delete later: the one in Downloads. */}
            {apk.canGive ? null : <Text style={txt.smMuted}>{t('nearby.letIn.fileHelp')}</Text>}
            <LetInCoverNote worn={worn} part="file" />
          </Card>
        </>
      ) : null}
    </Screen>
  );
}

/** What keeping a copy of the chosen file came to, or why this phone keeps none (14.5). */
const KEEP_WORDS = {
  keeping: 'nearby.letIn.keep.keeping',
  kept: 'nearby.letIn.keep.kept',
  'not-ours': 'nearby.letIn.keep.notOurs',
  'no-space': 'nearby.letIn.keep.noSpace',
  unreadable: 'nearby.letIn.keep.unreadable',
  failed: 'nearby.letIn.keep.failed',
  'needs-android': 'nearby.letIn.keep.needsAndroid',
  'needs-update': 'nearby.letIn.keep.needsUpdate'
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
