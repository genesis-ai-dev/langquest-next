// Pieces of the simple review (demo SIMPLE-10; Ryder's ReviewListen,
// ReviewQuestion, ReviewDecide, ReviewSayWhy and the agreed "Background,
// open"): the three-step strip under the header, the dots that count
// questions, a question in a card with a speaker, the two big Decide cards,
// and Background as one sheet with chips (Passage, Guide, Notes, Key words,
// Earlier). The Passage chip is the Bible the translator used: a player
// with a Bible picker, Back 10 s and Note (a note on the verse playing), and
// the passage's verses with the team's notes marked in amber with their
// author. Built from kit.tsx and theme tokens; every press goes through the
// kit or useHelpSpot (with its HelpBadge) so help mode explains it.
import {
  commands, usedOn,
  type KeyTermView, type KindDef, type PassageNote, type ReviewView, type SourcedQuestion
} from '@langquest-next/core';
import * as Crypto from 'expo-crypto';
import { useMemo, useState, type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AudioClip } from '../audioClip';
import type { Ctx } from '../ctx';
import { useHelpSpot } from '../helpContext';
import { HelpBadge, HelpClip } from '../helpBadge';
import { t } from '../i18n';
import { formatClock, formatNumber } from '../i18n/format';
import { indexesFor } from '../indexes';
import { Badge, Chip, ChipRow, Field, GhostBtn, Group, Ico, IconBtn, LinkBtn, NoteCard, PrimaryBtn, Row, txt, useLayout, type IconName } from '../kit';
import type { PassageView } from '../passageView';
import { when } from '../passageView';
import { Authored, recordTarget, ReportFlag } from '../reportSheet';
import { clockMs, questionSource, YES_NO, yesNoLabel, type Stage, type StageId } from '../reviewing/capture';
import { EarlierReviewsPart, TeamStudyPart } from '../reviewing/parts';
import { lift } from '../shadow';
import { usePassagePlayer } from '../sources/player';
import type { Usage } from '../sources/used';
import { usePassageSource, useSources } from '../sources/useSources';
import type { StudyProgress } from '../study/progress';
import { C, onColor, radius, space, target, TINT, type as T, withAlpha } from '../theme';
import { VoiceNote } from '../voiceNote';
import { SpeakBtn } from './reviewVoice';

// ---- the strip of steps ----------------------------------------------------------------------

/**
 * Listen · Questions · Decide under the header: round icons, a green check
 * for a step done, the brand colour for the step you are on. A step done
 * goes back with a tap; later ones wait for the footer's button.
 */
export function StepStrip(props: { stages: Stage[]; at: number; onGo: (id: StageId) => void }) {
  return (
    <View style={styles.strip} accessibilityLabel={t('review.simple.stepsLabel')}>
      {props.stages.map((st, i) => (
        <StripStep key={st.id} stage={st} index={i} count={props.stages.length} done={i < props.at} current={i === props.at} onGo={props.onGo} />
      ))}
    </View>
  );
}

function StripStep(props: { stage: Stage; index: number; count: number; done: boolean; current: boolean; onGo: (id: StageId) => void }) {
  const { stage, done, current } = props;
  const spot = useHelpSpot(stage.label, done ? t('review.simple.goBack') : t('review.simple.stepOf', { index: props.index + 1, total: props.count }), () => props.onGo(stage.id));
  const icon: IconName = done ? 'check' : stage.icon === 'help' ? 'help' : stage.icon;
  const fg = done ? TINT.greenText : current ? C.primary : C.muted;
  return (
    <Pressable onPress={spot.onPress} disabled={!done} accessibilityRole="button"
      accessibilityLabel={done ? t('review.simple.stepDone', { stage: stage.label }) : t('review.simple.stepA11y', { stage: stage.label, index: props.index + 1, total: props.count })}
      accessibilityState={{ selected: current, disabled: !done }}
      style={({ pressed }) => [styles.step, pressed && styles.pressed]}>
      <View style={[styles.stepMark, done ? { backgroundColor: C.green } : current ? { backgroundColor: C.primary } : styles.stepLater]}>
        <Ico name={icon} size={20} color={done || current ? C.white : C.muted} strokeWidth={done ? 3 : 2.2} />
      </View>
      <Text style={[styles.stepLabel, { color: fg }]} numberOfLines={1}>{stage.label}</Text>
      <HelpBadge spot={spot} />
    </Pressable>
  );
}

/** Which question of how many: the current one a long pill, the rest dots. */
export function QuestionDots(props: { count: number; at: number }) {
  if (props.count < 2) return null;
  return (
    <View style={styles.dots} accessibilityLabel={t('review.simple.questionOf', { index: props.at + 1, total: props.count })}>
      {Array.from({ length: props.count }, (_, i) => (
        <View key={i} style={[styles.dot, i === props.at ? styles.dotNow : i < props.at ? { backgroundColor: withAlpha(C.primary, 0.45) } : null]} />
      ))}
    </View>
  );
}

/** The question in a card, with a speaker that reads it aloud, and where it comes from. */
export function QuestionCard(props: { question: SourcedQuestion; asker?: string }) {
  const q = props.question;
  return (
    <View style={styles.qCard}>
      <SpeakBtn text={q.q.text} />
      <View style={{ flex: 1, minWidth: 0, gap: space.xs }}>
        <Text style={styles.qText} accessibilityRole="header">{q.q.text}</Text>
        {q.required || q.source !== 'org' ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm }}>
          {q.required ? <Badge label={t('common.required')} tone="brand" /> : null}
          {q.source !== 'org' ? <Text style={txt.xs}>{questionSource(q, props.asker)}</Text> : null}
        </View> : null}
      </View>
    </View>
  );
}

// ---- Decide -----------------------------------------------------------------------------------

/** One of the two big Decide cards: Looks good (green) or Needs changes (amber). */
export function DecideCard(props: { tone: 'green' | 'amber'; label: string; icon: IconName; onPress: () => void; busy?: boolean; disabled?: boolean }) {
  const green = props.tone === 'green';
  const spot = useHelpSpot(props.label, green ? t('review.simple.looksGoodHelp') : t('review.simple.needsChangesHelp'), props.onPress);
  return (
    <Pressable onPress={spot.onPress} disabled={props.disabled || props.busy} accessibilityRole="button" accessibilityLabel={props.label}
      accessibilityState={{ disabled: !!props.disabled, busy: !!props.busy }}
      style={({ pressed }) => [styles.decide, green ? { backgroundColor: TINT.green, borderColor: C.green } : { backgroundColor: TINT.amber, borderColor: C.amber },
        props.disabled && { opacity: 0.45 }, pressed && styles.pressed]}>
      <View style={[styles.decideMark, { backgroundColor: green ? onColor.green : onColor.amber }]}>
        <Ico name={props.icon} size={40} color={C.white} strokeWidth={green ? 3 : 2.4} />
      </View>
      <Text style={[styles.decideLabel, { color: green ? TINT.greenText : TINT.amberText }]}>{props.busy ? t('common.saving') : props.label}</Text>
      <HelpBadge spot={spot} />
    </Pressable>
  );
}

/** A small amber pill: "Needs changes". */
export function OutcomePill(props: { label: string }) {
  return (
    <View style={styles.pill}>
      <Ico name="chat" size={18} color={TINT.amberText} />
      <Text style={[txt.sm, { fontWeight: '800', color: TINT.amberText }]}>{props.label}</Text>
    </View>
  );
}

// ---- Background ------------------------------------------------------------------------------

export interface BackgroundData {
  terms: KeyTermView[];
  notes: PassageNote[];
  anchor: (n: PassageNote) => string;
  olderVersion: (n: PassageNote) => string | undefined;
  study: StudyProgress | null;
  earlier: ReviewView[];
}

type Tab = 'passage' | 'guide' | 'notes' | 'terms' | 'earlier';

/**
 * The Background row's line: what there is, in the translator's name ("The
 * passage, Deng's notes, key words, earlier checks"). `you` when the
 * translator is the person looking ("your notes").
 */
export function backgroundLine(d: BackgroundData, translator: { id: string; name: string; you: boolean }): string {
  const parts = [t('review.simple.bgLine.passage')];
  if (d.study) parts.push(t('review.simple.bgLine.study'));
  if (d.notes.length) {
    parts.push(!d.notes.every((n) => n.by === translator.id) ? t('review.simple.bgLine.notes')
      : translator.you ? t('review.simple.bgLine.yourNotes') : t('review.simple.bgLine.theirNotes', { name: translator.name }));
  }
  if (d.terms.length) parts.push(t('review.simple.bgLine.keyWords'));
  if (d.earlier.length) parts.push(t('review.simple.bgLine.earlier'));
  return parts.join(', ');
}

/**
 * Background as one sheet: chips switch between the passage in the Bible
 * the translator used, the team's study, notes, key words and earlier
 * checks. Leaving for a key term or the study closes the sheet first.
 */
export function BackgroundSheet(props: {
  ctx: Ctx;
  v: PassageView;
  takeId: string;
  /** The translator's first name; `translatorIsYou` when that is the person looking. */
  translator: string;
  translatorIsYou: boolean;
  data: BackgroundData;
  usage: Usage;
  kind: (id: string) => KindDef;
  onClose: () => void;
  onOpenTerm: (termId: string) => void;
  onOpenStep: (stepId: string) => void;
  onOpenStudy: () => void;
  onMoreBibles: () => void;
}) {
  const { ctx, v, data } = props;
  const [tab, setTab] = useState<Tab>('passage');
  const chips: { id: Tab; label: string; count?: number }[] = [
    { id: 'passage', label: t('review.simple.chips.passage') },
    ...(data.study ? [{ id: 'guide' as const, label: t('review.simple.chips.guide') }] : []),
    { id: 'notes', label: t('review.simple.chips.notes'), count: data.notes.length },
    { id: 'terms', label: t('review.simple.chips.terms'), count: data.terms.length },
    { id: 'earlier', label: t('review.simple.chips.earlier'), count: data.earlier.length }
  ];
  return (
    <TallSheet title={t('review.parts.background')} onClose={props.onClose}>
      <ChipRow>
        {chips.map((c) => <Chip key={c.id} label={c.label} {...(c.count !== undefined ? { count: c.count } : {})} on={tab === c.id} onPress={() => setTab(c.id)} />)}
      </ChipRow>
      {tab === 'passage' ? (
        <BiblePassage ctx={ctx} v={v} takeId={props.takeId} translator={props.translator} translatorIsYou={props.translatorIsYou} usage={props.usage} onMoreBibles={props.onMoreBibles} />
      ) : null}
      {tab === 'guide' && data.study ? (
        <Group><TeamStudyPart ctx={ctx} study={data.study} onOpenStep={props.onOpenStep} onOpenStudy={props.onOpenStudy} /></Group>
      ) : null}
      {tab === 'notes' ? (
        data.notes.length === 0 ? <Text style={[txt.smMuted, styles.empty]}>{t('review.simple.noNotes')}</Text> : (
          <View style={{ gap: space.sm }}>
            {[...data.notes].reverse().map((n) => {
              const older = data.olderVersion(n);
              return (
                <Authored key={n.id} ctx={ctx} by={n.by}>
                  <NoteCard anchor={data.anchor(n)} {...(n.text ? { text: n.text } : {})} by={ctx.name(n.by)} when={when(n.hlc)}
                    {...(older ? { olderVersion: older } : {})} icon={n.anchor.kind === 'term' ? 'book' : 'note'}
                    {...(n.blobHash ? { audio: <AudioClip language={ctx.language} hashes={[n.blobHash]} label={t('review.parts.playNote')} /> } : {})}
                    action={<ReportFlag ctx={ctx} target={recordTarget(ctx, 'note', n.id, n.by, n.unitId)} size={36} />} />
                </Authored>
              );
            })}
          </View>
        )
      ) : null}
      {tab === 'terms' ? (
        data.terms.length === 0 ? <Text style={[txt.smMuted, styles.empty]}>{t('review.simple.noTerms')}</Text> : (
          <Group>
            {data.terms.map((term, i) => {
              const rendering = term.renderings.at(-1)?.rendering;
              return (
                <Row key={term.termId} icon="key" label={term.term} sub={rendering ? t('review.simple.theirWord', { word: rendering }) : t('review.simple.noWordYet')}
                  last={i === data.terms.length - 1} onPress={() => props.onOpenTerm(term.termId)} />
              );
            })}
          </Group>
        )
      ) : null}
      {tab === 'earlier' ? (
        data.earlier.length === 0 ? <Text style={[txt.smMuted, styles.empty]}>{t('review.simple.noEarlier')}</Text>
          : <Group><EarlierReviewsPart ctx={ctx} reviews={data.earlier} kind={props.kind} /></Group>
      ) : null}
    </TallSheet>
  );
}

// ---- the passage in the Bible the translator used --------------------------------------------

function BiblePassage(props: { ctx: Ctx; v: PassageView; takeId: string; translator: string; translatorIsYou: boolean; usage: Usage; onMoreBibles: () => void }) {
  const { ctx, v, usage } = props;
  const passage = useSources(ctx, v.unitId, v.languageId);
  // The Bible the translator played or chose while recording this version (v1.ReferencesUsed).
  const used = useMemo(() => usedOn(v.state, { takeId: props.takeId }).filter((u) => u.kind === 'source'), [v.state, props.takeId]);
  const theirs = used.find((u) => u.opened && passage.options.some((o) => o.itemId === u.itemId))?.itemId;
  const [chosen, setChosen] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [noting, setNoting] = useState<{ verse: string; at: string } | null>(null);
  const [openVerse, setOpenVerse] = useState<string | null>(null);
  // A verse tapped where audio can't jump to it: Note then notes that verse.
  const [picked, setPicked] = useState<string | null>(null);
  const option = passage.options.find((o) => o.itemId === (chosen ?? theirs)) ?? passage.options[0];
  const src = usePassageSource(ctx, option, passage);
  const plan = src?.plan ?? null;
  const signature = `${option?.itemId ?? ''}:${passage.ref}:${plan?.parts.length ?? 0}`;
  const player = usePassagePlayer({
    plan, rows: src?.rows ?? null, signature,
    resolve: (i) => {
      const part = plan?.parts[i];
      const ch = src?.chapters.find((c) => c.chapter === part?.chapter);
      return ch ? ch.resolve() : Promise.reject(new Error(t('review.simple.noAudioChapter')));
    },
    onPlayed: () => { if (option) usage.open(option.itemId); }
  });
  const verseNotes = useMemo(() => {
    const out = new Map<string, PassageNote[]>();
    for (const n of v.p.notes) if (n.anchor.kind === 'verse') out.set(n.anchor.verse, [...(out.get(n.anchor.verse) ?? []), n]);
    return out;
  }, [v.p.notes]);

  const back = useHelpSpot(t('common.backTenSeconds'), t('review.simple.backHelp'), () => player.skip(-10));
  const play = useHelpSpot(player.playing ? t('common.pause') : t('review.simple.playPassage'), t('review.simple.playHelp'), player.toggle);
  const rows = src?.rows ?? [];
  const noteHere = () => {
    player.pause();
    const row = player.current ?? rows.find((x) => x.key === picked) ?? rows[0];
    if (row) setNoting({ verse: row.key, at: player.started ? clockMs(player.ms) : '' });
  };
  const note = useHelpSpot(t('review.simple.note'), t('review.simple.noteHelp'), noteHere);
  const pick = useHelpSpot(t('review.simple.chooseBible'), t('review.simple.chooseBibleHelp'), () => setPicking((x) => !x));

  if (!passage.range) {
    return <Text style={[txt.smMuted, styles.empty]}>{t('review.simple.noVerses')}</Text>;
  }
  const parts = plan?.parts ?? [];
  const known = parts.length > 0 && parts.every((x) => x.toMs != null);
  const total = known ? parts.reduce((n, x) => n + (x.toMs! - x.fromMs), 0) : 0;
  const elapsed = parts.slice(0, player.part).reduce((n, x) => n + ((x.toMs ?? x.fromMs) - x.fromMs), 0) + Math.max(0, player.ms - (parts[player.part]?.fromMs ?? 0));
  const share = total > 0 ? Math.min(1, elapsed / total) : 0;
  const canPlay = !!plan && !player.loading;

  return (
    <View style={{ gap: space.md }}>
      <View style={styles.bible}>
        <View style={styles.bibleHead}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[txt.body, { fontWeight: '800' }]} numberOfLines={1}>{v.title}</Text>
            <Text style={txt.xs} numberOfLines={2}>
              {option && option.itemId === theirs
                ? (props.translatorIsYou ? t('review.simple.sourceYouUsed') : t('review.simple.sourceNameUsed', { name: props.translator }))
                : option ? option.name : passage.loading ? t('common.loading') : t('review.simple.noBible')}
            </Text>
          </View>
          {(
            <Pressable onPress={pick.onPress} accessibilityRole="button" accessibilityLabel={option ? t('review.simple.chooseBibleNow', { bible: option.name }) : t('review.simple.chooseBible')}
              accessibilityState={{ expanded: picking }} style={({ pressed }) => [styles.picker, pressed && styles.pressed]}>
              <Text style={[txt.sm, { fontWeight: '800', color: TINT.amberText }]} numberOfLines={1}>{option?.abbreviation ?? t('review.simple.bibles')}</Text>
              <Ico name={picking ? 'up' : 'down'} size={18} color={TINT.amberText} strokeWidth={2.6} />
              <HelpBadge spot={pick} />
            </Pressable>
          )}
        </View>
        {picking ? (
          <View style={styles.pickList}>
            {passage.options.map((o, i) => (
              <Row key={o.itemId} label={o.abbreviation} role="radio" selected={o.itemId === option?.itemId}
                sub={o.itemId !== theirs ? o.name : props.translatorIsYou ? t('review.simple.youUsedIt', { bible: o.name }) : t('review.simple.nameUsedIt', { bible: o.name, name: props.translator })}
                right={o.itemId === option?.itemId ? <Ico name="check" size={20} color={C.primary} /> : <View />}
                onPress={() => { setChosen(o.itemId); usage.open(o.itemId); setPicking(false); }} />
            ))}
            <Row icon="plus" label={t('review.simple.moreBibles')} sub={t('review.simple.moreBiblesSub')} onPress={props.onMoreBibles} last />
          </View>
        ) : null}
        {option ? (
          <>
            <View style={styles.track} accessibilityRole="progressbar"
              accessibilityValue={{ text: total ? t('review.simple.elapsedOf', { elapsed: formatClock(elapsed), total: formatClock(total) }) : formatClock(elapsed) }}>
              <View style={styles.rail} />
              <View style={[styles.fill, { width: `${share * 100}%` }]} />
              <View style={[styles.thumb, { left: `${share * 100}%` }]} />
            </View>
            <View style={styles.controls}>
              <Text style={[txt.xs, styles.time]}>{formatClock(elapsed)}</Text>
              <Pressable onPress={back.onPress} disabled={!player.started} accessibilityRole="button" accessibilityLabel={t('common.backTenSeconds')}
                style={({ pressed }) => [styles.side, !player.started && styles.off, pressed && styles.pressed]}>
                <Ico name="restart" size={20} color={C.dark} />
                <Text style={styles.sideLabel}>{formatNumber(10)}</Text>
                <HelpBadge spot={back} />
              </Pressable>
              <Pressable onPress={play.onPress} disabled={!canPlay} accessibilityRole="button"
                accessibilityLabel={plan ? player.playing ? t('common.pause') : t('review.simple.playTitleIn', { title: v.title, bible: option.abbreviation }) : t('review.simple.noAudioIn', { bible: option.abbreviation })}
                style={({ pressed }) => [styles.play, !plan && { backgroundColor: C.faint }, pressed && styles.pressed]}>
                <Ico name={player.playing ? 'pause' : 'play'} size={24} color={C.white} />
                <HelpBadge spot={play} />
              </Pressable>
              <Pressable onPress={note.onPress} disabled={rows.length === 0} accessibilityRole="button" accessibilityLabel={t('review.simple.noteOnPlaying')}
                style={({ pressed }) => [styles.side, rows.length === 0 && styles.off, pressed && styles.pressed]}>
                <Ico name="chat" size={18} color={TINT.amberText} />
                <Text style={[styles.sideLabel, { color: TINT.amberText }]}>{t('review.simple.note')}</Text>
                <HelpBadge spot={note} />
              </Pressable>
              <Text style={[txt.xs, styles.time, { textAlign: 'right' }]}>{total ? formatClock(total) : ''}</Text>
            </View>
            {!plan && !src?.loading ? <Text style={[txt.xs, { textAlign: 'center' }]}>{t('review.simple.noAudioRead', { bible: option.abbreviation })}</Text> : null}
            {player.error ? <Text accessibilityRole="alert" style={txt.error}>{player.error}</Text> : null}
          </>
        ) : null}
      </View>

      {noting ? (
        <VerseNote ctx={ctx} v={v} verse={noting.verse} at={noting.at} translation={option?.abbreviation ?? ''} onDone={() => setNoting(null)} />
      ) : null}

      {option ? (
        <View style={{ gap: 2 }}>
          {src?.rows ? src.rows.map((row) => {
            const notes = verseNotes.get(row.key) ?? [];
            const here = player.started && player.current?.key === row.key;
            const open = openVerse === row.key;
            const isPicked = picked === row.key && !player.playing;
            return (
              <View key={row.key} style={[styles.verse, notes.length ? styles.verseNoted : here ? styles.versePlaying : null, isPicked && styles.versePicked]}>
                <Pressable onPress={() => {
                  if (player.playFrom(row)) return;
                  setPicked(isPicked ? null : row.key);
                  if (notes.length) setOpenVerse(open ? null : row.key);
                }} accessibilityState={{ selected: isPicked }}
                  accessibilityHint={plan ? t('review.simple.playsFromVerse') : t('review.simple.picksVerse')}
                  accessibilityRole="button"
                  accessibilityLabel={notes.length ? t('review.simple.verseWithNotes', { verse: row.key, text: row.text, count: notes.length }) : t('review.simple.verseA11y', { verse: row.key, text: row.text })}
                  style={({ pressed }) => [pressed && styles.pressed]}>
                  <Text style={styles.verseText}>
                    <Text style={styles.verseNum}>{row.key.split(':')[1] ?? row.key} </Text>{row.text}
                  </Text>
                </Pressable>
                {notes.length ? (
                  <Pressable onPress={() => setOpenVerse(open ? null : row.key)} accessibilityRole="button" accessibilityState={{ expanded: open }}
                    accessibilityLabel={open ? t('review.simple.hideNotes', { count: notes.length, verse: row.key }) : t('review.simple.showNotes', { count: notes.length, verse: row.key })}
                    style={({ pressed }) => [styles.noteBy, pressed && styles.pressed]}>
                    <Ico name="chat" size={16} color={TINT.amberText} />
                    <Text style={[txt.sm, { fontWeight: '800', color: TINT.amberText }]}>{[...new Set(notes.map((n) => ctx.name(n.by).split(' ')[0]))].join(', ')}</Text>
                  </Pressable>
                ) : null}
                {open ? notes.map((n) => (
                  <Authored key={n.id} ctx={ctx} by={n.by}>
                    <View style={{ gap: space.xs }}>
                      {n.text ? <Text style={txt.sm}>{n.text}</Text> : null}
                      {n.blobHash ? <AudioClip language={ctx.language} hashes={[n.blobHash]} label={t('review.parts.playNote')} /> : null}
                      <Text style={txt.xs}>{ctx.name(n.by)} · {when(n.hlc)}{n.anchor.kind === 'verse' && n.anchor.at ? ` · ${t('review.simple.atTime', { time: n.anchor.at })}` : ''}</Text>
                    </View>
                  </Authored>
                )) : null}
              </View>
            );
          }) : <Text style={[txt.smMuted, styles.empty]}>{src?.loading || !src ? t('common.loading') : src.textProblem}</Text>}
          {src && (src.copyright.text || src.copyright.audio) ? (
            <Text style={txt.xs}>{option.abbreviation}: {src.copyright.text ?? src.copyright.audio}</Text>
          ) : null}
        </View>
      ) : !passage.loading ? <Text style={[txt.smMuted, styles.empty]}>{t('review.simple.findUnderMore')}</Text> : null}
    </View>
  );
}

/** A note on a verse of the Bible, where it was paused: it follows the passage (a verse note, as the study and the recorder leave). */
function VerseNote(props: { ctx: Ctx; v: PassageView; verse: string; at: string; translation: string; onDone: () => void }) {
  const { ctx, v } = props;
  const [text, setText] = useState('');
  const [hash, setHash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    const state = ctx.language.state;
    if (!state || busy) return;
    setBusy(true);
    try {
      await ctx.act(commands(state, indexesFor(state)).addNote({
        commandId: Crypto.randomUUID(), unitId: v.unitId,
        anchor: { kind: 'verse', verse: props.verse, ...(props.translation ? { translation: props.translation } : {}), ...(props.at ? { at: props.at } : {}) },
        ...(text.trim() ? { text: text.trim() } : {}), ...(hash ? { blobHash: hash } : {})
      }), t('review.simple.noteAdded'));
      props.onDone();
    } catch { /* ctx.act said what went wrong */ } finally { setBusy(false); }
  }
  return (
    <View style={styles.noteBox}>
      <Text style={[txt.sm, { fontWeight: '800', color: TINT.amberText }]}>
        {props.at ? t('review.simple.noteOnVerseAt', { verse: props.verse, time: props.at }) : t('review.simple.noteOnVerse', { verse: props.verse })}
      </Text>
      <VoiceNote ctx={ctx} label={t('common.sayIt')} hash={hash} onChange={setHash} />
      <Field value={text} onChangeText={setText} placeholder={t('common.orTypeIt')} multiline />
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <View style={{ flex: 1 }}><GhostBtn label={t('common.cancel')} onPress={props.onDone} /></View>
        <View style={{ flex: 1 }}><PrimaryBtn label={t('review.simple.saveNote')} busy={busy} disabled={!text.trim() && !hash} onPress={() => void save()} /></View>
      </View>
    </View>
  );
}

// ---- notes at moments in the version -----------------------------------------------------------

/** Notes the reviewer left at moments while listening: "At 0:42 · 5 s", each playable and removable. */
export function MomentList(props: { ctx: Ctx; moments: { hash: string; durationMs: number; atMs: number }[]; onRemove: (hash: string) => void }) {
  if (props.moments.length === 0) return null;
  return (
    <Group>
      {props.moments.map((m, i) => (
        <View key={m.hash} style={[styles.moment, i > 0 && styles.momentTop]}>
          <AudioClip language={props.ctx.language} hashes={[m.hash]} label={t('review.simple.playYourNoteAt', { time: formatClock(m.atMs) })} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[txt.body, { fontWeight: '700' }]}>{t('review.simple.yourNoteAt', { time: formatClock(m.atMs) })}</Text>
            <Text style={txt.xs}>{t('review.simple.goesWithReview', { length: formatClock(m.durationMs) })}</Text>
          </View>
          <LinkBtn label={t('common.remove')} color={C.muted} accessibilityLabel={t('review.simple.removeNoteAt', { time: formatClock(m.atMs) })} onPress={() => props.onRemove(m.hash)} />
        </View>
      ))}
    </Group>
  );
}


/** Answer a rating or a yes/no question with big targets: five numbers, or two cards. */
export function BigChoices(props: { type: 'rating' | 'yesno'; value: string | undefined; onChange: (v: string) => void }) {
  if (props.type === 'rating') {
    return (
      <View style={{ alignSelf: 'stretch', gap: space.sm }}>
        <View style={styles.choiceRow} accessibilityRole="radiogroup">
          {['1', '2', '3', '4', '5'].map((n) => <BigChoice key={n} label={n} on={props.value === n} onPress={() => props.onChange(n)} />)}
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: space.xs }}>
          <Text style={txt.xs}>{t('review.simple.ratingLow')}</Text>
          <Text style={txt.xs}>{t('review.simple.ratingHigh')}</Text>
        </View>
      </View>
    );
  }
  return (
    <View style={[styles.choiceRow, { alignSelf: 'stretch' }]} accessibilityRole="radiogroup">
      {YES_NO.map((v) => <BigChoice key={v} label={yesNoLabel(v)} icon={v === 'Yes' ? 'check' : 'close'} tall on={props.value === v} onPress={() => props.onChange(v)} />)}
    </View>
  );
}

function BigChoice(props: { label: string; icon?: IconName; on: boolean; tall?: boolean; onPress: () => void }) {
  const spot = useHelpSpot(props.label, t('review.simple.yourAnswerHelp'), props.onPress);
  return (
    <Pressable onPress={spot.onPress} accessibilityRole="radio" accessibilityState={{ checked: props.on }} accessibilityLabel={props.label}
      style={({ pressed }) => [styles.choice, props.tall && { minHeight: 112 }, props.on && { backgroundColor: C.primary, borderColor: C.primary }, pressed && styles.pressed]}>
      {props.icon ? <Ico name={props.icon} size={30} color={props.on ? C.white : C.primary} strokeWidth={2.6} /> : null}
      <Text style={[styles.choiceLabel, { color: props.on ? C.white : C.dark }]}>{props.label}</Text>
      <HelpBadge spot={spot} />
    </Pressable>
  );
}

/** "Skip": small beside the main button, so it is there without competing. */
export function SkipBtn(props: { onPress: () => void }) {
  const spot = useHelpSpot(t('review.simple.skip'), t('review.simple.skipHelp'), props.onPress);
  return (
    <Pressable onPress={spot.onPress} accessibilityRole="button" accessibilityLabel={t('review.simple.skipA11y')} style={({ pressed }) => [styles.skip, pressed && styles.pressed]}>
      <Text style={[txt.body, { fontWeight: '700' }]}>{t('review.simple.skip')}</Text>
      <HelpBadge spot={spot} />
    </Pressable>
  );
}

/** A tall white sheet (Background): grip, title and close, its own scroll; a dialog on a wide window. */
export function TallSheet(props: { title: string; onClose: () => void; children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const wide = useLayout().kind !== 'phone';
  return (
    <Modal visible transparent animationType={wide ? 'fade' : 'slide'} onRequestClose={props.onClose}>
      <View style={[{ flex: 1 }, wide && styles.dialogFrame]}>
        <Pressable style={styles.backdrop} onPress={props.onClose} accessibilityLabel={t('common.close')} />
        <View style={wide ? styles.dialog : [styles.tall, { paddingBottom: Math.max(insets.bottom, space.md) }]}>
          {wide ? null : <View style={styles.grip} />}
          <View style={styles.tallHead}>
            <Text style={styles.tallTitle} accessibilityRole="header">{props.title}</Text>
            <IconBtn name="close" label={t('common.close')} onPress={props.onClose} bg={C.bg} color={C.muted} />
          </View>
          <HelpClip style={{ flex: 1 }}>
            <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.tallBody} keyboardShouldPersistTaps="handled">{props.children}</ScrollView>
          </HelpClip>
        </View>
      </View>
    </Modal>
  );
}

/** A centred block of the body (Decide, What should change): fills the screen's height. */
export function Centre(props: { children: ReactNode }) {
  return <View style={styles.centre}>{props.children}</View>;
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.7 },
  off: { opacity: 0.4 },
  empty: { paddingHorizontal: space.xs, paddingVertical: space.md },
  strip: { flexDirection: 'row', justifyContent: 'center', paddingHorizontal: space.lg, paddingBottom: space.sm, backgroundColor: C.bg },
  step: { width: 78, minHeight: target.row, alignItems: 'center', gap: 4, paddingTop: space.xs },
  stepMark: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  stepLater: { backgroundColor: C.card, borderWidth: 1.5, borderColor: C.border },
  stepLabel: { fontSize: T.xs, fontWeight: '800' },
  dots: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, paddingVertical: space.xs },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: withAlpha(C.primary, 0.2) },
  dotNow: { width: 24, backgroundColor: C.primary },
  qCard: { flexDirection: 'row', alignItems: 'center', gap: space.lg, backgroundColor: C.card, borderRadius: radius.xl + 4, borderWidth: 1, borderColor: C.border,
    paddingHorizontal: space.lg + 4, paddingVertical: space.xl },
  qText: { fontSize: T.lg + 1, fontWeight: '800', color: C.dark, lineHeight: 26 },
  decide: { minHeight: 168, borderRadius: 24, borderWidth: 2, alignItems: 'center', justifyContent: 'center', gap: space.md, paddingVertical: space.xl },
  decideMark: { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center' },
  decideLabel: { fontSize: T.xxl, fontWeight: '800' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: space.sm, alignSelf: 'center', paddingHorizontal: space.lg, minHeight: 40, borderRadius: radius.full, backgroundColor: TINT.amber },
  bible: { backgroundColor: C.card, borderRadius: radius.xl, borderWidth: 1, borderColor: C.border, padding: space.md, gap: space.sm },
  bibleHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  picker: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: target.min, paddingHorizontal: space.md, borderRadius: radius.full,
    borderWidth: 1.5, borderColor: TINT.noteBorder, backgroundColor: TINT.note, maxWidth: 160 },
  pickList: { borderRadius: radius.lg, borderWidth: 1, borderColor: C.border, overflow: 'hidden' },
  track: { height: 32, justifyContent: 'center' },
  rail: { position: 'absolute', left: 0, right: 0, height: 6, borderRadius: 3, backgroundColor: C.light },
  fill: { position: 'absolute', left: 0, height: 6, borderRadius: 3, backgroundColor: C.primary },
  thumb: { position: 'absolute', width: 22, height: 22, marginLeft: -11, borderRadius: 11, backgroundColor: C.white, borderWidth: 3, borderColor: C.primary },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.lg },
  time: { width: 40 },
  side: { width: 52, height: 52, borderRadius: 26, borderWidth: 1, borderColor: C.border, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' },
  sideLabel: { fontSize: 11, fontWeight: '800', color: C.dark },
  play: { width: 56, height: 56, borderRadius: 28, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center', ...lift({ color: C.primary, opacity: 0.3, radius: 12, y: 6 }) },
  verse: { borderRadius: radius.md, paddingHorizontal: space.xs, paddingVertical: 4, gap: space.xs },
  verseNoted: { backgroundColor: TINT.amber, paddingHorizontal: space.md, paddingVertical: space.sm, marginVertical: space.xs },
  versePlaying: { backgroundColor: C.light },
  versePicked: { borderWidth: 1.5, borderColor: withAlpha(C.primary, 0.4) },
  verseText: { fontSize: T.base + 1, lineHeight: 26, color: C.dark },
  verseNum: { fontSize: T.xs, fontWeight: '700', color: C.muted },
  noteBy: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36, alignSelf: 'flex-start' },
  noteBox: { backgroundColor: TINT.note, borderWidth: 1, borderColor: TINT.noteBorder, borderRadius: radius.lg, padding: space.md, gap: space.sm },
  moment: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.md, paddingVertical: space.sm, minHeight: target.row },
  momentTop: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: C.border },
  centre: { flexGrow: 1, justifyContent: 'center', gap: space.lg, paddingVertical: space.lg },
  choiceRow: { flexDirection: 'row', gap: space.sm },
  choice: { flex: 1, minHeight: 72, borderRadius: radius.lg + 2, borderWidth: 1.5, borderColor: C.border, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center', gap: space.xs },
  choiceLabel: { fontSize: T.xxl, fontWeight: '800' },
  skip: { width: 84, minHeight: target.primary, borderRadius: radius.lg, borderWidth: 1, borderColor: C.border, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center' },
  backdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(15,18,28,0.45)' },
  tall: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '80%', backgroundColor: C.card, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, paddingTop: space.sm, ...lift({ opacity: 0.2, radius: 30, y: -10 }) },
  dialogFrame: { alignItems: 'center', justifyContent: 'center', padding: space.xl },
  dialog: { backgroundColor: C.card, borderRadius: radius.sheet, width: '100%', maxWidth: 640, height: '85%', paddingTop: space.md, paddingBottom: space.lg, ...lift({ opacity: 0.2 }) },
  grip: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: C.border, marginBottom: space.sm },
  tallHead: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.xl, paddingBottom: space.md },
  tallTitle: { flex: 1, fontSize: T.xl, fontWeight: '800', color: C.dark },
  tallBody: { gap: space.md, paddingHorizontal: space.xl, paddingBottom: space.xl }
});
