import type { ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { t } from '../i18n';
import { formatNumber } from '../i18n/format';
import type { Ctx } from '../shell/ctx';
import { LetInCoverNote } from '../shell/LetInCoverNote';
import { Badge, Banner, Card, GhostBtn, Header, Ico, LinkBtn, PrimaryBtn, ProgressBar, Screen } from '../ui/kit';
import { Text } from '../ui/text';
import { txt } from '../ui/textStyles';
import { C, space, TINT } from '../ui/theme';
import { megabytes, pageAddress, sentShown, wifiCode, type GiveEnd, type GiveFail } from './giveAppModel';
import { LetInCode } from './LetInCode';
import { useGiveApp } from './useGiveApp';

const GIVE_END = {
  stopped: 'nearby.give.ended.stopped',
  idle: 'nearby.give.ended.idle',
  phone: 'nearby.give.ended.phone'
} as const satisfies Record<GiveEnd, string>;

const GIVE_FAIL = {
  'wifi-off': 'nearby.give.failed.wifiOff',
  'location-off': 'nearby.give.failed.locationOff',
  permission: 'nearby.give.failed.permission',
  blocked: 'nearby.permission.settings',
  'permission-covered': 'nearby.give.failed.permissionCovered',
  busy: 'nearby.give.failed.busy',
  'no-file': 'nearby.give.noFile',
  failed: 'nearby.give.failed.failed'
} as const satisfies Record<GiveFail, string>;

/**
 * Give the app, from Share nearby's A new person and Let someone in: this phone forms its own
 * Wi-Fi and serves the kept install file from a small page, so a new phone gets LangQuest with no
 * internet and no Google services on either phone. Code 1 joins the Wi-Fi, code 2 opens the page;
 * then the count of what is sent, and the way on to Let someone in. The app downloads nothing: the
 * file is the one kept under Check my file. Android only; elsewhere it says what to do instead.
 */
export function GiveAppScreen(ctx: Ctx) {
  const give = useGiveApp();
  const { stage, giving, kept, actions, worn } = give;
  const live = stage.t === 'join' || stage.t === 'download' || stage.t === 'sending' || stage.t === 'starting';
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
    footer = <PrimaryBtn label={t('nearby.give.start')} icon="send" help={t('nearby.give.startHelp')} onPress={actions.start} />;
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
  // Code 2 stays up while the file goes, so a stalled download or a second phone can start again.
  const pageCode = giving && (stage.t === 'download' || stage.t === 'sending' || stage.t === 'sent') ? (
    <Card>
      <Text style={txt.h3}>{t('nearby.give.download.title')}</Text>
      <LetInCode value={pageAddress(giving)} label={t('nearby.give.download.code')} />
      <Text style={txt.body}>{t('nearby.give.download.line')}</Text>
      <Text style={txt.sm} selectable>{t('nearby.give.download.address', { address: pageAddress(giving) })}</Text>
      <Text style={[txt.sm, { color: TINT.amberText }]}>{t('nearby.give.download.dataLine')}</Text>
      <LinkBtn label={t('nearby.give.backToJoin')} help={t('nearby.give.backToJoinHelp')} onPress={actions.back} />
    </Card>
  ) : null;
  return (
    <Screen header={<Header title={t('screens.give_app')} onBack={ctx.back} />} footer={footer}>
      <Card>
        <View style={styles.line}>
          <Ico name="send" size={22} color={C.primary} />
          <Text style={[txt.body, { flex: 1, fontWeight: '700' }]}>{t('screens.give_app')}</Text>
          <Badge label={t('nearby.experimental')} tone="amber" />
        </View>
        <Text style={txt.sm}>{t('nearby.give.intro')}</Text>
        {kept ? <Text style={txt.smMuted}>{t('nearby.give.size', { size: formatNumber(megabytes(kept.size)) })}</Text> : null}
        <LetInCoverNote worn={worn} part="look" />
      </Card>
      {!give.canGive ? (
        <Banner icon="info" tone="amber" title={t('nearby.give.unsupported')} />
      ) : stage.t === 'reading' ? (
        <Card><ActivityIndicator color={C.primary} /></Card>
      ) : stage.t === 'none' || (stage.t === 'failed' && stage.why === 'no-file') ? (
        <Card>
          <Text style={txt.body}>{t('nearby.give.noFile')}</Text>
          <LinkBtn label={t('screens.get_install_file')} help={t('nearby.installFile.linkHelp')} onPress={() => ctx.go('get_install_file')} />
        </Card>
      ) : null}
      {stage.t === 'starting' ? <Waiting text={t('nearby.give.starting')} /> : null}
      {stage.t === 'join' && giving ? (
        <Card>
          <Text style={txt.h3}>{t('nearby.give.join.title')}</Text>
          <LetInCode value={wifiCode(giving)} label={t('nearby.give.join.code')} />
          <Text style={txt.body}>{t('nearby.give.join.line')}</Text>
          <Text style={[txt.body, { fontWeight: '700' }]} selectable>{t('nearby.give.join.network', { name: giving.ssid })}</Text>
          <Text style={[txt.body, { fontWeight: '700' }]} selectable>{t('nearby.give.join.password', { password: giving.passphrase })}</Text>
          <Text style={txt.smMuted}>{t('nearby.give.join.typeLine')}</Text>
        </Card>
      ) : null}
      {stage.t === 'sending' ? (
        <Card>
          <Text style={txt.body}>{t('nearby.give.sending', { sent: formatNumber(megabytes(sentShown(stage.sent, stage.total))), total: formatNumber(megabytes(stage.total)) })}</Text>
          <ProgressBar value={stage.total ? (sentShown(stage.sent, stage.total) / stage.total) * 100 : 0} />
        </Card>
      ) : null}
      {stage.t === 'sent' ? <Banner icon="check" tone="green" title={t('nearby.give.sent')} body={t('nearby.give.sentLine')} /> : null}
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
