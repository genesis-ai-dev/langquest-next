// The workspace's Help sheet (demo translate.tsx HelpSheet, ADR-029; REC-W5,
// TERM-4): everything the team knows about the passage, one tap away. Key terms with this
// language's rendering and "Tie to your draft", the study's progress with
// each step one tap away, notes (Add a note by voice or text; ones about
// older versions marked), and the version history.
import { commands, keyTermView, type KeyTermView, type PassageNote } from '@langquest-next/core';
import * as Crypto from 'expo-crypto';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../ui/text';
import { AudioClip } from '../audio/audioClip';
import type { Ctx } from '../shell/ctx';
import { HelpBadge, HelpRow } from '../helpMode/helpBadge';
import { useHelpSpot } from '../helpMode/useHelpMode';
import { t } from '../i18n';
import { formatNumber } from '../i18n/format';
import { indexesFor } from '../sync/indexes';
import { Badge, Chip, ChipRow, Field, HelpInfo, Ico, LinkBtn, NoteCard, PrimaryBtn, ProgressBar, Row, Sheet, ShowMore, SmallBtn } from '../ui/kit';
import { txt } from '../ui/textStyles';
import { versionTitle, when, type PassageView } from '../passage/passageView';
import { Authored, ReportFlag } from '../moderation/reportSheet';
import { recordTarget } from '../moderation/reportTargets';
import type { StudyProgress } from '../study/progress';
import { studySummary } from '../study/progress';
import { StepMark } from '../study/ui';
import { stepLine } from '../study/studyText';
import { C, radius, space, target, TINT, withAlpha } from '../ui/theme';
import { VoiceNote } from '../audio/voiceNote';
import { useNoteStep } from '../checks/useNoteStep';

export type TrayTab = 'terms' | 'study' | 'notes' | 'history';

/** "Help" in the recording screen's header (ADR-029): icon and word, 48pt. */
export function HelpButton(props: { onPress: () => void; disabled?: boolean }) {
  const spot = useHelpSpot(t('recording.tray.help'), t('recording.tray.helpButtonHelp'), props.onPress);
  return (
    <Pressable onPress={spot.onPress} disabled={props.disabled} accessibilityRole="button" accessibilityLabel={t('recording.tray.help')}
      accessibilityHint={t('recording.tray.helpHint')} accessibilityState={{ disabled: !!props.disabled }}
      style={({ pressed }) => [styles.help, props.disabled && { opacity: 0.45 }, pressed && { opacity: 0.7 }]}>
      <Ico name="help" size={20} color={C.primary} />
      <Text style={[txt.sm, { fontWeight: '700', color: C.primary }]}>{t('recording.tray.help')}</Text>
      <HelpBadge spot={spot} />
    </Pressable>
  );
}

/**
 * The study tray as one sheet (ADR-029): key terms, the study, notes and
 * history, one section at a time, with the same contents the tray had.
 * Going anywhere from it closes it first, so it is never left over the
 * next screen.
 */
export function HelpSheet(props: {
  ctx: Ctx;
  v: PassageView;
  tab: TrayTab;
  onTab: (t: TrayTab) => void;
  onClose: () => void;
  terms: KeyTermView[];
  tied: ReadonlySet<string>;
  /** The draft take a tie is made on; none until something is recorded. */
  draftTakeId: string | undefined;
  /** May tie terms (KeyTermLinked needs fill_reference). */
  canTie: boolean;
  study: StudyProgress | null;
  notes: PassageNote[];
  disabled: boolean;
}) {
  const { onClose } = props;
  const ctx = useMemo<Ctx>(() => ({ ...props.ctx, go: (to, params) => { onClose(); props.ctx.go(to, params); } }), [props.ctx, onClose]);
  const tab = props.tab === 'study' && !props.study ? 'terms' : props.tab;
  const pillHelp: Record<TrayTab, string> = {
    terms: t('recording.tray.termsTabHelp'), study: t('recording.tray.studyTabHelp'), notes: t('recording.tray.notesTabHelp'), history: t('recording.tray.historyTabHelp')
  };
  const pill = (id: TrayTab, label: string, count?: number) => (
    <Chip key={id} label={label} help={pillHelp[id]} on={tab === id} onPress={() => props.onTab(id)} {...(count !== undefined ? { count } : {})} />
  );
  return (
    <Sheet visible title={t('recording.tray.help')} sub={t('recording.tray.helpSub')} onClose={onClose}>
      <ChipRow>
        {pill('terms', t('recording.tray.keyTerms'), props.terms.length)}
        {props.study ? pill('study', t('recording.tray.studyPill', { pattern: props.study.guide.pattern, done: formatNumber(props.study.doneCount), total: formatNumber(props.study.steps.length) })) : null}
        {pill('notes', t('recording.tray.notes'), props.notes.length)}
        {pill('history', t('recording.tray.history'), props.v.p.versions.length)}
      </ChipRow>
      <View style={styles.body}>
        {tab === 'terms' ? <TermsTab {...props} ctx={ctx} /> : null}
        {tab === 'study' && props.study ? <StudyTab ctx={ctx} v={props.v} study={props.study} /> : null}
        {tab === 'notes' ? <NotesTab ctx={ctx} v={props.v} notes={props.notes} disabled={props.disabled} /> : null}
        {tab === 'history' ? <HistoryTab ctx={ctx} v={props.v} /> : null}
      </View>
    </Sheet>
  );
}

/**
 * One tray section shown in place, for the recording workspace's reference
 * pane (demo ADR-036): the same contents as the Help sheet's tabs, without
 * the sheet.
 */
export function TrayPane(props: {
  ctx: Ctx; v: PassageView; tab: TrayTab; terms: KeyTermView[]; tied: ReadonlySet<string>; draftTakeId: string | undefined;
  canTie: boolean; study: StudyProgress | null; notes: PassageNote[]; disabled: boolean;
}) {
  return (
    <View style={styles.body}>
      {props.tab === 'terms' ? <TermsTab {...props} /> : null}
      {props.tab === 'study' && props.study ? <StudyTab ctx={props.ctx} v={props.v} study={props.study} /> : null}
      {props.tab === 'notes' ? <NotesTab ctx={props.ctx} v={props.v} notes={props.notes} disabled={props.disabled} /> : null}
      {props.tab === 'history' ? <HistoryTab ctx={props.ctx} v={props.v} /> : null}
    </View>
  );
}

const TERM_STEP = 8;

function TermsTab(props: { ctx: Ctx; v: PassageView; terms: KeyTermView[]; tied: ReadonlySet<string>; draftTakeId: string | undefined; canTie: boolean; disabled: boolean }) {
  const { ctx, v } = props;
  const [shown, setShown] = useState(TERM_STEP);
  const [tying, setTying] = useState<string | null>(null);
  async function tie(termId: string) {
    const state = ctx.language.state;
    if (!state || !props.draftTakeId || !props.canTie || tying) return;
    setTying(termId);
    try {
      // TERM-4: ties the term to the take being recorded; publishing carries
      // it onto the version. A tie is grow-only, so there is no Undo.
      await ctx.act(commands(state, indexesFor(state)).linkKeyTerms({ commandId: Crypto.randomUUID(), takeId: props.draftTakeId, termIds: [termId] }),
        t('recording.tray.tied'));
    } catch { /* ctx.act said what went wrong */ }
    finally { setTying(null); }
  }
  const scope = { unitId: v.unitId, languageId: v.languageId };
  return (
    <>
      {props.terms.length === 0 ? <Text style={[txt.smMuted, styles.pad]}>{t('recording.tray.noTerms')}</Text> : null}
      {props.terms.slice(0, shown).map((term) => {
        const tied = props.tied.has(term.termId);
        const renderings = term.renderings.map((r) => r.rendering).filter(Boolean);
        const rendered = renderings.length ? renderings.join(', ') : t('recording.tray.noRendering');
        return (
          <HelpRow key={term.termId} of="tray.term">
            <View style={styles.item}>
              <TermHead term={term.term} tied={tied} label={tied ? t('recording.tray.termLabelTied', { term: term.term, rendered }) : t('recording.tray.termLabel', { term: term.term, rendered })}
                renderings={renderings} language={v.language} onPress={() => ctx.go('key_term_detail', { ...scope, termId: term.termId })} />
              {!tied && props.canTie ? (
                <SmallBtn label={tying === term.termId ? t('recording.tray.tying') : t('recording.tray.tie')} icon="link" help={t('recording.tray.tieHelp')}
                  disabled={!props.draftTakeId || props.disabled || !!tying} onPress={() => void tie(term.termId)} />
              ) : null}
            </View>
          </HelpRow>
        );
      })}
      <ShowMore remaining={props.terms.length - shown} step={TERM_STEP} onMore={() => setShown((n) => n + TERM_STEP)} />
      {props.canTie && !props.draftTakeId && props.terms.some((term) => !props.tied.has(term.termId))
        ? <Text style={[txt.xs, styles.pad]}>{t('recording.tray.recordFirst')}</Text> : null}
      <LinkBtn label={t('recording.tray.allTerms')} help={t('recording.tray.allTermsHelp')} onPress={() => ctx.go('key_terms', scope)} style={styles.pad} />
    </>
  );
}

/** A key term's head: the term and how this language says it (amber when not yet), Tied when tied; it opens the term. */
function TermHead(props: { term: string; tied: boolean; label: string; renderings: string[]; language: string; onPress: () => void }) {
  const spot = useHelpSpot(props.term, props.tied ? t('recording.tray.termTiedHelp') : t('recording.tray.termHelp'), props.onPress);
  return (
    <Pressable onPress={spot.onPress} accessibilityRole="button" accessibilityLabel={props.label}
      style={({ pressed }) => [styles.itemHead, pressed && { opacity: 0.7 }]}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[txt.body, { fontWeight: '600' }]} numberOfLines={1}>{props.term}</Text>
        <Text style={[txt.xsStrong, { color: props.renderings.length ? C.primary : TINT.amberText, marginTop: 2 }]} numberOfLines={1}>
          {props.renderings.length ? props.renderings.join(' · ') : t('recording.tray.noLanguageRendering', { language: props.language })}
        </Text>
      </View>
      {props.tied ? <View style={styles.tied}><Ico name="link" size={14} color={TINT.greenText} /><Badge label={t('recording.tray.tiedBadge')} tone="green" /></View> : null}
      <Ico name="right" size={20} color={C.muted} />
      <HelpBadge spot={spot} />
    </Pressable>
  );
}

function StudyTab(props: { ctx: Ctx; v: PassageView; study: StudyProgress }) {
  const { ctx, v, study } = props;
  const scope = { unitId: v.unitId, languageId: v.languageId };
  return (
    <>
      <View style={[styles.pad, { gap: space.sm }]}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.sm }}>
          <Text style={[txt.sm, { fontWeight: '700', flex: 1 }]} numberOfLines={2}>{t('recording.tray.studyTitle', { pattern: study.guide.pattern, passage: study.guide.passage })}</Text>
          <Text style={txt.xs}>{studySummary(study)}</Text>
        </View>
        <HelpInfo label={studySummary(study)} detail={t('recording.tray.studyBarHelp')}>
          <ProgressBar value={study.steps.length ? Math.round((study.doneCount / study.steps.length) * 100) : 0} color={study.next ? C.primary : C.green} />
        </HelpInfo>
      </View>
      <View style={styles.list}>
        {study.steps.map((s, i) => (
          <HelpRow key={s.step.id} of="tray.studyStep">
            <Row leading={<StepMark status={s} />} label={s.step.title} sub={stepLine(ctx, s)}
              last={i === study.steps.length - 1} onPress={() => ctx.go('study_step', { ...scope, stepId: s.step.id })} />
          </HelpRow>
        ))}
      </View>
      <LinkBtn label={t('recording.tray.openStudy')} help={t('recording.tray.openStudyHelp')} onPress={() => ctx.go('study_guide', scope)} style={styles.pad} />
    </>
  );
}

const NOTE_STEP = 6;

function NotesTab(props: { ctx: Ctx; v: PassageView; notes: PassageNote[]; disabled: boolean }) {
  const { ctx, v } = props;
  const [adding, setAdding] = useState(false);
  const [shown, setShown] = useState(NOTE_STEP);
  const versionN = useMemo(() => new Map(v.p.versions.map((x) => [x.takeId, x.n])), [v.p.versions]);
  const latestId = v.p.latest?.takeId;
  const anchor = (n: PassageNote): string => {
    switch (n.anchor.kind) {
      case 'passage': return t('recording.tray.anchor.passage');
      case 'version': { const at = versionN.get(n.anchor.takeId); return at ? versionTitle(at) : t('recording.tray.anchor.draft'); }
      case 'verse': return t('recording.tray.anchor.verse', { verse: n.anchor.verse });
      case 'term': return keyTermView(v.state, n.anchor.termId)?.term ?? t('recording.tray.anchor.term');
      case 'study': return t('recording.tray.anchor.study');
    }
  };
  const newest = [...props.notes].reverse();
  const add = useHelpSpot(t('common.addNote'), t('recording.tray.addNoteHelp'), () => setAdding(true));
  return (
    <>
      <Pressable onPress={add.onPress} disabled={props.disabled} accessibilityRole="button" accessibilityLabel={t('common.addNote')}
        style={({ pressed }) => [styles.addNote, props.disabled && { opacity: 0.5 }, pressed && { opacity: 0.7 }]}>
        <Ico name="plus" size={18} color={TINT.amberText} />
        <Text style={[txt.sm, { fontWeight: '700', color: TINT.amberText }]}>{t('common.addNote')}</Text>
        <HelpBadge spot={add} />
      </Pressable>
      {props.notes.length === 0
        ? <Text style={[txt.smMuted, styles.pad]}>{t('recording.tray.notesEmpty')}</Text> : null}
      {newest.slice(0, shown).map((n) => {
        const older = n.onTakeId && n.onTakeId !== latestId ? versionN.get(n.onTakeId) : undefined;
        return (
          <HelpRow key={n.id} of="tray.note">
            <Authored ctx={ctx} by={n.by}>
              <NoteCard anchor={anchor(n)} {...(n.text ? { text: n.text } : {})} by={ctx.name(n.by)} when={when(n.hlc)}
                {...(older ? { olderVersion: versionTitle(older) } : {})}
                {...(n.blobHash ? { audio: <AudioClip language={ctx.language} hashes={[n.blobHash]} label={t('recording.voiceNote.play')} /> } : {})}
                action={<ReportFlag ctx={ctx} target={recordTarget(ctx, 'note', n.id, n.by, n.unitId)} size={36} />} />
            </Authored>
          </HelpRow>
        );
      })}
      <ShowMore remaining={newest.length - shown} step={NOTE_STEP} onMore={() => setShown((x) => x + NOTE_STEP)} />
      {adding ? <NoteSheet ctx={ctx} v={v} onClose={() => setAdding(false)} /> : null}
    </>
  );
}

function NoteSheet(props: { ctx: Ctx; v: PassageView; onClose: () => void }) {
  const { ctx, v } = props;
  const [text, setText] = useState('');
  const [hash, setHash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const step = useNoteStep();
  async function save() {
    const state = ctx.language.state;
    if (!state || busy) return;
    setBusy(true);
    try {
      const specs = commands(state, indexesFor(state)).addNote({
        commandId: Crypto.randomUUID(), unitId: v.unitId, anchor: { kind: 'passage' }, ...(step ? { kindId: step } : {}),
        ...(text.trim() ? { text: text.trim() } : {}), ...(hash ? { blobHash: hash } : {})
      });
      // No toast offers Undo (decision 134): History's Undo on your own note takes it back.
      await ctx.act(specs, t('recording.tray.noteAdded'));
      props.onClose();
    } catch { /* ctx.act said what went wrong */ }
    finally { setBusy(false); }
  }
  return (
    <Sheet visible title={t('common.addNote')} sub={t('recording.tray.noteSheetSub')} onClose={props.onClose}
      footer={<PrimaryBtn label={t('recording.tray.saveNote')} busy={busy} disabled={!text.trim() && !hash} onPress={() => void save()} />}>
      <VoiceNote ctx={ctx} label={t('common.sayIt')} hash={hash} onChange={setHash} />
      <Field value={text} onChangeText={setText} placeholder={t('common.orTypeIt')} multiline />
    </Sheet>
  );
}

const HISTORY_STEP = 5;

function HistoryTab(props: { ctx: Ctx; v: PassageView }) {
  const { ctx, v } = props;
  const [shown, setShown] = useState(HISTORY_STEP);
  const versions = [...v.p.versions].reverse();
  if (versions.length === 0) return <Text style={[txt.smMuted, styles.pad]}>{t('recording.tray.firstVersion')}</Text>;
  return (
    <>
      {versions.slice(0, shown).map((x) => (
        <HelpRow key={x.takeId} of="tray.version">
          <View style={styles.history}>
            <Text style={[txt.sm, { fontWeight: '700' }]}>{versionTitle(x.n)} <Text style={[txt.sm, { fontWeight: '400', color: C.muted }]}>· {ctx.name(x.by)} · {when(x.hlc)}</Text></Text>
            <Text style={[txt.sm, { marginTop: 2 }]}>{x.changeNote ?? (x.n === 1 ? t('recording.tray.firstRecording') : t('recording.tray.saidInVoiceNote'))}</Text>
            {x.changeBlobHash ? <View style={{ marginTop: space.xs }}><AudioClip language={ctx.language} hashes={[x.changeBlobHash]} label={t('recording.tray.playWhatChanged', { version: versionTitle(x.n) })} /></View> : null}
          </View>
        </HelpRow>
      ))}
      <ShowMore remaining={versions.length - shown} step={HISTORY_STEP} onMore={() => setShown((n) => n + HISTORY_STEP)} />
    </>
  );
}

const styles = StyleSheet.create({
  body: { gap: space.sm },
  help: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: target.min, paddingHorizontal: space.md, borderRadius: radius.full, backgroundColor: C.light },
  pad: { paddingHorizontal: space.xs },
  item: { backgroundColor: C.bg, borderRadius: radius.lg, padding: space.sm, gap: space.sm },
  itemHead: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: target.min, paddingHorizontal: space.sm },
  tied: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  list: { backgroundColor: C.card, borderRadius: radius.lg, overflow: 'hidden' },
  addNote: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: target.primary, paddingHorizontal: space.lg, borderRadius: radius.lg,
    borderWidth: 1.5, borderStyle: 'dashed', borderColor: withAlpha(C.amber, 0.56) },
  history: { backgroundColor: C.bg, borderRadius: radius.lg, paddingHorizontal: space.lg, paddingVertical: space.md }
});
