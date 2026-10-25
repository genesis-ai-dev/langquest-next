// What this phone has for use without a connection, said where people look:
// a download button on each passage's row and tile and at the top of the
// passage, and in Settings (decisions.md 61, 166).
// Text, status and history of the open language are here once its first
// download has filled every passage in (decisions.md 147; until then the Map
// says it is downloading, and a passage not reached yet shows its line); audio
// (core `offlineByUnit`) and, on a phone, study pictures and audio
// (study/studyFiles.ts) are here only for passages kept offline. The worry this
// answers: someone browses passages online, plays their audio, and finds out
// in the field that none of it came along.
import { languageName, offlineByUnit, unitTitle, type UnitOffline } from '@langquest-next/core';
import { deriveKinds, passageSummary } from '../i18n/coreText';
import { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../ui/text';
import type { Ctx } from '../shell/ctx';
import { Card, Header, HelpInfo, Ico, ProgressBar, Screen, type IconName } from '../ui/kit';
import { HelpBadge } from '../helpMode/helpBadge';
import { useHelpSpot } from '../helpMode/useHelpMode';
import { txt } from '../ui/textStyles';
import { endsSentence } from '../helpMode/helpContext';
import { t } from '../i18n';
import { formatNumber } from '../i18n/format';
import { STUDY_FILES_OFFLINE } from '../study/studyFiles';
import { C, onColor, radius, space, TINT } from '../ui/theme';
import { keptOfflineMap, offlineLine, type KeptOffline, type OfflineOverview } from './offlineText';
import { offlineLook, type OfflineLook } from './offlineModel';
import { useStudyRevision } from './useOfflineSummary';
import { WaveArrow } from './transit';
import { useSyncStatus } from './useSyncStatus';

/**
 * Where one passage stands, from what this device has counted and nothing
 * else (decisions.md 166): the session's count of every passage it keeps
 * (useLanguage, worked out from the phone's table), or "checking" until that
 * count has this passage in it. A passage the count leaves out is not kept.
 */
function useOffline(ctx: Ctx, unitId: string): KeptOffline | 'checking' {
  const counted = keptOfflineMap(ctx);
  const { keptOffline, keptUnits } = ctx.language.blobs;
  useStudyRevision();
  if (!keptOffline) return 'checking';
  const u = counted.get(unitId);
  if (u) return u;
  // Just kept: the count has not caught up with it yet.
  return keptUnits.has(unitId) ? 'checking' : NOT_KEPT;
}

/** Whole sentences, one after another. */
const sentences = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');

/** Why a passage is kept on this device. */
function reasonText(reason: NonNullable<UnitOffline['reason']>): string {
  switch (reason) {
    case 'asked': return t('offline.reason.asked');
    case 'worked': return t('offline.reason.worked');
    case 'chosen': return t('offline.reason.chosen');
  }
}

/** What tapping the download button does: keep a passage, stop keeping one chosen, or say why it is kept. */
function useKeepToggle(ctx: Ctx, unitId: string, u: KeptOffline | 'checking', offline: boolean): { onPress: (() => void) | undefined; help: string } {
  if (u === 'checking') return { help: t('offline.checkingHelp'), onPress: undefined };
  if (!u.reason) {
    // Offline nothing can come down: no download is offered (decisions.md 166).
    if (offline) return { help: t('offline.needsConnectionHelp'), onPress: undefined };
    // No toast: the button itself says what happens, as it happens.
    return { help: t('offline.keepHelp'), onPress: () => { void ctx.language.blobs.keepOffline(unitId, true); } };
  }
  if (u.reason === 'chosen') {
    return { help: t('offline.stopKeepingHelp'), onPress: () => { void ctx.language.blobs.keepOffline(unitId, false); ctx.toast(t('offline.toast.notKept')); } };
  }
  const why = reasonText(u.reason);
  return { help: why, onPress: () => ctx.toast(why) };
}

const DISC = 34;

/** The round download mark: an outline to download, an arrow wave while it does (amber offline), green once it is all here. */
function DownloadDisc(props: { look: OfflineLook; size?: number }) {
  const { look } = props;
  const size = props.size ?? DISC;
  const ready = look.kind === 'ready';
  const amber = look.kind === 'partial';
  const quiet = look.kind === 'checking' || look.kind === 'noConnection';
  const tint = ready ? C.white : amber ? TINT.amberText : quiet ? C.faint : C.primary;
  return (
    <View style={[styles.disc, { width: size, height: size, borderRadius: size / 2 },
      ready ? { backgroundColor: onColor.green, borderColor: onColor.green }
        : look.kind === 'none' ? { borderColor: C.primary }
        : quiet ? { borderColor: C.border }
        : { borderColor: 'transparent', backgroundColor: amber ? TINT.amber : C.light }]}>
      {look.kind === 'downloading'
        ? <WaveArrow direction="down" color={C.primary} size={Math.round(size * 0.3)} />
        : <Ico name={look.kind === 'noConnection' ? 'notOnPhone' : 'download'} size={Math.round(size * 0.5)} color={tint} strokeWidth={ready ? 2.75 : 2.25} />}
    </View>
  );
}

/**
 * A passage's download button, on its row of a list and its chapter's
 * tile (decisions.md 166): what the tiny cloud mark used to say, as a
 * button that keeps the passage on this device.
 */
export function DownloadButton(props: { ctx: Ctx; unitId: string; testID?: string; size?: number }) {
  const { ctx, unitId } = props;
  const u = useOffline(ctx, unitId);
  const offline = ctx.language.online === false;
  const look = offlineLook(u, { offline, downloading: useSyncStatus().downloading.has(unitId) });
  const keep = useKeepToggle(ctx, unitId, u, offline);
  const spot = useHelpSpot(look.label, keep.help, keep.onPress);
  return (
    <Pressable {...(props.testID ? { testID: props.testID } : {})} onPress={spot.onPress} disabled={!keep.onPress && !spot.id} accessibilityRole="button" accessibilityLabel={look.label}
      accessibilityState={{ disabled: !keep.onPress }} hitSlop={4} style={({ pressed }) => [styles.discTap, pressed && { opacity: 0.6 }]}>
      <DownloadDisc look={look} {...(props.size ? { size: props.size } : {})} />
      <HelpBadge spot={spot} />
    </Pressable>
  );
}

const NOT_KEPT: KeptOffline = { reason: null, audio: 0, here: 0, toFetch: 0, bytesToFetch: 0, notSent: 0, ready: false, studyHere: 0, studyTotal: 0 };

/**
 * The top of a passage: whether its audio is on this device, and the
 * button that changes it, where nobody has to look for it (decisions.md
 * 61, 166). The whole line is the button.
 */
export function PassageOfflineBar(props: { ctx: Ctx; unitId: string }) {
  const { ctx, unitId } = props;
  const u = useOffline(ctx, unitId);
  const offline = ctx.language.online === false;
  const look = offlineLook(u, { offline, downloading: useSyncStatus().downloading.has(unitId) });
  const keep = useKeepToggle(ctx, unitId, u, offline);
  const spot = useHelpSpot(look.label, keep.help, keep.onPress);
  const tone = look.kind === 'ready' ? { bg: TINT.green, fg: TINT.greenText } : look.kind === 'partial' ? { bg: TINT.amber, fg: TINT.amberText }
    : look.kind === 'checking' || look.kind === 'noConnection' ? { bg: C.card, fg: C.muted } : { bg: C.card, fg: C.primary };
  return (
    <Pressable testID="passage-offline" onPress={spot.onPress} disabled={!keep.onPress && !spot.id} accessibilityRole="button" accessibilityLabel={look.label}
      accessibilityState={{ disabled: !keep.onPress }}
      style={({ pressed }) => [styles.bar, { backgroundColor: tone.bg, borderColor: look.kind === 'none' ? C.border : tone.bg }, pressed && { opacity: 0.7 }]}>
      <DownloadDisc look={look} size={30} />
      <Text style={[txt.sm, { flex: 1, fontWeight: '700', color: tone.fg }]}>{look.label}</Text>
      <HelpBadge spot={spot} />
    </Pressable>
  );
}

/** Over a book's passages: how many of them are on this device, once the device has counted (decisions.md 166). */
export function BookOfflineLine(props: { ready: number; count: number; checking: boolean }) {
  if (props.count === 0) return null;
  const label = props.checking ? t('offline.summary.checking') : t('map.me.ready', { ready: formatNumber(props.ready), count: props.count });
  return (
    <View style={styles.bookLine} accessible accessibilityLabel={label}>
      <DownloadDisc look={{ kind: props.ready ? 'ready' : 'none', label }} size={22} />
      <Text style={[txt.sm, { flex: 1, fontWeight: '600', color: props.ready ? TINT.greenText : C.muted }]}>{label}</Text>
    </View>
  );
}

/**
 * While a first download fills a language in (decisions.md 147): how many
 * passages are on this device, with decision 61's progress bar. The Map
 * and the Sync screen show it; it goes once every passage is here.
 */
export function FillBanner(props: { ctx: Ctx }) {
  const fill = props.ctx.language.fill;
  if (!fill || fill.total === 0) return null;
  const offline = props.ctx.language.online === false;
  const count = t('offline.fill.count', { filled: fill.filled, total: fill.total });
  const body = sentences(count, offline ? t('offline.connectToFinish') : t('offline.stayConnected'));
  return (
    <Card accessibilityLabel={t('shell.a11y.labelDetail', { label: t('offline.fill.title'), detail: body })}>
      <Block icon="download" tint={offline ? TINT.amberText : C.primary} bg={offline ? TINT.amber : C.light} title={t('offline.fill.title')} body={body} />
      <HelpInfo label={t('offline.fill.title')} detail={t('offline.fill.barHelp')}>
        <ProgressBar value={(fill.filled / fill.total) * 100} />
      </HelpInfo>
    </Card>
  );
}

/**
 * A passage the first download has not reached, opened without a
 * connection (decisions.md 147): what its line knows (where it stands, its
 * latest version and by whom, open requests), and that the rest comes once
 * the device is connected.
 */
export function PassageNotHere(props: { ctx: Ctx; unitId: string }) {
  const { ctx, unitId } = props;
  const state = ctx.language.state;
  const line = ctx.language.lines.get(unitId);
  const title = state ? unitTitle(state, unitId) : '';
  const status = state ? passageSummary(line, deriveKinds(state), ctx.session.actorId, (id) => ctx.name(id, true)) : '';
  // One fact a line: where it stands, its latest version and by whom, its open requests.
  const facts = [
    status,
    line.latest ? t('offline.notHere.latest', { n: line.latest.n, name: ctx.name(line.latest.by, true) }) : null,
    line.openRequests.length ? t('offline.notHere.requests', { n: line.openRequests.length }) : null
  ].filter((f): f is string => !!f);
  return (
    <Screen header={<Header title={title} onBack={ctx.back} />}>
      <Card accessibilityLabel={t('shell.a11y.labelDetail', { label: title, detail: facts.join(' ') })}>
        {facts.map((f) => <Text key={f} style={txt.body}>{f}</Text>)}
      </Card>
      <Card>
        <Block icon="notOnPhone" tint={TINT.amberText} bg={TINT.amber} title={t('offline.notHere.title')} body={t('offline.notHere.body')} />
      </Card>
    </Screen>
  );
}

/** The Sync screen's card: how ready this phone is, and what never comes along. */
export function OfflineCard(props: { ctx: Ctx; s: OfflineOverview | null }) {
  const { ctx, s } = props;
  const offline = ctx.language.online === false;
  const ready = !!s && s.kept > 0 && s.ready === s.kept;
  const language = ctx.languageId ? languageName(ctx.org.state, ctx.languageId) : t('offline.card.thisLanguage');
  const head = ready
    ? { icon: 'onPhone' as IconName, tint: onColor.green, bg: TINT.green }
    : s?.kept && !offline ? { icon: 'download' as IconName, tint: C.primary, bg: C.light }
    : { icon: 'notOnPhone' as IconName, tint: TINT.amberText, bg: TINT.amber };
  const finish = s && s.kept && !ready ? (offline ? t('offline.connectToFinish') : t('offline.stayConnected')) : null;
  // Settings' line, as a sentence here.
  const line = offlineLine(s);
  return (
    <Card>
      <Block icon={head.icon} tint={head.tint} bg={head.bg} title={t('offline.card.readyTitle')}
        body={sentences(endsSentence(line) ? line : t('offline.card.lineAsSentence', { line }), finish)} />
      {s && s.kept ? (
        <HelpInfo label={t('offline.card.readyTitle')} detail={t('offline.card.barHelp')}>
          <ProgressBar value={(s.ready / s.kept) * 100} {...(ready ? { color: onColor.green } : {})} />
        </HelpInfo>
      ) : null}
      <Block icon="check" tint={onColor.green} bg={TINT.green} title={t('offline.card.alwaysTitle')}
        body={STUDY_FILES_OFFLINE ? t('offline.card.alwaysBodyStudy', { language }) : t('offline.card.alwaysBody', { language })} />
      <Block icon="cloud" tint={TINT.amberText} bg={TINT.amber} title={t('offline.card.needsTitle')}
        body={[
          STUDY_FILES_OFFLINE ? t('offline.card.needsNotDownloadedStudy') : t('offline.card.needsNotDownloaded'),
          STUDY_FILES_OFFLINE ? t('offline.card.needsFilms') : t('offline.card.needsStudyWeb'),
          t('offline.card.needsReports'),
          t('offline.card.needsOtherLanguages')
        ].map((l) => t('offline.card.bullet', { line: l })).join('\n')} />
      {s && s.notSent ? (
        <Text style={txt.xs}>{t('offline.card.notSent', { count: s.notSent })}</Text>
      ) : null}
    </Card>
  );
}

function Block(props: { icon: IconName; tint: string; bg: string; title: string; body: string }) {
  return (
    <View style={styles.head} accessible accessibilityLabel={t('shell.a11y.labelDetail', { label: props.title, detail: props.body })}>
      <View style={[styles.tile, { backgroundColor: props.bg }]}><Ico name={props.icon} size={22} color={props.tint} /></View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[txt.body, { fontWeight: '700' }]}>{props.title}</Text>
        <Text style={txt.xs}>{props.body}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  tile: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  disc: { alignItems: 'center', justifyContent: 'center', borderWidth: 2, backgroundColor: C.card },
  discTap: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  bar: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 48, paddingHorizontal: space.md, paddingVertical: space.xs,
    borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth },
  bookLine: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.xs }
});
