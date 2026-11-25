import { useEffect, useSyncExternalStore } from 'react';
import { ActivityIndicator, AppState, StyleSheet, View } from 'react-native';
import { t } from '../i18n';
import { formatDayYear } from '../i18n/format';
import type { Ctx } from '../shell/ctx';
import { LetInCoverNote } from '../shell/LetInCoverNote';
import { useAppCovered } from '../shell/useAppCovered';
import { Banner, Card, GhostBtn, Header, Ico, PrimaryBtn, Screen } from '../ui/kit';
import { Text } from '../ui/text';
import { txt } from '../ui/textStyles';
import { C, space, TINT } from '../ui/theme';
import { apkGet, apkShown, apkStep, type KeepResult } from './carriedApkModel';
import { handedFileNow, subscribeHandedFile, takeHandedFile } from './handedFile';
import { apkOffer } from './installFileOfferModel';
import { NearbyIntro } from './NearbyIntro';
import { useCarriedApk } from './useCarriedApk';

/**
 * Download the install file (`get_install_file`), from Share nearby, Let someone in and Sync: the
 * job done online before a trip. Its main button follows the job (`apkStep`): the browser download
 * while online; then, once the person has gone to get it, choosing the downloaded file, which
 * checks it and keeps a copy for Give the app, with the download offered again beside it; and none
 * once the file is in hand, when a green line says it is ready. Each step's other way on (Check
 * my file, Download it again, Choose the downloaded file) sits under its main button in the
 * footer. Before the browser opens, numbered steps say what follows: the browser downloads the
 * file, may warn that it is harmful, then back to LangQuest without opening it, and choose it. On
 * a build the browser can hand the file to (`handOff`), the browser downloads it as the app's own
 * type, with no warning, and its Open brings it here: this screen takes it (src/nearby/handedFile.android.ts)
 * and checks and keeps it as one chosen, and the steps say to tap Open, or to come back and choose
 * it if Open has gone (docs/decisions/0246-a-carried-build-is-the-newcomers.md, amended 2026-11-20).
 * While online, a copy older than the file the Worker serves (or, where it does not say, two days
 * behind this phone's app) says a newer file is ready, and
 * Download in the browser is the main button again, with Choose the downloaded file under it (`keptOutdated`,
 * docs/decisions/2026-11-19-carried-build-refreshed-daily.md, amended 2026-11-25). Choose a file you already have (Check my file until 2026-11-19) stays for a file got
 * another way. The file's name shows only when a wrong one is chosen, since the app checks the
 * file, not the person; the ready line names the day the kept copy was built. With the file in
 * hand and nothing newer known, the screen offers no download, a file the browser just handed
 * over included; a file handed over or chosen that did not check is offered again (`apkOffer`,
 * Carl, 2026-11-24, in place of Download the newest file from 2026-11-20). Coming back to the
 * front, as from the browser, it reads what the phone keeps again. Last, how the file reaches the
 * new phone. Nothing here downloads or installs anything.
 */
export function GetInstallFileScreen(ctx: Ctx) {
  const apk = useCarriedApk();
  const { worn } = useAppCovered();
  // A file the browser's Open handed over: taken once, and checked and kept here, which shows what came of it.
  const handed = useSyncExternalStore(subscribeHandedFile, handedFileNow);
  const { take, reread } = apk.actions;
  useEffect(() => {
    if (handed === null) return;
    const uri = takeHandedFile();
    if (uri) take(uri);
  }, [handed, take]);
  // Back in front, as from the browser: what the phone keeps is read again, so the screen shows the copy it holds now.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => { if (state === 'active') reread(); });
    return () => sub.remove();
  }, [reread]);
  const get = apkGet({ needed: apk.needed, url: apk.url, online: ctx.language.online });
  const step = apkStep({ needed: apk.needed, opened: apk.opened, kept: apk.kept, canGive: apk.canGive, right: apk.right });
  const keeping = apk.checked?.keep === 'keeping';
  // What is said of a file in hand: a copy kept, or why this phone keeps none.
  const inHand: KeepResult = apk.cannotGive === 'android' ? 'needs-android' : apk.cannotGive === 'update' ? 'needs-update' : 'kept';
  // What there is to do (`apkOffer`): the step's own way while no file is in hand; with one, a newer
  // file while one is known and can be downloaded, the file again when the one handed over or
  // chosen did not check, and else nothing: a file in hand is not offered again (Carl, 2026-11-24).
  const offer = apkOffer({ step, get, behind: apk.behind, checked: apk.checked });
  const newer = offer === 'newer';
  // The step's two ways on sit together in the footer, the main one and under it the other, as on
  // Give the app and Let someone in (Carl, 2026-11-19): getting the file and choosing it are one job.
  const download = (label: string, help: string, primary: boolean) => {
    const Btn = primary ? PrimaryBtn : GhostBtn;
    return <Btn label={label} icon="download" disabled={get === 'offline'} help={help} onPress={apk.actions.get} />;
  };
  const choose = (label: string, help: string, primary: boolean) => {
    const Btn = primary ? PrimaryBtn : GhostBtn;
    return <Btn label={label} icon="folder" disabled={keeping} help={help} onPress={apk.actions.check} />;
  };
  // A file that did not check is chosen again, as after the browser, or downloaded again.
  const buttons = newer
    ? [download(t('nearby.letIn.get'), t('nearby.letIn.getHelp'), true), choose(t('nearby.letIn.choose'), t('nearby.letIn.chooseHelp'), false)]
    : offer === 'choose' || offer === 'again'
      ? [choose(t('nearby.letIn.choose'), t('nearby.letIn.chooseHelp'), true), get !== null ? download(t('nearby.letIn.getAgain'), t('nearby.letIn.getAgainHelp'), false) : null]
      : offer === 'get'
        // With no address to download from (a development build), Choose a file you already have is all there is.
        ? [get !== null ? download(t('nearby.letIn.get'), t('nearby.letIn.getHelp'), true) : null, choose(t('nearby.letIn.check'), t('nearby.letIn.checkHelp'), false)]
        : [];
  const [first, second] = buttons;
  const footer = first || second ? <>{first}{second}</> : undefined;
  const waiting = step !== null && step !== 'done';
  // What is in hand, and when the kept copy was built, so the carrier sees how old it is (Carl, 2026-11-20).
  // A date names nothing, so it shows on a phone that wears a cover too.
  const builtMs = inHand === 'kept' ? apk.kept?.builtMs : null;
  const heldWords = typeof builtMs === 'number' ? t('nearby.letIn.keep.keptBuilt', { date: formatDayYear(builtMs) }) : t(KEEP_WORDS[inHand]);
  // What the card between them says: when to choose, that a newer file is ready, and what a choice came to.
  const line = newer ? t('nearby.installFile.newer') : offer === 'choose' ? t(apk.handOff ? 'nearby.letIn.chooseLineOpen' : 'nearby.letIn.chooseLine') : null;
  // What happens after Download in the browser, before it is pressed. Where the browser hands the
  // file over: it downloads, Open brings it to LangQuest, and if Open has gone, come back and choose
  // it (Carl, 2026-11-20). Elsewhere: the browser, its warning on an app file, coming back, and
  // choosing the file (Carl, 2026-11-19), not opening it, which on this phone offers to install the
  // carried build over the app.
  const chooseLabel = t('nearby.letIn.choose');
  const steps = (newer || offer === 'get') && get !== null ? (apk.handOff ? [
    t('nearby.letIn.getSteps.browser'),
    t('nearby.letIn.getSteps.open'),
    t('nearby.letIn.getSteps.openGone', { button: chooseLabel })
  ] : [
    t('nearby.letIn.getSteps.browser'),
    t('nearby.letIn.getSteps.warning'),
    t('nearby.letIn.getSteps.back'),
    t('nearby.letIn.getSteps.choose', { button: chooseLabel })
  ]) : null;
  const wrong = apk.checked?.result === 'other' ? apk.checked : null;
  const kept = apk.checked?.result === 'right' ? apk.checked.keep ?? null : null;
  // With a file in hand, what a file handed over or chosen came to shows while it is kept, or when
  // it failed; once kept, the green line names the new copy's day, which says it is here.
  const told = waiting || offer !== null || keeping;
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
          {step === 'done' ? <Banner icon="check" tone="green" title={t('nearby.installFile.done')} body={heldWords} /> : null}
          {told && (line || steps || wrong || kept) ? (
            <Card>
              {line ? <Text style={txt.sm}>{line}</Text> : null}
              {steps ? (
                <View style={{ gap: space.xs }}>
                  <Text style={[txt.sm, { fontWeight: '700' }]}>{t('nearby.letIn.getSteps.lead', { button: t('nearby.letIn.get') })}</Text>
                  {steps.map((label, i) => <Text key={label} style={txt.sm}>{t('nearby.step', { n: i + 1, label })}</Text>)}
                </View>
              ) : null}
              {wrong ? (
                <View style={styles.line}>
                  <Ico name="warning" size={20} color={TINT.amberText} />
                  <View style={{ flex: 1 }}>
                    <Text style={txt.sm}>{t('nearby.letIn.checkOther', { file: apkShown(apk.needed) })}</Text>
                    <Text style={txt.smMuted}>{t('nearby.letIn.checkChose', { name: wrong.name })}</Text>
                  </View>
                </View>
              ) : null}
              {/* A right name: only what keeping it came to, since a kept copy says the rest. */}
              {kept ? <KeepLine keep={kept} /> : null}
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
