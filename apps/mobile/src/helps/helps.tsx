// Deciding something about a passage with its text open, in a Bible the
// person chooses, and what others usually do beside it (design principles
// 13 and 14; demo ADR-042, src/helps/helps.tsx PassageHelps, NoteOnPassage
// and KeyWord): the passage one tap away on What helps here, each help's
// words for this passage, a note for translators written under the text on
// the verses it is about, and a key word's verses with how the
// organization's other languages say it. The Bible is the recorder's
// (`useBible`, `BibleSheet`); pure rules are in helpsModel.ts.
import { languageName, unitTitle, type KeyTermView, type PassageNote } from '@langquest-next/core';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../ui/text';
import type { BlobFile } from '../sync/blobs';
import { streamUrl } from '../server/blobTransport';
import type { Ctx } from '../shell/ctx';
import { useHelpSpot } from '../helpMode/helpContext';
import { HelpBadge } from '../helpMode/helpBadge';
import { t } from '../i18n';
import { Field, Header, Ico, LinkBtn, PrimaryBtn, Screen, SectionLabel, txt, type IconName } from '../ui/kit';
import { markTerms } from '../recording/workspaceModel';
import { noteExpected } from '../diagnostics/report';
import type { VerseRow } from '../sources/model';
import { saveNote } from '../study/ui';
import { C, radius, space, target, TINT, type as T, withAlpha } from '../ui/theme';
import { VoiceNote } from '../audio/voiceNote';
import { firstTouched, keyLabel, runKey, tapVerse, wordHits, type OtherSays, type VerseRun } from './helpsModel';
import { styles as ps } from '../recording/blocks';
import { BibleSheet, useBible, type Bible } from './reference';
import { useClip } from '../audio/useClip';
import { textMissing } from './helpsModel';
export { bibleMissing } from './helpsModel';

/** A chosen verse or a found word: soft grey, never loud purple (Caleb, 2026-10-10). */
export const SOFT_MARK = withAlpha(C.dark, 0.1);

/** "12", "38-39": a verse row's own number, without its chapter. */
const verseOf = (row: VerseRow) => keyLabel(row.key.includes(':') ? row.key.slice(row.key.indexOf(':') + 1) : row.key);

// ---- the Bible chips ------------------------------------------------------------------------

/** The chosen Bible (tap to choose another) and Listen, as two amber chips (demo `BibleChips`). */
export function BibleChips(props: { ctx: Ctx; bible: Bible }) {
  const { bible } = props;
  const listen = useHelpSpot(t('reference.passageText.listen'), t('reference.passageText.listenHelp'), bible.player.toggle);
  if (!bible.option) return null;
  return (
    <View style={styles.chips}>
      <BibleChip ctx={props.ctx} bible={bible} />
      {bible.hasAudio ? (
        <Pressable onPress={listen.onPress} disabled={bible.player.loading} accessibilityRole="button"
          accessibilityLabel={bible.player.playing ? t('common.pause') : t('reference.passageText.listen')}
          style={({ pressed }) => [styles.chip, bible.player.loading && ps.off, pressed && ps.pressed]}>
          <Ico name={bible.player.playing ? 'pause' : 'play'} size={16} color={TINT.amberText} fill={TINT.amberText} />
          <Text style={styles.chipText}>{bible.player.playing ? t('common.pause') : t('reference.passageText.listen')}</Text>
          <HelpBadge spot={listen} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** The chosen Bible as an amber chip: tap to choose another (the recorder's `BibleSheet`). */
export function BibleChip(props: { ctx: Ctx; bible: Bible }) {
  const { bible } = props;
  const [picking, setPicking] = useState(false);
  const many = bible.passage.options.length > 1;
  const abbr = bible.option?.abbreviation ?? '';
  const spot = useHelpSpot(t('reference.bible.choose'), t('reference.bible.chooseHelp'), many ? () => setPicking(true) : undefined);
  if (!bible.option) return null;
  return (
    <>
      <Pressable onPress={spot.onPress} disabled={!many} accessibilityRole="button" accessibilityLabel={t('reference.bible.pickLabel', { bible: abbr })}
        style={({ pressed }) => [styles.chip, pressed && ps.pressed]}>
        <Ico name="book" size={18} color={TINT.amberText} />
        <Text style={styles.chipText} numberOfLines={1}>{abbr}</Text>
        {many ? <Ico name="down" size={18} color={TINT.amberText} strokeWidth={2.6} /> : null}
        <HelpBadge spot={spot} />
      </Pressable>
      {picking ? <BibleSheet ctx={props.ctx} bible={bible} onClose={() => setPicking(false)} /> : null}
    </>
  );
}

// ---- the passage, one tap away ---------------------------------------------------------------

/**
 * "Luke 15:11–32 · WEB ▾" at the top of What helps here (demo
 * `PassageHelps`): it opens the passage in the chosen Bible, with the key
 * words marked and a Note mark where a note for translators starts.
 */
export function PassageTextBar(props: {
  ctx: Ctx; bible: Bible; title: string; open: boolean; onToggle: () => void;
  terms: readonly Pick<KeyTermView, 'termId' | 'term'>[]; notes: readonly PassageNote[];
}) {
  const { bible } = props;
  const rows = bible.rows;
  const abbr = bible.option?.abbreviation;
  const toggle = useHelpSpot(t('reference.passageText.barHelpTitle'), t('reference.passageText.barHelp'), props.onToggle);
  const noted = useMemo(() => {
    const at = new Set<number>();
    if (!rows) return at;
    for (const n of props.notes) {
      if (n.anchor.kind !== 'verse') continue;
      const i = firstTouched(rows, n.anchor.verse);
      if (i >= 0) at.add(i);
    }
    return at;
  }, [rows, props.notes]);
  const label = abbr ? t('reference.passageText.bar', { passage: props.title, bible: abbr }) : props.title;
  return (
    <View style={styles.textCard}>
      <Pressable onPress={toggle.onPress} accessibilityRole="button" accessibilityState={{ expanded: props.open }}
        accessibilityLabel={props.open ? t('reference.passageText.closeText', { passage: label }) : t('reference.passageText.openText', { passage: label })}
        style={({ pressed }) => [styles.textBar, pressed && ps.pressed]}>
        <Ico name="book" size={22} color={TINT.amberText} />
        <Text style={styles.barTitle} numberOfLines={1}>{label}</Text>
        <Ico name={props.open ? 'up' : 'down'} size={22} color={TINT.amberText} strokeWidth={2.4} />
        <HelpBadge spot={toggle} />
      </Pressable>
      {props.open ? (
        <View style={styles.textBody}>
          <BibleChips ctx={props.ctx} bible={bible} />
          <ScrollView style={styles.textScroll} nestedScrollEnabled showsVerticalScrollIndicator>
            {rows ? (
              <Text style={styles.reading}>
                {rows.map((row, i) => (
                  <Text key={row.key}>
                    <Text style={styles.num}>{verseOf(row)} </Text>
                    {noted.has(i) ? <Text style={styles.noteTag}>{t('reference.passageText.noteTag')}</Text> : null}
                    {noted.has(i) ? ' ' : null}
                    {markTerms(row.text, props.terms).map((p, j) => (p.termId
                      ? <Text key={j} style={styles.word} accessibilityLabel={t('reference.bible.keyWord', { word: p.text })}>{p.text}</Text>
                      : <Text key={j}>{p.text}</Text>))}
                    {' '}
                  </Text>
                ))}
              </Text>
            ) : <Text style={txt.smMuted}>{textMissing(bible)}</Text>}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

// ---- one help ------------------------------------------------------------------------------------

/** What a help says on this passage, in a line or two: "Step 1 · Hear and Heart", "15:20 · Older men did not run." */
export interface HelpPreview { lead?: string; text: string }

/**
 * One help on the passage (demo `HelpCard`): what it is and where it is
 * from, what it says here, and Show here / Hide here for whoever manages
 * reference. A hidden help's words are greyed.
 */
export function HelpCard(props: {
  icon: IconName; name: string; sub: string; preview: HelpPreview | null; shown: boolean;
  onSet?: (shown: boolean) => void; busy?: boolean; children?: ReactNode;
}) {
  const p = props.preview;
  return (
    <View style={styles.helpCard}>
      <View style={styles.helpHead}>
        <View style={styles.helpTile}><Ico name={props.icon} size={20} color={TINT.amberText} /></View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.helpName} numberOfLines={2}>{props.name}</Text>
          <Text style={txt.xs} numberOfLines={2}>{props.sub}</Text>
        </View>
      </View>
      {p && (p.text || p.lead) ? (
        <View style={[styles.preview, !props.shown && styles.previewOff]}>
          <Text style={[txt.sm, !props.shown && { color: C.muted }]} numberOfLines={2}>
            {p.lead ? <Text style={{ fontWeight: '800' }}>{p.lead}</Text> : null}
            {p.lead && p.text ? ' · ' : null}
            {p.text}
          </Text>
        </View>
      ) : null}
      {props.children}
      {props.onSet ? <ShowHide shown={props.shown} busy={!!props.busy} onSet={props.onSet} /> : null}
    </View>
  );
}

function ShowHide(props: { shown: boolean; busy: boolean; onSet: (shown: boolean) => void }) {
  return (
    <View style={styles.showHide}>
      <ShowHideBtn on={props.shown} icon="eye" label={t('reference.passage.showHere')} help={t('reference.passageText.showHelp')} disabled={props.busy} onPress={() => props.onSet(true)} />
      <ShowHideBtn on={!props.shown} icon="eyeOff" label={t('reference.passage.hideHere')} help={t('reference.passageText.hideHelp')} disabled={props.busy} onPress={() => props.onSet(false)} />
    </View>
  );
}

function ShowHideBtn(props: { on: boolean; icon: IconName; label: string; help: string; disabled: boolean; onPress: () => void }) {
  const spot = useHelpSpot(props.label, props.help, props.on ? () => undefined : props.onPress);
  return (
    <Pressable onPress={spot.onPress} disabled={props.disabled} accessibilityRole="radio" accessibilityState={{ selected: props.on, disabled: props.disabled }}
      style={({ pressed }) => [styles.showBtn, props.on && styles.showBtnOn, pressed && ps.pressed]}>
      <Ico name={props.icon} size={18} color={props.on ? C.primary : C.muted} />
      <Text style={[styles.showLabel, { color: props.on ? C.primary : C.muted }]} numberOfLines={1}>{props.label}</Text>
      <HelpBadge spot={spot} />
    </Pressable>
  );
}

/** A small word to tap inside a help (a key word that opens), 48pt tall. */
export function WordChip(props: { label: string; help: string; onPress: () => void }) {
  const spot = useHelpSpot(props.label, props.help, props.onPress);
  return (
    <Pressable onPress={spot.onPress} accessibilityRole="button" style={({ pressed }) => [styles.wordChip, pressed && ps.pressed]}>
      <Text style={styles.wordChipText} numberOfLines={1}>{props.label}</Text>
      <HelpBadge spot={spot} />
    </Pressable>
  );
}

// ---- a note for translators on the verses --------------------------------------------------------

/**
 * A note for translators, written under the passage's text (demo
 * `NoteOnPassage`): the passage in a Bible the writer chooses, tap a verse
 * and another to run to it (or the whole passage), then say the note, with
 * typing under it. Saved as a passage note on those verses (`v1.NoteAdded`,
 * a verse anchor in the verse rows' own key form), which translators see
 * on those verses in the recorder and the study.
 */
export function PassageNoteEditor({ ctx }: { ctx: Ctx }) {
  const state = ctx.language.state;
  const unitId = ctx.params['unitId'] ?? '';
  const languageId = ctx.params['languageId'] ?? ctx.language.languageId;
  const here = !!state?.units[unitId] && languageId === ctx.language.languageId;
  const bible = useBible(ctx, here ? unitId : null, languageId, {});
  const [run, setRun] = useState<VerseRun>(null);
  const [text, setText] = useState('');
  const [hash, setHash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const title = state && here ? unitTitle(state, unitId) : '';
  const language = languageName(ctx.org.state, languageId);
  const header = <Header title={t('notes.onVerses.title')} sub={title ? t('notes.onVerses.sub', { passage: title, language }) : language} onBack={ctx.back} close />;
  if (!state || !here) {
    return <Screen header={header}><Text style={txt.smMuted}>{state ? t('reference.passage.gone') : t('common.loading')}</Text></Screen>;
  }
  const rows = bible.rows ?? [];
  const key = run ? runKey(rows, run) : null;
  const abbr = bible.option?.abbreviation;
  const ready = !!text.trim() || !!hash;

  async function save() {
    if (!ready || busy) return;
    setBusy(true);
    const anchor = key ? { kind: 'verse' as const, verse: key, ...(abbr ? { translation: abbr } : {}) } : { kind: 'passage' as const };
    const ok = await saveNote(ctx, { unitId }, anchor, { text, blobHash: hash },
      key ? t('notes.onVerses.saved', { where: keyLabel(key) }) : t('notes.onVerses.savedWhole', { passage: title }));
    setBusy(false);
    if (ok) ctx.back();
  }

  return (
    <Screen
      header={<>{header}<View style={styles.chipBar}><BibleChips ctx={ctx} bible={bible} /></View></>}
      footer={(
        <>
          <View style={styles.whereRow}>
            <View style={styles.wherePill}><Text style={styles.whereText} numberOfLines={1}>{key ? t('notes.onVerses.on', { where: keyLabel(key) }) : t('notes.onVerses.onWhole')}</Text></View>
            {key ? <LinkBtn label={t('notes.onVerses.whole')} color={C.muted} onPress={() => setRun(null)} /> : null}
          </View>
          <VoiceNote ctx={ctx} label={t('notes.onVerses.say')} hash={hash} onChange={setHash} />
          <Field value={text} onChangeText={setText} placeholder={t('common.orTypeIt')} autoCapitalize="sentences" multiline />
          <PrimaryBtn label={t('reference.notes.save')} icon="check" disabled={!ready} busy={busy} onPress={() => void save()} />
        </>
      )}>
      <View style={styles.hint}>
        <Ico name="note" size={16} color={C.muted} />
        <Text style={[txt.smMuted, { flex: 1 }]}>{t('notes.onVerses.hint')}</Text>
      </View>
      {rows.length ? (
        <View>
          {rows.map((row, i) => {
            const on = !!run && i >= Math.min(run[0], run[1]) && i <= Math.max(run[0], run[1]);
            const top = on && i === Math.min(run[0], run[1]);
            const bottom = on && i === Math.max(run[0], run[1]);
            return <VerseTap key={row.key} row={row} on={on} top={top} bottom={bottom} onPress={() => setRun(tapVerse(run, i))} />;
          })}
        </View>
      ) : <Text style={txt.smMuted}>{textMissing(bible)}</Text>}
    </Screen>
  );
}

function VerseTap(props: { row: VerseRow; on: boolean; top: boolean; bottom: boolean; onPress: () => void }) {
  const r = props.row;
  const spot = useHelpSpot(t('reference.bible.verse', { verse: verseOf(r) }), t('notes.onVerses.verseHelp'), props.onPress);
  return (
    <Pressable onPress={spot.onPress} accessibilityRole="button" accessibilityState={{ selected: props.on }}
      accessibilityLabel={t('sources.reader.verseLabel', { verse: r.key, text: r.text })}
      style={({ pressed }) => [styles.verse, props.on && styles.verseOn, props.top && styles.verseTop, props.bottom && styles.verseBottom, pressed && ps.pressed]}>
      <Text style={styles.reading}>
        <Text style={styles.num}>{verseOf(r)} </Text>
        {r.text}
      </Text>
      <HelpBadge spot={spot} />
    </Pressable>
  );
}

// ---- a key word on a passage -------------------------------------------------------------------

/**
 * Where a key word is in the passage (demo `KeyWord`): each verse it is in,
 * named, with the word marked in soft grey. `chip` is the Bible to read it
 * in, beside the heading; `max` keeps a sheet short.
 */
export function WhereItIs(props: { rows: readonly VerseRow[] | null; book: string; word: string; bibleName: string; missing: string; chip?: ReactNode; max?: number }) {
  const hits = useMemo(() => wordHits(props.rows, props.word), [props.rows, props.word]);
  const shown = props.max ? hits.slice(0, props.max) : hits;
  return (
    <>
      <SectionLabel label={t('keyTerms.verses.title')} action={props.chip} />
      {!props.rows ? <Text style={[txt.smMuted, styles.pad]}>{props.missing}</Text>
        : hits.length === 0 ? (
          <Text style={[txt.smMuted, styles.pad]}>
            {props.bibleName ? t('keyTerms.verses.none', { word: props.word.trim(), bible: props.bibleName }) : t('keyTerms.verses.noneHere', { word: props.word.trim() })}
          </Text>
        )
        : (
          <View style={styles.group}>
            {shown.map((h, i) => (
              <View key={h.row.key} style={[styles.hit, i < shown.length - 1 && ps.rowBorder]}>
                <Text style={txt.xsStrong}>{`${props.book} ${keyLabel(h.row.key)}`}</Text>
                <Text style={styles.reading}>
                  {h.parts.map((p, j) => (p.hit ? <Text key={j} style={styles.found}>{p.text}</Text> : <Text key={j}>{p.text}</Text>))}
                </Text>
              </View>
            ))}
          </View>
        )}
      {props.max && hits.length > props.max ? <Text style={[txt.xs, styles.pad]}>{t('keyTerms.verses.more', { count: hits.length - props.max })}</Text> : null}
    </>
  );
}

/**
 * How the organization's other languages say a key word (demo `KeyWord`,
 * principle 14): each language's word, what it means, and its recording
 * when the file is on this phone. Only languages this phone holds.
 */
export function OthersSay(props: { ctx: Ctx; items: readonly OtherSays[]; loading: boolean; word: string }) {
  return (
    <>
      <SectionLabel label={t('keyTerms.others.title')} />
      {props.loading ? <Text style={[txt.smMuted, styles.pad]}>{t('common.loading')}</Text>
        : props.items.length === 0 ? <Text style={[txt.smMuted, styles.pad]}>{t('keyTerms.others.none', { word: props.word.trim() })}</Text>
        : props.items.map((o) => <OtherCard key={o.languageId} ctx={props.ctx} o={o} />)}
    </>
  );
}

function OtherCard(props: { ctx: Ctx; o: OtherSays }) {
  const { o } = props;
  const [failed, setFailed] = useState(false);
  return (
    <View style={styles.other}>
      {o.voice && !failed ? <OtherVoice ctx={props.ctx} o={o} onFailed={() => setFailed(true)} /> : (
        <View style={styles.otherTile}><Ico name="globe" size={20} color={TINT.amberText} /></View>
      )}
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text style={styles.helpName}>{o.name}</Text>
        {o.word ? <Text style={styles.otherWord}>{o.word}</Text> : <Text style={txt.xs}>{t('keyTerms.others.saidOnly')}</Text>}
        {o.means ? <Text style={txt.sm}>{o.means}</Text> : null}
      </View>
    </View>
  );
}

/**
 * Another language's word, said: from this phone when the file is here,
 * else streamed from that language's files on the first tap. When the
 * server will not give it (not a member there, or offline) the play button
 * goes and the word stays.
 */
function OtherVoice(props: { ctx: Ctx; o: OtherSays; onFailed: () => void }) {
  const { ctx, o } = props;
  const ref = { hash: o.voice!, format: (o.voiceFormat ?? 'm4a') as BlobFile['format'] };
  const [uri, setUri] = useState<string | null>(() => ctx.language.blobs.uriFor(ref));
  const [wanted, setWanted] = useState(false);
  const clip = useClip(ctx.language, [], uri ? { uri } : undefined);
  useEffect(() => {
    if (!wanted || !uri) return;
    setWanted(false);
    clip.toggle();
  }, [wanted, uri]); // eslint-disable-line react-hooks/exhaustive-deps
  const press = () => {
    if (uri) { clip.toggle(); return; }
    setWanted(true);
    streamUrl(ctx.language.orgId, o.languageId, ref).then(setUri).catch((e: unknown) => {
      noteExpected('other language word audio', e);
      setWanted(false);
      props.onFailed();
    });
  };
  const spot = useHelpSpot(t('keyTerms.others.play', { language: o.name }), t('keyTerms.others.playHelp'), press);
  return (
    <Pressable onPress={spot.onPress} disabled={wanted} accessibilityRole="button"
      accessibilityLabel={clip.playing ? t('common.pause') : t('keyTerms.others.play', { language: o.name })}
      style={({ pressed }) => [styles.otherPlay, wanted && ps.off, pressed && ps.pressed]}>
      <Ico name={clip.playing ? 'pause' : 'play'} size={18} color={C.white} fill={C.white} />
      <HelpBadge spot={spot} />
    </Pressable>
  );
}

/** The open language's own word, as its team said it: play it here. */
export function OwnWord(props: { ctx: Ctx; hash: string; term: string }) {
  const clip = useClip(props.ctx.language, [props.hash]);
  const spot = useHelpSpot(t('reference.keyWords.yourWord'), t('reference.keyWords.yourWordHelp', { term: props.term }), clip.toggle);
  return (
    <Pressable onPress={spot.onPress} disabled={!clip.available} accessibilityRole="button"
      accessibilityLabel={clip.playing ? t('reference.keyWords.pauseYourWord', { term: props.term }) : t('reference.keyWords.playYourWord', { term: props.term })}
      style={({ pressed }) => [styles.own, !clip.available && ps.off, pressed && ps.pressed]}>
      <View style={styles.ownPlay}><Ico name={clip.playing ? 'pause' : 'play'} size={18} color={C.white} fill={C.white} /></View>
      <Text style={[styles.helpName, { flex: 1 }]}>{t('reference.keyWords.yourWord')}</Text>
      <HelpBadge spot={spot} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  own: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: target.row, paddingHorizontal: space.lg, paddingVertical: space.sm, backgroundColor: C.card },
  ownPlay: { width: target.min, height: target.min, borderRadius: target.min / 2, backgroundColor: TINT.greenText, alignItems: 'center', justifyContent: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: { minHeight: target.min, paddingHorizontal: space.lg, borderRadius: radius.full, borderWidth: 1.5, borderColor: TINT.noteBorder, backgroundColor: TINT.note,
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' },
  chipText: { fontSize: T.base, fontWeight: '800', color: TINT.amberText, maxWidth: 140 },
  chipBar: { paddingHorizontal: space.lg, paddingBottom: space.md, backgroundColor: C.bg, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: C.border },
  textCard: { borderRadius: radius.xl, borderWidth: 1.5, borderColor: TINT.noteBorder, backgroundColor: C.card, overflow: 'hidden' },
  textBar: { minHeight: target.primary, flexDirection: 'row', alignItems: 'center', gap: space.sm + 2, paddingHorizontal: space.lg, backgroundColor: TINT.note },
  barTitle: { flex: 1, fontSize: T.base, fontWeight: '800', color: C.dark },
  textBody: { paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.sm, gap: space.sm },
  textScroll: { maxHeight: 320 },
  reading: { fontSize: T.base, lineHeight: 27, color: C.dark },
  num: { fontSize: T.xs, fontWeight: '800', color: C.muted },
  word: { textDecorationLine: 'underline', textDecorationStyle: 'dotted', textDecorationColor: TINT.amberText },
  noteTag: { fontSize: T.xs, fontWeight: '800', color: TINT.amberText, backgroundColor: TINT.amber },
  helpCard: { backgroundColor: C.card, borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth, borderColor: C.border, padding: space.md, gap: space.sm + 2 },
  helpHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  helpTile: { width: 40, height: 40, borderRadius: radius.md, backgroundColor: TINT.amber, alignItems: 'center', justifyContent: 'center' },
  helpName: { fontSize: T.base, fontWeight: '800', color: C.dark },
  preview: { borderRadius: radius.md, backgroundColor: TINT.amber, paddingHorizontal: space.md, paddingVertical: space.sm },
  previewOff: { backgroundColor: C.bg },
  showHide: { flexDirection: 'row', gap: space.sm },
  showBtn: { flex: 1, minHeight: target.min, borderRadius: radius.md + 2, borderWidth: 2, borderColor: C.border, backgroundColor: C.card,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: space.sm },
  showBtnOn: { borderColor: C.primary, backgroundColor: C.light },
  showLabel: { fontSize: T.sm, fontWeight: '700' },
  wordChip: { minHeight: target.min, paddingHorizontal: space.md, borderRadius: radius.full, backgroundColor: TINT.amber, justifyContent: 'center' },
  wordChipText: { fontSize: T.sm, fontWeight: '700', color: C.dark, textDecorationLine: 'underline', textDecorationStyle: 'dotted', textDecorationColor: TINT.amberText },
  hint: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.xs },
  verse: { minHeight: target.min, justifyContent: 'center', paddingHorizontal: space.sm, paddingVertical: space.xs },
  verseOn: { backgroundColor: SOFT_MARK },
  verseTop: { borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md },
  verseBottom: { borderBottomLeftRadius: radius.md, borderBottomRightRadius: radius.md },
  whereRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  wherePill: { minHeight: 40, paddingHorizontal: space.lg, borderRadius: radius.full, backgroundColor: SOFT_MARK, justifyContent: 'center', flexShrink: 1 },
  whereText: { fontSize: T.sm, fontWeight: '800', color: C.dark },
  pad: { paddingHorizontal: space.xs },
  group: { backgroundColor: C.card, borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth, borderColor: C.border, overflow: 'hidden' },
  hit: { paddingHorizontal: space.lg, paddingVertical: space.md, gap: 2 },
  found: { backgroundColor: SOFT_MARK, fontWeight: '800', color: C.dark },
  other: { flexDirection: 'row', alignItems: 'center', gap: space.md, backgroundColor: C.card, borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth, borderColor: C.border, padding: space.md },
  otherTile: { width: target.min, height: target.min, borderRadius: target.min / 2, backgroundColor: TINT.amber, alignItems: 'center', justifyContent: 'center' },
  otherPlay: { width: target.min, height: target.min, borderRadius: target.min / 2, backgroundColor: TINT.amberText, alignItems: 'center', justifyContent: 'center' },
  otherWord: { fontSize: T.lg, fontWeight: '800', color: C.dark }
});
