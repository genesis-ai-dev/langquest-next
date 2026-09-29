// Pieces of the reviewing screens (UX demo src/screens/review.tsx and
// screens/shared.tsx): answer inputs for Yes/No, 1–5 and text questions
// (REV-2), the question list with "Can't answer this?", earlier reviews that
// play in place, the content a checking kind compares against (REV-5), the
// background a reviewer opens on request (REV-1, ADR-013), and the
// "Also covered in this session" picker for a review that already happened
// (REV-6, ADR-028). Built from kit.tsx only.
import type { KindDef, KeyTermView, PassageNote, RequestView, ReviewView, SourcedQuestion, Version } from '@langquest-next/core';
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AudioClip } from '../audioClip';
import type { Ctx } from '../ctx';
import {
  Badge, Banner, Card, Chip, Disclosure, Field, Ico, LinkBtn, NoteCard, Row, SearchField, SectionLabel, ShowMore, txt
} from '../kit';
import { dueText, feedbackSource, outcomeText, plural, versionTitle, when } from '../passageView';
import type { StudyProgress, StudyStepStatus } from '../study/progress';
import { studySummary } from '../study/progress';
import { C, radius, space, target, TINT } from '../theme';
import { questionSource, searchPassages, nearbyPassages, type Answers, type PassageChoice, type Skips } from './capture';

// ---- answers --------------------------------------------------------------------------

/** One 56pt choice in a row of equal choices (Yes/No, 1–5). */
function Choice(props: { label: string; on: boolean; onPress: () => void; big?: boolean }) {
  return (
    <Pressable onPress={props.onPress} accessibilityRole="button" accessibilityState={{ selected: props.on }} accessibilityLabel={props.label}
      style={({ pressed }) => [styles.choice, props.on ? { backgroundColor: C.primary } : null, pressed && { opacity: 0.7 }]}>
      <Text style={[props.big ? styles.choiceBig : styles.choiceLabel, { color: props.on ? C.white : C.dark }]}>{props.label}</Text>
    </Pressable>
  );
}

export function AnswerInput(props: { type: SourcedQuestion['q']['type']; value?: string; onChange: (v: string) => void }) {
  if (props.type === 'rating') {
    return (
      <View style={styles.choices}>
        {['1', '2', '3', '4', '5'].map((n) => <Choice key={n} label={n} big on={props.value === n} onPress={() => props.onChange(n)} />)}
      </View>
    );
  }
  if (props.type === 'yesno') {
    return (
      <View style={styles.choices}>
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
          <Card key={id} style={waiting ? { borderColor: `${C.primary}80`, borderWidth: 1.5 } : null}>
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
      <Banner icon={r.guest ? 'link' : 'assign'} title={`${who} asked${r.dueDate ? ` · ${dueText(r.dueDate)}` : ''}`} {...(r.note ? { body: r.note } : {})} />
      {r.noteBlobHash ? <AudioClip project={props.ctx.project} hashes={[r.noteBlobHash]} label="Play their directions" /> : null}
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
  const recordings = r.artifactHashes ?? [];
  return (
    <Card style={{ borderColor: `${C.primary}66`, borderWidth: 1.5 }}>
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
      {recordings.length ? <AudioClip project={props.ctx.project} hashes={recordings} label={`Play the ${k.produces?.what ?? 'recording'}`} /> : <Text style={txt.xs}>No recording attached.</Text>}
      {r.comment || r.commentBlobHash ? (
        <View style={styles.inset}>
          <Text style={txt.xsStrong}>{k.produces?.what === 'back translation' ? "Back translator's note" : 'Their note'}</Text>
          {r.comment ? <Text style={txt.sm}>{r.comment}</Text> : null}
          {r.commentBlobHash ? <AudioClip project={props.ctx.project} hashes={[r.commentBlobHash]} label="Play their note" /> : null}
        </View>
      ) : null}
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
  const recordings = [...(r.artifactHashes ?? []), ...(r.commentBlobHash ? [r.commentBlobHash] : [])];
  const sub = `${feedbackSource(r, props.ctx.name)} · ${versionTitle(r.versionN)} · ${when(r.hlc)}${recordings.length ? ` · ${plural(recordings.length, 'recording')}` : ''}`;
  return (
    <View style={!props.last ? styles.divider : null}>
      <Row
        leading={<View style={[styles.mark, { backgroundColor: good ? TINT.green : TINT.amber }]}><Ico name={good ? 'check' : 'chat'} size={18} color={good ? TINT.greenText : TINT.amberText} /></View>}
        label={`${props.kind?.name ?? 'Review'} · ${outcomeText(props.kind, r.outcome)}`} sub={sub} last
        right={<Ico name={open ? 'up' : 'down'} size={20} color={C.muted} />} onPress={() => setOpen((o) => !o)} />
      {open ? (
        <View style={{ paddingHorizontal: space.lg, paddingBottom: space.lg, gap: space.sm }}>
          {r.comment ? <Text style={txt.sm}>{r.comment}</Text> : null}
          {recordings.length ? <AudioClip project={props.ctx.project} hashes={recordings} label="Play what they recorded" /> : null}
          {r.response ? (
            <Text style={txt.smMuted}>
              <Text style={{ fontWeight: '700', color: C.dark }}>{r.response.decision === 'revised' ? 'Revised' : 'Kept'}:</Text> {r.response.note ?? (r.response.decision === 'revised' ? 'A new version answered it.' : 'Kept as it is.')}
            </Text>
          ) : null}
          {!r.comment && !recordings.length && !r.response ? <Text style={txt.xs}>Nothing else was said.</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

const EARLIER_STEP = 5;

export function EarlierReviews(props: { ctx: Ctx; detailsKey: string; reviews: ReviewView[]; kind: (id: string) => KindDef }) {
  const [shown, setShown] = useState(EARLIER_STEP);
  const d = props.ctx.details(props.detailsKey);
  if (props.reviews.length === 0) return null;
  const names = [...new Set(props.reviews.map((r) => props.kind(r.kindId).name))];
  const list = props.reviews.slice(0, shown);
  return (
    <Disclosure icon="chat" title="Earlier reviews" summary={`${props.reviews.length} · ${names.join(', ')}`} open={d.open} onToggle={d.onToggle}>
      {list.map((r, i) => <EarlierReview key={r.id} ctx={props.ctx} review={r} kind={props.kind(r.kindId)} last={i === list.length - 1} />)}
      {props.reviews.length > shown ? (
        <View style={{ padding: space.md }}>
          <ShowMore remaining={props.reviews.length - shown} step={EARLIER_STEP} onMore={() => setShown((n) => n + EARLIER_STEP)} />
        </View>
      ) : null}
    </Disclosure>
  );
}

/** Notes and key terms the translator left (REV-1). */
export function FromTranslator(props: {
  ctx: Ctx;
  detailsKey: string;
  terms: KeyTermView[];
  notes: PassageNote[];
  anchor: (n: PassageNote) => string;
  olderVersion: (n: PassageNote) => string | undefined;
  onOpenTerm: (termId: string) => void;
}) {
  const [shown, setShown] = useState(EARLIER_STEP);
  const d = props.ctx.details(props.detailsKey);
  if (props.terms.length === 0 && props.notes.length === 0) return null;
  const notes = props.notes.slice(0, shown);
  return (
    <Disclosure icon="book" title="From the translator" summary={`${plural(props.terms.length, 'term')} · ${plural(props.notes.length, 'note')}`} open={d.open} onToggle={d.onToggle}>
      <View style={{ padding: space.lg, gap: space.sm }}>
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
            <NoteCard key={n.id} anchor={props.anchor(n)} {...(n.text ? { text: n.text } : {})} by={props.ctx.name(n.by)} when={when(n.hlc)}
              {...(older ? { olderVersion: older } : {})} icon={n.anchor.kind === 'term' ? 'book' : 'note'}
              {...(n.blobHash ? { audio: <AudioClip project={props.ctx.project} hashes={[n.blobHash]} label="Play note" /> } : {})} />
          );
        })}
        {props.notes.length > shown ? <ShowMore remaining={props.notes.length - shown} step={EARLIER_STEP} onMore={() => setShown((x) => x + EARLIER_STEP)} /> : null}
      </View>
    </Disclosure>
  );
}

function studyStepLine(s: StudyStepStatus, name: Ctx['name']): string {
  const notes = s.notes.length ? ` · ${plural(s.notes.length, 'note')}` : '';
  if (s.done) return `Done by ${name(s.done.by, true)} · ${when(s.done.hlc)}${notes}`;
  return s.notes.length ? plural(s.notes.length, 'note') : 'Not started';
}

/** The team's study of the passage (FIA): evidence it was studied before drafting (ADR-018). */
export function TeamStudy(props: { ctx: Ctx; detailsKey: string; study: StudyProgress; onOpenStep: (stepId: string) => void; onOpenStudy: () => void }) {
  const d = props.ctx.details(props.detailsKey);
  const s = props.study;
  const started = s.doneCount > 0 || s.noteCount > 0;
  return (
    <Disclosure icon="sparkle" title="The team's study" summary={`${s.guide.pattern} · ${started ? studySummary(s) : 'not started'}`} open={d.open} onToggle={d.onToggle}>
      <Text style={[txt.smMuted, { paddingHorizontal: space.lg, paddingTop: space.md }]}>
        What the team worked through before drafting, and what they said. Tap a step to see their answers and notes in place.
      </Text>
      {s.steps.map((st) => (
        <Row key={st.step.id} leading={<StudyMark done={!!st.done} />} label={st.step.title} sub={studyStepLine(st, props.ctx.name)} onPress={() => props.onOpenStep(st.step.id)} />
      ))}
      <Row icon="sparkle" label="Open the study" onPress={props.onOpenStudy} last />
    </Disclosure>
  );
}

function StudyMark(props: { done: boolean }) {
  return (
    <View style={[styles.mark, { backgroundColor: props.done ? C.green : C.card, borderWidth: props.done ? 0 : 1.5, borderColor: C.border }]}>
      {props.done ? <Ico name="check" size={16} color={C.white} strokeWidth={3} /> : null}
    </View>
  );
}

// ---- a session that already happened (REV-6) ----------------------------------------------------------

/** How many listened: − and + around the count (a group kind). */
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
          {pickedChoices.map((p) => (
            <Pressable key={p.unitId} onPress={() => toggle(p.unitId)} accessibilityRole="button" accessibilityLabel={`Remove ${p.title}`}
              style={({ pressed }) => [styles.pickedPill, pressed && { opacity: 0.7 }]}>
              <Text style={[txt.sm, { color: C.white, fontWeight: '700' }]}>{p.title}</Text>
              <View style={styles.pillX}><Ico name="close" size={18} color={C.white} /></View>
            </Pressable>
          ))}
        </View>
      ) : null}
      <SearchField value={query} onChangeText={setQuery} placeholder="Find another — “Mark 2”" />
      {list.length ? (
        <View style={styles.pickList}>
          {!searching ? <Text style={[txt.label, { paddingHorizontal: space.lg, paddingTop: space.md }]}>Nearby in {here.bookLabel}</Text> : null}
          {list.map((p, i) => {
            const on = picked.includes(p.unitId);
            return (
              <Row key={p.unitId} last={i === list.length - 1} label={p.title} onPress={() => toggle(p.unitId)}
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
  choiceLabel: { fontSize: 17, fontWeight: '600' },
  choiceBig: { fontSize: 19, fontWeight: '700' },
  inset: { backgroundColor: C.bg, borderRadius: radius.md, padding: space.md, gap: space.xs },
  withheld: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start', padding: space.lg, borderRadius: radius.lg, backgroundColor: TINT.gray },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: C.border },
  mark: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  counter: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.sm, borderRadius: radius.lg, borderWidth: 1.5, borderColor: C.border, backgroundColor: C.card },
  counterBtn: { width: target.primary, height: target.primary, borderRadius: radius.md, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' },
  counterSign: { fontSize: 26, fontWeight: '600', color: C.dark },
  pickedPill: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: target.min, paddingLeft: space.lg, paddingRight: space.xs, borderRadius: radius.full, backgroundColor: C.primary },
  pillX: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  pickList: { backgroundColor: C.card, borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth, borderColor: C.border, overflow: 'hidden' },
  box: { width: 28, height: 28, borderRadius: 8, borderWidth: 2, borderColor: C.border, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center' }
});
