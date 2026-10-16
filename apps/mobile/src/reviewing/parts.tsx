// Pieces of the reviewing screens (UX demo src/screens/review.tsx and
// screens/shared.tsx): answer inputs for Yes/No, 1–5 and text questions
// (REV-2), the question list with "Can't answer this?", earlier reviews that
// play in place, the content a checking kind compares against (REV-5), the
// background a reviewer opens on request as one collapsed card (REV-1,
// ADR-013, ADR-029) and the strip of review stages (REV-0). A review that
// already happened goes on its one passage (decision 128), so the demo's
// "Also covered in this session" picker is not here. Built from kit.tsx only.
import type { KindDef, KeyTermView, PassageNote, RequestView, ReviewView, SourcedQuestion, Version } from '@langquest-next/core';
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../ui/text';
import { AudioClip } from '../audio/audioClip';
import type { Ctx } from '../shell/ctx';
import { useHelpSpot } from '../helpMode/useHelpMode';
import { HelpBadge } from '../helpMode/helpBadge';
import { Badge, Banner, Card, Chip, Disclosure, Field, Ico, LinkBtn, NoteCard, Row, SectionLabel, ShowMore } from '../ui/kit';
import { txt } from '../ui/textStyles';
import { useLayout } from '../ui/useLayout';
import { t } from '../i18n';
import { feedbackSource, outcomeText, versionTitle, when } from '../passage/passageView';
import { Authored, ReportFlag } from '../moderation/reportSheet';
import { authoredText, recordTarget } from '../moderation/reportTargets';
import type { StudyProgress } from '../study/progress';
import { studySummary } from '../study/progress';
import { StepMark } from '../study/ui';
import { stepLine } from '../study/studyText';
import { C, measure, radius, space, target, TINT, type as T, withAlpha } from '../ui/theme';
import {
  questionSource, summaryLine, YES_NO, yesNoLabel, type Answers, type Skips, type Stage, type StageId
} from './capture';

// ---- answers --------------------------------------------------------------------------

/**
 * One 56pt choice in a row of equal choices (Yes/No, 1–5). No kit primitive
 * is an equal-width 56pt segment (Chip is a 48pt pill sized to its label),
 * so this stays; a screen reader hears it as one radio of the set.
 */
function Choice(props: { label: string; on: boolean; onPress: () => void; big?: boolean }) {
  const spot = useHelpSpot(props.label, t('review.simple.yourAnswerHelp'), props.onPress);
  return (
    <Pressable onPress={spot.onPress} accessibilityRole="radio" accessibilityState={{ checked: props.on }} aria-checked={props.on} accessibilityLabel={props.label}
      style={({ pressed }) => [styles.choice, props.on ? { backgroundColor: C.primary } : null, pressed && { opacity: 0.7 }]}>
      <Text style={[props.big ? styles.choiceBig : styles.choiceLabel, { color: props.on ? C.white : C.dark }]}>{props.label}</Text>
      <HelpBadge spot={spot} />
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
        {YES_NO.map((v) => <Choice key={v} label={yesNoLabel(v)} on={props.value === v} onPress={() => props.onChange(v)} />)}
      </View>
    );
  }
  return <Field value={props.value ?? ''} onChangeText={props.onChange} placeholder={t('review.parts.yourAnswer')} multiline />;
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
      <SectionLabel label={t('review.parts.questions')} action={<Text style={txt.xs}>{t('review.parts.requiredCount', { count: questions.filter((q) => q.required).length })}</Text>} />
      {questions.map((sq) => {
        const id = sq.q.id;
        const skip = skipped[id];
        const unanswered = !(answers[id] ?? '').trim();
        const waiting = sq.required && unanswered && skip === undefined;
        return (
          <Card key={id} style={waiting ? { borderColor: withAlpha(C.primary, 0.5), borderWidth: 1.5 } : null}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <Text style={txt.label}>{questionSource(sq, props.asker)}</Text>
              {sq.required ? <Badge label={t('common.required')} tone="brand" /> : null}
            </View>
            <Text style={[txt.body, { fontWeight: '600' }]}>{sq.q.text}</Text>
            {skip !== undefined ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                <Text style={[txt.smMuted, { flex: 1 }]}><Text style={{ fontWeight: '700' }}>{t('review.parts.leftUnanswered')}</Text> {skip}</Text>
                <LinkBtn label={t('review.parts.answer')} help={t('review.screen.answerItHelp')} onPress={() => props.onUnskip(id)} />
              </View>
            ) : (
              <>
                <AnswerInput type={sq.q.type} value={answers[id]} onChange={(v) => props.onAnswer(id, v)} />
                {sq.required && unanswered ? <LinkBtn label={t('review.parts.cantAnswer')} color={C.muted} help={t('review.parts.cantAnswerHelp')} onPress={() => props.onSkip(id)} /> : null}
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
  const change = v.changeNote ?? (v.n === 1 ? t('review.parts.firstRecording') : undefined);
  return (
    <View style={{ gap: space.sm }}>
      <SectionLabel label={t('review.parts.listen')} />
      <Card>
        <Text style={txt.h3}>{versionTitle(v.n)}</Text>
        <AudioClip language={props.ctx.language} hashes={v.cardHashes} label={t('review.parts.playVersion', { n: v.n })} />
        {change ? <Text style={txt.sm}><Text style={{ fontWeight: '700' }}>{t('review.parts.whatChanged')}</Text> {change}</Text> : null}
        {v.changeBlobHash ? <AudioClip language={props.ctx.language} hashes={[v.changeBlobHash]} label={t('review.parts.playWhatChanged')} /> : null}
        <Text style={txt.xs}>{t('review.parts.publishedBy', { name: props.ctx.name(v.by), when: when(v.hlc) })}</Text>
      </Card>
    </View>
  );
}

/** Who asked, by when, and their note. */
export function RequestBanner(props: { ctx: Ctx; request: RequestView }) {
  const r = props.request;
  const who = r.by ? props.ctx.name(r.by) : t('common.someone');
  return (
    <View style={{ gap: space.sm }}>
      <Banner icon={r.guest ? 'link' : 'assign'} title={t('review.parts.asked', { name: who })}
        {...(r.note ? { body: authoredText(props.ctx, r.by, r.note) } : {})} />
      {r.noteBlobHash ? (
        <Authored ctx={props.ctx} by={r.by}>
          <AudioClip language={props.ctx.language} hashes={[r.noteBlobHash]} label={t('review.parts.playDirections')} />
        </Authored>
      ) : null}
      {r.by && (r.note || r.noteBlobHash) ? (
        <View style={{ alignSelf: 'flex-end' }}>
          <ReportFlag ctx={props.ctx} target={recordTarget(props.ctx, 'request', r.id, r.by, r.unitId)} size={36} />
        </View>
      ) : null}
    </View>
  );
}

/** A kind that makes a back translation: the shipped one (its words may be in another language now), or one that says so. */
function makesBackTranslation(k: KindDef): boolean {
  return k.id === 'bt' || k.produces?.what === 'back translation';
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
  const bt = makesBackTranslation(k);
  const into = k.produces?.into ?? t('review.parts.aRecording');
  return (
    <Card style={{ borderColor: withAlpha(C.primary, 0.4), borderWidth: 1.5 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <Ico name="swap" size={18} color={C.primary} />
        <Text style={[txt.label, { color: C.primary }]}>{t('review.parts.toCompare', { kind: k.name })}</Text>
      </View>
      <Text style={txt.smMuted}>
        {bt ? t('review.parts.madeForCheckBt', { into }) : t('review.parts.madeForCheck', { into })}
      </Text>
      <Text style={[txt.sm, { fontWeight: '700' }]}>{t('review.parts.compareFrom', { who: feedbackSource(r, props.ctx.name), n: r.versionN, when: when(r.hlc) })}</Text>
      {r.versionN !== props.version.n ? (
        <Banner icon="history" tone="amber" title={t('review.parts.madeFromOlder', { from: r.versionN, now: props.version.n })} />
      ) : null}
      <Authored ctx={props.ctx} by={r.by}>
        {recordings.length ? (
          <AudioClip language={props.ctx.language} hashes={recordings}
            label={k.produces?.what ? t('review.parts.playThe', { what: k.produces.what }) : t('review.parts.playTheRecording')} />
        ) : <Text style={txt.xs}>{t('review.parts.noRecording')}</Text>}
        {r.comment || r.commentBlobHash ? (
          <View style={styles.inset}>
            <Text style={txt.xsStrong}>{bt ? t('review.parts.btNote') : t('review.parts.theirNote')}</Text>
            {r.comment ? <Text style={txt.sm}>{r.comment}</Text> : null}
            {r.commentBlobHash ? <AudioClip language={props.ctx.language} hashes={[r.commentBlobHash]} label={t('review.parts.playTheirNote')} /> : null}
          </View>
        ) : null}
      </Authored>
    </Card>
  );
}

// ---- background, on request (ADR-013) ------------------------------------------------------------

/** What an earlier reviewer said and recorded; recordings play in place, not as a summary. */
function EarlierReview(props: { ctx: Ctx; review: ReviewView; kind: KindDef | undefined; last: boolean }) {
  const [open, setOpen] = useState(false);
  const r = props.review;
  const good = r.outcome !== 'needs_changes';
  const recordings = [...(r.artifacts ?? []).map((c) => c.hash), ...(r.commentBlobHash ? [r.commentBlobHash] : [])];
  const sub = `${feedbackSource(r, props.ctx.name)} · ${versionTitle(r.versionN)} · ${when(r.hlc)}${recordings.length ? ` · ${t('review.parts.recordings', { count: recordings.length })}` : ''}`;
  return (
    <View style={!props.last ? styles.divider : null}>
      <Row
        leading={<View style={[styles.mark, { backgroundColor: good ? TINT.green : TINT.amber }]}><Ico name={good ? 'check' : 'chat'} size={18} color={good ? TINT.greenText : TINT.amberText} /></View>}
        label={`${props.kind?.name ?? t('review.parts.review')} · ${outcomeText(props.kind, r.outcome)}`} sub={sub} last
        right={<Ico name={open ? 'up' : 'down'} size={20} color={C.muted} />} onPress={() => setOpen((o) => !o)} expanded={open} />
      {open ? (
        <View style={{ paddingHorizontal: space.lg, paddingBottom: space.lg, gap: space.sm }}>
          <Authored ctx={props.ctx} by={r.by}>
            {r.comment ? <Text style={txt.sm}>{r.comment}</Text> : null}
            {recordings.length ? <AudioClip language={props.ctx.language} hashes={recordings} label={t('review.parts.playRecorded')} /> : null}
          </Authored>
          {r.response ? (
            <Text style={txt.smMuted}>
              <Text style={{ fontWeight: '700', color: C.dark }}>{r.response.decision === 'revised' ? t('review.parts.revised') : t('review.parts.kept')}</Text> {r.response.note ? authoredText(props.ctx, r.response.by, r.response.note) : (r.response.decision === 'revised' ? t('review.parts.newVersionAnswered') : t('review.parts.keptAsIs'))}
            </Text>
          ) : null}
          {!r.comment && !recordings.length && !r.response ? <Text style={txt.xs}>{t('review.parts.nothingElse')}</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

const EARLIER_STEP = 5;

export function EarlierReviewsPart(props: { ctx: Ctx; reviews: ReviewView[]; kind: (id: string) => KindDef }) {
  const [shown, setShown] = useState(EARLIER_STEP);
  const names = [...new Set(props.reviews.map((r) => props.kind(r.kindId).name))];
  const list = props.reviews.slice(0, shown);
  return (
    <View>
      <PartLabel label={t('review.parts.earlierReviews', { kinds: names.join(', ') })} />
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
      <PartLabel label={t('review.parts.fromTranslator')} inset={false} />
      {props.terms.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {props.terms.map((term) => {
            const rendering = term.renderings.at(-1)?.rendering;
            return <Chip key={term.termId} icon="book" label={`${term.term}${rendering ? ` · ${rendering}` : ''}`} on={false} help={t('passage.version.termHelp')} onPress={() => props.onOpenTerm(term.termId)} />;
          })}
        </View>
      ) : null}
      {notes.map((n) => {
        const older = props.olderVersion(n);
        return (
          <Authored key={n.id} ctx={props.ctx} by={n.by}>
            <NoteCard anchor={props.anchor(n)} {...(n.text ? { text: n.text } : {})} by={props.ctx.name(n.by)} when={when(n.hlc)}
              {...(older ? { olderVersion: older } : {})} icon={n.anchor.kind === 'term' ? 'book' : 'note'}
              {...(n.blobHash ? { audio: <AudioClip language={props.ctx.language} hashes={[n.blobHash]} label={t('review.parts.playNote')} /> } : {})}
              action={<ReportFlag ctx={props.ctx} target={recordTarget(props.ctx, 'note', n.id, n.by, n.unitId)} size={36} />} />
          </Authored>
        );
      })}
      {props.notes.length > shown ? <ShowMore remaining={props.notes.length - shown} step={EARLIER_STEP} onMore={() => setShown((x) => x + EARLIER_STEP)} /> : null}
    </View>
  );
}

/** The team's study of the passage (FIA): evidence it was studied before drafting (ADR-018). */
export function TeamStudyPart(props: { ctx: Ctx; study: StudyProgress; onOpenStep: (stepId: string) => void; onOpenStudy: () => void }) {
  const s = props.study;
  const started = s.doneCount > 0 || s.noteCount > 0;
  return (
    <View>
      <PartLabel label={t('review.parts.teamStudy', { pattern: s.guide.pattern })} />
      <Text style={[txt.smMuted, { paddingHorizontal: space.lg }]}>
        {t('review.parts.studyIntro', { summary: started ? studySummary(s) : t('review.parts.notStarted') })}
      </Text>
      {s.steps.map((st) => (
        <Row key={st.step.id} leading={<StepMark status={st} />} label={st.step.title} sub={stepLine(props.ctx, st)} help={t('passage.page.openStudyStepHelp')} onPress={() => props.onOpenStep(st.step.id)} />
      ))}
      <Row icon="sparkle" label={t('review.parts.openStudy')} help={t('passage.page.openStudyHelp')} onPress={props.onOpenStudy} last />
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
 * study, earlier reviews. Nothing to show, nothing drawn. What a check
 * shows is the language's to say (decisions.md 130).
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
    !!props.source && t('review.parts.bg.source'),
    fromTranslator && `${t('review.parts.bg.terms', { count: props.terms.length })} · ${t('review.parts.bg.notes', { count: props.notes.length })}`,
    props.study && t('review.parts.bg.study'),
    props.reviews.length > 0 && t('review.parts.bg.earlier', { count: props.reviews.length })
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
    <Disclosure icon="book" title={t('review.parts.background')} summary={summary} open={d.open} onToggle={d.onToggle}>
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
      <View style={[styles.stripRow, wide && { maxWidth: measure.column, alignSelf: 'center', width: '100%' }]} accessibilityLabel={t('review.parts.stagesLabel')}>
        {props.stages.map((st, i) => <StageTab key={st.id} stage={st} index={i} count={props.stages.length} at={props.at} onGo={props.onGo} />)}
      </View>
    </View>
  );
}

/** One stage in the strip: a done one goes back with a tap; in help mode each says where it is. */
function StageTab(props: { stage: Stage; index: number; count: number; at: number; onGo: (id: StageId) => void }) {
  const { stage: st, index: i } = props;
  const current = i === props.at;
  const done = i < props.at;
  const spot = useHelpSpot(st.label, done ? t('review.simple.goBack') : t('review.simple.stepOf', { index: i + 1, total: props.count }), () => props.onGo(st.id));
  return (
    <Pressable onPress={spot.onPress} disabled={!done && !spot.id} accessibilityRole="button"
      accessibilityLabel={done ? t('review.parts.backToStage', { stage: st.label }) : t('review.parts.stageOf', { stage: st.label, index: i + 1, total: props.count })}
      accessibilityState={{ selected: current, disabled: !done }}
      style={({ pressed }) => [styles.stage, current && { backgroundColor: C.light }, pressed && { opacity: 0.7 }]}>
      <View style={[styles.stageNum, current ? { backgroundColor: C.primary } : done ? { backgroundColor: C.dark } : styles.stageNumLater]}>
        {done ? <Ico name="check" size={14} color={C.white} strokeWidth={3} /> : (
          <Text style={[styles.stageNumText, { color: current ? C.white : C.muted }]}>{i + 1}</Text>
        )}
      </View>
      <Text style={[txt.sm, { fontWeight: '600', flexShrink: 1, color: current ? C.primary : done ? C.dark : C.muted }]} numberOfLines={1}>{st.label}</Text>
      <HelpBadge spot={spot} />
    </Pressable>
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
  const fewer = useHelpSpot(t('review.parts.oneFewer'), t('review.parts.counterHelp'), () => props.onChange(Math.max(0, n - 1)));
  const more = useHelpSpot(t('review.parts.oneMore'), t('review.parts.counterHelp'), () => props.onChange(n + 1));
  return (
    <View style={styles.counter}>
      <Pressable onPress={fewer.onPress} disabled={n === 0 && !fewer.id} accessibilityRole="button" accessibilityLabel={t('review.parts.oneFewer')}
        style={({ pressed }) => [styles.counterBtn, n === 0 && { opacity: 0.4 }, pressed && { opacity: 0.6 }]}>
        <Text style={styles.counterSign}>−</Text>
        <HelpBadge spot={fewer} />
      </Pressable>
      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm }}>
        <Ico name="people" size={22} color={C.muted} />
        <Text style={[txt.body, { fontWeight: '600', color: n ? C.dark : C.muted }]}>{n ? t('review.parts.people', { count: n }) : t('review.parts.howManyListened')}</Text>
      </View>
      <Pressable onPress={more.onPress} accessibilityRole="button" accessibilityLabel={t('review.parts.oneMore')}
        style={({ pressed }) => [styles.counterBtn, pressed && { opacity: 0.6 }]}>
        <Text style={styles.counterSign}>+</Text>
        <HelpBadge spot={more} />
      </Pressable>
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
  counterSign: { fontSize: T.xxl, fontWeight: '600', color: C.dark }
});
