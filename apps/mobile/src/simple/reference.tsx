// What is attached to a passage, as the recording workspace's top pane and
// the study reader show it (decision 71; demo ADR-035, ADR-036; demo
// simple/translator.tsx Workspace, TermsRef, EarlierRef, StudyDoc): the
// Bible (play, Back 10 s, a Bible picker, the verses with the one playing
// lit, a note on a verse or a moment), key words (hear each, your word or
// say yours, add a word), notes, and everything recorded so far.
import { commands, keyTermView, type KeyTermView, type PassageNote } from '@langquest-next/core';
import * as Crypto from 'expo-crypto';
import { useMemo, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../text';
import type { Ctx } from '../ctx';
import { useHelpPress } from '../helpContext';
import { t } from '../i18n';
import { formatNumber } from '../i18n/format';
import { indexesFor } from '../indexes';
import { Field, Ico, LinkBtn, PrimaryBtn, Sheet, txt } from '../kit';
import { versionTitle, when, type PassageView } from '../passageView';
import type { ListenHooks } from '../recording/useListenLoop';
import { markTerms } from '../recording/workspaceModel';
import { Authored, recordTarget, ReportFlag } from '../reportSheet';
import { RequestBanner } from '../reviewing/parts';
import { openContentLink } from '../share';
import { anchorClock, chipLabel, choiceKey, copyrightLine, useChoice, useOffer } from '../sources/SourceReader';
import type { SourceOption, VerseRow } from '../sources/model';
import { PlayError, usePassagePlayer } from '../sources/player';
import type { Usage } from '../sources/used';
import { useChipMarks, usePassageSource, useSources } from '../sources/useSources';
import { saveNote } from '../study/ui';
import { C, radius, space, target, TINT, type as T } from '../theme';
import { VoiceNote } from '../voiceNote';
import { languageLabel } from './adminModel';
import { bookOf, mmss, passageClock, verseRefs } from './model';
import { Back10, DashedBtn, MiniPlayer, PlayBtn, PlayRow, styles as ps } from './parts';
import { useClip } from './useClip';

const DBP_TERMS = 'https://www.faithcomesbyhearing.com/bible-brain/license';

// ---- the Bible --------------------------------------------------------------------------

export type Bible = ReturnType<typeof useBible>;

/**
 * The passage's Bibles and one player for them, held by the screen so the
 * Bible card, the one-line bar and the dock all play the same thing, and a
 * key word can play its verse. The version chosen last for the language is
 * shared with every other reader on this device (SourceReader.tsx).
 */
export function useBible(ctx: Ctx, unitId: string | null, languageId: string | null, opts: { listen?: ListenHooks; usage?: Usage; hidden?: boolean }) {
  const passage = useSources(ctx, unitId, languageId);
  const [chosen, setChosen] = useChoice(choiceKey(ctx.session.actorId, ctx.language.orgId, languageId ?? ''));
  const option = passage.options.find((o) => o.itemId === chosen) ?? passage.options[0];
  const usage = opts.usage;
  useOffer(usage, passage);
  const src = usePassageSource(ctx, option, passage);
  const plan = src?.plan ?? null;
  const rows = src?.rows ?? null;
  const player = usePassagePlayer({
    plan, rows, signature: `${option?.itemId ?? ''}:${passage.ref}:${plan?.parts.length ?? 0}`, disabled: opts.hidden,
    resolve: (i) => {
      const part = plan?.parts[i];
      const ch = src?.chapters.find((c) => c.chapter === part?.chapter);
      if (!ch) return Promise.reject(new PlayError(t('sources.reader.noAudioForChapter')));
      return ch.resolve();
    },
    ...(opts.listen ? { listen: opts.listen } : {}),
    onPlayed: () => { if (option) usage?.open(option.itemId); }
  });
  const clock = plan ? passageClock(plan.parts, player.part, player.ms) : null;
  const timed = !!plan && plan.parts.some((p) => p.timing);
  return {
    passage, option, src, plan, rows, player, clock, timed,
    /** Has verses at all: an outline item has none, so no Bible chip and no dock. */
    hasVerses: !!passage.range,
    hasAudio: !!plan,
    choose: (o: SourceOption) => { setChosen(o.itemId); usage?.open(o.itemId); },
    /** "0:42 / 1:18", or why there is nothing to play. */
    time: (): string => {
      if (!option) return '';
      if (!plan) return src?.loading ? t('common.loading') : t('reference.bible.noAudio');
      const total = clock?.total;
      if (player.started) return `${mmss((clock?.elapsed ?? 0) * 1000)}${total ? ` / ${mmss(total * 1000)}` : ''}`;
      return total ? mmss(total * 1000) : '';
    },
    /** "World English Bible · 0:42 / 1:18" */
    line: (): string => {
      if (!option) return passage.loading ? t('common.loading') : t('reference.bible.noBible');
      if (src?.loading && !plan) return t('reference.bible.nameLoading', { name: option.name });
      if (!plan) return t('reference.bible.nameNoAudio', { name: option.name });
      const total = clock?.total;
      if (player.started) return `${option.name} · ${mmss((clock?.elapsed ?? 0) * 1000)}${total ? ` / ${mmss(total * 1000)}` : ''}`;
      return total ? `${option.name} · ${mmss(total * 1000)}` : option.name;
    },
    /** Play from the first verse that holds a word; false when it cannot (no timed audio). */
    playVerse: (key: string) => {
      const row = rows?.find((r) => r.key === key);
      return !!row && !!plan && timed && player.playFrom(row);
    }
  };
}

/** The Bible chip: the player card, then the verses with the one playing lit (a-wsHalf). */
export function BiblePane(props: {
  ctx: Ctx; v: PassageView; bible: Bible; terms?: readonly Pick<KeyTermView, 'termId' | 'term'>[]; tied?: ReadonlySet<string>;
  onTerm?: (termId: string) => void; canNote: boolean; onMoreBibles?: () => void; selected: string | null; onSelect: (key: string | null) => void;
  header?: ReactNode;
  /** Under the text: the passage's own reference recordings. */
  footer?: ReactNode;
}) {
  const { ctx, v, bible } = props;
  const { player, option, src } = bible;
  const [picking, setPicking] = useState(false);
  const [noting, setNoting] = useState<{ verse?: string; at?: string } | null>(null);
  const verseNotes = useMemo(() => v.p.notes.filter((n) => n.anchor.kind === 'verse'), [v.p.notes]);
  const count = (key: string) => verseNotes.filter((n) => n.anchor.kind === 'verse' && n.anchor.verse === key).length;
  const abbr = option?.abbreviation ?? '';
  const many = bible.passage.options.length > 1;
  const note = () => {
    player.pause();
    const verse = props.selected ?? player.current?.key;
    // Stored in the note's anchor: plain digits, whatever the language showing.
    const at = player.started && player.current && verse === player.current.key ? anchorClock(player.ms) : undefined;
    setNoting({ ...(verse ? { verse } : {}), ...(at ? { at } : {}) });
  };
  const tap = (row: VerseRow) => {
    props.onSelect(props.selected === row.key ? null : row.key);
    if (bible.timed) player.playFrom(row);
  };
  const terms = props.terms ?? [];
  return (
    <View style={{ gap: space.md }}>
      {props.header}
      <MiniPlayer title={v.title} sub={bible.line()} playing={player.playing} available={bible.hasAudio && !player.loading} none={!bible.hasAudio}
        onToggle={player.toggle} onBack10={() => player.skip(-10)} backDisabled={!player.started}
        under={many ? (
          <View style={styles.under}>
            <BiblePick label={abbr} onPress={() => setPicking(true)} />
            <Text style={[txt.smMuted, { flex: 1 }]} numberOfLines={1}>{bible.time()}</Text>
          </View>
        ) : undefined}
        {...(props.canNote ? { onNote: note } : {})}
        {...(player.error ? { error: player.error } : {})} />
      {src?.rows ? (
        <View style={{ gap: space.xs }}>
          {src.rows.map((row) => {
            const here = player.started && player.current?.key === row.key;
            const sel = props.selected === row.key;
            const n = count(row.key);
            return (
              <Verse key={row.key} row={row} here={here} selected={sel} notes={n} onPress={() => tap(row)} timed={bible.timed}>
                {markTerms(row.text, terms).map((part, i) => {
                  if (!part.termId) return <Text key={i}>{part.text}</Text>;
                  const tied = props.tied?.has(part.termId) ?? false;
                  const onTerm = props.onTerm;
                  return (
                    <Text key={i} {...(onTerm ? { onPress: () => onTerm(part.termId!), accessibilityRole: 'link' as const } : {})}
                      accessibilityLabel={tied ? t('reference.bible.keyWordTied', { word: part.text }) : t('reference.bible.keyWord', { word: part.text })}
                      style={[styles.term, tied && { color: TINT.greenText }]}>{part.text}{tied ? ' ✓' : ''}</Text>
                  );
                })}
              </Verse>
            );
          })}
        </View>
      ) : (
        <Text style={[txt.smMuted, { paddingHorizontal: space.xs }]}>{!option ? (bible.passage.loading ? t('common.loading') : t('sources.reader.noBible')) : src?.loading || !src ? t('common.loading') : src.textProblem}</Text>
      )}
      {props.selected ? <VerseNotes ctx={ctx} notes={verseNotes.filter((n) => n.anchor.kind === 'verse' && n.anchor.verse === props.selected)} /> : null}
      {option && src ? (
        <View style={{ gap: 2, paddingHorizontal: space.xs }}>
          {option.kind === 'builtin' ? <Text style={txt.xs}>{t('sources.reader.builtIn')}</Text>
            : option.sharedBy ? <Text style={txt.xs}>{t('sources.reader.sharedBy', { org: option.sharedBy })}</Text> : null}
          {copyrightLine(src.copyright) ? <Text style={txt.xs}>{t('sources.reader.copyright', { abbr, line: copyrightLine(src.copyright) })}</Text> : null}
          {src.bibleBrain ? <LinkBtn label={t('sources.reader.terms')} style={{ alignSelf: 'flex-start' }} accessibilityLabel={t('sources.reader.termsLabel')} onPress={() => openContentLink(DBP_TERMS)} /> : null}
          {props.onMoreBibles && !many ? <LinkBtn label={t('reference.bible.otherBibles')} style={{ alignSelf: 'flex-start' }} onPress={props.onMoreBibles} /> : null}
        </View>
      ) : null}
      {props.footer}
      {picking ? <BibleSheet ctx={ctx} bible={bible} onClose={() => setPicking(false)} {...(props.onMoreBibles ? { onMoreBibles: () => { setPicking(false); props.onMoreBibles!(); } } : {})} /> : null}
      {noting ? (
        <NoteSheet ctx={ctx} v={v} title={noting.verse ? t('reference.notes.noteOnRef', { verse: noting.verse }) : t('common.addNote')}
          where={noting.verse ? [t('reference.notes.whereVerse', { passage: v.title, verse: noting.verse }), abbr, noting.at].filter(Boolean).join(' · ') : t('reference.notes.whereWhole', { passage: v.title })}
          anchor={noting.verse ? { kind: 'verse', verse: noting.verse, ...(abbr ? { translation: abbr } : {}), ...(noting.at ? { at: noting.at } : {}) } : { kind: 'passage' }}
          onClose={() => setNoting(null)} />
      ) : null}
    </View>
  );
}

function Verse(props: { row: VerseRow; here: boolean; selected: boolean; notes: number; timed: boolean; onPress: () => void; children: ReactNode }) {
  const r = props.row;
  const verse = r.key.includes(':') ? r.key.slice(r.key.indexOf(':') + 1) : r.key;
  const onPress = useHelpPress(t('reference.bible.verse', { verse }), props.timed ? t('reference.bible.verseHelpTimed') : t('reference.bible.verseHelp'), props.onPress);
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: props.here || props.selected }}
      accessibilityLabel={props.notes ? t('reference.bible.verseLabelNotes', { verse: r.key, text: r.text, count: props.notes }) : t('sources.reader.verseLabel', { verse: r.key, text: r.text })}
      style={({ pressed }) => [styles.verse, props.here && styles.versePlaying, props.selected && styles.verseSelected, pressed && ps.pressed]}>
      <Text style={styles.verseText}>
        <Text style={styles.verseNum}>{verse} </Text>
        {props.children}
        {props.notes ? <Text style={styles.verseNotes}>  ● {formatNumber(props.notes)}</Text> : null}
      </Text>
    </Pressable>
  );
}

function VerseNotes(props: { ctx: Ctx; notes: PassageNote[] }) {
  if (props.notes.length === 0) return null;
  return <View style={{ gap: space.sm }}>{props.notes.map((n) => <NoteItem key={n.id} ctx={props.ctx} note={n} label={noteLabel(props.ctx, n)} />)}</View>;
}

function BiblePick(props: { label: string; onPress: () => void }) {
  const onPress = useHelpPress(t('reference.bible.choose'), t('reference.bible.chooseHelp'), props.onPress);
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={t('reference.bible.pickLabel', { bible: props.label })}
      style={({ pressed }) => [styles.pick, pressed && ps.pressed]}>
      <Text style={[txt.sm, { fontWeight: '700', color: TINT.amberText }]} numberOfLines={1}>{props.label}</Text>
      <Ico name="down" size={16} color={TINT.amberText} strokeWidth={2.6} />
    </Pressable>
  );
}

function BibleSheet(props: { ctx: Ctx; bible: Bible; onClose: () => void; onMoreBibles?: () => void }) {
  const { bible } = props;
  const marks = useChipMarks(props.ctx, bible.passage);
  return (
    <Sheet visible title={t('reference.bible.choose')} sub={t('reference.bible.chooseSub')} onClose={props.onClose}>
      <View style={styles.card}>
        {bible.passage.options.map((o, i, all) => (
          <BibleRow key={o.itemId} label={chipLabel(o, all)} sub={[o.name, languageLabel(o.language), ...(marks[o.itemId] ?? [])].filter(Boolean).join(' · ')} on={o.itemId === bible.option?.itemId}
            last={i === all.length - 1 && !props.onMoreBibles} onPress={() => { bible.choose(o); props.onClose(); }} />
        ))}
        {props.onMoreBibles ? <BibleRow label={t('sources.reader.moreBibles')} sub={t('reference.bible.moreBiblesSub')} more last onPress={props.onMoreBibles} /> : null}
      </View>
    </Sheet>
  );
}

function BibleRow(props: { label: string; sub: string; on?: boolean; more?: boolean; last?: boolean; onPress: () => void }) {
  const onPress = useHelpPress(props.label, props.sub, props.onPress);
  return (
    <Pressable onPress={onPress} accessibilityRole={props.more ? 'button' : 'radio'} accessibilityState={props.more ? undefined : { selected: !!props.on }}
      style={({ pressed }) => [styles.bibleRow, !props.last && ps.rowBorder, pressed && ps.pressed]}>
      <Ico name={props.more ? 'plus' : 'book'} size={20} color={C.primary} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[txt.body, { fontWeight: '700', color: props.more ? C.primary : C.dark }]} numberOfLines={1}>{props.label}</Text>
        <Text style={txt.xs} numberOfLines={2}>{props.sub}</Text>
      </View>
      {props.on ? <Ico name="check" size={20} color={C.primary} strokeWidth={3} /> : null}
    </Pressable>
  );
}

/** The reference at one line (a-wsPeek): the Bible still plays, and the rest is a drag away. */
export function BibleBar(props: { bible: Bible; onOpen: () => void }) {
  const { bible } = props;
  const open = useHelpPress(t('reference.bible.barHelpTitle'), t('reference.bible.barHelp'), props.onOpen);
  return (
    <View style={styles.bar}>
      <PlayBtn playing={bible.player.playing} available={bible.hasAudio && !bible.player.loading} none={!bible.hasAudio} label={t('reference.bible.play')} onPress={bible.player.toggle} />
      <Pressable onPress={open} accessibilityRole="button" accessibilityLabel={t('reference.bible.openReference')} style={({ pressed }) => [{ flex: 1, minWidth: 0 }, pressed && ps.pressed]}>
        <Text style={ps.miniTitle} numberOfLines={1}>{bible.option ? t('reference.bible.barTitleWith', { abbr: bible.option.abbreviation }) : t('reference.bible.barTitle')}</Text>
        <Text style={txt.smMuted} numberOfLines={2}>{t('reference.bible.barSub')}</Text>
      </Pressable>
      <Back10 onPress={() => bible.player.skip(-10)} disabled={!bible.player.started} />
    </View>
  );
}

// ---- key words --------------------------------------------------------------------------

/** The latest voice recording of the term in this language: what "Your word" plays. */
function voiceOf(term: KeyTermView): string | undefined {
  return [...term.adjustments].reverse().find((a) => a.blobHash)?.blobHash;
}

/**
 * The Key words chip (a-wsTerms): each word with where it is in the passage,
 * a listen icon that plays its verse, and the language's word: "Your word"
 * plays it, "Say yours" records it (TERM-5, adjustKeyTermRendering). A tap
 * on the word opens it (renderings, why, Tie to your draft).
 */
export function KeyWordsPane(props: {
  ctx: Ctx; v: PassageView; terms: KeyTermView[]; rows: VerseRow[] | null; draftTakeId: string | undefined;
  canTie: boolean; onHear: (verseKey: string | null) => void; allTerms?: () => void; disabled?: boolean;
}) {
  const { ctx, v } = props;
  const canEdit = ctx.session.can('fill_reference') || ctx.session.can('manage_reference');
  const [saying, setSaying] = useState<KeyTermView | null>(null);
  const [adding, setAdding] = useState(false);
  const book = bookOf(v.title);
  const where = (term: KeyTermView): string[] => (props.rows ?? []).filter((r) => markTerms(r.text, [term]).some((p) => p.termId)).map((r) => r.key);
  return (
    <View style={{ gap: space.md }}>
      {props.terms.length === 0 ? (
        <Text style={[txt.smMuted, { paddingHorizontal: space.xs }]}>{canEdit ? t('reference.keyWords.noneAdd') : t('reference.keyWords.none')}</Text>
      ) : (
        <View style={styles.card}>
          {props.terms.map((term, i) => {
            const keys = where(term);
            return (
              <TermRow key={term.termId} ctx={ctx} term={term} refs={keys.length ? `${book} ${verseRefs(keys)}` : term.gloss || t('reference.keyWords.elsewhere')} last={i === props.terms.length - 1}
                onHear={() => props.onHear(keys[0] ?? null)} canEdit={canEdit && !props.disabled} onSay={() => setSaying(term)}
                onOpen={() => ctx.go('key_term_detail', { unitId: v.unitId, languageId: v.languageId, termId: term.termId })} />
            );
          })}
        </View>
      )}
      {canEdit ? <DashedBtn label={t('reference.keyWords.add')} onPress={() => setAdding(true)} disabled={props.disabled} hint={t('reference.keyWords.addHint')} /> : null}
      {props.allTerms ? <LinkBtn label={t('reference.keyWords.all')} style={{ alignSelf: 'center' }} onPress={props.allTerms} /> : null}
      {saying ? <SayYoursSheet ctx={ctx} v={v} term={saying} draftTakeId={props.draftTakeId} canTie={props.canTie} onClose={() => setSaying(null)} /> : null}
      {adding ? <AddWordSheet ctx={ctx} v={v} draftTakeId={props.draftTakeId} onClose={() => setAdding(false)} /> : null}
    </View>
  );
}

function TermRow(props: { ctx: Ctx; term: KeyTermView; refs: string; last: boolean; canEdit: boolean; onHear: () => void; onSay: () => void; onOpen: () => void }) {
  const term = props.term;
  const voice = voiceOf(term);
  const rendering = term.renderings[term.renderings.length - 1]?.rendering;
  const hear = useHelpPress(t('reference.keyWords.hear', { term: term.term }), t('reference.keyWords.hearHelp'), props.onHear);
  const open = useHelpPress(term.term, t('reference.keyWords.openHelp'), props.onOpen);
  return (
    <View style={[styles.termRow, !props.last && ps.rowBorder]}>
      <Pressable onPress={hear} accessibilityRole="button" accessibilityLabel={t('reference.keyWords.hearLabel', { term: term.term })} hitSlop={4} style={({ pressed }) => [styles.hear, pressed && ps.pressed]}>
        <Ico name="listen" size={22} color={TINT.amberText} />
      </Pressable>
      <Pressable onPress={open} accessibilityRole="button"
        accessibilityLabel={rendering ? t('reference.keyWords.termLabelWord', { term: term.term, refs: props.refs, word: rendering }) : t('reference.keyWords.termLabel', { term: term.term, refs: props.refs })}
        style={({ pressed }) => [{ flex: 1, minWidth: 0, minHeight: target.min, justifyContent: 'center' }, pressed && ps.pressed]}>
        <Text style={styles.termName} numberOfLines={1}>{term.term}</Text>
        <Text style={txt.smMuted} numberOfLines={1}>{props.refs}{rendering && voice ? ` · ${rendering}` : ''}</Text>
      </Pressable>
      {voice ? <YourWord ctx={props.ctx} hash={voice} term={term.term} />
        : rendering ? <Text style={[styles.yourWord, { maxWidth: 120 }]} numberOfLines={2}>{rendering}</Text>
        : props.canEdit ? <SayYours onPress={props.onSay} term={term.term} /> : null}
    </View>
  );
}

function YourWord(props: { ctx: Ctx; hash: string; term: string }) {
  const clip = useClip(props.ctx.language, [props.hash]);
  const onPress = useHelpPress(t('reference.keyWords.yourWord'), t('reference.keyWords.yourWordHelp', { term: props.term }), clip.toggle);
  return (
    <Pressable onPress={onPress} disabled={!clip.available} accessibilityRole="button"
      accessibilityLabel={clip.playing ? t('reference.keyWords.pauseYourWord', { term: props.term }) : t('reference.keyWords.playYourWord', { term: props.term })}
      style={({ pressed }) => [styles.wordBtn, !clip.available && ps.off, pressed && ps.pressed]}>
      <Ico name={clip.playing ? 'pause' : 'play'} size={14} color={TINT.greenText} strokeWidth={3} fill={TINT.greenText} />
      <Text style={styles.yourWord}>{t('reference.keyWords.yourWord')}</Text>
    </Pressable>
  );
}

function SayYours(props: { onPress: () => void; term: string }) {
  const onPress = useHelpPress(t('reference.keyWords.sayYours'), t('reference.keyWords.sayYoursHelp', { term: props.term }), props.onPress);
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={t('reference.keyWords.sayYoursLabel', { term: props.term })}
      style={({ pressed }) => [styles.wordBtn, pressed && ps.pressed]}>
      <Ico name="mic" size={16} color={C.primary} />
      <Text style={[styles.yourWord, { color: C.primary }]}>{t('reference.keyWords.sayYours')}</Text>
    </Pressable>
  );
}

function SayYoursSheet(props: { ctx: Ctx; v: PassageView; term: KeyTermView; draftTakeId: string | undefined; canTie: boolean; onClose: () => void }) {
  const { ctx, v, term } = props;
  const [hash, setHash] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  async function save() {
    const state = ctx.language.state;
    if (!state || busy || (!hash && !text.trim())) return;
    setBusy(true);
    const duringTakeId = props.draftTakeId ?? v.p.latest?.takeId;
    try {
      // TERM-5: a rendering said (and, when typed, written), recorded with this passage; tied to the draft when there is one.
      await ctx.act(commands(state, indexesFor(state)).adjustKeyTermRendering({
        // i18n-ignore: the rendering's note is stored in the event log
        commandId: Crypto.randomUUID(), termId: term.termId, rendering: text, note: hash ? '' : `Rendered “${text.trim()}” in ${v.title}.`,
        ...(hash ? { blobHash: hash } : {}), ...(duringTakeId ? { duringTakeId } : {}),
        ...(props.canTie && props.draftTakeId ? { tieToTakeId: props.draftTakeId } : {})
      }), t('reference.keyWords.saved', { term: term.term }));
      props.onClose();
    } catch { /* ctx.act said what went wrong */ }
    finally { setBusy(false); }
  }
  return (
    <Sheet visible title={t('reference.keyWords.sayTitle', { term: term.term })}
      sub={term.gloss ? t('reference.keyWords.saySubGloss', { gloss: term.gloss, language: v.language }) : t('reference.keyWords.saySub', { language: v.language })}
      onClose={props.onClose} footer={<PrimaryBtn label={t('reference.keyWords.saveWord')} icon="check" busy={busy} disabled={!hash && !text.trim()} onPress={() => void save()} />}>
      <VoiceNote ctx={ctx} label={t('common.sayIt')} hash={hash} onChange={setHash} />
      <Field value={text} onChangeText={setText} placeholder={t('common.orTypeIt')} />
    </Sheet>
  );
}

function AddWordSheet(props: { ctx: Ctx; v: PassageView; draftTakeId: string | undefined; onClose: () => void }) {
  const { ctx, v } = props;
  const [term, setTerm] = useState('');
  const [gloss, setGloss] = useState('');
  const [hash, setHash] = useState<string | null>(null);
  const [rendering, setRendering] = useState('');
  const [busy, setBusy] = useState(false);
  const ready = !!term.trim() && (!!hash || !!rendering.trim());
  async function save() {
    const state = ctx.language.state;
    if (!state || busy || !ready) return;
    const book = state.units[v.unitId]?.parentUnitId ?? v.unitId;
    const duringTakeId = props.draftTakeId ?? v.p.latest?.takeId;
    setBusy(true);
    try {
      // TERM-6: the word, how the language says it (said, typed or both), recorded as its first adjustment.
      await ctx.act(commands(state, indexesFor(state)).defineKeyTerm({
        commandId: Crypto.randomUUID(), termId: `kt-${Crypto.randomUUID()}`, term, gloss, unitScope: [book],
        // i18n-ignore: the term's first note is stored in the event log
        rendering, note: rendering.trim() ? `First rendering: ${rendering.trim()}.` : 'Said in a voice note.',
        ...(hash ? { blobHash: hash } : {}), ...(duringTakeId ? { duringTakeId } : {})
      }), t('reference.keyWords.added', { term: term.trim() }));
      props.onClose();
    } catch { /* ctx.act said what went wrong */ }
    finally { setBusy(false); }
  }
  return (
    <Sheet visible title={t('reference.keyWords.add')} sub={t('reference.keyWords.addSub', { language: v.language })}
      onClose={props.onClose} footer={<PrimaryBtn label={t('reference.keyWords.addWord')} icon="plus" busy={busy} disabled={!ready} onPress={() => void save()} />}>
      <Field value={term} onChangeText={setTerm} placeholder={t('reference.keyWords.wordPlaceholder')} />
      <Field value={gloss} onChangeText={setGloss} placeholder={t('reference.keyWords.meaningPlaceholder')} autoCapitalize="sentences" />
      <VoiceNote ctx={ctx} label={t('reference.keyWords.sayItIn', { language: v.language })} hash={hash} onChange={setHash} />
      <Field value={rendering} onChangeText={setRendering} placeholder={t('common.orTypeIt')} />
    </Sheet>
  );
}

// ---- notes --------------------------------------------------------------------------------

/** "NOTE ON VERSE 12 · MARY", "VOICE NOTE · ABEBE · ON VERSE 12". */
export function noteLabel(ctx: Ctx, n: PassageNote, versionN?: (takeId: string) => number | undefined): string {
  const who = ctx.name(n.by);
  // What the note is on, as its own phrase (after "Voice note") and as a whole label ("Note on verse 12").
  const on = ((): { on: string; note: string } | null => {
    switch (n.anchor.kind) {
      case 'passage': return null;
      case 'verse': {
        const verse = n.anchor.verse.includes(':') ? n.anchor.verse.slice(n.anchor.verse.indexOf(':') + 1) : n.anchor.verse;
        return { on: t('reference.notes.onVerse', { verse }), note: t('reference.notes.noteOnVerse', { verse }) };
      }
      case 'version': {
        const at = versionN?.(n.anchor.takeId);
        if (!at) return { on: t('reference.notes.onDraft'), note: t('reference.notes.noteOnDraft') };
        const version = versionTitle(at);
        return { on: t('reference.notes.onVersion', { version }), note: t('reference.notes.noteOnVersion', { version }) };
      }
      case 'term': {
        const term = ctx.language.state ? keyTermView(ctx.language.state, n.anchor.termId) : null;
        return term ? { on: t('reference.notes.onTerm', { term: term.term }), note: t('reference.notes.noteOnTerm', { term: term.term }) }
          : { on: t('reference.notes.onKeyWord'), note: t('reference.notes.noteOnKeyWord') };
      }
      case 'study': return { on: t('reference.notes.onStudy'), note: t('reference.notes.noteOnStudy') };
    }
  })();
  if (n.blobHash && !n.text) return [t('common.voiceNote'), who, on?.on].filter(Boolean).join(' · ');
  return [on ? on.note : t('reference.notes.noteOnPassage'), who].join(' · ');
}

function NoteItem(props: { ctx: Ctx; note: PassageNote; label: string; older?: string }) {
  const { ctx, note: n } = props;
  return (
    <Authored ctx={ctx} by={n.by}>
      <View style={styles.noteCard}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <Text style={[txt.label, { flex: 1, letterSpacing: 0.6 }]} numberOfLines={2}>{props.label}{props.older ? ` · ${props.older}` : ''}</Text>
          <ReportFlag ctx={ctx} target={recordTarget(ctx, 'note', n.id, n.by, n.unitId)} size={36} />
        </View>
        {n.text ? <Text style={styles.noteText}>{n.text}</Text> : null}
        {n.blobHash ? <VoiceClip ctx={ctx} hash={n.blobHash} sub={when(n.hlc)} /> : null}
        {!n.blobHash ? <Text style={txt.xs}>{when(n.hlc)}</Text> : null}
      </View>
    </Authored>
  );
}

/** A voice note as the small player: its length, when, and Back 10 s. */
function VoiceClip(props: { ctx: Ctx; hash: string; sub: string }) {
  const clip = useClip(props.ctx.language, [props.hash]);
  return (
    <MiniPlayer title={clip.total ? mmss(clip.total * 1000) : t('common.voiceNote')} sub={props.sub} playing={clip.playing} available={clip.available}
      onToggle={clip.toggle} onBack10={clip.back10} backDisabled={!clip.available || clip.elapsed <= 0} {...(clip.error ? { error: clip.error } : {})} />
  );
}

/** The Notes chip (a-studyDoc): the passage's notes, newest first, and Add a note. */
export function NotesPane(props: { ctx: Ctx; v: PassageView; notes: PassageNote[]; disabled?: boolean; top?: ReactNode }) {
  const { ctx, v } = props;
  const [adding, setAdding] = useState(false);
  const versionN = useMemo(() => new Map(v.p.versions.map((x) => [x.takeId, x.n])), [v.p.versions]);
  const latestId = v.p.latest?.takeId;
  const newest = [...props.notes].reverse();
  return (
    <View style={{ gap: space.md }}>
      {props.top}
      {newest.length === 0 && !props.top ? (
        <Text style={[txt.smMuted, { paddingHorizontal: space.xs }]}>{t('reference.notes.empty')}</Text>
      ) : null}
      {newest.map((n) => {
        const older = n.onTakeId && n.onTakeId !== latestId ? versionN.get(n.onTakeId) : undefined;
        return <NoteItem key={n.id} ctx={ctx} note={n} label={noteLabel(ctx, n, (id) => versionN.get(id))} {...(older ? { older: t('reference.notes.madeWith', { version: versionTitle(older) }) } : {})} />;
      })}
      <DashedBtn label={t('common.addNote')} onPress={() => setAdding(true)} disabled={props.disabled} hint={t('reference.notes.addHint')} />
      {adding ? <NoteSheet ctx={ctx} v={v} title={t('common.addNote')} where={t('reference.notes.whereWhole', { passage: v.title })} anchor={{ kind: 'passage' }} onClose={() => setAdding(false)} /> : null}
    </View>
  );
}

/** What someone asked of this passage, at the top of Notes. */
export function RequestNote(props: { ctx: Ctx; request: Parameters<typeof RequestBanner>[0]['request'] }) {
  return <RequestBanner ctx={props.ctx} request={props.request} />;
}

/** A note by voice or text on the passage, a verse or a moment. */
export function NoteSheet(props: { ctx: Ctx; v: Pick<PassageView, 'unitId'>; title: string; where: string; anchor: Parameters<typeof saveNote>[2]; onClose: () => void; message?: string }) {
  const [text, setText] = useState('');
  const [hash, setHash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Sheet visible title={props.title} sub={t('reference.notes.sheetSub')} onClose={props.onClose}
      footer={<PrimaryBtn label={t('reference.notes.save')} busy={busy} disabled={!text.trim() && !hash}
        onPress={() => { setBusy(true); void saveNote(props.ctx, props.v, props.anchor, { text, blobHash: hash }, props.message ?? t('reference.notes.added')).then((ok) => { setBusy(false); if (ok) props.onClose(); }); }} />}>
      <View style={styles.where}><Text style={txt.smMuted}>{props.where}</Text></View>
      <VoiceNote ctx={props.ctx} label={t('common.sayIt')} hash={hash} onChange={setHash} />
      <Field value={text} onChangeText={setText} placeholder={t('common.orTypeIt')} multiline />
    </Sheet>
  );
}

// ---- earlier ------------------------------------------------------------------------------

interface EarlierItem { key: string; hlc: string; title: string; sub: string; hashes: string[]; text?: string; focus?: boolean; after?: string }

/**
 * The Earlier chip (a-wsPast): everything recorded for this passage so far,
 * oldest first: its versions (and what changed), the feedback on them, and
 * voice notes. Each plays where it is.
 */
export function EarlierPane(props: { ctx: Ctx; v: PassageView; focusReviewId?: string }) {
  const { ctx, v } = props;
  const me = ctx.session.actorId;
  const items = useMemo<EarlierItem[]>(() => {
    const out: EarlierItem[] = [];
    for (const x of v.p.versions) {
      const who = x.by === me ? t('reference.earlier.yours') : ctx.name(x.by);
      out.push({ key: x.takeId, hlc: x.hlc, title: versionTitle(x.n), sub: who, after: when(x.hlc), hashes: x.cardHashes });
      if (x.changeBlobHash || (x.changeNote && x.n > 1)) {
        out.push({ key: `${x.takeId}:change`, hlc: x.hlc, title: t('reference.earlier.whatChanged', { version: versionTitle(x.n) }), sub: who, hashes: x.changeBlobHash ? [x.changeBlobHash] : [], ...(x.changeNote ? { text: x.changeNote } : {}) });
      }
    }
    for (const r of v.p.reviews) {
      const kind = v.kind(r.kindId);
      const mine = r.by === me;
      const name = ctx.name(r.by);
      const made = kind.produces && r.artifacts?.length;
      const hashes = made ? r.artifacts!.map((c) => c.hash) : r.commentBlobHash ? [r.commentBlobHash] : [];
      if (!hashes.length && !r.comment) continue;
      const version = versionTitle(r.versionN);
      const outcome = made ? null : r.outcome === 'needs_changes' ? t('reference.earlier.needsChanges') : r.outcome === 'looks_good' ? t('reference.earlier.looksGood') : null;
      out.push({
        key: r.id, hlc: r.hlc, hashes, ...(r.comment ? { text: r.comment } : {}), focus: r.id === props.focusReviewId,
        title: made
          ? (mine ? t('reference.earlier.yourMade', { what: kind.produces!.what, version }) : t('reference.earlier.theirMade', { name, what: kind.produces!.what, version }))
          : (mine ? t('reference.earlier.yourFeedback', { version }) : t('reference.earlier.theirFeedback', { name, version })),
        sub: outcome ? [kind.name, outcome].join(' · ') : kind.name
      });
      if (r.response?.blobHash || r.response?.note) {
        out.push({ key: `${r.id}:response`, hlc: r.response.hlc,
          title: r.response.by === me ? t('reference.earlier.yourAnswer') : t('reference.earlier.theirAnswer', { name: ctx.name(r.response.by) }),
          sub: r.response.decision === 'kept' ? t('reference.earlier.keptIt') : t('reference.earlier.revised'), hashes: r.response.blobHash ? [r.response.blobHash] : [], ...(r.response.note ? { text: r.response.note } : {}) });
      }
    }
    for (const n of v.p.notes) {
      if (!n.blobHash || n.anchor.kind === 'study' || (n.anchor.kind === 'version' && n.anchor.role === 'change')) continue;
      const verse = n.anchor.kind === 'verse' ? n.anchor.verse.slice(n.anchor.verse.indexOf(':') + 1) : null;
      const title = n.by === me
        ? (verse ? t('reference.earlier.yourNoteOnVerse', { verse }) : t('reference.earlier.yourNote'))
        : (verse ? t('reference.earlier.theirNoteOnVerse', { name: ctx.name(n.by), verse }) : t('reference.earlier.theirNote', { name: ctx.name(n.by) }));
      out.push({ key: n.id, hlc: n.hlc, title, sub: when(n.hlc), hashes: [n.blobHash], ...(n.text ? { text: n.text } : {}) });
    }
    return out.sort((a, b) => (a.hlc < b.hlc ? -1 : a.hlc > b.hlc ? 1 : 0));
  }, [v, ctx, me, props.focusReviewId]);
  if (items.length === 0) return <Text style={[txt.smMuted, { paddingHorizontal: space.xs }]}>{t('reference.earlier.empty')}</Text>;
  return (
    <View style={styles.card}>
      {items.map((it, i) => <EarlierRow key={it.key} ctx={ctx} item={it} last={i === items.length - 1} />)}
    </View>
  );
}

function EarlierRow(props: { ctx: Ctx; item: EarlierItem; last: boolean }) {
  const it = props.item;
  const clip = useClip(props.ctx.language, it.hashes);
  const length = `${clip.total > 0 ? ` · ${mmss(clip.total * 1000)}` : ''}${it.after ? ` · ${it.after}` : ''}`;
  if (it.hashes.length === 0) {
    return (
      <View style={[ps.playRow, !props.last && ps.rowBorder, it.focus && styles.focus]}>
        <View style={ps.playTile}><Ico name="chat" size={20} color={C.primary} /></View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={ps.rowTitle}>{it.title}</Text>
          <Text style={txt.smMuted}>{it.sub}</Text>
          {it.text ? <Text style={[txt.sm, { marginTop: 2 }]}>{t('reference.earlier.quoted', { text: it.text })}</Text> : null}
        </View>
      </View>
    );
  }
  return (
    <View style={[it.focus && styles.focus, !props.last && ps.rowBorder]}>
      <PlayRow title={it.title} sub={`${it.sub}${length}`} playing={clip.playing} available={clip.available} onToggle={clip.toggle}
        last {...(clip.error ? { error: clip.error } : {})} />
      {it.text ? <Text style={[txt.sm, styles.earlierText]}>{t('reference.earlier.quoted', { text: it.text })}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: C.card, borderRadius: radius.xl, borderWidth: 1, borderColor: C.border, overflow: 'hidden' },
  verse: { borderRadius: radius.md, paddingHorizontal: space.xs, paddingVertical: 2, borderWidth: 1.5, borderColor: 'transparent' },
  versePlaying: { backgroundColor: C.light, paddingHorizontal: space.sm },
  verseSelected: { borderColor: C.soft },
  verseText: { fontSize: T.base, lineHeight: 25, color: C.dark },
  verseNum: { fontSize: T.xs, fontWeight: '700', color: C.muted },
  verseNotes: { fontSize: T.xs, fontWeight: '800', color: TINT.amberText },
  term: { fontWeight: '700', color: C.primary, textDecorationLine: 'underline', textDecorationStyle: 'dotted' },
  under: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: 2 },
  pick: { minHeight: 40, paddingHorizontal: space.md, borderRadius: radius.full, borderWidth: 1.5, borderColor: TINT.noteBorder, backgroundColor: TINT.note,
    flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: 110 },
  bibleRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: target.row, paddingHorizontal: space.lg, paddingVertical: space.sm },
  bar: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm + 2, paddingHorizontal: space.lg, backgroundColor: C.card, borderBottomWidth: 1, borderColor: C.border },
  termRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 56, paddingHorizontal: space.sm, paddingVertical: space.xs },
  hear: { width: target.min, height: target.min, alignItems: 'center', justifyContent: 'center' },
  termName: { fontSize: T.base, fontWeight: '800', color: C.dark },
  wordBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: target.min, paddingHorizontal: space.sm },
  yourWord: { fontSize: T.sm, fontWeight: '700', color: TINT.greenText },
  noteCard: { backgroundColor: C.card, borderRadius: radius.xl, borderWidth: 1, borderColor: C.border, padding: space.md + 2, gap: space.sm },
  noteText: { fontSize: T.base, lineHeight: 25, color: C.dark },
  where: { backgroundColor: C.card, borderLeftWidth: 3, borderColor: C.primary, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.sm },
  focus: { backgroundColor: TINT.amber },
  earlierText: { paddingLeft: 68, paddingRight: space.lg, paddingBottom: space.md, marginTop: -space.sm }
});
