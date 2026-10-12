// What this phone has for use without a connection, said where people look:
// on each passage, as a mark on the Map, and in Settings (decisions.md 61).
// Text, status and history of the open language are always here; audio
// (core `offlineByUnit`) and, on a phone, study pictures and audio
// (study/studyFiles.ts) are here only for passages kept offline. The worry this
// answers: someone browses passages online, plays their audio, and finds out
// in the field that none of it came along.
import { defaultOfflineScope, languageName, offlineByUnit, offlineSummary, type OfflineSummary, type UnitOffline } from '@langquest-next/core';
import { useMemo, useSyncExternalStore } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from './text';
import type { Ctx } from './ctx';
import { Card, Ico, ProgressBar, SmallBtn, txt, type IconName } from './kit';
import { endsSentence } from './helpContext';
import { t } from './i18n';
import { formatBytes } from './i18n/format';
import { onStudyFiles, STUDY_FILES_OFFLINE, studyCounts, studyRevision } from './study/studyFiles';
import { C, onColor, space, TINT } from './theme';

/** A passage's audio counts with its study files folded in: ready means both are here. */
export type KeptOffline = UnitOffline & { studyHere: number; studyTotal: number };

function withStudy(u: UnitOffline, unitId: string): KeptOffline {
  const { here, total } = u.reason ? studyCounts(unitId) : { here: 0, total: 0 };
  return { ...u, studyHere: here, studyTotal: total, ready: u.ready && here === total };
}

/** Re-render when a study file arrives or the prefetcher learns a guide. */
function useStudyRevision(): number {
  return useSyncExternalStore(onStudyFiles, studyRevision, studyRevision);
}

/** Offline counts for these passages, recomputed when files arrive, leave, or a passage is kept. */
function useOfflineUnits(ctx: Ctx, unitIds: readonly string[]): Map<string, KeptOffline> {
  const state = ctx.language.state;
  const { present, keptUnits } = ctx.language.blobs;
  const me = ctx.session.actorId;
  const rev = useStudyRevision();
  const key = unitIds.join(',');
  return useMemo(() => {
    const out = new Map<string, KeptOffline>();
    if (!state) return out;
    for (const [id, u] of offlineByUnit(state, unitIds, present, me, keptUnits)) out.set(id, withStudy(u, id));
    return out;
  },
    // unitIds is read through its key, so a new array with the same passages does not recompute.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state, present, keptUnits, me, key, rev]);
}

/**
 * Counts for every kept passage, for marks on long lists. A passage missing
 * from the map is not kept. Shared by every row drawn from the same inputs.
 */
export function keptOfflineMap(ctx: Ctx): Map<string, KeptOffline> {
  const state = ctx.language.state;
  const { present, keptUnits } = ctx.language.blobs;
  const me = ctx.session.actorId;
  if (!state) return new Map();
  const rev = studyRevision();
  const last = keptCache;
  if (last && last.state === state && last.present === present && last.kept === keptUnits && last.me === me && last.rev === rev) return last.map;
  const scope = defaultOfflineScope(state, me);
  for (const u of keptUnits) scope.add(u);
  const map = new Map<string, KeptOffline>();
  for (const [id, u] of offlineByUnit(state, scope, present, me, keptUnits)) map.set(id, withStudy(u, id));
  keptCache = { state, present, kept: keptUnits, me, rev, map };
  return map;
}
let keptCache: { state: object; present: ReadonlySet<string>; kept: ReadonlySet<string>; me: string; rev: number; map: Map<string, KeptOffline> } | null = null;

/** The whole scope: audio from core, with passages counted ready only once their study files are here too. */
type OfflineOverview = OfflineSummary & { studyToFetch: number };

export function useOfflineSummary(ctx: Ctx): OfflineOverview | null {
  const state = ctx.language.state;
  const { present, keptUnits } = ctx.language.blobs;
  const me = ctx.session.actorId;
  const rev = useStudyRevision();
  return useMemo(() => {
    if (!state) return null;
    const audio = offlineSummary(state, present, me, keptUnits);
    const kept = [...keptOfflineMap(ctx).values()];
    return { ...audio, ready: kept.filter((u) => u.ready).length, studyToFetch: kept.reduce((n, u) => n + u.studyTotal - u.studyHere, 0) };
    // ctx is read for the same inputs listed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, present, keptUnits, me, rev]);
}

/** Why a passage is kept on this device. */
function reasonText(reason: NonNullable<UnitOffline['reason']>): string {
  switch (reason) {
    case 'asked': return t('offline.reason.asked');
    case 'worked': return t('offline.reason.worked');
    case 'chosen': return t('offline.reason.chosen');
  }
}

/** Whole sentences, one after another. */
const sentences = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');

/** Where one passage stands: on this phone, coming, or not kept; with the words for each. */
function passageOfflineView(u: KeptOffline, offline: boolean, hasStudy: boolean) {
  const notSent = u.notSent ? t('offline.passage.notSent', { count: u.notSent }) : null;
  // The web app opens online only (decisions.md 58), so its study media stay on the web.
  const studyOnline = hasStudy && !STUDY_FILES_OFFLINE ? t('offline.passage.studyOnline') : null;
  const here = u.here + u.studyHere;
  const total = u.audio + u.studyTotal;
  if (u.reason && u.ready) {
    const works = u.studyTotal ? t('offline.passage.worksWithStudy') : u.audio ? t('offline.passage.worksWithAudio') : t('offline.passage.worksTextOnly');
    return {
      icon: 'onPhone' as IconName, tint: onColor.green, bg: TINT.green, short: t('offline.onDevice'),
      label: t('offline.onDevice'),
      sub: sentences(works, reasonText(u.reason), notSent, studyOnline)
    };
  }
  if (u.reason) {
    const size = u.bytesToFetch ? formatBytes(u.bytesToFetch) : null;
    const filesHere = u.studyTotal
      ? (size ? t('offline.passage.studyFilesHereLeft', { here, count: total, size }) : t('offline.passage.studyFilesHere', { here, count: total }))
      : (size ? t('offline.passage.audioFilesHereLeft', { here, count: total, size }) : t('offline.passage.audioFilesHere', { here, count: total }));
    return {
      icon: 'download' as IconName, tint: offline ? TINT.amberText : C.primary, bg: offline ? TINT.amber : C.light,
      short: offline ? t('offline.passage.onlySomeHere', { here, count: total }) : t('offline.passage.downloadingCount', { here, total }),
      label: offline ? t('offline.passage.notAllHere') : t('offline.downloading'),
      sub: sentences(filesHere, offline ? t('offline.connectToFinish') : t('offline.stayConnected'), reasonText(u.reason), notSent, studyOnline)
    };
  }
  const study = hasStudy && STUDY_FILES_OFFLINE;
  return {
    icon: 'notOnPhone' as IconName, tint: TINT.amberText, bg: TINT.amber,
    short: offline ? t('offline.audioNotHere') : t('offline.notKept'),
    label: offline ? t('offline.audioNotHere') : t('offline.notKept'),
    sub: sentences(
      offline
        ? (study ? t('offline.passage.readRecordStudyNeeds') : t('offline.passage.readRecordAudioNeeds'))
        : (study ? t('offline.passage.textHereStudyNeeds') : t('offline.passage.textHereAudioNeeds')),
      studyOnline)
  };
}

/** One line at the top of a passage, so nobody has to scroll to learn it will not come along. */
export function PassageOfflineLine(props: { ctx: Ctx; unitId: string }) {
  const u = useOfflineUnits(props.ctx, [props.unitId]).get(props.unitId);
  if (!u) return null;
  const v = passageOfflineView(u, props.ctx.language.online === false, false);
  return (
    <View style={styles.line} accessible accessibilityLabel={v.short}>
      <Ico name={v.icon} size={16} color={v.tint} />
      <Text style={[txt.xsStrong, { color: v.tint, flex: 1 }]} numberOfLines={1}>{v.short}</Text>
    </View>
  );
}

/** The passage's offline card: what is here, why, and the one action that changes it. */
export function PassageOffline(props: { ctx: Ctx; unitId: string; hasStudy: boolean }) {
  const { ctx, unitId } = props;
  const u = useOfflineUnits(ctx, [unitId]).get(unitId);
  if (!u) return null;
  const v = passageOfflineView(u, ctx.language.online === false, props.hasStudy);
  const keep = (on: boolean) => {
    void ctx.language.blobs.keepOffline(unitId, on);
    ctx.toast(on ? t('offline.toast.kept') : t('offline.toast.notKept'));
  };
  return (
    <Card accessibilityLabel={t('shell.a11y.labelDetail', { label: v.label, detail: v.sub })}>
      <Block icon={v.icon} tint={v.tint} bg={v.bg} title={v.label} body={v.sub} />
      {u.reason && !u.ready ? <ProgressBar value={u.audio + u.studyTotal ? ((u.here + u.studyHere) / (u.audio + u.studyTotal)) * 100 : 0} /> : null}
      {!u.reason ? <View style={styles.action}><SmallBtn label={t('offline.keep')} icon="download" onPress={() => keep(true)} /></View> : null}
      {u.reason === 'chosen' ? <View style={styles.action}><SmallBtn label={t('offline.stopKeeping')} onPress={() => keep(false)} /></View> : null}
    </Card>
  );
}

/** A small mark on a Map row's disc: on this phone, or still downloading. Not kept shows nothing. */
export function OfflineMark(props: { u: KeptOffline | undefined; corner?: boolean }) {
  const u = props.u;
  if (!u?.reason) return null;
  return (
    <View style={[styles.mark, props.corner && styles.corner, { backgroundColor: u.ready ? onColor.green : C.primary }]}>
      <Ico name={u.ready ? 'onPhone' : 'download'} size={11} color={C.white} />
    </View>
  );
}

/** Words for a Map row's screen reader label. */
export function offlineWords(u: KeptOffline | undefined): string {
  if (!u?.reason) return t('offline.audioNotKept');
  return u.ready ? t('offline.onDevice') : t('offline.downloading');
}

/** Settings' one line. */
export function offlineLine(s: OfflineOverview | null): string {
  if (!s) return t('offline.summary.checking');
  if (s.kept === 0) return t('offline.summary.noneKept');
  if (s.ready === s.kept) return t('offline.summary.allReady', { count: s.kept });
  const size = s.bytesToFetch ? formatBytes(s.bytesToFetch) : null;
  const studyFiles = s.studyToFetch ? t('offline.summary.studyFiles', { count: s.studyToFetch }) : null;
  const counts = { ready: s.ready, count: s.kept };
  if (size && studyFiles) return t('offline.summary.someReadyAudioStudy', { ...counts, size, studyFiles });
  if (size) return t('offline.summary.someReadyAudio', { ...counts, size });
  if (studyFiles) return t('offline.summary.someReadyStudy', { ...counts, studyFiles });
  return t('offline.summary.someReady', counts);
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
      {s && s.kept ? <ProgressBar value={(s.ready / s.kept) * 100} {...(ready ? { color: onColor.green } : {})} /> : null}
      <Block icon="check" tint={onColor.green} bg={TINT.green} title={t('offline.card.alwaysTitle')}
        body={STUDY_FILES_OFFLINE ? t('offline.card.alwaysBodyStudy', { language }) : t('offline.card.alwaysBody', { language })} />
      <Block icon="cloud" tint={TINT.amberText} bg={TINT.amber} title={t('offline.card.needsTitle')}
        body={[
          STUDY_FILES_OFFLINE ? t('offline.card.needsNotKeptStudy') : t('offline.card.needsNotKept'),
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
  line: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  tile: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  action: { alignItems: 'flex-start', paddingLeft: 44 + space.md },
  corner: { right: undefined, bottom: undefined, top: 5, left: 5 },
  mark: { position: 'absolute', right: -3, bottom: -3, width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: C.card }
});
