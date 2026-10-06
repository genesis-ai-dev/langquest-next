// What this phone has for use without a connection, said where people look:
// on each passage, as a mark on the Map, and in Settings (decisions.md 61).
// Text, status and history of the open language are always here; audio
// (core `offlineByUnit`) and, on a phone, study pictures and audio
// (study/studyFiles.ts) are here only for passages kept offline. The worry this
// answers: someone browses passages online, plays their audio, and finds out
// in the field that none of it came along.
import { defaultOfflineScope, laneName, offlineByUnit, offlineSummary, type OfflineSummary, type UnitOffline } from '@langquest-next/core';
import { useMemo, useSyncExternalStore } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { Ctx } from './ctx';
import { Card, Ico, ProgressBar, SmallBtn, txt, type IconName } from './kit';
import { plural } from './passageView';
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
export function useOfflineUnits(ctx: Ctx, unitIds: readonly string[]): Map<string, KeptOffline> {
  const state = ctx.project.state;
  const { present, keptUnits } = ctx.project.blobs;
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
  const state = ctx.project.state;
  const { present, keptUnits } = ctx.project.blobs;
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
export type OfflineOverview = OfflineSummary & { studyToFetch: number };

export function useOfflineSummary(ctx: Ctx): OfflineOverview | null {
  const state = ctx.project.state;
  const { present, keptUnits } = ctx.project.blobs;
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

export function sizeText(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

const REASON: Record<NonNullable<UnitOffline['reason']>, string> = {
  assigned: "Kept because it's assigned to you.",
  worked: "Kept because you've worked on it.",
  chosen: 'Kept because you chose to keep it.'
};

/** Where one passage stands: on this phone, coming, or not kept; with the words for each. */
function passageOfflineView(u: KeptOffline, offline: boolean, hasStudy: boolean) {
  const notSent = u.notSent ? ` ${plural(u.notSent, 'recording')} ${u.notSent === 1 ? "hasn't" : "haven't"} been sent from the phone that made ${u.notSent === 1 ? 'it' : 'them'} yet.` : '';
  // The web app opens online only (decisions.md 58), so its study media stay on the web.
  const studyOnline = hasStudy && !STUDY_FILES_OFFLINE ? ' Study pictures and study audio need a connection in the web app.' : '';
  const here = u.here + u.studyHere;
  const total = u.audio + u.studyTotal;
  if (u.reason && u.ready) {
    const what = u.studyTotal ? 'Its text, audio and study pictures work' : u.audio ? 'Its text and audio work' : 'Its text works';
    return {
      icon: 'onPhone' as IconName, tint: onColor.green, bg: TINT.green, short: 'On this phone',
      label: 'On this phone',
      sub: `${what} without a connection${u.audio || u.studyTotal ? '' : ', and new audio downloads as it arrives'}. ${REASON[u.reason]}${notSent}${studyOnline}`
    };
  }
  if (u.reason) {
    const left = u.bytesToFetch ? `, ${sizeText(u.bytesToFetch)} of audio to go` : '';
    return {
      icon: 'download' as IconName, tint: offline ? TINT.amberText : C.primary, bg: offline ? TINT.amber : C.light,
      short: offline ? `Only ${here} of ${total} files on this phone` : `Downloading for offline · ${here} of ${total}`,
      label: offline ? 'Not all of it is on this phone yet' : 'Downloading for offline',
      sub: `${here} of ${total} ${u.studyTotal ? 'audio and study files' : 'audio files'} are here${left}. ${offline ? 'Connect to finish before you travel.' : 'Stay connected until this finishes.'} ${REASON[u.reason]}${notSent}${studyOnline}`
    };
  }
  const needs = hasStudy && STUDY_FILES_OFFLINE ? 'its audio and study pictures need' : 'its audio needs';
  return {
    icon: 'notOnPhone' as IconName, tint: TINT.amberText, bg: TINT.amber,
    short: offline ? 'Audio not on this phone' : 'Not kept on this phone',
    label: offline ? 'Audio not on this phone' : 'Not kept on this phone',
    sub: `${offline ? `You can read it and record, but ${needs} a connection.` : `Its text is here, but ${needs} a connection. Keep it offline to take it with you.`}${studyOnline}`
  };
}

/** One line at the top of a passage, so nobody has to scroll to learn it will not come along. */
export function PassageOfflineLine(props: { ctx: Ctx; unitId: string }) {
  const u = useOfflineUnits(props.ctx, [props.unitId]).get(props.unitId);
  if (!u) return null;
  const v = passageOfflineView(u, props.ctx.project.online === false, false);
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
  const v = passageOfflineView(u, ctx.project.online === false, props.hasStudy);
  const keep = (on: boolean) => {
    void ctx.project.blobs.keepOffline(unitId, on);
    ctx.toast(on ? 'Kept on this phone. It downloads while you are connected.' : 'No longer kept. Its audio may be removed to make room.');
  };
  return (
    <Card accessibilityLabel={`${v.label}. ${v.sub}`}>
      <Block icon={v.icon} tint={v.tint} bg={v.bg} title={v.label} body={v.sub} />
      {u.reason && !u.ready ? <ProgressBar value={u.audio + u.studyTotal ? ((u.here + u.studyHere) / (u.audio + u.studyTotal)) * 100 : 0} /> : null}
      {!u.reason ? <View style={styles.action}><SmallBtn label="Keep offline" icon="download" onPress={() => keep(true)} /></View> : null}
      {u.reason === 'chosen' ? <View style={styles.action}><SmallBtn label="Stop keeping offline" onPress={() => keep(false)} /></View> : null}
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
  if (!u?.reason) return 'Audio not kept on this phone';
  return u.ready ? 'On this phone' : 'Downloading for offline';
}

/** Settings' one line. */
export function offlineLine(s: OfflineOverview | null): string {
  if (!s) return 'Checking this phone…';
  if (s.kept === 0) return 'No passages kept yet. Keep one from its page.';
  if (s.ready === s.kept) return `${s.kept === 1 ? 'Your 1 kept passage is' : `All ${s.kept} kept passages are`} on this phone`;
  const left = [s.bytesToFetch ? `${sizeText(s.bytesToFetch)} of audio` : '', s.studyToFetch ? plural(s.studyToFetch, 'study file') : ''].filter(Boolean).join(' and ');
  return `${s.ready} of ${plural(s.kept, 'kept passage')} ready${left ? ` · ${left} to download` : ''}`;
}

/** The Sync screen's card: how ready this phone is, and what never comes along. */
export function OfflineCard(props: { ctx: Ctx; s: OfflineOverview | null }) {
  const { ctx, s } = props;
  const offline = ctx.project.online === false;
  const ready = !!s && s.kept > 0 && s.ready === s.kept;
  const state = ctx.project.state;
  const language = state && ctx.laneId ? laneName(state, ctx.laneId) : 'this language';
  const head = ready
    ? { icon: 'onPhone' as IconName, tint: onColor.green, bg: TINT.green }
    : s?.kept && !offline ? { icon: 'download' as IconName, tint: C.primary, bg: C.light }
    : { icon: 'notOnPhone' as IconName, tint: TINT.amberText, bg: TINT.amber };
  const finish = s && s.kept && !ready ? (offline ? ' Connect to finish before you travel.' : ' Stay connected until this finishes.') : '';
  return (
    <Card>
      <Block icon={head.icon} tint={head.tint} bg={head.bg} title="Ready for offline" body={`${offlineLine(s).replace(/\.$/, '')}.${finish}`} />
      {s && s.kept ? <ProgressBar value={(s.ready / s.kept) * 100} {...(ready ? { color: onColor.green } : {})} /> : null}
      <Block icon="check" tint={onColor.green} bg={TINT.green} title="Always on this phone"
        body={`Every passage's text, status and history in ${language}. Audio${STUDY_FILES_OFFLINE ? ', study pictures, maps and study audio' : ''} of passages you are assigned to, have worked on, or chose to keep.`} />
      <Block icon="cloud" tint={TINT.amberText} bg={TINT.amber} title="Needs a connection"
        body={[
          `Audio${STUDY_FILES_OFFLINE ? ' and study material' : ''} of passages you have not kept. Open a passage and tap Keep offline to take it with you.`,
          STUDY_FILES_OFFLINE ? 'Study films.' : 'Study pictures, maps and study audio, in the web app.',
          'Reports.',
          'Other languages. Open one while connected to bring it up to date.'
        ].map((l) => `• ${l}`).join('\n')} />
      {s && s.notSent ? (
        <Text style={txt.xs}>{plural(s.notSent, 'recording')} in your kept passages {s.notSent === 1 ? "hasn't" : "haven't"} been sent from the phone that made {s.notSent === 1 ? 'it' : 'them'} yet, so no phone can download {s.notSent === 1 ? 'it' : 'them'}.</Text>
      ) : null}
    </Card>
  );
}

function Block(props: { icon: IconName; tint: string; bg: string; title: string; body: string }) {
  return (
    <View style={styles.head} accessible accessibilityLabel={`${props.title}. ${props.body}`}>
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
