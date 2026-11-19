import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { t } from '../i18n';
import { formatNumber } from '../i18n/format';
import type { Ctx } from '../shell/ctx';
import { LetInCoverNote } from '../shell/LetInCoverNote';
import { Banner, Card, GhostBtn, Header, LinkBtn, PrimaryBtn, ProgressBar, Screen } from '../ui/kit';
import { Text } from '../ui/text';
import { txt } from '../ui/textStyles';
import { C, space, TINT } from '../ui/theme';
import { megabytes, pageAddress, sentShown, wifiCode, type GiveEnd, type GiveFail } from './giveAppModel';
import { LetInCode } from './LetInCode';
import { NearbyIntro } from './NearbyIntro';
import { useGiveApp } from './useGiveApp';

const GIVE_END = {
  stopped: 'nearby.give.ended.stopped',
  idle: 'nearby.give.ended.idle',
  phone: 'nearby.give.ended.phone'
} as const satisfies Record<GiveEnd, string>;

const GIVE_FAIL = {
  'wifi-off': 'nearby.give.failed.wifiOff',
  permission: 'nearby.give.failed.permission',
  blocked: 'nearby.permission.settings',
  'permission-covered': 'nearby.give.failed.permissionCovered',
  busy: 'nearby.give.failed.busy',
  'no-file': 'nearby.give.noFile',
  failed: 'nearby.give.failed.failed'
} as const satisfies Record<GiveFail, string>;

/**
 * Give the app, from Share nearby's A new person and Let someone in: this phone makes its own
 * Wi-Fi network and serves the kept install file from a small page, so a new phone gets LangQuest
 * with no internet and no Google services on either phone. Three numbered steps: code 1 joins the
 * network, code 2 opens the page, and once the file is sent, installing it; then the way on to Let
 * someone in. Both codes come back under Give it to another phone. The app downloads nothing: the
 * file is the copy kept when the person chose it. Android only; elsewhere a stub.
 */
export function GiveAppScreen(ctx: Ctx) {
  const give = useGiveApp();
  const { stage, giving, kept, actions, worn } = give;
  const live = stage.t === 'join' || stage.t === 'download' || stage.t === 'sending' || stage.t === 'starting';
  // Both codes again after a file is sent, for one more new phone; folded until asked for.
  const [another, setAnother] = useState(false);
  useEffect(() => { if (stage.t !== 'sent') setAnother(false); }, [stage.t]);
  // Opened from Let someone in: Let them in goes back there, not to a second one on the stack.
  const letIn = () => { actions.stop(); if (ctx.params['from'] === 'let_someone_in') ctx.back(); else ctx.go('let_someone_in'); };
  const startable = give.canGive && (stage.t === 'ready' || stage.t === 'ended' || (stage.t === 'failed' && stage.why !== 'no-file'));
  let footer: ReactNode = null;
  if (startable && stage.t === 'failed' && stage.why === 'blocked') {
    footer = (
      <>
        <PrimaryBtn label={t('nearby.permission.openSettings')} icon="settings" help={t('nearby.permission.openSettingsHelp')} onPress={actions.openSettings} />
        <GhostBtn label={t('nearby.give.start')} help={t('nearby.give.startHelp')} onPress={actions.start} />
      </>
    );
  } else if (startable) {
    footer = <PrimaryBtn label={t('nearby.give.start')} icon="qr" help={t('nearby.give.startHelp')} onPress={actions.start} />;
  } else if (stage.t === 'join') {
    footer = (
      <>
        <PrimaryBtn label={t('nearby.give.next')} icon="arrowR" help={t('nearby.give.nextHelp')} onPress={actions.next} />
        <GhostBtn label={t('nearby.give.stop')} help={t('nearby.give.stopHelp')} onPress={actions.stop} />
      </>
    );
  } else if (stage.t === 'download' || stage.t === 'sending' || stage.t === 'starting') {
    footer = <GhostBtn label={t('nearby.give.stop')} help={t('nearby.give.stopHelp')} onPress={actions.stop} />;
  } else if (stage.t === 'sent') {
    footer = (
      <>
        <PrimaryBtn label={t('nearby.give.letIn')} icon="people" help={t('nearby.give.letInHelp')} onPress={letIn} />
        <GhostBtn label={t('nearby.give.stop')} help={t('nearby.give.stopHelp')} onPress={actions.stop} />
      </>
    );
  }
  // Code 1: on its own step, and again for another phone once a file is sent.
  const joinCode = giving && (stage.t === 'join' || (stage.t === 'sent' && another)) ? (
    <Card>
      <Text style={txt.h3}>{t('nearby.give.join.title')}</Text>
      <LetInCode value={wifiCode(giving)} label={t('nearby.give.join.code')} />
      {/* Next exists only on code 1's own step, so only there does the line name it. */}
      <Text style={txt.body}>{t(stage.t === 'join' ? 'nearby.give.join.line' : 'nearby.give.join.lineAgain')}</Text>
      <Text style={txt.smMuted}>{t('nearby.give.join.typeLine')}</Text>
      <Text style={[txt.body, { fontWeight: '700' }]} selectable>{t('nearby.give.join.network', { name: giving.ssid })}</Text>
      <Text style={[txt.body, { fontWeight: '700' }]} selectable>{t('nearby.give.join.password', { password: giving.passphrase })}</Text>
    </Card>
  ) : null;
  // Code 2 stays up while the file goes, so a stalled download can start again, and comes back with code 1 for another phone.
  const pageCode = giving && (stage.t === 'download' || stage.t === 'sending' || (stage.t === 'sent' && another)) ? (
    <Card>
      <Text style={txt.h3}>{t('nearby.give.download.title')}</Text>
      <LetInCode value={pageAddress(giving)} label={t('nearby.give.download.code')} />
      <Text style={txt.body}>{t('nearby.give.download.line')}</Text>
      <Text style={txt.sm} selectable>{t('nearby.give.download.address', { address: pageAddress(giving) })}</Text>
      <Text style={[txt.sm, { color: TINT.amberText }]}>{t('nearby.give.download.dataLine')}</Text>
      {/* Back works only before the file starts: after that the stage follows the file, not the step. */}
      {stage.t === 'download' ? <LinkBtn label={t('nearby.give.backToJoin')} help={t('nearby.give.backToJoinHelp')} onPress={actions.back} /> : null}
    </Card>
  ) : null;
  return (
    <Screen header={<Header title={t('screens.give_app')} onBack={ctx.back} />} footer={footer}>
      <NearbyIntro icon="send" text={t('nearby.give.intro')}>
        {kept ? <Text style={txt.smMuted}>{t('nearby.give.size', { size: formatNumber(megabytes(kept.size)) })}</Text> : null}
        <LetInCoverNote worn={worn} part="look" />
      </NearbyIntro>
      {give.cannotGive !== null ? (
        <Banner icon="info" tone="amber" title={t(give.cannotGive === 'android' ? 'nearby.give.unsupported.android' : 'nearby.give.unsupported.update')} />
      ) : stage.t === 'reading' ? (
        <Card><ActivityIndicator color={C.primary} /></Card>
      ) : stage.t === 'none' || (stage.t === 'failed' && stage.why === 'no-file') ? (
        <Card>
          <Text style={txt.body}>{t('nearby.give.noFile')}</Text>
          <LinkBtn label={t('screens.get_install_file')} help={t('nearby.installFile.linkHelp')} onPress={() => ctx.go('get_install_file')} />
        </Card>
      ) : null}
      {stage.t === 'starting' ? <Waiting text={t('nearby.give.starting')} /> : null}
      {stage.t === 'sending' ? (
        <Card>
          <Text style={txt.body}>{t('nearby.give.sending', { sent: formatNumber(megabytes(sentShown(stage.sent, stage.total))), total: formatNumber(megabytes(stage.total)) })}</Text>
          <ProgressBar value={stage.total ? (sentShown(stage.sent, stage.total) / stage.total) * 100 : 0} />
        </Card>
      ) : null}
      {stage.t === 'sent' ? (
        <>
          <Banner icon="check" tone="green" title={t('nearby.give.sent')} body={t('nearby.give.sentLine')} />
          <LinkBtn label={t('nearby.give.another')} help={t('nearby.give.anotherHelp')} expanded={another} onPress={() => setAnother((o) => !o)} style={{ alignSelf: 'flex-start' }} />
        </>
      ) : null}
      {joinCode}
      {pageCode}
      {stage.t === 'ended' ? <Banner icon="info" tone="amber" title={t(GIVE_END[stage.why])} /> : null}
      {stage.t === 'failed' && stage.why !== 'no-file' ? <Banner icon="warning" tone="amber" title={t(GIVE_FAIL[stage.why])} /> : null}
      {live ? <Text style={txt.smMuted}>{t('nearby.give.stayOpen')}</Text> : null}
    </Screen>
  );
}

function Waiting(props: { text: string }) {
  return (
    <Card>
      <View style={styles.line}>
        <ActivityIndicator color={C.primary} />
        <Text style={[txt.body, { flex: 1 }]}>{props.text}</Text>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  line: { flexDirection: 'row', alignItems: 'center', gap: space.md }
});
