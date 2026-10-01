// The study screens' shared widgets (the UX demo's screens/shared.tsx
// `useAudio`, `AudioBar`, `MediaTile`, `MediaSheet`, `StudyStepMark`, and
// study.tsx's `ViewSwitch`, `PassageReader`, `ContributeSheet`). STUDY-3,
// STUDY-5, STUDY-7, ADR-019. Audio follows audioSession.ts: starting one
// player stops every other, and playback sets the session to play mode.
import { commands, CommandError, type EventSpec, type NoteAnchor, type PassageNote } from '@langquest-next/core';
import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import * as Crypto from 'expo-crypto';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Image, Linking, Pressable, ScrollView, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { AudioClip } from '../audioClip';
import { registerPlayback, setSessionAudioMode, stopAudioPlayback } from '../audioSession';
import type { Ctx } from '../ctx';
import { indexesFor } from '../indexes';
import { Chip, ChipRow, EmptyState, Field, Ico, NoteCard, PrimaryBtn, Sheet, txt, type IconName } from '../kit';
import { plural, when, type PassageView } from '../passageView';
import { noteExpected, reportError } from '../report';
import { Authored, recordTarget, ReportFlag } from '../reportSheet';
import { readingSeconds, verseAt, type Reading } from '../scripture';
import { C, onColor, radius, shadow, space, target, TINT, type as T, withAlpha } from '../theme';
import { VoiceNote } from '../voiceNote';
import type { GlossaryEntry, StudyMedia, StudyMediaKind, StudyResource } from './guides';
import type { StudyStepStatus } from './progress';
import { clock } from './text';

// ---- audio -------------------------------------------------------------------------

export interface StudyAudio {
  playing: boolean;
  time: number;
  duration: number;
  /** No file, or it could not load: a clock at reading pace stands in. */
  simulated: boolean;
  /** There was a file and it could not load. */
  failed: boolean;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  seek: (seconds: number) => void;
}

/**
 * Plays a real file when there is one (FIA's step and glossary audio) and
 * falls back to a simulated clock when there is none or it cannot load
 * (offline), so the screen behaves the same either way. The file is only
 * fetched on the first Play, to spare field data.
 */
export function useStudyAudio(url: string | undefined, estimate: number): StudyAudio {
  const player = useRef<AudioPlayer | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(estimate);
  const [failed, setFailed] = useState(false);
  const simulated = !url || failed;
  const now = useRef({ time: 0, duration: estimate });
  now.current = { time, duration };
  // Where the simulated clock started from, so a seek while playing moves it.
  const base = useRef({ at: 0, from: 0 });

  useEffect(() => registerPlayback(() => { player.current?.pause(); setPlaying(false); }), []);
  useEffect(() => {
    setFailed(false);
    setPlaying(false);
    setTime(0);
    setDuration(estimate);
    return () => { player.current?.remove(); player.current = null; };
    // A new source starts over; the estimate only matters until the file says its length.
  }, [url]);

  useEffect(() => {
    if (!playing || !simulated) return;
    const tick = setInterval(() => {
      const end = now.current.duration;
      const t = Math.min(base.current.from + (Date.now() - base.current.at) / 1000, end);
      setTime(t);
      if (t >= end) setPlaying(false);
    }, 250);
    return () => clearInterval(tick);
  }, [playing, simulated]);

  /** The file could not load or play: the simulated clock carries on from `from`. */
  const fallBack = (from = now.current.time) => {
    player.current?.remove();
    player.current = null;
    base.current = { at: Date.now(), from };
    setFailed(true);
  };

  async function play() {
    stopAudioPlayback();
    if (simulated) {
      const from = now.current.time >= now.current.duration ? 0 : now.current.time;
      base.current = { at: Date.now(), from };
      setTime(from);
      setPlaying(true);
      return;
    }
    setPlaying(true);
    try {
      await setSessionAudioMode({ allowsRecording: false, playsInSilentMode: true });
      let p = player.current;
      if (!p) {
        const created = createAudioPlayer({ uri: url! }, { updateInterval: 250 });
        p = created;
        player.current = created;
        created.addListener('playbackStatusUpdate', (st) => {
          if (player.current !== created) return;
          if (st.error) { fallBack(); return; }
          if (st.duration > 0) setDuration(st.duration);
          if (st.isLoaded) setTime(st.currentTime);
          if (st.didJustFinish) setPlaying(false);
        });
        if (now.current.time > 0) await created.seekTo(now.current.time);
      } else if (p.duration > 0 && p.currentTime >= p.duration - 0.1) {
        await p.seekTo(0);
      }
      p.play();
    } catch (e) {
      // Offline or a bad file: expected in the field, and the bar says so.
      noteExpected('study audio: play', e);
      fallBack();
    }
  }
  function pause() {
    player.current?.pause();
    setPlaying(false);
  }
  function seek(seconds: number) {
    const v = Math.max(0, Math.min(seconds, now.current.duration));
    setTime(v);
    base.current = { at: Date.now(), from: v };
    if (player.current && !simulated) {
      player.current.seekTo(v).catch((e: unknown) => {
        // The player lost its place: keep the bar where it was moved to, on the stand-in clock.
        noteExpected('study audio: seek', e);
        fallBack(v);
      });
    }
  }
  return { playing, time, duration, simulated, failed, play: () => void play(), pause, toggle: () => (playing ? pause() : void play()), seek };
}

/** Drag or tap along the bar to move; screen readers step 10 seconds. */
function Scrubber(props: { value: number; max: number; label: string; onSeek: (s: number) => void }) {
  const [width, setWidth] = useState(0);
  const pct = props.max > 0 ? Math.max(0, Math.min(1, props.value / props.max)) : 0;
  const at = (x: number) => { if (width > 0) props.onSeek((Math.max(0, Math.min(width, x)) / width) * props.max); };
  return (
    <View onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)} style={styles.scrubber}
      onStartShouldSetResponder={() => true} onMoveShouldSetResponder={() => true} onResponderTerminationRequest={() => false}
      onResponderGrant={(e) => at(e.nativeEvent.locationX)} onResponderMove={(e) => at(e.nativeEvent.locationX)}
      accessible accessibilityRole="adjustable" accessibilityLabel={`Position in ${props.label}`}
      accessibilityValue={{ min: 0, max: Math.round(props.max), now: Math.round(props.value), text: clock(props.value) }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => props.onSeek(props.value + (e.nativeEvent.actionName === 'increment' ? 10 : -10))}>
      <View pointerEvents="none" style={styles.track}>
        <View style={[styles.trackFill, { width: `${pct * 100}%` }]} />
      </View>
      <View pointerEvents="none" style={[styles.thumb, { left: pct * width - 9 }]} />
    </View>
  );
}

/** Play/pause, a scrubber, and back 10 seconds. */
export function AudioBar(props: { audio: StudyAudio; label: string; sub?: string }) {
  const a = props.audio;
  return (
    <View style={styles.audioBar}>
      <Pressable onPress={a.toggle} accessibilityRole="button" accessibilityLabel={a.playing ? `Pause ${props.label}` : `Play ${props.label}`}
        style={({ pressed }) => [styles.playBtn, pressed && styles.pressed]}>
        <Ico name={a.playing ? 'pause' : 'play'} size={26} color={C.white} />
      </Pressable>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <Text style={[txt.sm, { fontWeight: '700', flex: 1 }]} numberOfLines={1}>{props.label}</Text>
          <Text style={[txt.xs, { fontVariant: ['tabular-nums'] }]}>{clock(a.time)} / {clock(a.duration)}</Text>
        </View>
        <Scrubber value={a.time} max={a.duration} label={props.label} onSeek={a.seek} />
        {props.sub ? <Text style={[txt.xs, { marginTop: -2 }]} numberOfLines={2}>{props.sub}</Text> : null}
      </View>
      <Pressable onPress={() => a.seek(a.time - 10)} accessibilityRole="button" accessibilityLabel="Back 10 seconds"
        style={({ pressed }) => [styles.backBtn, pressed && styles.pressed]}>
        <Ico name="undo" size={16} color={C.primary} />
        <Text style={[txt.xsStrong, { color: C.primary }]}>10</Text>
      </Pressable>
    </View>
  );
}

// ---- layout pieces -------------------------------------------------------------------

/** Study material or the passage: two views of one screen, so switching never loses your place. */
export function ViewSwitch<T extends string>(props: { views: { id: T; label: string; icon: IconName }[]; active: T; onChange: (v: T) => void }) {
  return (
    <View style={styles.switchWrap}>
      <View style={styles.switch} accessibilityRole="tablist">
        {props.views.map((v) => {
          const on = props.active === v.id;
          return (
            <Pressable key={v.id} onPress={() => props.onChange(v.id)} accessibilityRole="tab" accessibilityState={{ selected: on }}
              style={({ pressed }) => [styles.switchTab, on && styles.switchOn, pressed && styles.pressed]}>
              <Ico name={v.icon} size={16} color={on ? C.primary : C.muted} />
              <Text style={[txt.sm, { fontWeight: '700', color: on ? C.dark : C.muted }]} numberOfLines={1}>{v.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** A step's mark: its number, a tinted ring once someone added to it, a green check when finished. */
export function StepMark(props: { status: StudyStepStatus; size?: number }) {
  const s = props.status;
  const size = props.size ?? 32;
  const started = !s.done && s.notes.length > 0;
  return (
    <View accessibilityLabel={s.done ? 'Done' : started ? 'Started' : 'Not started'}
      style={{ width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center',
        backgroundColor: s.done ? C.green : started ? C.light : C.card, borderWidth: s.done ? 0 : 1.5, borderColor: started ? C.primary : C.border }}>
      {s.done ? <Ico name="check" size={Math.round(size * 0.55)} color={C.white} strokeWidth={3} />
        : <Text style={[txt.sm, { fontWeight: '800', color: C.primary }]}>{s.index + 1}</Text>}
    </View>
  );
}

/** "Done by you · Sep 2 · 2 notes", "2 notes", "Not started". */
export function stepLine(ctx: Ctx, s: StudyStepStatus): string {
  if (s.done) return `Done by ${ctx.name(s.done.by, true)} · ${when(s.done.hlc)}${s.notes.length ? ` · ${plural(s.notes.length, 'note')}` : ''}`;
  if (s.notes.length) return plural(s.notes.length, 'note');
  return 'Not started';
}

/** One note from the study or the passage reader, with its voice note when there is one. */
export function StudyNote(props: { ctx: Ctx; note: PassageNote; label?: string }) {
  const n = props.note;
  const anchor = props.label ?? (n.blobHash && !n.text ? 'Voice note' : 'Note');
  return (
    <Authored ctx={props.ctx} by={n.by}>
      <NoteCard anchor={n.photoHash ? `${anchor} · photo` : anchor} {...(n.text ? { text: n.text } : {})} by={props.ctx.name(n.by)} when={when(n.hlc)}
        icon={n.blobHash ? 'mic' : 'note'}
        audio={n.blobHash ? <AudioClip project={props.ctx.project} hashes={[n.blobHash]} label="Play voice note" /> : undefined}
        action={<ReportFlag ctx={props.ctx} target={recordTarget(props.ctx, 'note', n.id, n.by, n.unitId, n.laneId)} size={36} />} />
    </Authored>
  );
}

// ---- writing notes -------------------------------------------------------------------

/**
 * Add a note to the passage's record (STUDY-7); returns whether it was saved.
 * A note the record refuses says why; anything else is reported with an id.
 * A failed write was already shown by ctx.act.
 */
export async function saveNote(ctx: Ctx, v: Pick<PassageView, 'unitId' | 'laneId'>, anchor: NoteAnchor, c: { text: string; blobHash: string | null }, message: string): Promise<boolean> {
  const state = ctx.project.state;
  if (!state) return false;
  let specs: EventSpec[];
  try {
    specs = commands(state, indexesFor(state)).addNote({
      commandId: Crypto.randomUUID(), unitId: v.unitId, laneId: v.laneId, anchor,
      ...(c.text.trim() ? { text: c.text.trim() } : {}), ...(c.blobHash ? { blobHash: c.blobHash } : {})
    });
  } catch (e) {
    if (e instanceof CommandError) ctx.toast(e.message);
    else ctx.toast(`Something went wrong (code ${reportError('study: build note', e)}). Nothing was lost.`);
    return false;
  }
  try {
    await ctx.act(specs, message);
    return true;
  } catch (e) {
    noteExpected('study: save note', e);
    return false;
  }
}

/** Answer, note, or report what the group said: by voice or text (STUDY-3). */
export function ContributeSheet(props: {
  ctx: Ctx;
  unitId: string;
  laneId: string;
  title: string;
  where: string;
  onClose: () => void;
  onSave: (c: { text: string; blobHash: string | null }) => Promise<boolean>;
}) {
  const [text, setText] = useState('');
  const [hash, setHash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Sheet visible title={props.title} sub="It stays with the passage, and reviewers see it with the study." onClose={props.onClose}
      footer={<PrimaryBtn label="Save" busy={busy} disabled={!text.trim() && !hash}
        onPress={() => { setBusy(true); void props.onSave({ text, blobHash: hash }).then((ok) => { setBusy(false); if (ok) props.onClose(); }); }} />}>
      <View style={styles.where}><Text style={txt.smMuted}>{props.where}</Text></View>
      <VoiceNote ctx={props.ctx} unitId={props.unitId} laneId={props.laneId} label="Record what the group said" hash={hash} onChange={setHash} />
      <Field value={text} onChangeText={setText} placeholder="Or type it" multiline />
    </Sheet>
  );
}

// ---- pictures, maps and glossary terms ----------------------------------------------------

const MEDIA_LABEL: Record<StudyMediaKind, string> = { map: 'Map', photo: 'Photo', illustration: 'Illustration', video: 'Video' };
const MEDIA_ICON: Record<StudyMediaKind, IconName> = { map: 'map', photo: 'camera', illustration: 'media', video: 'video' };

export function resourceIcon(r: StudyResource | undefined): IconName {
  return r?.kind === 'map' ? 'map' : r?.kind === 'term' ? 'book' : 'camera';
}

/** The picture when there is a file for it (FIA sends low-resolution copies), a neutral stand-in otherwise or offline. */
function MediaImage(props: { item: StudyMedia }) {
  const [failed, setFailed] = useState(false);
  const it = props.item;
  if (!it.url || failed) {
    return (
      <View style={styles.standIn} accessibilityLabel={`${MEDIA_LABEL[it.kind]}: ${it.title}`}>
        <Ico name={MEDIA_ICON[it.kind]} size={40} color={C.faint} />
        <Text style={[txt.xs, { textAlign: 'center' }]}>{it.url ? 'Not loaded. Check your connection.' : MEDIA_LABEL[it.kind]}</Text>
      </View>
    );
  }
  return <Image source={{ uri: it.url }} accessibilityLabel={it.title} onError={() => setFailed(true)}
    resizeMode={it.kind === 'map' ? 'contain' : 'cover'} style={styles.image} />;
}

/** A set of pictures or a map, full width. A map opens full size. */
export function MediaSheet(props: { resource: StudyResource; source: string; onClose: () => void }) {
  const items = props.resource.media ?? [];
  const kinds = [...new Set(items.map((i) => MEDIA_LABEL[i.kind]))].join(', ');
  return (
    <Sheet visible title={props.resource.title} sub={kinds ? `${kinds} · ${props.source}` : props.source} onClose={props.onClose}>
      {props.resource.description ? <Text style={txt.body}>{props.resource.description}</Text> : null}
      {items.map((item) => (
        <View key={item.id} style={{ gap: space.xs }}>
          {item.kind === 'map' && item.url ? (
            <Pressable onPress={() => void Linking.openURL(item.url!)} accessibilityRole="link" accessibilityLabel={`Open ${item.title} full size`}
              style={({ pressed }) => [styles.imageWrap, pressed && styles.pressed]}>
              <MediaImage item={item} />
            </Pressable>
          ) : (
            <View style={styles.imageWrap}><MediaImage item={item} /></View>
          )}
          {item.caption || (items.length > 1 && item.title) ? (
            <Text style={txt.smMuted}>
              {items.length > 1 ? <Text style={{ fontWeight: '700', color: C.dark }}>{item.title}. </Text> : null}{item.caption}
            </Text>
          ) : null}
        </View>
      ))}
      <Text style={txt.xs}>
        Low-resolution copies, sized for phones with little data.{items.some((i) => i.kind === 'map' && i.url) ? ' Tap the map to open it full size.' : ''}
      </Text>
    </Sheet>
  );
}

/** A glossary term: its entry, read aloud when there is audio, and the project's key term when there is one. */
export function GlossarySheet(props: { entry: GlossaryEntry; source: string; hasKeyTerm: boolean; onOpenTerm: () => void; onClose: () => void }) {
  const e = props.entry;
  const words = (e.body ?? e.hint ?? '').split(/\s+/).filter(Boolean).length;
  const audio = useStudyAudio(e.audioUrl, Math.max(5, Math.round(words / 2.5)));
  useEffect(() => () => audio.pause(), []);
  return (
    <Sheet visible title={e.term} sub={`Glossary · ${props.source}`} onClose={props.onClose}
      footer={props.hasKeyTerm ? <PrimaryBtn label="Open the key term" icon="book" onPress={props.onOpenTerm} /> : undefined}>
      {e.hint ? <Text style={[txt.body, { fontWeight: '600' }]}>{e.hint}</Text> : null}
      {e.audioUrl ? <AudioBar audio={audio} label={`Listen: ${e.term}`} {...(audio.failed ? { sub: "Couldn't load the audio — playing a stand-in" } : {})} /> : null}
      {e.body ? e.body.split(/\n{2,}/).map((para, i) => <Text key={i} style={txt.body}>{para.trim()}</Text>) : null}
      {!props.hasKeyTerm ? <Text style={txt.xs}>This term isn't in your organization's key terms yet.</Text> : null}
    </Sheet>
  );
}

// ---- the passage: read and listen in a few translations, note any verse (STUDY-5) -------

export function PassageReader(props: { ctx: Ctx; v: PassageView; readings: Reading[]; canContribute: boolean; header?: ReactNode; hidden?: boolean }) {
  const [code, setCode] = useState(props.readings[0]?.code);
  const reading = props.readings.find((r) => r.code === code) ?? props.readings[0];
  if (!reading) {
    return (
      <ScrollView contentContainerStyle={styles.body}>
        {props.header}
        <EmptyState icon="book" title={`No Bible text for ${props.v.title} yet`}
          sub="The app has the text of a few passages so far. The rest comes with the translations your organization chooses." />
      </ScrollView>
    );
  }
  return <TranslationView key={reading.code} {...props} reading={reading} onPick={setCode} />;
}

function TranslationView(props: { ctx: Ctx; v: PassageView; readings: Reading[]; reading: Reading; canContribute: boolean; header?: ReactNode; hidden?: boolean; onPick: (code: string) => void }) {
  const { ctx, v, reading } = props;
  const audio = useStudyAudio(reading.audioUrl, Math.ceil(readingSeconds(reading)));
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState<{ verse: string; at?: string } | null>(null);
  const current = verseAt(reading, audio.time);
  const scroll = useRef<ScrollView>(null);
  const cardY = useRef(0);
  const rows = useRef<Record<string, number>>({});
  const notes = useMemo(() => v.p.notes.filter((n) => n.anchor.kind === 'verse'), [v.p.notes]);
  const notesOn = (ref: string) => notes.filter((n) => n.anchor.kind === 'verse' && n.anchor.verse === ref);

  useEffect(() => {
    if (!audio.playing || !current) return;
    const y = rows.current[current.ref];
    if (y !== undefined) scroll.current?.scrollTo({ y: Math.max(0, cardY.current + y - 180), animated: true });
  }, [audio.playing, current?.ref]);
  useEffect(() => () => audio.pause(), []);
  useEffect(() => { if (props.hidden) audio.pause(); }, [props.hidden]);

  const sub = reading.audioUrl ? reading.translation : `${reading.translation} · no recording yet, the clock follows reading pace`;
  return (
    <ScrollView ref={scroll} stickyHeaderIndices={[1]} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
      <View style={{ gap: space.md }}>
        {props.header}
        {props.readings.length > 1 ? (
          <ChipRow>
            {props.readings.map((r) => <Chip key={r.code} label={r.code} on={r.code === reading.code} onPress={() => props.onPick(r.code)} />)}
          </ChipRow>
        ) : null}
      </View>
      <View style={styles.sticky}>
        <AudioBar audio={audio} label={`${v.title} · ${reading.code}`} sub={sub} />
        {props.canContribute && !audio.playing && audio.time > 0 && current ? (
          <Pressable onPress={() => setAdding({ verse: current.ref, at: clock(audio.time) })} accessibilityRole="button"
            style={({ pressed }) => [styles.momentBtn, pressed && styles.pressed]}>
            <Ico name="note" size={16} color={TINT.amberText} />
            <Text style={[txt.sm, { fontWeight: '700', color: TINT.amberText }]}>Add a note at {clock(audio.time)} · verse {current.ref}</Text>
          </Pressable>
        ) : null}
      </View>
      <View style={styles.textCard} onLayout={(e) => { cardY.current = e.nativeEvent.layout.y; }}>
        {reading.verses.map((verse) => {
          const here = notesOn(verse.ref);
          const isSel = selected === verse.ref;
          const playingHere = current?.ref === verse.ref && audio.time > 0;
          return (
            <View key={verse.ref} onLayout={(e) => { rows.current[verse.ref] = e.nativeEvent.layout.y; }} style={{ paddingHorizontal: space.sm }}>
              <Pressable disabled={!props.canContribute} onPress={() => setSelected((cur) => (cur === verse.ref ? null : verse.ref))}
                accessibilityRole={props.canContribute ? 'button' : undefined} accessibilityState={{ selected: isSel }}
                style={[styles.verse, playingHere && { backgroundColor: C.light }, isSel && styles.selected]}>
                <Text style={[styles.verseRef, playingHere && { color: C.primary }]}>{verse.ref}</Text>
                <Text style={[styles.readingText, { flex: 1 }]}>{verse.text}</Text>
                {here.length > 0 && !isSel ? <View style={styles.count}><Text style={styles.countText}>{here.length}</Text></View> : null}
              </Pressable>
              {isSel && props.canContribute ? (
                <Pressable onPress={() => setAdding({ verse: verse.ref })} accessibilityRole="button"
                  style={({ pressed }) => [styles.addBtn, { marginLeft: 44 }, pressed && styles.pressed]}>
                  <Ico name="note" size={16} color={C.white} />
                  <Text style={[txt.sm, { fontWeight: '700', color: C.white }]}>Add a note on {verse.ref}</Text>
                </Pressable>
              ) : null}
              {here.length > 0 ? (
                <View style={{ paddingLeft: 44, paddingRight: space.xs, paddingBottom: space.sm, gap: space.sm }}>
                  {here.map((n) => {
                    const a = n.anchor.kind === 'verse' ? [n.anchor.translation, n.anchor.at].filter(Boolean).join(' · ') : '';
                    return <StudyNote key={n.id} ctx={ctx} note={n} label={a || `Verse ${verse.ref}`} />;
                  })}
                </View>
              ) : null}
            </View>
          );
        })}
      </View>
      <Text style={[txt.xs, { paddingHorizontal: space.xs }]}>
        Notes on the passage stay with it, like the rest of the study, and reviewers see them with the team's notes.
      </Text>
      {adding ? (
        <ContributeSheet ctx={ctx} unitId={v.unitId} laneId={v.laneId} title="Add a note"
          where={`${v.title} · verse ${adding.verse} · ${reading.code}${adding.at ? ` · ${adding.at}` : ''}`}
          onClose={() => { setAdding(null); setSelected(null); }}
          onSave={(c) => saveNote(ctx, v, { kind: 'verse', verse: adding.verse, translation: reading.code, ...(adding.at ? { at: adding.at } : {}) }, c,
            `Note added on ${adding.verse} — it follows this passage`)} />
      ) : null}
    </ScrollView>
  );
}

export const styles = StyleSheet.create({
  pressed: { opacity: 0.7 },
  body: { padding: space.lg, gap: space.md, paddingBottom: space.xxl },
  sticky: { backgroundColor: C.bg, paddingBottom: space.xs, gap: space.sm },
  audioBar: { flexDirection: 'row', alignItems: 'center', gap: space.md, backgroundColor: C.card, borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.border, paddingHorizontal: space.md, paddingVertical: space.md, ...shadow },
  playBtn: { width: 56, height: 56, borderRadius: 28, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' },
  backBtn: { width: 48, height: 48, borderRadius: 24, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 1 },
  scrubber: { height: target.min, justifyContent: 'center' },
  track: { height: 6, borderRadius: 3, backgroundColor: C.border, overflow: 'hidden' },
  trackFill: { height: 6, borderRadius: 3, backgroundColor: C.primary },
  thumb: { position: 'absolute', top: (target.min - 18) / 2, width: 18, height: 18, borderRadius: 9, backgroundColor: C.primary, borderWidth: 2, borderColor: C.white },
  momentBtn: { minHeight: 48, borderRadius: radius.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm,
    backgroundColor: C.card, borderWidth: 1, borderColor: C.border, paddingHorizontal: space.md },
  switchWrap: { paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.sm, backgroundColor: C.card, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: C.border },
  switch: { flexDirection: 'row', gap: 4, padding: 4, borderRadius: radius.lg, backgroundColor: C.bg },
  switchTab: { flex: 1, minHeight: 48, borderRadius: radius.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm, paddingHorizontal: space.sm },
  switchOn: { backgroundColor: C.card, ...shadow },
  textCard: { backgroundColor: C.card, borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth, borderColor: C.border, paddingVertical: space.sm },
  verse: { flexDirection: 'row', gap: space.sm, borderRadius: radius.md, paddingHorizontal: space.sm, paddingVertical: 6, minHeight: 48 },
  verseRef: { width: 36, textAlign: 'right', paddingTop: 3, fontSize: T.xs, fontWeight: '700', color: C.muted, fontVariant: ['tabular-nums'] },
  readingText: { fontSize: T.base, lineHeight: 28, color: C.dark },
  selected: { backgroundColor: withAlpha(C.primary, 0.07), borderWidth: 1.5, borderColor: withAlpha(C.primary, 0.38) },
  count: { minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 5, backgroundColor: onColor.amber, alignItems: 'center', justifyContent: 'center', marginTop: 3 },
  countText: { fontSize: T.xs, fontWeight: '800', color: C.white },
  addBtn: { alignSelf: 'flex-start', minHeight: target.min, borderRadius: radius.md, flexDirection: 'row', alignItems: 'center', gap: space.sm,
    paddingHorizontal: space.lg, marginTop: space.xs, marginBottom: space.xs, backgroundColor: onColor.amber },
  where: { backgroundColor: C.card, borderLeftWidth: 3, borderColor: C.primary, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.sm },
  imageWrap: { borderRadius: radius.lg, overflow: 'hidden', backgroundColor: TINT.gray },
  image: { width: '100%', aspectRatio: 4 / 3, backgroundColor: TINT.gray },
  standIn: { width: '100%', aspectRatio: 4 / 3, alignItems: 'center', justifyContent: 'center', gap: space.sm, backgroundColor: TINT.gray, padding: space.lg }
});
