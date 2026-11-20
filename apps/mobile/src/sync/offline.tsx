// What this phone has for use without a connection, said where people look:
// a download button on each passage's row and tile and at the top of the
// passage, one over a book's passages and beside an outline section's name
// for all of them at once (LAN-316), and in Settings (decisions.md 61, 166).
// Text, status and history of the open language are here once its first
// download has filled every passage in (decisions.md 147; until then the Map
// says it is downloading, and a passage not reached yet shows its line); audio
// (core `offlineByUnit`) and, on a phone, study pictures and audio
// (study/studyFiles.ts) are here only for passages kept offline. The worry this
// answers: someone browses passages online, plays their audio, and finds out
// in the field that none of it came along.
import { languageName, offlineByUnit, unitTitle, type UnitOffline } from '@langquest-next/core';
import { deriveKinds, passageSummary } from '../i18n/coreText';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../ui/text';
import type { Ctx } from '../shell/ctx';
import { Card, Header, HelpInfo, Ico, LinkBtn, ProgressBar, Screen, type IconName } from '../ui/kit';
import { HelpBadge } from '../helpMode/helpBadge';
import { isOffline } from './uploadsModel';
import { useHelpSpot } from '../helpMode/useHelpMode';
import { txt } from '../ui/textStyles';
import { endsSentence } from '../helpMode/helpContext';
import { t } from '../i18n';
import { STUDY_FILES_OFFLINE } from '../study/studyFiles';
import { C, onColor, radius, space, TINT } from '../ui/theme';
import { keptOfflineMap, offlineLine, sentences, type KeptOffline, type OfflineOverview } from './offlineText';
import { fillBanner, fits, groupLook, groupOffline, groupSpoken, letGoWords, noRoomWords, offlineLook, type FillSeen, type GroupLook, type OfflineLook } from './offlineModel';
import { useStudyRevision } from './useOfflineSummary';
import { WaveArrow } from './transit';
import { useSyncStatus } from './useSyncStatus';
import { a11yState } from '../ui/a11yModel';
import { noteExpected } from '../diagnostics/report';

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
function DownloadDisc(props: { look: OfflineLook | GroupLook; size?: number }) {
  const { look } = props;
  const size = props.size ?? DISC;
  const ready = look.kind === 'ready';
  const amber = look.kind === 'partial' || look.kind === 'noRoom';
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
  const offline = isOffline(ctx.language.online);
  const look = offlineLook(u, { offline, downloading: useSyncStatus().downloading.has(unitId) });
  const keep = useKeepToggle(ctx, unitId, u, offline);
  const spot = useHelpSpot(look.label, keep.help, keep.onPress);
  return (
    <Pressable {...(props.testID ? { testID: props.testID } : {})} onPress={spot.onPress} disabled={!keep.onPress && !spot.id} accessibilityRole="button" accessibilityLabel={look.label}
      {...a11yState({ disabled: !keep.onPress }, 'button')} hitSlop={4} style={({ pressed }) => [styles.discTap, pressed && { opacity: 0.6 }]}>
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
  const offline = isOffline(ctx.language.online);
  const look = offlineLook(u, { offline, downloading: useSyncStatus().downloading.has(unitId) });
  const keep = useKeepToggle(ctx, unitId, u, offline);
  const spot = useHelpSpot(look.label, keep.help, keep.onPress);
  const tone = look.kind === 'ready' ? { bg: TINT.green, fg: TINT.greenText } : look.kind === 'partial' ? { bg: TINT.amber, fg: TINT.amberText }
    : look.kind === 'checking' || look.kind === 'noConnection' ? { bg: C.card, fg: C.muted } : { bg: C.card, fg: C.primary };
  return (
    <Pressable testID="passage-offline" onPress={spot.onPress} disabled={!keep.onPress && !spot.id} accessibilityRole="button" accessibilityLabel={look.label}
      {...a11yState({ disabled: !keep.onPress }, 'button')}
      style={({ pressed }) => [styles.bar, { backgroundColor: tone.bg, borderColor: look.kind === 'none' ? C.border : tone.bg }, pressed && { opacity: 0.7 }]}>
      <DownloadDisc look={look} size={30} />
      <Text style={[txt.sm, { flex: 1, fontWeight: '700', color: tone.fg }]}>{look.label}</Text>
      <HelpBadge spot={spot} />
    </Pressable>
  );
}

/** A value that can change many times a second, followed at most once every `ms`: the latest is taken when the wait ends. */
function useSlowly<T>(value: T, ms: number): T {
  const [slow, setSlow] = useState(value);
  const latest = useRef(value);
  latest.current = value;
  const waiting = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (Object.is(value, slow) || waiting.current) return;
    waiting.current = setTimeout(() => { waiting.current = null; setSlow(latest.current); }, ms);
  }, [value, slow, ms]);
  useEffect(() => () => { if (waiting.current) clearTimeout(waiting.current); waiting.current = null; }, []);
  return slow;
}

/**
 * What keeping some passages would take: `bytes` of audio to bring down
 * (null when the device could not work it out), and the `room` it has for
 * them: what is free above what recording keeps (`BlobStore.roomBytes`),
 * and what it would free for them by itself (the session's `freeable`).
 * `room` is null where the device cannot say.
 */
type GroupCost = { bytes: number | null; room: number | null };

/**
 * A group's cost, asked a beat after its passages are known and again as the
 * language changes, at most every few seconds (a sync changes it many times
 * a second). `answer` is null until these passages have been answered for,
 * and stays while they are asked about again. `ask` asks now, as a tap does,
 * and the line then says what the tap learned. Only what a tap would keep is
 * asked about, and only while `shown`.
 */
function useGroupCost(ctx: Ctx, unitIds: readonly string[], shown: boolean): { answer: GroupCost | null; ask: () => Promise<GroupCost> } {
  const key = unitIds.join('\n');
  const [cost, setCost] = useState<(GroupCost & { key: string }) | null>(null);
  const { offlineCost, store } = ctx.language.blobs;
  const revision = useSlowly(ctx.language.revision, 5000);
  const current = useRef(key);
  current.current = key;
  const ask = useCallback(async (): Promise<GroupCost> => {
    const c = key ? await offlineCost(key.split('\n')).catch((e: unknown) => { noteExpected('offline: group cost', e); return null; }) : null;
    const free = store?.roomBytes() ?? null;
    const found: GroupCost = { bytes: c ? c.bytes : null, room: free === null ? null : free + (c?.freeable ?? 0) };
    // Kept only for the passages now asked about: an answer for an earlier set never replaces a later one's.
    if (current.current === key) setCost({ key, ...found });
    return found;
  }, [key, offlineCost, store]);
  useEffect(() => {
    if (!shown || !key) return;
    // A beat later, so passages kept one after another ask once.
    const timer = setTimeout(() => { void ask(); }, 300);
    return () => clearTimeout(timer);
  }, [shown, key, ask, revision]);
  return { answer: cost && cost.key === key ? cost : null, ask };
}

/**
 * A book's or an outline section's passages as one download (LAN-316,
 * docs/decisions/2026-11-20-a-book-has-its-own-download-button.md): what its
 * button says and what a tap does, from each passage's own count (decisions.md
 * 166). A tap keeps the passages not kept yet; once every one is kept it lets
 * go those the person chose, as a passage's button does. `sized`: say how much
 * audio would come before the tap.
 */
function useGroup(ctx: Ctx, unitIds: readonly string[], sized: boolean): { look: GroupLook; onPress: (() => void) | undefined } {
  const counted = keptOfflineMap(ctx);
  const { keptOffline, keptUnits, keepOffline } = ctx.language.blobs;
  useStudyRevision();
  const offline = isOffline(ctx.language.online);
  const downloading = useSyncStatus().downloading;
  const g = useMemo(() => groupOffline(unitIds, keptOffline ? counted : null, keptUnits), [unitIds, keptOffline, counted, keptUnits]);
  // While a first download fills the language in (decisions.md 147) the device does not know every
  // passage's files, so it could not tell whether they fit: no group is offered until it ends.
  const fill = ctx.language.fill;
  const filling = !!fill && fill.total > 0;
  const offering = !filling && !g.checking && !offline && g.toKeep.length > 0;
  // The size is said before the tap: until it is answered the line is still checking.
  const { answer, ask } = useGroupCost(ctx, g.toKeep, sized && offering);
  const cost = answer && answer.bytes !== null ? { bytes: answer.bytes } : null;
  const look = groupLook(g, {
    offline, filling, downloading: unitIds.some((u) => downloading.has(u)), cost, room: answer?.room ?? null, sizing: sized && offering && !answer
  });
  const keep = async () => {
    // Asked again at the tap: a section's button says no size, and room changes.
    const now = await ask();
    const bytes = now.bytes ?? 0;
    if (!fits(bytes, now.room)) { ctx.toast(noRoomWords(bytes, now.room ?? 0)); return; }
    await keepOffline(g.toKeep, true);
  };
  const onPress = look.tap === 'keep' ? () => { void keep(); }
    : look.tap === 'letGo' ? () => { void keepOffline(g.chosen, false); ctx.toast(letGoWords(g)); }
    : look.tap === 'why' ? () => ctx.toast(look.help)
    : undefined;
  return { look, onPress };
}

/**
 * Over a book's passages: how many of them are on this device, and the
 * button that downloads the whole book for offline (LAN-316). The whole line
 * is the button, as at the top of a passage; it says how much audio would
 * come before the tap. Nothing for a book with no passages.
 */
export function GroupOfflineBar(props: { ctx: Ctx; unitIds: readonly string[]; testID?: string }) {
  const { look, onPress } = useGroup(props.ctx, props.unitIds, true);
  const spot = useHelpSpot(look.label, look.help, onPress);
  if (props.unitIds.length === 0) return null;
  const tone = look.kind === 'ready' ? { bg: TINT.green, fg: TINT.greenText } : look.kind === 'partial' || look.kind === 'noRoom' ? { bg: TINT.amber, fg: TINT.amberText }
    : look.kind === 'checking' || look.kind === 'noConnection' ? { bg: C.card, fg: C.muted } : { bg: C.card, fg: C.primary };
  return (
    <Pressable testID={props.testID ?? 'group-offline'} onPress={spot.onPress} disabled={!onPress && !spot.id} accessibilityRole="button" accessibilityLabel={groupSpoken(look)}
      {...a11yState({ disabled: !onPress }, 'button')}
      style={({ pressed }) => [styles.bar, { backgroundColor: tone.bg, borderColor: look.kind === 'none' ? C.border : tone.bg }, pressed && { opacity: 0.7 }]}>
      <DownloadDisc look={look} size={30} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[txt.sm, { fontWeight: '700', color: tone.fg }]}>{look.label}</Text>
        {look.notes.map((note) => <Text key={note} style={[txt.xs, { color: look.kind === 'none' ? C.muted : tone.fg }]}>{note}</Text>)}
      </View>
      <HelpBadge spot={spot} />
    </Pressable>
  );
}

/**
 * The same button as a round mark, at the end of an outline section's label
 * (lessons, stories): it downloads the section's passages for offline. Its
 * spoken label names the section; the size is asked at the tap.
 */
export function GroupDownloadButton(props: { ctx: Ctx; unitIds: readonly string[]; name: string; testID?: string }) {
  const { look, onPress } = useGroup(props.ctx, props.unitIds, false);
  const label = t('shell.a11y.labelDetail', { label: props.name, detail: groupSpoken(look) });
  const spot = useHelpSpot(label, look.help, onPress);
  if (props.unitIds.length === 0) return null;
  return (
    <Pressable {...(props.testID ? { testID: props.testID } : {})} onPress={spot.onPress} disabled={!onPress && !spot.id} accessibilityRole="button" accessibilityLabel={label}
      {...a11yState({ disabled: !onPress }, 'button')} hitSlop={4} style={({ pressed }) => [styles.discTap, pressed && { opacity: 0.6 }]}>
      <DownloadDisc look={look} />
      <HelpBadge spot={spot} />
    </Pressable>
  );
}

/**
 * While a first download fills a language in (decisions.md 147): how many
 * passages are on this device, with decision 61's progress bar. The Map
 * and the Sync screen show it; it goes once every passage is here.
 */
export function FillBanner(props: { ctx: Ctx }) {
  const { fill, languageId } = props.ctx.language;
  // Kept once shown, so the finished fill stays in place, as tall as it was (fillBanner, LAN-253).
  const [seen, setSeen] = useState<FillSeen | null>(null);
  const [height, setHeight] = useState(0);
  if (fill && fill.total > 0 && (seen?.languageId !== languageId || seen.total !== fill.total)) setSeen({ languageId, total: fill.total });
  const shown = fillBanner(fill, seen, languageId);
  if (!shown) return null;
  const offline = isOffline(props.ctx.language.online);
  const count = t('offline.fill.count', { filled: shown.filled, total: shown.total });
  const title = t(shown.done ? 'offline.onDevice' : 'offline.fill.title');
  const body = shown.done ? count : sentences(count, offline ? t('offline.connectToFinish') : t('offline.stayConnected'));
  return (
    <View onLayout={(e) => { if (!shown.done) setHeight(e.nativeEvent.layout.height); }} style={{ minHeight: shown.done ? height : 0 }}>
      <Card style={{ flexGrow: 1 }} accessibilityLabel={t('shell.a11y.labelDetail', { label: title, detail: body })}>
        <Block icon={shown.done ? 'check' : 'download'} tint={shown.done ? TINT.greenText : offline ? TINT.amberText : C.primary} bg={shown.done ? TINT.green : offline ? TINT.amber : C.light} title={title} body={body} />
        <HelpInfo label={title} detail={t('offline.fill.barHelp')}>
          <ProgressBar value={(shown.filled / shown.total) * 100} />
        </HelpInfo>
      </Card>
    </View>
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

/** A tile with an icon, a bold title and a line under it: the Map's banners and Sync's Ready for offline list. */
export function Block(props: { icon: IconName; tint: string; bg: string; title: string; body: string }) {
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
    borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth }
});
