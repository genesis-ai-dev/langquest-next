// Pieces of the reviewing screens (UX demo src/screens/review.tsx and
// screens/shared.tsx): answer inputs for Yes/No, 1–5 and text questions
// (REV-2), the question list with "Can't answer this?", earlier reviews that
// play in place, the content a checking kind compares against (REV-5), the
// background a reviewer opens on request as one collapsed card (REV-1,
// ADR-013, ADR-029), the strip of review stages (REV-0), and the
// "Also covered in this session" picker for a review that already happened
// (REV-6, ADR-028). Built from kit.tsx only.
import type { KindDef, KeyTermView, PassageNote, RequestView, ReviewView, SourcedQuestion, Version } from '@langquest-next/core';
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AudioClip } from '../audioClip';
import type { Ctx } from '../ctx';
import {
  Badge, Banner, Card, Chip, Disclosure, Field, Ico, LinkBtn, NoteCard, Row, SearchField, SectionLabel, ShowMore, txt, useLayout
} from '../kit';
import { dueText, feedbackSource, outcomeText, plural, versionTitle, when } from '../passageView';
import { Authored, authoredText, recordTarget, ReportFlag } from '../reportSheet';
import type { StudyProgress } from '../study/progress';
import { studySummary } from '../study/progress';
import { StepMark, stepLine } from '../study/ui';
import { C, measure, radius, space, target, TINT, type as T, withAlpha } from '../theme';
import { questionSource, searchPassages, nearbyPassages, summaryLine, type Answers, type PassageChoice, type Skips, type Stage, type StageId } from './capture';

// ---- answers --------------------------------------------------------------------------

/**
 * One 56pt choice in a row of equal choices (Yes/No, 1–5). No kit primitive
 * is an equal-width 56pt segment (Chip is a 48pt pill sized to its label),
 * so this stays; a screen reader hears it as one radio of the set.
 */
function Choice(props: { label: string; on: boolean; onPress: () => void; big?: boolean }) {
  return (
    <Pressable onPress={props.onPress} accessibilityRole="radio" accessibilityState={{ checked: props.on }} accessibilityLabel={props.label}
      style={({ pressed }) => [styles.choice, props.on ? { backgroundColor: C.primary } : null, pressed && { opacity: 0.7 }]}>
      <Text style={[props.big ? styles.choiceBig : styles.choiceLabel, { color: props.on ? C.white : C.dark }]}>{props.label}</Text>
    </Pressable>
  );
}

export function AnswerInput(props: { type: SourcedQuestion['q']['type']; value?: string; onChange: (v: string) => void }) {
  if (props.type === 'rating') {
    return (
      <View style={styles.choices} accessibilityRole="radiogroup">
        {['1', '2', '3', '4', '5'].map((n) => <Choice key={n} label={n} big on={props.value === n} onPress={() => props.onChange(n)} />)}
      </View>
    );
  }
  if (props.type === 'yesno') {
    return (
      <View style={styles.choices} accessibilityRole="radiogroup">
        {['Yes', 'No'].map((v) => <Choice key={v} label={v} on={props.value === v} onPress={() => props.onChange(v)} />)}
      </View>
    );
  }
  return <Field value={props.value ?? ''} onChangeText={props.onChange} placeholder="Your answer" multiline />;
}

/** The combined question list, labelled by source; required ones need an answer or a reason (REV-2). */
export function QuestionList(props: {
  questions: SourcedQuestion[];
  answers: Answers;
  skipped: Skips;
  asker?: string;
  onAnswer: (id: string, v: string) => void;
  onSkip: (id: string) => void;
  onUnskip: (id: string) => void;
}) {
  const { questions, answers, skipped } = props;
  if (questions.length === 0) return null;
  return (
    <View style={{ gap: space.sm }}>
      <SectionLabel label="Questions" action={<Text style={txt.xs}>{questions.filter((q) => q.required).length} required</Text>} />
      {questions.map((sq) => {
        const id = sq.q.id;
        const skip = skipped[id];
        const unanswered = !(answers[id] ?? '').trim();
        const waiting = sq.required && unanswered && skip === undefined;
        return (
          <Card key={id} style={waiting ? { borderColor: withAlpha(C.primary, 0.5), borderWidth: 1.5 } : null}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <Text style={txt.label}>{questionSource(sq, props.asker)}</Text>
              {sq.required ? <Badge label="Required" tone="brand" /> : null}
            </View>
            <Text style={[txt.body, { fontWeight: '600' }]}>{sq.q.text}</Text>
            {skip !== undefined ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                <Text style={[txt.smMuted, { flex: 1 }]}><Text style={{ fontWeight: '700' }}>Left unanswered:</Text> {skip}</Text>
                <LinkBtn label="Answer" onPress={() => props.onUnskip(id)} />
              </View>
            ) : (
              <>
                <AnswerInput type={sq.q.type} value={answers[id]} onChange={(v) => props.onAnswer(id, v)} />
                {sq.required && unanswered ? <LinkBtn label="Can't answer this?" color={C.muted} onPress={() => props.onSkip(id)} /> : null}
              </>
            )}
          </Card>
        );
      })}
    </View>
  );
}

// ---- what is being heard ------------------------------------------------------------------

/** Listen to the version, with what changed (REV-1). */
export function ListenCard(props: { ctx: Ctx; version: Version }) {
  const v = props.version;
  const change = v.changeNote ?? (v.n === 1 ? 'First recording.' : undefined);
  return (
    <View style={{ gap: space.sm }}>
      <SectionLabel label="Listen" />
      <Card>
        <Text style={txt.h3}>{versionTitle(v.n)}</Text>
        <AudioClip project={props.ctx.project} hashes={v.cardHashes} label={`Play ${versionTitle(v.n)}`} />
        {change ? <Text style={txt.sm}><Text style={{ fontWeight: '700' }}>What changed:</Text> {change}</Text> : null}
        {v.changeBlobHash ? <AudioClip project={props.ctx.project} hashes={[v.changeBlobHash]} label="Play what changed" /> : null}
        <Text style={txt.xs}>Published by {props.ctx.name(v.by)} · {when(v.hlc)}</Text>
      </Card>
    </View>
  );
}

/** Who asked, by when, and their note. */
export function RequestBanner(props: { ctx: Ctx; request: RequestView }) {
  const r = props.request;
  const who = r.by ? props.ctx.name(r.by) : 'Someone';
  return (
    <View style={{ gap: space.sm }}>
      <Banner icon={r.guest ? 'link' : 'assign'} title={`${who} asked${r.dueDate ? ` · ${dueText(r.dueDate)}` : ''}`} {...(r.note ? { body: authoredText(props.ctx, r.by, r.note) } : {})} />
      {r.noteBlobHash ? (
        <Authored ctx={props.ctx} by={r.by}>
          <AudioClip project={props.ctx.project} hashes={[r.noteBlobHash]} label="Play their directions" />
        </Authored>
      ) : null}
      {r.by && (r.note || r.noteBlobHash) ? (
        <View style={{ alignSelf: 'flex-end' }}>
          <ReportFlag ctx={props.ctx} target={recordTarget(props.ctx, 'request', r.id, r.by, r.unitId, r.laneId)} size={36} />
        </View>
      ) : null}
    </View>
  );
}

/**
 * Content made for this check (a back translation for the Consultant
 * Check), at the top as the material to compare with the source, warned
 * when it was made from an older version (REV-5, ADR-015).
 */
export function CompareCard(props: { ctx: Ctx; review: ReviewView; kind: KindDef; version: Version }) {
  const r = props.review;
  const k = props.kind;
  const recordings = (r.artifacts ?? []).map((c) => c.hash);
  return (
    <Card style={{ borderColor: withAlpha(C.primary, 0.4), borderWidth: 1.5 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <Ico name="swap" size={18} color={C.primary} />
        <Text style={[txt.label, { color: C.primary }]}>{k.name} to compare</Text>
      </View>
      <Text style={txt.smMuted}>
        Made for this check: {k.produces?.into ?? 'a recording'} in the {k.produces?.what === 'back translation' ? "back translator's" : "maker's"} own words. Compare its meaning with the source.
      </Text>
      <Text style={[txt.sm, { fontWeight: '700' }]}>{feedbackSource(r, props.ctx.name)} · from {versionTitle(r.versionN)} · {when(r.hlc)}</Text>
      {r.versionN !== props.version.n ? (
        <Banner icon="history" tone="amber" title={`Made from ${versionTitle(r.versionN)} — you're reviewing ${versionTitle(props.version.n)}. Check what changed.`} />
      ) : null}
      <Authored ctx={props.ctx} by={r.by}>
        {recordings.length ? <AudioClip project={props.ctx.project} hashes={recordings} label={`Play the ${k.produces?.what ?? 'recording'}`} /> : <Text style={txt.xs}>No recording attached.</Text>}
        {r.comment || r.commentBlobHash ? (
          <View style={styles.inset}>
            <Text style={txt.xsStrong}>{k.produces?.what === 'back translation' ? "Back translator's note" : 'Their note'}</Text>
            {r.comment ? <Text style={txt.sm}>{r.comment}</Text> : null}
            {r.commentBlobHash ? <AudioClip project={props.ctx.project} hashes={[r.commentBlobHash]} label="Play their note" /> : null}
          </View>
        ) : null}
      </Authored>
    </Card>
  );
}

/** Notes and earlier reviews are hidden for this kind; say so (REV-4). */
export function WithheldNotice(props: { kind: KindDef }) {
  return (
    <View style={styles.withheld}>
      <Ico name="lock" size={18} color={TINT.grayText} />
      <Text style={[txt.sm, { flex: 1, color: TINT.grayText }]}>
        Notes and earlier reviews are hidden for {props.kind.name}, so what you hear isn't shaped by what others said. They're still on the record.
      </Text>
    </View>
  );
}

// ---- background, on request (ADR-013) ------------------------------------------------------------

/** What an earlier reviewer said and recorded; recordings play in place, not as a summary. */
function EarlierReview(props: { ctx: Ctx; review: ReviewView; kind: KindDef | undefined; last: boolean }) {
  const [open, setOpen] = useState(false);
  const r = props.review;
  const good = r.outcome !== 'needs_changes';
  const recordings = [...(r.artifacts ?? []).map((c) => c.hash), ...(r.commentBlobHash ? [r.commentBlobHash] : [])];
  const sub = `${feedbackSource(r, props.ctx.name)} · ${versionTitle(r.versionN)} · ${when(r.hlc)}${recordings.length ? ` · ${plural(recordings.length, 'recording')}` : ''}`;
  return (
    <View style={!props.last ? styles.divider : null}>
      <Row
        leading={<View style={[styles.mark, { backgroundColor: good ? TINT.green : TINT.amber }]}><Ico name={good ? 'check' : 'chat'} size={18} color={good ? TINT.greenText : TINT.amberText} /></View>}
        label={`${props.kind?.name ?? 'Review'} · ${outcomeText(props.kind, r.outcome)}`} sub={sub} last
        right={<Ico name={open ? 'up' : 'down'} size={20} color={C.muted} />} onPress={() => setOpen((o) => !o)} expanded={open} />
      {open ? (
        <View style={{ paddingHorizontal: space.lg, paddingBottom: space.lg, gap: space.sm }}>
          <Authored ctx={props.ctx} by={r.by}>
            {r.comment ? <Text style={txt.sm}>{r.comment}</Text> : null}
            {recordings.length ? <AudioClip project={props.ctx.project} hashes={recordings} label="Play what they recorded" /> : null}
          </Authored>
          {r.response ? (
            <Text style={txt.smMuted}>
              <Text style={{ fontWeight: '700', color: C.dark }}>{r.response.decision === 'revised' ? 'Revised' : 'Kept'}:</Text> {r.response.note ? authoredText(props.ctx, r.response.by, r.response.note) : (r.response.decision === 'revised' ? 'A new version answered it.' : 'Kept as it is.')}
            </Text>
          ) : null}
          {!r.comment && !recordings.length && !r.response ? <Text style={txt.xs}>Nothing else was said.</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

const EARLIER_STEP = 5;

function EarlierReviewsPart(props: { ctx: Ctx; reviews: ReviewView[]; kind: (id: string) => KindDef }) {
  const [shown, setShown] = useState(EARLIER_STEP);
  const names = [...new Set(props.reviews.map((r) => props.kind(r.kindId).name))];
  const list = props.reviews.slice(0, shown);
  return (
    <View>
      <PartLabel label={`Earlier reviews · ${names.join(', ')}`} />
      {list.map((r, i) => <EarlierReview key={r.id} ctx={props.ctx} review={r} kind={props.kind(r.kindId)} last={i === list.length - 1} />)}
      {props.reviews.length > shown ? (
        <View style={{ padding: space.md }}>
          <ShowMore remaining={props.reviews.length - shown} step={EARLIER_STEP} onMore={() => setShown((n) => n + EARLIER_STEP)} />
        </View>
      ) : null}
    </View>
  );
}

/** Notes and key terms the translator left (REV-1). */
function FromTranslatorPart(props: {
  ctx: Ctx;
  terms: KeyTermView[];
  notes: PassageNote[];
  anchor: (n: PassageNote) => string;
  olderVersion: (n: PassageNote) => string | undefined;
  onOpenTerm: (termId: string) => void;
}) {
  const [shown, setShown] = useState(EARLIER_STEP);
  const notes = props.notes.slice(0, shown);
  return (
    <View style={{ paddingHorizontal: space.lg, paddingBottom: space.lg, gap: space.sm }}>
      <PartLabel label="From the translator" inset={false} />
      {props.terms.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {props.terms.map((t) => {
            const rendering = t.renderings.at(-1)?.rendering;
            return <Chip key={t.termId} icon="book" label={`${t.term}${rendering ? ` · ${rendering}` : ''}`} on={false} onPress={() => props.onOpenTerm(t.termId)} />;
          })}
        </View>
      ) : null}
      {notes.map((n) => {
        const older = props.olderVersion(n);
        return (
          <Authored key={n.id} ctx={props.ctx} by={n.by}>
            <NoteCard anchor={props.anchor(n)} {...(n.text ? { text: n.text } : {})} by={props.ctx.name(n.by)} when={when(n.hlc)}
              {...(older ? { olderVersion: older } : {})} icon={n.anchor.kind === 'term' ? 'book' : 'note'}
              {...(n.blobHash ? { audio: <AudioClip project={props.ctx.project} hashes={[n.blobHash]} label="Play note" /> } : {})}
              action={<ReportFlag ctx={props.ctx} target={recordTarget(props.ctx, 'note', n.id, n.by, n.unitId, n.laneId)} size={36} />} />
          </Authored>
        );
      })}
      {props.notes.length > shown ? <ShowMore remaining={props.notes.length - shown} step={EARLIER_STEP} onMore={() => setShown((x) => x + EARLIER_STEP)} /> : null}
    </View>
  );
}

/** The team's study of the passage (FIA): evidence it was studied before drafting (ADR-018). */
function TeamStudyPart(props: { ctx: Ctx; study: StudyProgress; onOpenStep: (stepId: string) => void; onOpenStudy: () => void }) {
  const s = props.study;
  const started = s.doneCount > 0 || s.noteCount > 0;
  return (
    <View>
      <PartLabel label={`The team's study · ${s.guide.pattern}`} />
      <Text style={[txt.smMuted, { paddingHorizontal: space.lg }]}>
        {started ? studySummary(s) : 'Not started'}. What the team worked through before drafting, and what they said. Tap a step to see their answers and notes in place.
      </Text>
      {s.steps.map((st) => (
        <Row key={st.step.id} leading={<StepMark status={st} />} label={st.step.title} sub={stepLine(props.ctx, st)} onPress={() => props.onOpenStep(st.step.id)} />
      ))}
      <Row icon="sparkle" label="Open the study" onPress={props.onOpenStudy} last />
    </View>
  );
}

/** A part's small heading inside Background. */
function PartLabel(props: { label: string; inset?: boolean }) {
  return <Text style={[txt.label, { paddingTop: space.lg, paddingBottom: space.sm }, props.inset !== false && { paddingHorizontal: space.lg }]}>{props.label}</Text>;
}

/**
 * Everything a reviewer may open for background, as one collapsed card
 * (REV-1, ADR-029): notes and key terms from the translator, the team's
 * study, earlier reviews. Nothing to show, nothing drawn. A kind that
 * withholds context shows WithheldNotice instead (REV-4).
 */
export function Background(props: {
  ctx: Ctx;
  detailsKey: string;
  terms: KeyTermView[];
  notes: PassageNote[];
  anchor: (n: PassageNote) => string;
  olderVersion: (n: PassageNote) => string | undefined;
  onOpenTerm: (termId: string) => void;
  study: StudyProgress | null;
  onOpenStep: (stepId: string) => void;
  onOpenStudy: () => void;
  reviews: ReviewView[];
  kind: (id: string) => KindDef;
  /** The passage's Bible text and audio (sources/SourceReader.tsx). */
  source?: ReactNode;
}) {
  const d = props.ctx.details(props.detailsKey);
  const fromTranslator = props.terms.length > 0 || props.notes.length > 0;
  if (!fromTranslator && !props.study && props.reviews.length === 0 && !props.source) return null;
  const summary = summaryLine([
    !!props.source && 'the source',
    fromTranslator && `${plural(props.terms.length, 'term')} · ${plural(props.notes.length, 'note')}`,
    props.study && "the team's study",
    props.reviews.length > 0 && plural(props.reviews.length, 'earlier review')
  ]);
  const parts: ReactNode[] = [];
  if (props.source) parts.push(<View key="source" style={{ padding: space.md }}>{props.source}</View>);
  if (fromTranslator) {
    parts.push(<FromTranslatorPart key="translator" ctx={props.ctx} terms={props.terms} notes={props.notes}
      anchor={props.anchor} olderVersion={props.olderVersion} onOpenTerm={props.onOpenTerm} />);
  }
  if (props.study) parts.push(<TeamStudyPart key="study" ctx={props.ctx} study={props.study} onOpenStep={props.onOpenStep} onOpenStudy={props.onOpenStudy} />);
  if (props.reviews.length > 0) parts.push(<EarlierReviewsPart key="earlier" ctx={props.ctx} reviews={props.reviews} kind={props.kind} />);
  return (
    <Disclosure icon="book" title="Background" summary={summary} open={d.open} onToggle={d.onToggle}>
      {parts.map((part, i) => <View key={i} style={i > 0 ? styles.partTop : null}>{part}</View>)}
    </Disclosure>
  );
}

// ---- stages (REV-0, ADR-029) ------------------------------------------------------------------

/**
 * Where you are in the review, under the header: the current stage is
 * highlighted, earlier ones go back with a tap, later ones wait for the
 * footer's main button. Kit has no stage strip yet, so it is drawn here
 * from theme tokens; every stage is a 48pt target.
 */
export function StageStrip(props: { stages: Stage[]; at: number; onGo: (id: StageId) => void }) {
  const wide = useLayout().kind !== 'phone';
  return (
    <View style={styles.strip}>
      <View style={[styles.stripRow, wide && { maxWidth: measure.column, alignSelf: 'center', width: '100%' }]} accessibilityLabel="Review stages">
        {props.stages.map((st, i) => {
          const current = i === props.at;
          const done = i < props.at;
          return (
            <Pressable key={st.id} onPress={() => props.onGo(st.id)} disabled={!done} accessibilityRole="button"
              accessibilityLabel={done ? `Back to ${st.label}` : `${st.label}, stage ${i + 1} of ${props.stages.length}`}
              accessibilityState={{ selected: current, disabled: !done }}
              style={({ pressed }) => [styles.stage, current && { backgroundColor: C.light }, pressed && { opacity: 0.7 }]}>
              <View style={[styles.stageNum, current ? { backgroundColor: C.primary } : done ? { backgroundColor: C.dark } : styles.stageNumLater]}>
                {done ? <Ico name="check" size={14} color={C.white} strokeWidth={3} /> : (
                  <Text style={[styles.stageNumText, { color: current ? C.white : C.muted }]}>{i + 1}</Text>
                )}
              </View>
              <Text style={[txt.sm, { fontWeight: '600', flexShrink: 1, color: current ? C.primary : done ? C.dark : C.muted }]} numberOfLines={1}>{st.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

// ---- a session that already happened (REV-6) ----------------------------------------------------------

/**
 * How many listened: − and + around the count (a group kind). Kit has no
 * minus icon and SmallBtn takes no spoken label, so these are 56pt
 * Pressables that say "One fewer person" / "One more person".
 */
export function PeopleCounter(props: { value: number; onChange: (n: number) => void }) {
  const n = props.value;
  return (
    <View style={styles.counter}>
      <Pressable onPress={() => props.onChange(Math.max(0, n - 1))} disabled={n === 0} accessibilityRole="button" accessibilityLabel="One fewer person"
        style={({ pressed }) => [styles.counterBtn, n === 0 && { opacity: 0.4 }, pressed && { opacity: 0.6 }]}>
        <Text style={styles.counterSign}>−</Text>
      </Pressable>
      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm }}>
        <Ico name="people" size={22} color={C.muted} />
        <Text style={[txt.body, { fontWeight: '600', color: n ? C.dark : C.muted }]}>{n ? `${n} ${n === 1 ? 'person' : 'people'}` : 'How many listened?'}</Text>
      </View>
      <Pressable onPress={() => props.onChange(n + 1)} accessibilityRole="button" accessibilityLabel="One more person"
        style={({ pressed }) => [styles.counterBtn, pressed && { opacity: 0.6 }]}>
        <Text style={styles.counterSign}>+</Text>
      </Pressable>
    </View>
  );
}

/**
 * One session often covers a run of neighbouring chapters. Suggest the
 * nearest recorded passages in the same book, and search for anything else;
 * never a wall of every recorded passage in the language.
 */
export function AlsoCoveredPicker(props: { here: PassageChoice; all: PassageChoice[]; picked: string[]; onChange: (ids: string[]) => void }) {
  const [query, setQuery] = useState('');
  const { here, all, picked } = props;
  const toggle = (id: string) => props.onChange(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]);
  const searching = query.trim() !== '';
  const hits = searching ? searchPassages(all, query, here.unitId) : [];
  const near = nearbyPassages(all, here).filter((p) => !picked.includes(p.unitId));
  const list = searching ? hits : near;
  const pickedChoices = picked.map((id) => all.find((p) => p.unitId === id)).filter((p): p is PassageChoice => !!p);
  if (all.every((p) => p.unitId === here.unitId)) return null;
  return (
    <View style={{ gap: space.sm }}>
      <SectionLabel label="Also covered in this session" />
      <Text style={[txt.smMuted, { paddingHorizontal: space.xs }]}>The same review is added to each passage you pick.</Text>
      {pickedChoices.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {pickedChoices.map((p) => <Chip key={p.unitId} label={p.title} icon="close" on accessibilityLabel={`Remove ${p.title}`} onPress={() => toggle(p.unitId)} />)}
        </View>
      ) : null}
      <SearchField value={query} onChangeText={setQuery} placeholder="Find another — “Mark 2”" />
      {list.length ? (
        <View style={styles.pickList}>
          {!searching ? <Text style={[txt.label, { paddingHorizontal: space.lg, paddingTop: space.md }]}>Nearby in {here.bookLabel}</Text> : null}
          {list.map((p, i) => {
            const on = picked.includes(p.unitId);
            return (
              <Row key={p.unitId} last={i === list.length - 1} label={p.title} onPress={() => toggle(p.unitId)} role="checkbox" checked={on}
                leading={<View style={[styles.box, on ? { backgroundColor: C.primary, borderColor: C.primary } : null]}>{on ? <Ico name="check" size={18} color={C.white} strokeWidth={3} /> : null}</View>}
                right={<View />} />
            );
          })}
        </View>
      ) : null}
      {searching && hits.length === 0 ? <Text style={[txt.smMuted, { paddingHorizontal: space.xs }]}>No recorded passage matches “{query.trim()}”.</Text> : null}
    </View>
  );
}

/** A labelled block in the body: a small heading and what goes under it. */
export function Block(props: { label: string; hint?: string; children: ReactNode }) {
  return (
    <View style={{ gap: space.sm }}>
      <SectionLabel label={props.label} />
      {props.hint ? <Text style={[txt.smMuted, { paddingHorizontal: space.xs }]}>{props.hint}</Text> : null}
      {props.children}
    </View>
  );
}

const styles = StyleSheet.create({
  choices: { flexDirection: 'row', gap: space.sm },
  choice: { flex: 1, minHeight: target.primary, borderRadius: radius.md, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' },
  choiceLabel: { fontSize: T.base, fontWeight: '600' },
  choiceBig: { fontSize: T.lg, fontWeight: '700' },
  inset: { backgroundColor: C.bg, borderRadius: radius.md, padding: space.md, gap: space.xs },
  withheld: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start', padding: space.lg, borderRadius: radius.lg, backgroundColor: TINT.gray },
  partTop: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: C.border },
  strip: { backgroundColor: C.card, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: C.border, paddingHorizontal: space.md, paddingVertical: space.xs },
  stripRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  stage: { flex: 1, minWidth: 0, minHeight: target.min, borderRadius: radius.md, paddingHorizontal: space.xs, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xs + 2 },
  stageNum: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  stageNumLater: { borderWidth: 1.5, borderColor: C.border },
  stageNumText: { fontSize: T.xs, fontWeight: '700' },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: C.border },
  mark: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  counter: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.sm, borderRadius: radius.lg, borderWidth: 1.5, borderColor: C.border, backgroundColor: C.card },
  counterBtn: { width: target.primary, height: target.primary, borderRadius: radius.md, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' },
  counterSign: { fontSize: T.xxl, fontWeight: '600', color: C.dark },
  pickList: { backgroundColor: C.card, borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth, borderColor: C.border, overflow: 'hidden' },
  box: { width: 28, height: 28, borderRadius: 8, borderWidth: 2, borderColor: C.border, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center' }
});
