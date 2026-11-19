// Sync and offline (app only; docs/decisions/2026-11-18-sync-and-offline-one-screen.md): a screen of
// its own module, loaded the first time it is opened (src/shell/lazyScreens.tsx), since most visits
// never open it. Me's row for it stays in account.tsx.
import { decodeHlc, unitTitle } from '@langquest-next/core';
import * as Updates from 'expo-updates';
import { useState } from 'react';
import { Linking, Platform, StyleSheet, View } from 'react-native';
import { Text } from '../ui/text';
import type { Ctx } from '../shell/ctx';
import { t } from '../i18n';
import { formatNumber, formatTime } from '../i18n/format';
import { refusedHere, speed } from '../account/model';
import { useSyncInspection } from '../account/useSyncInspection';
import { HelpRow } from '../helpMode/helpBadge';
import { Badge, Card, Disclosure, Group, Header, Ico, PrimaryBtn, ProgressBar, Row, Screen, SectionLabel, type IconName } from '../ui/kit';
import { txt } from '../ui/textStyles';
import { storeUrl } from '../appVersion/appVersionModel';
import { belowMinimum } from '../appVersion/syncGate';
import { noteExpected, failureMessage } from '../diagnostics/report';
import { storeBuildParts } from '../diagnostics/storeBuild';
import { contractsFor } from '../shell/screenContracts';
import { runningBuildLines } from '../shell/updateStatus';
import { NearbyRow } from '../shell/NearbyRow';
import { useLayout } from '../ui/useLayout';
import { C, radius, space, TINT, type as T } from '../ui/theme';
import { useInstallFile } from '../nearby/useInstallFile';
import { ReadyForOffline } from '../sync/readyForOffline';
import { downloadsLine, foldsOpenAtFirst, readyLine, refusedLine, stripLink, uploadsLine } from '../sync/syncScreenModel';
import { standingTitle, syncStanding, type SyncStanding } from '../sync/syncStanding';
import { TransitStrip } from '../sync/transitStrip';
import { SentList, WaitingList } from '../sync/uploads';
import { changeUnits, uploadsSummary } from '../sync/uploadsModel';
import { useFolds } from '../sync/useFolds';
import { useOfflineSummary } from '../sync/useOfflineSummary';
import { useSignInBlocked } from '../sync/useSignInBlocked';
import { useSyncStatus } from '../sync/useSyncStatus';
import { useUploadState } from '../sync/useUploadState';

const failure = failureMessage;

// ---- Sync and offline (app only) ---------------------------------------------------------------------------------

/**
 * Sync and offline (docs/decisions/2026-11-18-sync-and-offline-one-screen.md): one card that says
 * where this phone stands with the server, drawn as the transit strip (decisions.md 166) over the
 * status word and its sentence, with Sync now; then folds, each one line saying what it holds:
 * Refused (only when there is some, and open), Uploads, Downloads (a line with nothing to open),
 * Ready for offline with the install file for someone who can let a new person in, Share nearby
 * where it is offered, and Details for support. Each opens in place; a link may ask for one open
 * (`open`). Polled once a second.
 */
export function SyncStatus(ctx: Ctx) {
  const { language, org } = ctx;
  const sync = useSyncStatus();
  const { ins, orgIns, logged, rates } = useSyncInspection(language, org, (e) => ctx.toast(failure('sync inspect', e), 'problem'));
  const [busy, setBusy] = useState(false);
  const offline = language.online === false;
  const offlineSummaryNow = useOfflineSummary(ctx);
  const pendingEvents = (ins?.pending.length ?? 0) + (orgIns?.pending.length ?? 0);
  const rejected = refusedHere(ins, orgIns, logged);
  const standing = syncStanding(language, useSignInBlocked());
  const folds = useFolds(foldsOpenAtFirst(ctx.params['open']));
  const { counts, moving: movingUp } = useUploadState(ctx);
  const lastSent = sync.sent.reduce((m, e) => Math.max(m, e.at), 0);
  const uploads = uploadsLine(uploadsSummary(counts, movingUp, lastSent, Date.now()), offline);
  const install = useInstallFile(ctx);
  const ready = readyLine(offlineSummaryNow, install.item);
  const syncNow = async () => {
    setBusy(true);
    try { await Promise.all([language.sync(), org.sync()]); language.triggerUpload(); }
    catch (e) { ctx.toast(failure('sync now', e), 'problem'); }
    finally { setBusy(false); }
  };
  return (
    <Screen header={<Header title={t('account.sync.title')} onBack={ctx.back} />}
      footer={language.tooOld && STORE ? (
        // Too old to receive: the way on is the store, a button rather than a line (UI audit, finding 119).
        <PrimaryBtn label={t('appVersion.update')} icon="download" help={t('appVersion.updateHelp')}
          onPress={() => { Linking.openURL(storeUrl(STORE)).catch((e: unknown) => noteExpected('store page', e)); }} />
      ) : (
        <PrimaryBtn label={busy ? t('account.sync.syncing') : t('account.sync.syncNow')} icon="restart" help={t('account.sync.syncNowHelp')}
          onPress={() => void syncNow()} disabled={language.tooOld || busy} />
      )}>
      {/* The last try failing to reach the server outranks the live channel, which can take a minute to notice a lost network. */}
      <Card>
        <TransitStrip up={counts.recordings > 0 ? counts.recordings : counts.changes} down={sync.pendingDown} link={stripLink(standing)}
          movingUp={movingUp} movingDown={!offline && sync.downloading.size > 0} />
        <View style={styles.profile} accessible accessibilityLabel={standingTitle(standing)}>
          <View style={[styles.liveDot, { backgroundColor: STANDING_COLOR[standing] }]} />
          <Text style={[txt.body, { flex: 1, fontWeight: '700' }]}>{standingTitle(standing)}</Text>
        </View>
        <Text style={txt.smMuted}>{standingHelp(standing)}</Text>
        {/* The server's refusal is English (its reason goes to the log): say what it means. */}
        {language.refused ? <Text style={txt.smMuted}>{t('account.sync.refused')}</Text> : language.tooOld ? (
          // Below the minimum version the phone still sends its own work (syncGate.ts); a server that refuses the protocol takes nothing.
          <Text style={txt.body}>{belowMinimum() ? t('account.sync.tooOldSends') : t('account.sync.tooOld')}</Text>
        ) : null}
      </Card>
      {/* The one thing to act on, so it comes first and arrives open. */}
      {rejected.length ? (
        <Disclosure testID="sync-refused" icon="flag" tone="red" title={t('account.sync.fold.refused')} summary={refusedLine(rejected.length)}
          help={t('account.sync.fold.refusedHelp')} open={folds.isOpen('refused')} onToggle={() => folds.toggle('refused')}>
          <View style={styles.foldBody}>
            <Group>
              {rejected.slice(0, 20).map((l, i, a) => (
                <HelpRow key={l.event.id} of="sync.event">
                  <Row icon="flag" iconColor={TINT.redText} label={eventLabel(ctx, l.event)} sub={l.rejectReason ?? clock(l.event.hlc)} help={t('account.sync.eventHelp')} last={i === a.length - 1} onPress={openUnit(ctx, l.event)} />
                </HelpRow>
              ))}
            </Group>
            <Text style={txt.xs}>{t('account.sync.fold.refusedNote')}</Text>
          </View>
        </Disclosure>
      ) : null}
      {/* What waits to upload, by passage, and what went up (decision 166). */}
      <Disclosure testID="sync-uploads" icon="upload" tone={uploads.tone ?? undefined} title={t('account.sync.fold.uploads')} summary={uploads.line}
        help={t('account.sync.fold.uploadsHelp')} open={folds.isOpen('uploads')} onToggle={() => folds.toggle('uploads')}>
        <View style={styles.foldBody}>
          <WaitingList ctx={ctx} changes={changeUnits(ctx.language.state, ins?.pending ?? [], orgIns?.pending.length ?? 0)} />
          {/* Teammates' recordings waiting to upload here count too: that is true of this phone (decisions.md 166, docs/nearby-sync-plan.md 5.8). */}
          {sync.holding ? (
            <Text style={txt.sm} accessibilityHint={t('nearby.sync.holdingHelp')}>{t('account.sync.statLabel', { value: formatNumber(sync.holding), label: t('nearby.sync.holding') })}</Text>
          ) : null}
          <SentList ctx={ctx} />
          {!uploads.tone && !counts.recordings && !counts.changes && sync.sent.length === 0 ? <Text style={txt.smMuted}>{t('uploads.allUploaded')}</Text> : null}
        </View>
      </Disclosure>
      {/* Offline, what is new on the server cannot be known: never "Up to date" then (decision 166). */}
      <Disclosure testID="sync-downloads" icon="download" title={t('account.sync.fold.downloads')} help={t('account.sync.help.toReceive')}
        summary={downloadsLine({ online: language.online, pendingDown: sync.pendingDown, rate: sync.pendingDown && rates.down ? speed(rates.down) : null })} />
      {/* What to pack before a trip (decisions.md 61): kept passages and, for someone who can let a new person in, the install file. */}
      <Disclosure testID="sync-ready" icon="onPhone" tone={ready.tone ?? undefined} title={t('offline.card.readyTitle')} summary={ready.line}
        help={t('account.sync.fold.readyHelp')} open={folds.isOpen('ready')} onToggle={() => folds.toggle('ready')}>
        <ReadyForOffline ctx={ctx} s={offlineSummaryNow} install={install.item} installKeeps={install.keeps} />
      </Disclosure>
      {/* Share nearby, where this phone may share it (Android, the organization on; docs/nearby-sync-plan.md 5.8). */}
      <NearbyRow ctx={ctx} />
      <Disclosure testID="sync-details" icon="layers" title={t('account.sync.details')} summary={ins ? t('account.sync.events', { count: ins.total + ins.rejected.length }) : ''}
        open={folds.isOpen('details')} onToggle={() => folds.toggle('details')} help={t('account.sync.detailsHelp')}>
      <View style={styles.tiles}>
        <Stat id="waiting" icon="up" color={pendingEvents ? C.primary : C.green} value={pendingEvents} label={t('account.sync.waitingUpload')} />
        <Stat id="refused" icon="flag" color={rejected.length ? TINT.redText : C.muted} value={rejected.length} label={t('account.sync.refusedByServer')} />
        <Stat id="confirmed" icon="check" color={C.green} value={Math.max(ins?.cursor ?? 0, logged?.cursor ?? 0)} label={t('account.sync.latestConfirmed')} />
        <Stat id="checkpoint" icon="layers" color={C.muted} value={ins?.checkpointSeq ?? 0} label={t('account.sync.localCheckpoint')} />
      </View>
      {/* Teammates' recordings waiting to upload count too: that is true of this phone (decisions.md 166, docs/nearby-sync-plan.md 5.8). */}
      <Transfer icon="up" pending={sync.pendingUp + sync.holding} peak={sync.peakUp} rate={rates.up} label={t('account.sync.audioUp')} offline={offline} />
      <Transfer icon="download" pending={sync.pendingDown} peak={sync.peakDown} rate={rates.down} label={t('account.sync.audioDown')} offline={offline} />
      {ins && ins.pending.length ? (
        <>
          <SectionLabel label={t('account.sync.waitingCount', { n: ins.pending.length })} />
          <Group>
            {ins.pending.slice(0, 20).map((l, i, a) => (
              <HelpRow key={l.event.id} of="sync.event">
                <Row icon="cloud" label={eventLabel(ctx, l.event)} sub={clock(l.event.hlc)} help={t('account.sync.eventHelp')} last={i === a.length - 1} onPress={openUnit(ctx, l.event)} />
              </HelpRow>
            ))}
          </Group>
        </>
      ) : null}
      {/* Refused events are on this device too (PLAN.md invariant 1); the summary's count includes them, and the Refused fold lists them. */}
      <Text style={[txt.xs, { textAlign: 'center' }]} selectable>
        {runningBuildLines({ store: storeBuildParts(), updateId: Updates.updateId ?? undefined, createdAt: Updates.createdAt ?? undefined, isEmbeddedLaunch: Updates.isEmbeddedLaunch }).join('\n')}
      </Text>
      </Disclosure>
    </Screen>
  );
}

/** The passage a change on this phone is about, when it names one the open language has. */
function unitOf(ctx: Ctx, event: { payload: unknown }): string | null {
  const unitId = (event.payload as { unitId?: unknown } | null)?.unitId;
  return typeof unitId === 'string' && ctx.language.state?.units[unitId] ? unitId : null;
}

/** A change as its kind and the passage it is about ("TakeComposed · Luke 15:11–32"), so people can tell what is stuck. */
function eventLabel(ctx: Ctx, event: { type: string; payload: unknown }): string {
  const kind = event.type.replace(/^v\d\./, '');
  const unitId = unitOf(ctx, event);
  return unitId && ctx.language.state ? `${kind} · ${unitTitle(ctx.language.state, unitId)}` : kind;
}

/** Tapping a change about a passage opens that passage (design principle 11). */
function openUnit(ctx: Ctx, event: { payload: unknown }): (() => void) | undefined {
  const unitId = unitOf(ctx, event);
  const languageId = ctx.language.languageId;
  return unitId && languageId ? () => ctx.openPassage(unitId, languageId) : undefined;
}

function clock(hlc: string): string {
  try { return formatTime(decodeHlc(hlc).wallMs, { seconds: true }); } catch { return ''; }
}

/** The store a phone updates from; none on the web, which is always the newest. */
const STORE = Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : null;

const STANDING_COLOR: Record<SyncStanding, string> = { live: C.green, checking: C.faint, offline: C.amber, refused: C.red, tooOld: C.amber, signIn: C.amber };

function standingHelp(s: SyncStanding): string {
  return s === 'signIn' ? t('account.sync.help.signIn') : s === 'live' ? t('account.sync.help.live') : s === 'offline' ? t('account.sync.help.offline')
    : s === 'checking' ? t('account.sync.help.checking') : s === 'tooOld' ? t('account.sync.help.tooOld') : t('account.sync.help.refused');
}

function Stat(props: { id: string; icon: IconName; color: string; value: number; label: string }) {
  // Two by two on a phone; one row of four once the column is wide enough.
  const { kind, contentWidth } = useLayout();
  return (
    <View testID={`sync-tile-${props.id}`} style={[styles.tile2, kind !== 'phone' && contentWidth >= 600 && { width: '22%' }]} accessible
      accessibilityLabel={t('account.sync.statLabel', { value: formatNumber(props.value), label: props.label })}>
      <Ico name={props.icon} size={24} color={props.color} />
      <Text style={[styles.statValue, { color: props.color }]}>{formatNumber(props.value)}</Text>
      <Text style={[txt.xs, { textAlign: 'center' }]}>{props.label}</Text>
    </View>
  );
}

function Transfer(props: { icon: IconName; pending: number; peak: number; rate: number; label: string; offline: boolean }) {
  const total = Math.max(props.peak, props.pending);
  const done = total - props.pending;
  const idle = props.pending === 0;
  // The card itself is not focusable when it has no action (kit Card), so the words a screen reader hears sit on this group.
  return (
    <Card>
      <View accessible accessibilityLabel={props.offline ? t('shell.a11y.labelDetail', { label: props.label, detail: t('account.sync.standing.offline') })
        : idle ? t('account.sync.transferIdle', { label: props.label })
        : t('account.sync.transferBusy', { label: props.label, done, total, speed: speed(props.rate) })} style={{ gap: space.sm }}>
        <View style={styles.profile}>
          <Ico name={props.icon} size={22} color={idle ? C.muted : C.primary} />
          <Text style={[txt.sm, { flex: 1, fontWeight: '600' }]}>{props.label}</Text>
          <View style={{ flexShrink: 1, maxWidth: '50%', alignItems: 'flex-end' }}>
            {/* Offline nothing moves and nothing new is known: never "Up to date" then (decisions.md 166). */}
            {props.offline ? <Badge label={t('account.sync.standing.offline')} tone="amber" />
              : idle ? <Badge label={t('account.more.syncUpToDate')} tone="green" /> : <Text style={txt.xs}>{t('account.sync.left', { count: props.pending, speed: speed(props.rate) })}</Text>}
          </View>
        </View>
        {idle ? null : <ProgressBar value={total ? (done / total) * 100 : 100} />}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  profile: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  foldBody: { padding: space.lg, gap: space.md },
  liveDot: { width: 14, height: 14, borderRadius: 7 },
  tile2: { width: '47%', flexGrow: 1, alignItems: 'center', gap: space.xs, paddingVertical: space.lg, paddingHorizontal: space.sm, borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth, borderColor: C.border, backgroundColor: C.card },
  statValue: { fontSize: T.xl, fontWeight: '700' }
});

export const contracts = contractsFor('sync_status');
