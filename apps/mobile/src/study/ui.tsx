// The study screens' shared widgets (the UX demo's screens/shared.tsx
// `useAudio`, `AudioBar`, `MediaTile`, `MediaSheet`, `StudyStepMark`, and
// study.tsx's `ViewSwitch`, `PassageReader`, `ContributeSheet`). STUDY-3,
// STUDY-5, STUDY-7, ADR-019. Audio follows audioSession.ts: starting one
// player stops every other, and playback sets the session to play mode.
import type { PassageNote } from '@langquest-next/core';
import { createElement, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Image, Platform, Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { Text } from '../ui/text';
import { openContentLink } from '../ui/share';
import { AudioClip } from '../audio/audioClip';
import { studyUri } from './studyFiles';
import type { Ctx } from '../shell/ctx';
import { HelpBadge } from '../helpMode/helpBadge';
import { useHelpOn, useHelpSpot } from '../helpMode/useHelpMode';
import { t } from '../i18n';
import { formatNumber } from '../i18n/format';
import { Field, HelpInfo, Ico, NoteCard, PrimaryBtn, Sheet, type IconName } from '../ui/kit';
import { txt } from '../ui/textStyles';
import { when, type PassageView } from '../passage/passageView';
import { Authored, ReportFlag } from '../moderation/reportSheet';
import { recordTarget } from '../moderation/reportTargets';
import { SourceReader } from '../sources/SourceReader';
import { C, space, type as T } from '../ui/theme';
import { VoiceNote } from '../audio/voiceNote';
import type { GlossaryEntry, StudyMedia, StudyMediaKind, StudyResource } from './guides';
import { useStudyFileUri } from './useStudyFileUri';
import type { StudyStepStatus } from './progress';
import { inlineParts, isCallout, isQuestion, studySections, type StudySection } from './text';
import { shownClock, mediaKindLabel, CALLOUT_LOOK, calloutLabel } from './studyText';
import { saveNote } from './studyActions';
import { styles } from './studyStyles';
import { useStudyAudio, type StudyAudio } from './useStudyAudio';

// ---- audio -------------------------------------------------------------------------

/** A drag's press while help is on: the bar explains itself; moving waits until help is off. */
const DRAG_HERE = () => undefined;

/** Drag or tap along the bar to move; screen readers step 10 seconds. */
function Scrubber(props: { value: number; max: number; label: string; onSeek: (s: number) => void }) {
  const [width, setWidth] = useState(0);
  const spot = useHelpSpot(t('study.audio.position', { label: props.label }), t('study.audio.positionHelp'), DRAG_HERE);
  const pct = props.max > 0 ? Math.max(0, Math.min(1, props.value / props.max)) : 0;
  const at = (x: number) => { if (width > 0) props.onSeek((Math.max(0, Math.min(width, x)) / width) * props.max); };
  return (
    <View onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)} style={styles.scrubber}
      onStartShouldSetResponder={() => !spot.id} onMoveShouldSetResponder={() => !spot.id} onResponderTerminationRequest={() => false}
      onResponderGrant={(e) => at(e.nativeEvent.locationX)} onResponderMove={(e) => at(e.nativeEvent.locationX)}
      accessible accessibilityRole="adjustable" accessibilityLabel={t('study.audio.position', { label: props.label })}
      accessibilityValue={{ min: 0, max: Math.round(props.max), now: Math.round(props.value), text: shownClock(props.value) }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => props.onSeek(props.value + (e.nativeEvent.actionName === 'increment' ? 10 : -10))}>
      <View style={[styles.track, { pointerEvents: 'none' }]}>
        <View style={[styles.trackFill, { width: `${pct * 100}%` }]} />
      </View>
      <View style={[{ pointerEvents: 'none' }, styles.thumb, { left: pct * width - 9 }]} />
      {spot.id ? (
        <Pressable onPress={spot.onPress} accessibilityRole="button" accessibilityLabel={t('study.audio.position', { label: props.label })} style={StyleSheet.absoluteFill}>
          <HelpBadge spot={spot} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** Play/pause, a scrubber, and back 10 seconds. */
export function AudioBar(props: { audio: StudyAudio; label: string; sub?: string }) {
  const a = props.audio;
  const play = useHelpSpot(a.playing ? t('study.audio.pause', { label: props.label }) : t('study.audio.play', { label: props.label }), t('recording.player.playHelp'), a.toggle);
  const back = useHelpSpot(t('common.backTenSeconds'), t('recording.player.back10Help'), () => a.seek(a.time - 10));
  return (
    <View style={styles.audioBar}>
      <Pressable onPress={play.onPress} accessibilityRole="button" accessibilityLabel={a.playing ? t('study.audio.pause', { label: props.label }) : t('study.audio.play', { label: props.label })}
        style={({ pressed }) => [styles.playBtn, pressed && styles.pressed]}>
        <Ico name={a.playing ? 'pause' : 'play'} size={26} color={C.white} />
        <HelpBadge spot={play} />
      </Pressable>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <Text style={[txt.sm, { fontWeight: '700', flex: 1 }]} numberOfLines={1}>{props.label}</Text>
          <Text style={[txt.xs, { fontVariant: ['tabular-nums'] }]}>{shownClock(a.time)} / {shownClock(a.duration)}</Text>
        </View>
        <Scrubber value={a.time} max={a.duration} label={props.label} onSeek={a.seek} />
        {props.sub ? <Text style={[txt.xs, { marginTop: -2 }]} numberOfLines={2}>{props.sub}</Text> : null}
      </View>
      <Pressable onPress={back.onPress} accessibilityRole="button" accessibilityLabel={t('common.backTenSeconds')}
        style={({ pressed }) => [styles.backBtn, pressed && styles.pressed]}>
        <Ico name="undo" size={16} color={C.primary} />
        <Text style={[txt.xsStrong, { color: C.primary }]}>{formatNumber(10)}</Text>
        <HelpBadge spot={back} />
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
            // help-ignore: no screen shows this switch today; give it a line (useHelpSpot) when one does
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
    <View accessibilityLabel={s.done ? t('study.step.done') : started ? t('study.step.started') : t('study.step.notStarted')}
      style={{ width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center',
        backgroundColor: s.done ? C.green : started ? C.light : C.card, borderWidth: s.done ? 0 : 1.5, borderColor: started ? C.primary : C.border }}>
      {s.done ? <Ico name="check" size={Math.round(size * 0.55)} color={C.white} strokeWidth={3} />
        : <Text style={[txt.sm, { fontWeight: '800', color: C.primary }]}>{formatNumber(s.index + 1)}</Text>}
    </View>
  );
}

/** One note from the study or the passage reader, with its voice note when there is one. */
export function StudyNote(props: { ctx: Ctx; note: PassageNote; label?: string }) {
  const n = props.note;
  const anchor = props.label ?? (n.blobHash && !n.text ? t('common.voiceNote') : t('study.note.note'));
  return (
    <Authored ctx={props.ctx} by={n.by}>
      <NoteCard anchor={n.photoHash ? t('study.note.withPhoto', { anchor }) : anchor} {...(n.text ? { text: n.text } : {})} by={props.ctx.name(n.by)} when={when(n.hlc)}
        icon={n.blobHash ? 'mic' : 'note'}
        audio={n.blobHash ? <AudioClip language={props.ctx.language} hashes={[n.blobHash]} label={t('study.note.playVoiceNote')} /> : undefined}
        action={<ReportFlag ctx={props.ctx} target={recordTarget(props.ctx, 'note', n.id, n.by, n.unitId)} size={36} />} />
    </Authored>
  );
}

// ---- writing notes -------------------------------------------------------------------

/** Answer, note, or report what the group said: by voice or text (STUDY-3). */
export function ContributeSheet(props: {
  ctx: Ctx;
  unitId: string;
  languageId: string;
  title: string;
  where: string;
  onClose: () => void;
  onSave: (c: { text: string; blobHash: string | null }) => Promise<boolean>;
}) {
  const [text, setText] = useState('');
  const [hash, setHash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Sheet visible title={props.title} sub={t('study.contribute.sub')} onClose={props.onClose}
      footer={<PrimaryBtn label={t('common.save')} busy={busy} disabled={!text.trim() && !hash}
        onPress={() => { setBusy(true); void props.onSave({ text, blobHash: hash }).then((ok) => { setBusy(false); if (ok) props.onClose(); }); }} />}>
      <View style={styles.where}><Text style={txt.smMuted}>{props.where}</Text></View>
      <VoiceNote ctx={props.ctx} label={t('study.contribute.record')} hash={hash} onChange={setHash} />
      <Field value={text} onChangeText={setText} placeholder={t('common.orTypeIt')} help={t('study.contribute.typeHelp')} multiline />
    </Sheet>
  );
}

// ---- pictures, maps and glossary terms ----------------------------------------------------

const MEDIA_ICON: Record<StudyMediaKind, IconName> = { map: 'map', photo: 'camera', illustration: 'media', video: 'video' };

/** The picture when there is a file for it (FIA sends low-resolution copies), a neutral stand-in otherwise or offline. */
function MediaImage(props: { item: StudyMedia; orgId?: string | null }) {
  const [failed, setFailed] = useState(false);
  const it = props.item;
  const { uri, waiting } = useStudyFileUri(props.orgId, it.file, it.url);
  // A film kept as a file plays in the browser; phones have no player for it yet, so they say so.
  const film = it.kind === 'video' && !!it.file;
  if (film && uri && Platform.OS === 'web') {
    return createElement('video', { src: uri, controls: true, preload: 'metadata', 'aria-label': it.title, style: { width: '100%', aspectRatio: '16 / 9', backgroundColor: '#000', display: 'block' } });
  }
  if (!uri || failed || film) {
    const why = film ? t('study.media.filmsOnWeb') : waiting ? t('common.loading') : uri ? t('study.media.notLoaded') : mediaKindLabel(it.kind);
    return (
      <View style={styles.standIn} accessibilityLabel={t('study.media.standIn', { kind: mediaKindLabel(it.kind), title: it.title })}>
        <Ico name={MEDIA_ICON[it.kind]} size={40} color={C.faint} />
        <Text style={[txt.xs, { textAlign: 'center' }]}>{why}</Text>
      </View>
    );
  }
  // A kept copy of a picture known only by its address plays from the phone (studyFiles.ts); a stored file is already local.
  return <Image source={{ uri: it.file ? uri : studyUri(uri) }} accessibilityLabel={it.title} onError={() => setFailed(true)}
    resizeMode={it.kind === 'map' ? 'contain' : 'cover'} style={styles.image} />;
}

/** A set of pictures or a map, full width. A map opens full size. */
export function MediaSheet(props: { resource: StudyResource; source: string; orgId?: string | null; onClose: () => void }) {
  const items = props.resource.media ?? [];
  const kinds = [...new Set(items.map((i) => mediaKindLabel(i.kind)))].join(t('study.listSeparator'));
  const tapMap = items.some((i) => i.kind === 'map' && i.url);
  const noCopy = items.some((i) => i.noPhoneCopy);
  return (
    <Sheet visible title={props.resource.title} sub={kinds ? `${kinds} · ${props.source}` : props.source} onClose={props.onClose}>
      {props.resource.description ? <Text style={txt.body}>{props.resource.description}</Text> : null}
      {items.map((item) => (
        <View key={item.id} style={{ gap: space.xs }}>
          {item.kind === 'map' && item.url ? (
            <MapFullSize item={item} url={item.url} orgId={props.orgId} />
          ) : (
            <View style={styles.imageWrap}><MediaImage item={item} orgId={props.orgId} /></View>
          )}
          {item.caption || (items.length > 1 && item.title) ? (
            <Text style={txt.smMuted}>
              {items.length > 1 ? <Text style={{ fontWeight: '700', color: C.dark }}>{item.title}. </Text> : null}{item.caption}
            </Text>
          ) : null}
        </View>
      ))}
      <Text style={txt.xs}>
        {tapMap && noCopy ? t('study.media.lowResMapFilm') : tapMap ? t('study.media.lowResMap') : noCopy ? t('study.media.lowResFilm') : t('study.media.lowRes')}
      </Text>
    </Sheet>
  );
}

/** A map that opens full size, outside the app. */
function MapFullSize(props: { item: StudyMedia; url: string; orgId?: string | null }) {
  const label = t('study.media.openFullSize', { title: props.item.title });
  const spot = useHelpSpot(label, t('study.media.openFullSizeHelp'), () => openContentLink(props.url));
  return (
    <Pressable onPress={spot.onPress} accessibilityRole="link" accessibilityLabel={label}
      style={({ pressed }) => [styles.imageWrap, pressed && styles.pressed]}>
      <MediaImage item={props.item} orgId={props.orgId} />
      <HelpBadge spot={spot} />
    </Pressable>
  );
}

/** A glossary term: its entry, read aloud when there is audio, and the language's key term when there is one. */
export function GlossarySheet(props: { entry: GlossaryEntry; source: string; orgId?: string | null; hasKeyTerm: boolean; onOpenTerm: () => void; onClose: () => void }) {
  const e = props.entry;
  const words = (e.body ?? e.hint ?? '').split(/\s+/).filter(Boolean).length;
  const { uri: audioUri } = useStudyFileUri(props.orgId, e.audioFile, e.audioUrl);
  const audio = useStudyAudio(audioUri, Math.max(5, Math.round(words / 2.5)));
  useEffect(() => () => audio.pause(), []); // eslint-disable-line react-hooks/exhaustive-deps -- it reads only refs, so the first draw's copy is enough on unmount
  return (
    <Sheet visible title={e.term} sub={t('study.glossary.sub', { source: props.source })} onClose={props.onClose}
      footer={props.hasKeyTerm ? <PrimaryBtn label={t('study.glossary.openKeyTerm')} icon="book" onPress={props.onOpenTerm} /> : undefined}>
      {e.hint ? <Text style={[txt.body, { fontWeight: '600' }]}>{e.hint}</Text> : null}
      {e.audioUrl || e.audioFile ? <AudioBar audio={audio} label={t('study.glossary.listen', { term: e.term })} {...(audio.failed ? { sub: t('study.glossary.standIn') } : {})} /> : null}
      {e.body ? e.body.split(/\n{2,}/).map((para, i) => <Text key={i} style={txt.body}>{para.trim()}</Text>) : null}
      {!props.hasKeyTerm ? <Text style={txt.xs}>{t('study.glossary.notKeyTerm')}</Text> : null}
    </Sheet>
  );
}

// ---- a step's text: callouts, list items, headings and links -------------------------------

/** Inline text: bold words and links to pictures, maps and glossary terms. */
function Inline(props: { text: string; onOpenRef?: (ref: string) => void }): ReactNode {
  // While help is on a link does not open: the text around it explains it (StepPreview).
  const helpOn = useHelpOn();
  return inlineParts(props.text).map((p, i) => {
    if (p.type === 'text') return p.text;
    if (p.type === 'bold') return <Text key={i} style={{ fontWeight: '700' }}>{p.text}</Text>;
    return (
      <Text key={i} onPress={props.onOpenRef && !helpOn ? () => props.onOpenRef!(p.ref) : undefined} accessibilityRole="link" suppressHighlighting={false}
        style={{ fontWeight: '700', color: C.primary, textDecorationLine: 'underline' }}>{p.text}</Text>
    );
  });
}

/** One section of a step's text, drawn the same on the step screen and in the guide editor's preview. */
export function SectionBody(props: { section: StudySection; onOpenRef?: (ref: string) => void }) {
  const sec = props.section;
  const inline = <Inline text={sec.text} {...(props.onOpenRef ? { onOpenRef: props.onOpenRef } : {})} />;
  if (isCallout(sec.kind)) {
    const look = CALLOUT_LOOK[sec.kind];
    const Icon = look.icon;
    return (
      <View style={[styles.callout, { backgroundColor: look.bg, borderColor: look.edge }, sec.kind === 'question' && styles.calloutOutlined]}>
        <View style={styles.calloutHead}>
          <Icon size={16} color={look.ink} strokeWidth={2.4} />
          <Text style={[styles.calloutLabel, { color: look.ink }]}>{calloutLabel(sec.kind)}</Text>
        </View>
        <Text style={styles.stepText}>{inline}</Text>
      </View>
    );
  }
  if (sec.kind === 'item') {
    return (
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <Text style={[styles.stepText, styles.itemMark]}>{sec.n ? `${sec.n}.` : '•'}</Text>
        <Text style={[styles.stepText, { flex: 1 }, isQuestion(sec) && { fontWeight: '600' }]}>{inline}</Text>
      </View>
    );
  }
  if (sec.kind === 'heading') return <Text style={txt.h3}>{inline}</Text>;
  return <Text style={styles.stepText}>{inline}</Text>;
}

/** A step's whole text as the step screen shows it, without notes: the guide editor's live preview. */
export function StepPreview(props: { text: string; onOpenRef?: (ref: string) => void }) {
  const sections = useMemo(() => studySections(props.text), [props.text]);
  if (!sections.length) return <View style={styles.textCard}><Text style={[txt.smMuted, { padding: space.md }]}>{t('study.nothingWritten')}</Text></View>;
  const body = sections.map((sec) => (
    <View key={sec.id} style={{ paddingHorizontal: space.sm }}>
      <View style={styles.previewSection}><SectionBody section={sec} {...(props.onOpenRef ? { onOpenRef: props.onOpenRef } : {})} /></View>
    </View>
  ));
  // Links that open: while help is on the text says what they do, since a link inside it cannot light on its own.
  const linked = !!props.onOpenRef && sections.some((sec) => inlineParts(sec.text).some((p) => p.type === 'link'));
  if (!linked) return <View style={styles.textCard}>{body}</View>;
  return <HelpInfo label={t('common.preview')} detail={t('study.preview.linksHelp')} style={styles.textCard}>{body}</HelpInfo>;
}

// ---- the passage: read and listen in a few translations, note any verse (STUDY-5) -------

// ---- the passage: read and listen in the language's Bibles, note any verse (STUDY-5) -------

/**
 * The study's Passage view: the source reader (sources/SourceReader.tsx)
 * with the team's notes on each verse. Tapping a verse plays on from it and
 * selects it, so a note can be added there; paused in a verse, the note
 * says where.
 */
export function PassageReader(props: { ctx: Ctx; v: PassageView; canContribute: boolean; header?: ReactNode; hidden?: boolean }) {
  const { ctx, v } = props;
  const [adding, setAdding] = useState<{ verse: string; at?: string; code: string } | null>(null);
  const notes = useMemo(() => v.p.notes.filter((n) => n.anchor.kind === 'verse'), [v.p.notes]);
  const notesOn = (ref: string) => notes.filter((n) => n.anchor.kind === 'verse' && n.anchor.verse === ref);
  return (
    <>
      <SourceReader ctx={ctx} unitId={v.unitId} languageId={v.languageId} layout="screen" hidden={props.hidden}
        {...(props.header ? { header: props.header } : {})}
        onMoreBibles={() => ctx.go('bible_explore', { unitId: v.unitId, languageId: v.languageId })}
        verse={{
          badge: (row) => notesOn(row.key).length,
          below: (row, c) => {
            const here = notesOn(row.key);
            if (!(c.selected && props.canContribute) && here.length === 0) return null;
            return (
              <View style={{ paddingLeft: 44, paddingRight: space.xs, paddingBottom: space.sm, gap: space.sm }}>
                {c.selected && props.canContribute ? (
                  <AddNoteHere label={c.at ? t('study.reader.addNoteOnAt', { verse: row.key, time: c.at }) : t('study.reader.addNoteOn', { verse: row.key })}
                    onPress={() => setAdding({ verse: row.key, code: c.code, ...(c.at ? { at: c.at } : {}) })} />
                ) : null}
                {here.map((n) => {
                  const a = n.anchor.kind === 'verse' ? [n.anchor.translation, n.anchor.at].filter(Boolean).join(' · ') : '';
                  return <StudyNote key={n.id} ctx={ctx} note={n} label={a || t('study.reader.verse', { verse: row.key })} />;
                })}
              </View>
            );
          }
        }} />
      {adding ? (
        <ContributeSheet ctx={ctx} unitId={v.unitId} languageId={v.languageId} title={t('common.addNote')}
          where={adding.at
            ? t('study.reader.whereAt', { title: v.title, verse: adding.verse, bible: adding.code, time: adding.at })
            : t('study.reader.where', { title: v.title, verse: adding.verse, bible: adding.code })}
          onClose={() => setAdding(null)}
          onSave={(c) => saveNote(ctx, v, { kind: 'verse', verse: adding.verse, translation: adding.code, ...(adding.at ? { at: adding.at } : {}) }, c,
            t('study.reader.noteAdded', { verse: adding.verse }))} />
      ) : null}
    </>
  );
}

/** "Add a note on 15:20" under the verse chosen in the passage reader. */
function AddNoteHere(props: { label: string; onPress: () => void }) {
  const spot = useHelpSpot(props.label, t('study.reader.addNoteHelp'), props.onPress);
  return (
    <Pressable onPress={spot.onPress} accessibilityRole="button" style={({ pressed }) => [styles.addBtn, pressed && styles.pressed]}>
      <Ico name="note" size={16} color={C.white} />
      <Text style={[txt.sm, { fontWeight: '700', color: C.white }]}>{props.label}</Text>
      <HelpBadge spot={spot} />
    </Pressable>
  );
}
