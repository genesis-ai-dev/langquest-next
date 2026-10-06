// The workspace's Help sheet (demo translate.tsx HelpSheet, ADR-029; REC-W5,
// TERM-4): everything the team knows about the passage, one tap away. Key terms with this
// language's rendering and "Tie to your draft", the study's progress with
// each step one tap away, notes (Add a note by voice or text; ones about
// older versions marked), and the version history.
import { commands, keyTermView, type KeyTermView, type PassageNote } from '@langquest-next/core';
import * as Crypto from 'expo-crypto';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AudioClip } from '../audioClip';
import type { Ctx } from '../ctx';
import { indexesFor } from '../indexes';
import {
  Badge, Chip, ChipRow, Field, Ico, LinkBtn, NoteCard, PrimaryBtn, ProgressBar, Row, Sheet, ShowMore, SmallBtn, txt
} from '../kit';
import { versionTitle, when, type PassageView } from '../passageView';
import { Authored, recordTarget, ReportFlag } from '../reportSheet';
import type { StudyProgress } from '../study/progress';
import { studySummary } from '../study/progress';
import { StepMark, stepLine } from '../study/ui';
import { C, radius, space, target, TINT, withAlpha } from '../theme';
import { VoiceNote } from '../voiceNote';

export type TrayTab = 'terms' | 'study' | 'notes' | 'history';

/** "Help" in the recording screen's header (ADR-029): icon and word, 48pt. */
export function HelpButton(props: { onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable onPress={props.onPress} disabled={props.disabled} accessibilityRole="button" accessibilityLabel="Help"
      accessibilityHint="Key terms, the study, notes and history for this passage" accessibilityState={{ disabled: !!props.disabled }}
      style={({ pressed }) => [styles.help, props.disabled && { opacity: 0.45 }, pressed && { opacity: 0.7 }]}>
      <Ico name="help" size={20} color={C.primary} />
      <Text style={[txt.sm, { fontWeight: '700', color: C.primary }]}>Help</Text>
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
  const pill = (id: TrayTab, label: string, count?: number) => (
    <Chip key={id} label={label} on={tab === id} onPress={() => props.onTab(id)} {...(count !== undefined ? { count } : {})} />
  );
  return (
    <Sheet visible title="Help" sub="What the team knows about this passage." onClose={onClose}>
      <ChipRow>
        {pill('terms', 'Key terms', props.terms.length)}
        {props.study ? pill('study', `${props.study.guide.pattern} study ${props.study.doneCount}/${props.study.steps.length}`) : null}
        {pill('notes', 'Notes', props.notes.length)}
        {pill('history', 'History', props.v.p.versions.length)}
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
        'Tied to your draft.');
    } catch { /* ctx.act said what went wrong */ }
    finally { setTying(null); }
  }
  const scope = { unitId: v.unitId, languageId: v.languageId };
  return (
    <>
      {props.terms.length === 0 ? <Text style={[txt.smMuted, styles.pad]}>No key terms matched this passage's source.</Text> : null}
      {props.terms.slice(0, shown).map((t) => {
        const tied = props.tied.has(t.termId);
        const renderings = t.renderings.map((r) => r.rendering).filter(Boolean);
        return (
          <View key={t.termId} style={styles.item}>
            <Pressable onPress={() => ctx.go('key_term_detail', { ...scope, termId: t.termId })} accessibilityRole="button"
              accessibilityLabel={`${t.term}. ${renderings.length ? renderings.join(', ') : 'No rendering yet'}${tied ? '. Tied to your draft' : ''}`}
              style={({ pressed }) => [styles.itemHead, pressed && { opacity: 0.7 }]}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[txt.body, { fontWeight: '600' }]} numberOfLines={1}>{t.term}</Text>
                <Text style={[txt.xsStrong, { color: renderings.length ? C.primary : TINT.amberText, marginTop: 2 }]} numberOfLines={1}>
                  {renderings.length ? renderings.join(' · ') : `No ${v.language} rendering yet`}
                </Text>
              </View>
              {tied ? <View style={styles.tied}><Ico name="link" size={14} color={TINT.greenText} /><Badge label="Tied" tone="green" /></View> : null}
              <Ico name="right" size={20} color={C.muted} />
            </Pressable>
            {!tied && props.canTie ? (
              <SmallBtn label={tying === t.termId ? 'Tying…' : 'Tie to your draft'} icon="link"
                disabled={!props.draftTakeId || props.disabled || !!tying} onPress={() => void tie(t.termId)} />
            ) : null}
          </View>
        );
      })}
      <ShowMore remaining={props.terms.length - shown} step={TERM_STEP} onMore={() => setShown((n) => n + TERM_STEP)} />
      {props.canTie && !props.draftTakeId && props.terms.some((t) => !props.tied.has(t.termId))
        ? <Text style={[txt.xs, styles.pad]}>Record a take first; then you can tie terms to your draft.</Text> : null}
      <LinkBtn label="All key terms →" onPress={() => ctx.go('key_terms', scope)} style={styles.pad} />
    </>
  );
}

function StudyTab(props: { ctx: Ctx; v: PassageView; study: StudyProgress }) {
  const { ctx, v, study } = props;
  const scope = { unitId: v.unitId, languageId: v.languageId };
  return (
    <>
      <View style={[styles.pad, { gap: space.sm }]}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.sm }}>
          <Text style={[txt.sm, { fontWeight: '700', flex: 1 }]} numberOfLines={2}>{study.guide.pattern} study · {study.guide.passage}</Text>
          <Text style={txt.xs}>{studySummary(study)}</Text>
        </View>
        <ProgressBar value={study.steps.length ? Math.round((study.doneCount / study.steps.length) * 100) : 0} color={study.next ? C.primary : C.green} />
      </View>
      <View style={styles.list}>
        {study.steps.map((s, i) => (
          <Row key={s.step.id} leading={<StepMark status={s} />} label={s.step.title} sub={stepLine(ctx, s)}
            last={i === study.steps.length - 1} onPress={() => ctx.go('study_step', { ...scope, stepId: s.step.id })} />
        ))}
      </View>
      <LinkBtn label="Open the study →" onPress={() => ctx.go('study_guide', scope)} style={styles.pad} />
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
      case 'passage': return 'Whole passage';
      case 'version': { const at = versionN.get(n.anchor.takeId); return at ? versionTitle(at) : 'A draft'; }
      case 'verse': return `Verse ${n.anchor.verse}`;
      case 'term': return keyTermView(v.state, n.anchor.termId)?.term ?? 'Key term';
      case 'study': return 'Study';
    }
  };
  const newest = [...props.notes].reverse();
  return (
    <>
      <Pressable onPress={() => setAdding(true)} disabled={props.disabled} accessibilityRole="button" accessibilityLabel="Add a note"
        style={({ pressed }) => [styles.addNote, props.disabled && { opacity: 0.5 }, pressed && { opacity: 0.7 }]}>
        <Ico name="plus" size={18} color={TINT.amberText} />
        <Text style={[txt.sm, { fontWeight: '700', color: TINT.amberText }]}>Add a note</Text>
      </Pressable>
      {props.notes.length === 0
        ? <Text style={[txt.smMuted, styles.pad]}>Notes you leave here follow the passage — reviewers and the next translator will see them.</Text> : null}
      {newest.slice(0, shown).map((n) => {
        const older = n.onTakeId && n.onTakeId !== latestId ? versionN.get(n.onTakeId) : undefined;
        return (
          <Authored key={n.id} ctx={ctx} by={n.by}>
            <NoteCard anchor={anchor(n)} {...(n.text ? { text: n.text } : {})} by={ctx.name(n.by)} when={when(n.hlc)}
              {...(older ? { olderVersion: versionTitle(older) } : {})}
              {...(n.blobHash ? { audio: <AudioClip language={ctx.language} hashes={[n.blobHash]} label="Play voice note" /> } : {})}
              action={<ReportFlag ctx={ctx} target={recordTarget(ctx, 'note', n.id, n.by, n.unitId)} size={36} />} />
          </Authored>
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
  async function save() {
    const state = ctx.language.state;
    if (!state || busy) return;
    setBusy(true);
    try {
      const specs = commands(state, indexesFor(state)).addNote({
        commandId: Crypto.randomUUID(), unitId: v.unitId, anchor: { kind: 'passage' },
        ...(text.trim() ? { text: text.trim() } : {}), ...(hash ? { blobHash: hash } : {})
      });
      await ctx.act(specs, 'Note added.');
      props.onClose();
    } catch { /* ctx.act said what went wrong */ }
    finally { setBusy(false); }
  }
  return (
    <Sheet visible title="Add a note" sub="Anchored to the whole passage. It follows the passage into reviews and later versions." onClose={props.onClose}
      footer={<PrimaryBtn label="Save note" busy={busy} disabled={!text.trim() && !hash} onPress={() => void save()} />}>
      <VoiceNote ctx={ctx} label="Say it" hash={hash} onChange={setHash} />
      <Field value={text} onChangeText={setText} placeholder="Or type it" multiline />
    </Sheet>
  );
}

const HISTORY_STEP = 5;

function HistoryTab(props: { ctx: Ctx; v: PassageView }) {
  const { ctx, v } = props;
  const [shown, setShown] = useState(HISTORY_STEP);
  const versions = [...v.p.versions].reverse();
  if (versions.length === 0) return <Text style={[txt.smMuted, styles.pad]}>This will be the first version.</Text>;
  return (
    <>
      {versions.slice(0, shown).map((x) => (
        <View key={x.takeId} style={styles.history}>
          <Text style={[txt.sm, { fontWeight: '700' }]}>{versionTitle(x.n)} <Text style={[txt.sm, { fontWeight: '400', color: C.muted }]}>· {ctx.name(x.by)} · {when(x.hlc)}</Text></Text>
          <Text style={[txt.sm, { marginTop: 2 }]}>{x.changeNote ?? (x.n === 1 ? 'First recording.' : 'Said in a voice note.')}</Text>
          {x.changeBlobHash ? <View style={{ marginTop: space.xs }}><AudioClip language={ctx.language} hashes={[x.changeBlobHash]} label={`Play what changed in ${versionTitle(x.n)}`} /></View> : null}
        </View>
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
