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
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../ui/text';
import type { Ctx } from '../shell/ctx';
import { Card, GhostBtn, Header, HelpInfo, Ico, PrimaryBtn, ProgressBar, Screen, Sheet, SmallBtn, type IconName } from '../ui/kit';
import { HelpBadge } from '../helpMode/helpBadge';
import { isOffline } from './uploadsModel';
import { useHelpSpot } from '../helpMode/useHelpMode';
import { txt } from '../ui/textStyles';
import { t } from '../i18n';
import { C, onColor, radius, space, TINT } from '../ui/theme';
import { keptOfflineMap, sentences, type KeptOffline } from './offlineText';
import { fillBanner, groupSpoken, offlineLook, type FillSeen, type GroupLook, type OfflineLook } from './offlineModel';
import { useReferenceRevision } from './useOfflineSummary';
import { WaveArrow } from './transit';
import { a11yState } from '../ui/a11yModel';
import { useLayout } from '../ui/useLayout';
import { useComing, useGroupOffline, type GroupOffer } from './useGroupOffline';

/**
 * Where one passage stands, from what this device has counted and nothing
 * else (decisions.md 166): the session's count of every passage it keeps
 * (useLanguage, worked out from the phone's table), or "checking" until that
 * count has this passage in it. A passage the count leaves out is not kept.
 */
function useOffline(ctx: Ctx, unitId: string): KeptOffline | 'checking' {
  const counted = keptOfflineMap(ctx);
  const { keptOffline, keptUnits } = ctx.language.blobs;
  useReferenceRevision();
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
function DownloadDisc(props: { look: { kind: OfflineLook['kind'] | GroupLook['kind'] }; size?: number }) {
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
  const look = offlineLook(u, { offline, downloading: useComing()(unitId) });
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

const NOT_KEPT: KeptOffline = {
  reason: null, audio: 0, here: 0, toFetch: 0, bytesToFetch: 0, notSent: 0, ready: false, studyHere: 0, studyTotal: 0, studyUnknown: false,
  refHere: 0, refTotal: 0, refUnknown: false
};

/**
 * The top of a passage: whether its audio is on this device, and the
 * button that changes it, where nobody has to look for it (decisions.md
 * 61, 166). The whole line is the button.
 */
export function PassageOfflineBar(props: { ctx: Ctx; unitId: string }) {
  const { ctx, unitId } = props;
  const u = useOffline(ctx, unitId);
  const offline = isOffline(ctx.language.online);
  const look = offlineLook(u, { offline, downloading: useComing()(unitId) });
  const keep = useKeepToggle(ctx, unitId, u, offline);
  const spot = useHelpSpot(look.label, keep.help, keep.onPress);
  const tone = toneOf(look.kind);
  return (
    <Pressable testID="passage-offline" onPress={spot.onPress} disabled={!keep.onPress && !spot.id} accessibilityRole="button" accessibilityLabel={look.label}
      {...a11yState({ disabled: !keep.onPress }, 'button')}
      style={({ pressed }) => [styles.bar, { backgroundColor: tone.bg, borderColor: look.kind === 'none' ? C.border : tone.bg }, pressed && { opacity: 0.7 }]}>
      <DownloadDisc look={look} size={30} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[txt.sm, { fontWeight: '700', color: tone.fg }]}>{look.label}</Text>
        {/* Files that cannot come, said, since no wait will bring them: what the study guide names and its source does not
            have, and reference audio there is no room kept for or that cannot be downloaded now. */}
        {/* A recording its phone has not sent: no device can download it, and nothing plays it until it is (decision 61, amended 2026-11-23). */}
        {u !== 'checking' && u.reason && u.notSent ? <Text style={[txt.xs, { color: tone.fg }]}>{t('offline.notSent', { count: u.notSent })}</Text> : null}
        {u !== 'checking' && u.studyRefused ? <Text style={[txt.xs, { color: tone.fg }]}>{t('offline.studyRefused', { count: u.studyRefused })}</Text> : null}
        {u !== 'checking' && u.refFull ? <Text style={[txt.xs, { color: tone.fg }]}>{t('offline.referenceFull')}</Text> : null}
        {u !== 'checking' && u.refUnavailable ? <Text style={[txt.xs, { color: tone.fg }]}>{t('offline.referenceUnavailable')}</Text> : null}
      </View>
      <HelpBadge spot={spot} />
    </Pressable>
  );
}

/** A download line's colours: green when it is all here, amber when some is missing or there is no room, quiet while it cannot be told. */
function toneOf(kind: GroupLook['kind']): { bg: string; fg: string } {
  if (kind === 'ready') return { bg: TINT.green, fg: TINT.greenText };
  if (kind === 'partial' || kind === 'noRoom') return { bg: TINT.amber, fg: TINT.amberText };
  if (kind === 'checking' || kind === 'noConnection') return { bg: C.card, fg: C.muted };
  return { bg: C.card, fg: C.primary };
}

/**
 * Before a book's or a section's passages are let go: what that does, and a
 * red button to do it. A tap on a line that said "on this device" used to
 * let a whole book go at once, which nobody could tell it would (Carl,
 * 2026-11-20).
 */
function RemoveSheet(props: { name: string; stay: number; visible: boolean; onClose: () => void; onRemove: () => void }) {
  return (
    <Sheet visible={props.visible} title={t('offline.group.removeTitle', { name: props.name })} onClose={props.onClose}
      footer={(
        <View style={{ gap: space.sm }}>
          <PrimaryBtn label={t('offline.group.removeConfirm')} tone="red" icon="close" onPress={() => { props.onClose(); props.onRemove(); }} help={t('offline.group.letGoHelp')} />
          <GhostBtn label={t('common.cancel')} onPress={props.onClose} full help={t('offline.group.removeCancelHelp')} />
        </View>
      )}>
      <Text style={txt.body}>{t('offline.group.removeBody')}</Text>
      {props.stay > 0 ? <Text style={txt.body}>{t('offline.group.removeStay', { count: props.stay })}</Text> : null}
    </Sheet>
  );
}

/**
 * A book's header line under how many of its passages are recorded: where
 * they stand on this device, and what they still lack there (a recording not
 * sent yet, reference audio that cannot come). The book's counts are in one
 * place, the header, rather than one "of 97 passages" over another (Carl,
 * 2026-11-23). Held at the tallest it has been on this screen, as the buttons
 * under it are, so a word that wraps in one state and not the next does not
 * move the page.
 */
export function GroupStatusLine(props: { group: GroupOffer; lead: string; testID?: string }) {
  const [tallest, setTallest] = useState(0);
  const centred = useLayout().kind === 'phone';
  const { look } = props.group;
  const align = centred ? { textAlign: 'center' as const } : null;
  const color = look.tone === 'ready' ? TINT.greenText : look.tone === 'waiting' ? TINT.amberText : look.tone === 'downloading' ? C.primary : C.muted;
  return (
    <View onLayout={(e) => { const h = e.nativeEvent.layout.height; if (h > tallest) setTallest(h); }} style={{ minHeight: tallest, alignItems: centred ? 'center' : 'flex-start' }}>
      <Text style={[txt.xs, align]}>{props.lead}</Text>
      {props.group.count > 0 ? (
        <Text testID={props.testID} style={[txt.xs, { fontWeight: '700', color }, align]}>{look.note ? `${look.title} · ${look.note}` : look.title}</Text>
      ) : null}
    </View>
  );
}

/**
 * Over a book's passages, its download buttons and no words (Carl,
 * 2026-11-23: the line over them said little the header and the buttons did
 * not): "Download" or "Download the rest", with the size of the recordings to
 * come once it is known, downloads the passages not kept yet for offline
 * (LAN-316); "Remove", once some passage the person chose is kept, lets them
 * go after asking. Where the passages stand, and what they lack, is in the
 * header (`GroupStatusLine`). A download that cannot run now (no connection,
 * the language still coming, too little room, the device still counting)
 * keeps its place, dimmed, and says why when tapped. Held at the tallest it
 * has been on this screen, so the chapters under it never move under a thumb
 * (LAN-253 for the banner). Nothing for a book with no passages.
 */
export function GroupOfflineBar(props: { group: GroupOffer; name: string; testID?: string }) {
  const { look, onPress, remove } = props.group;
  const [asking, setAsking] = useState(false);
  const [tallest, setTallest] = useState(0);
  if (props.group.count === 0) return null;
  const testID = props.testID ?? 'group-offline';
  const download = (look.tap === 'keep' || look.blocked !== null) && onPress;
  const label = look.button === 'rest'
    ? (look.size ? t('offline.group.downloadRestButtonSize', { size: look.size }) : t('offline.group.downloadRestButton'))
    : (look.size ? t('offline.group.downloadButtonSize', { size: look.size }) : t('offline.group.downloadButton'));
  return (
    <View testID={testID} onLayout={(e) => { const h = e.nativeEvent.layout.height; if (h > tallest) setTallest(h); }}
      style={[styles.groupActions, { minHeight: tallest }]}>
      {download ? (
        <SmallBtn testID={`${testID}-download`} icon="download" onPress={onPress} dimmed={look.blocked !== null}
          help={look.blocked ?? look.help} label={label} />
      ) : null}
      {remove ? <SmallBtn testID={`${testID}-remove`} label={t('common.remove')} icon="close" help={t('offline.group.letGoHelp')} onPress={() => setAsking(true)} /> : null}
      {remove ? <RemoveSheet name={props.name} stay={remove.stay} visible={asking} onClose={() => setAsking(false)} onRemove={remove.run} /> : null}
    </View>
  );
}

/**
 * The same button as a round mark, at the end of an outline section's label
 * (lessons, stories): it downloads the section's passages for offline. Its
 * spoken label names the section; the size is asked at the tap. Once every
 * passage is kept, a tap asks before letting them go.
 */
export function GroupDownloadButton(props: { ctx: Ctx; unitIds: readonly string[]; name: string; testID?: string }) {
  const { look, onPress, remove: keptRemove } = useGroupOffline(props.ctx, props.unitIds, false);
  const [asking, setAsking] = useState(false);
  // One mark, one tap: it downloads what is left first, and asks to remove only once every passage is kept.
  const remove = look.tap === 'letGo' ? keptRemove : null;
  const press = remove ? () => setAsking(true) : onPress;
  const label = t('shell.a11y.labelDetail', { label: props.name, detail: groupSpoken(look) });
  const spot = useHelpSpot(label, look.help, press);
  if (props.unitIds.length === 0) return null;
  return (
    <>
      <Pressable {...(props.testID ? { testID: props.testID } : {})} onPress={spot.onPress} disabled={!press && !spot.id} accessibilityRole="button" accessibilityLabel={label}
        {...a11yState({ disabled: !press }, 'button')} hitSlop={4} style={({ pressed }) => [styles.discTap, pressed && { opacity: 0.6 }]}>
        <DownloadDisc look={look} />
        <HelpBadge spot={spot} />
      </Pressable>
      {remove ? <RemoveSheet name={props.name} stay={remove.stay} visible={asking} onClose={() => setAsking(false)} onRemove={remove.run} /> : null}
    </>
  );
}

/**
 * Every mark a download button can show, drawn as the buttons draw it, with
 * what it means: the map's key for them (Carl, 2026-11-20: the marks were
 * defined nowhere). Opened from a book's screen and from Filter.
 */
export function DownloadKey() {
  const marks: { look: OfflineLook; sub: string }[] = [
    { look: { kind: 'none', label: t('offline.download') }, sub: t('offline.key.noneSub') },
    { look: { kind: 'downloading', label: t('offline.downloading') }, sub: t('offline.key.downloadingSub') },
    { look: { kind: 'partial', label: t('offline.key.partial') }, sub: t('offline.key.partialSub') },
    { look: { kind: 'ready', label: t('offline.onDevice') }, sub: t('offline.key.readySub') },
    { look: { kind: 'noConnection', label: t('offline.needsConnection') }, sub: t('offline.key.noConnectionSub') },
    { look: { kind: 'checking', label: t('offline.summary.checking') }, sub: t('offline.key.checkingSub') }
  ];
  return (
    <View style={{ gap: space.md }}>
      {marks.map((m) => (
        <View key={m.look.kind} style={styles.keyLine} accessible accessibilityLabel={t('shell.a11y.labelDetail', { label: m.look.label, detail: m.sub })}>
          <DownloadDisc look={m.look} size={30} />
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Text style={[txt.sm, { fontWeight: '700' }]}>{m.look.label}</Text>
            <Text style={txt.xs}>{m.sub}</Text>
          </View>
        </View>
      ))}
      <Text style={txt.xs}>{t('offline.key.tap')}</Text>
    </View>
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
    borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth },
  /** Under the words: Download and Remove side by side, the line's full width so both fit on a phone. */
  groupActions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  keyLine: { flexDirection: 'row', alignItems: 'center', gap: space.md }
});
