// The journey: the passage's path, top to bottom (demo `screens/passage.tsx`
// Journey, JourneyRow, VersionPlayer, KindLine, OldKindLine; REC-2, REC-2a;
// ADR-030 and its two amendments). One column a finger can follow: the
// recording first, then each step of the language's flow as its own box,
// closed to one line and opened with a tap, then Done. The next step opens
// in place with its main button (ADR-029); feedback waiting for an answer
// shows inside the step that gave it. The recording flips between versions
// (‹ ›, the dots, or a swipe), and every step then shows what that version
// heard, read only.
import { stepName, type FlowStepStatus, type KindStatus, type ReviewView, type Version } from '@langquest-next/core';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { AudioClip } from '../audioClip';
import type { Ctx } from '../ctx';
import { Ico, StateMark, txt, type IconName } from '../kit';
import { plural, versionTitle, when, type PassageView } from '../passageView';
import { C, radius, shadow, space, target, TINT, withAlpha } from '../theme';
import {
  currentStepId, kindLineText, lastReviewOn, ledTo, madeAfter, oldKindLineText, oldStepState, oldStepSummary, pathState, reviewMark,
  stepSummary, versionCaption, type NameFn, type PathState
} from './record';

const PATH_A11Y: Record<PathState, string> = {
  complete: 'complete', answered: 'feedback answered', current: 'next', todo: 'to do', locked: 'locked', attention: 'needs attention', waiting: 'waiting'
};

/** A step's mark: colour and icon together (ADR-010); a lock for a checkpoint, a flag for an override. */
export function PathDot(props: { state: PathState; icon?: IconName; checkpoint: boolean; override: boolean; size?: number }) {
  const { state, checkpoint, override } = props;
  const size = props.size ?? 36;
  const px = (n: number) => Math.round((n * size) / 36);
  const bg = state === 'complete' ? C.green : state === 'locked' ? TINT.gray : state === 'attention' ? TINT.amber : C.card;
  const ring = state === 'current' || state === 'waiting' ? C.primary : state === 'attention' ? C.amber : state === 'answered' ? C.green
    : state === 'todo' ? C.border : checkpoint && state !== 'complete' ? C.amber : 'transparent';
  const halo = checkpoint ? (state === 'complete' ? withAlpha(C.green, 0.25) : withAlpha(C.amber, 0.31)) : 'transparent';
  let mark: ReactNode = null;
  if (state === 'complete') mark = <Ico name={override ? 'flag' : 'check'} size={px(18)} color={C.white} strokeWidth={3} />;
  if (state === 'answered') mark = <Ico name="check" size={px(18)} color={C.green} strokeWidth={3} />;
  if (state === 'locked') mark = <Ico name="lock" size={px(15)} color={C.faint} />;
  if (state === 'current') mark = props.icon ? <Ico name={props.icon} size={px(16)} color={C.primary} /> : <View style={{ width: px(10), height: px(10), borderRadius: px(5), backgroundColor: C.primary }} />;
  if (state === 'waiting') mark = <Ico name="clock" size={px(16)} color={C.primary} />;
  if (state === 'attention') mark = <Ico name="chat" size={px(15)} color={TINT.amberText} />;
  if (state === 'todo' && props.icon) mark = <Ico name={props.icon} size={px(15)} color={C.faint} />;
  return (
    <View accessibilityLabel={`${PATH_A11Y[state]}${checkpoint ? ', checkpoint' : ''}${override ? ', moved past' : ''}`}
      style={{ padding: 2, borderRadius: size, borderWidth: 2, borderColor: halo }}>
      <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, borderWidth: 2, borderColor: ring, alignItems: 'center', justifyContent: 'center' }}>
        {mark}
      </View>
      {checkpoint && !override ? (
        <View style={[styles.checkpointBadge, { borderColor: state === 'complete' ? C.green : C.amber }]}>
          <Ico name="lock" size={10} color={state === 'complete' ? C.green : C.amber} strokeWidth={2.6} />
        </View>
      ) : null}
    </View>
  );
}

export function Journey(props: {
  ctx: Ctx;
  v: PassageView;
  /** Which version the path shows (index into the versions, oldest first). */
  versionIdx: number;
  onVersion: (i: number) => void;
  /** Whether this person can do anything from a step (a viewer only looks). */
  canAct: boolean;
  /** The next step's card in place (or the record card before the first version). */
  nextSlot: ReactNode;
  /** Feedback on the latest version that still needs an answer, at the step that gave it. */
  feedbackSlot: (r: ReviewView) => ReactNode;
  onOpenStep: (stepId: string) => void;
  onOpenVersion: (takeId: string) => void;
  onOpenReview: (reviewId: string) => void;
  /** The current step's row once it is laid out, so the screen can open scrolled to it. */
  onCurrentLayout: (row: View) => void;
  teamName?: (teamId: string) => string | undefined;
}) {
  const { ctx, v } = props;
  const { p, kinds } = v;
  const name: NameFn = ctx.name;
  const versions = p.versions;
  const version = versions[props.versionIdx];
  const isLatest = !version || props.versionIdx >= versions.length - 1;
  const currentId = currentStepId(p);
  // Steps someone opened or closed by hand; the rest follow the default (the current one open).
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  useEffect(() => { setExpanded({}); }, [v.unitId, v.laneId, props.versionIdx]);
  const currentRow = useRef<View>(null);
  const go = (i: number) => { if (i >= 0 && i < versions.length && i !== props.versionIdx) props.onVersion(i); };
  const goTo = (takeId?: string) => go(versions.findIndex((x) => x.takeId === takeId));
  const kindName = (id: string) => v.kind(id).name;
  const steps = p.steps;

  return (
    <View>
      {/* The recording: the first stop, and the one you can hear. */}
      <JourneyRow dot={<PathDot state={p.recorded ? 'complete' : 'current'} icon="mic" checkpoint={false} override={false} size={36} />}
        {...(steps.length > 0 ? { line: p.recorded ? C.primary : C.border } : {})}>
        {version ? (
          <VersionCard ctx={ctx} version={version} index={props.versionIdx} titles={versions.map((x) => versionTitle(x.n))} onGo={go}
            onOpen={() => props.onOpenVersion(version.takeId)}
            madeAfter={madeAfter(p, version).map((r) => ({
              id: r.id, label: `${kindName(r.kindId)} on ${versionTitle(r.versionN)}`, onPress: () => goTo(versions.find((x) => x.n === r.versionN)?.takeId)
            }))} />
        ) : (
          <View style={{ paddingTop: space.xs, gap: 2 }}>
            <Text style={[txt.body, { fontWeight: '700' }]}>Recording</Text>
            <Text style={txt.xs}>{p.drafting ? 'Takes on the phone, not published yet' : 'Not recorded yet'}</Text>
          </View>
        )}
        {!p.recorded ? <View style={{ marginTop: space.md }}>{props.nextSlot}</View> : null}
      </JourneyRow>

      {!isLatest ? (
        <Pressable onPress={() => go(versions.length - 1)} accessibilityRole="button"
          style={({ pressed }) => [styles.backToLatest, pressed && styles.pressed]}>
          <Ico name="history" size={16} color={TINT.amberText} />
          <Text style={[txt.sm, { fontWeight: '700', color: TINT.amberText }]}>Back to the latest version</Text>
        </Pressable>
      ) : null}

      {steps.map((s, i) => {
        const st = s.step;
        const isNext = isLatest && p.recorded && !p.done && p.next?.step.id === st.id;
        const feedback = isLatest ? p.awaitingResponse.filter((r) => st.kindIds.includes(r.kindId)) : [];
        const lineTo = i < steps.length - 1 ? (s.complete && isLatest ? C.primary : C.border) : p.done && isLatest ? C.green : undefined;
        const oldReviews = st.kindIds.map((k) => lastReviewOn(p, k, version?.n));
        const dot = isLatest ? pathState(s, isNext) : oldStepState(oldReviews);
        const isCurrent = isLatest && st.id === currentId;
        const open = expanded[st.id] ?? isCurrent;
        const summary = isLatest ? stepSummary(s, kinds, name, props.teamName) : oldStepSummary(st.kindIds, oldReviews, kinds);
        const tone = feedback.length ? C.amber : isNext ? C.primary : C.border;
        const options = isLatest && props.canAct && !s.lockedBy && (!isNext || feedback.length > 0 || p.awaitingResponse.length > 0);
        return (
          <JourneyRow key={st.id} {...(lineTo ? { line: lineTo } : {})} dim={isLatest && !!s.lockedBy}
            {...(isCurrent ? { rowRef: currentRow, onLayout: () => { if (currentRow.current) props.onCurrentLayout(currentRow.current); } } : {})}
            dot={<PathDot state={dot} checkpoint={st.checkpoint} override={!!s.override && isLatest} size={36} />}>
            <View style={[styles.stepBox, open && { borderColor: tone, borderWidth: isNext || feedback.length ? 1.5 : StyleSheet.hairlineWidth, ...shadow }]}>
              <Pressable onPress={() => setExpanded((e) => ({ ...e, [st.id]: !open }))} accessibilityRole="button"
                accessibilityState={{ expanded: open }} accessibilityLabel={`${stepName(kinds, st)}. ${summary}`}
                style={({ pressed }) => [styles.stepHead, pressed && styles.pressed]}>
                <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                  <View style={styles.pills}>
                    <Text style={[txt.body, { fontWeight: '700' }]}>{stepName(kinds, st)}</Text>
                    {st.checkpoint ? <Pill icon="lock" label="Checkpoint" bg={TINT.amber} fg={TINT.amberText} /> : null}
                    {isNext && feedback.length === 0 ? <Pill label="Next" bg={C.primary} fg={C.white} /> : null}
                    {feedback.length > 0 ? <Pill label="Feedback" bg={TINT.amber} fg={TINT.amberText} /> : null}
                  </View>
                  {!open ? <Text style={txt.smMuted} numberOfLines={2}>{summary}</Text> : null}
                  {open && st.kindIds.length > 1 ? <Text style={txt.xs}>{st.kindIds.length === 2 ? 'Either order' : 'Any order'}</Text> : null}
                </View>
                <View style={styles.chev}><Ico name={open ? 'up' : 'down'} size={18} color={C.muted} /></View>
              </Pressable>
              {open ? (
                <View style={styles.stepBody}>
                  {feedback.map((r) => <View key={r.id}>{props.feedbackSlot(r)}</View>)}
                  {isNext ? props.nextSlot : feedback.length > 0 ? null : (
                    <View style={{ gap: space.sm }}>
                      {st.kindIds.map((kid, j) => isLatest
                        ? <KindLine key={kid} ctx={ctx} v={v} label={st.kindIds.length > 1 ? kindName(kid) : undefined} status={s.kinds.find((k) => k.kindId === kid)}
                            step={s} onOpenReview={props.onOpenReview} onVersion={goTo} {...(props.teamName ? { teamName: props.teamName } : {})} />
                        : <OldKindLine key={kid} ctx={ctx} v={v} label={st.kindIds.length > 1 ? kindName(kid) : undefined} kindId={kid}
                            review={oldReviews[j]} onOpenReview={props.onOpenReview} onVersion={goTo} />)}
                    </View>
                  )}
                  {options ? (
                    <Pressable onPress={() => props.onOpenStep(st.id)} accessibilityRole="button" accessibilityLabel={`${stepName(kinds, st)}, all options`}
                      style={({ pressed }) => [styles.softBtn, pressed && styles.pressed]}>
                      <Ico name="settings" size={18} color={C.dark} />
                      <Text style={[txt.sm, { fontWeight: '700' }]}>Options for this step</Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}
            </View>
          </JourneyRow>
        );
      })}

      {isLatest && p.done && steps.length > 0 ? (
        <JourneyRow dot={<View style={styles.doneDot}><Ico name="star" size={20} color={C.white} /></View>}>
          <View style={{ paddingTop: space.xs, gap: 2 }}>
            <Text style={[txt.body, { fontWeight: '700', color: TINT.greenText }]}>Done</Text>
            <Text style={txt.xs}>Every step of {p.flow.name} is complete.</Text>
          </View>
        </JourneyRow>
      ) : null}

      {isLatest && props.canAct && !p.done && steps.length > 0 ? (
        <Hint icon="help" text="Tap a step to open it. Its options let you ask someone, say it already happened, or set it aside." />
      ) : null}
      {versions.length > 1 ? <Hint icon="swap" text="Swipe, or tap ‹ ›, to see what happened to each version." /> : null}
    </View>
  );
}

function Hint(props: { icon: IconName; text: string }) {
  return (
    <View style={[styles.rowCenter, { gap: 6, marginTop: space.xs }]}>
      <Ico name={props.icon} size={14} color={C.muted} />
      <Text style={[txt.xs, { flex: 1 }]}>{props.text}</Text>
    </View>
  );
}

function Pill(props: { label: string; bg: string; fg: string; icon?: IconName }) {
  return (
    <View style={[styles.pill, { backgroundColor: props.bg }]}>
      {props.icon ? <Ico name={props.icon} size={11} color={props.fg} /> : null}
      <Text style={[txt.xsStrong, { color: props.fg }]}>{props.label}</Text>
    </View>
  );
}

/** One stop on the path: a dot on the line at the left, its content on the right. */
function JourneyRow(props: { dot: ReactNode; line?: string; dim?: boolean; rowRef?: React.RefObject<View | null>; onLayout?: () => void; children: ReactNode }) {
  return (
    <View ref={props.rowRef} onLayout={props.onLayout} collapsable={false} style={[styles.journeyRow, props.dim && { opacity: 0.6 }]}>
      <View style={styles.rail}>
        {props.dot}
        {props.line ? <View style={[styles.line, { backgroundColor: props.line }]} /> : null}
      </View>
      <View style={{ flex: 1, minWidth: 0, paddingBottom: space.lg }}>{props.children}</View>
    </View>
  );
}

/** The version's own card: flip between versions, hear it in place, open it, and the feedback it answered. */
function VersionCard(props: {
  ctx: Ctx;
  version: Version;
  index: number;
  /** Every version's title, oldest first (the dots). */
  titles: string[];
  onGo: (i: number) => void;
  onOpen: () => void;
  madeAfter: { id: string; label: string; onPress: () => void }[];
}) {
  const { ctx, version, index } = props;
  const count = props.titles.length;
  const isLatest = index >= count - 1;
  const many = count > 1;
  // A horizontal swipe flips versions; vertical drags stay with the scroll view.
  const latest = useRef({ index, onGo: props.onGo });
  latest.current = { index, onGo: props.onGo };
  const pan = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 16 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
    onPanResponderRelease: (_e, g) => {
      if (Math.abs(g.dx) > 60) latest.current.onGo(latest.current.index + (g.dx < 0 ? 1 : -1));
    },
    onPanResponderTerminationRequest: () => true
  }), []);
  return (
    <View style={styles.versionCard} {...(many ? pan.panHandlers : {})}>
      <View style={styles.rowCenter}>
        <Flip icon="left" label="Earlier version" hidden={!many} disabled={index === 0} onPress={() => props.onGo(index - 1)} />
        <View style={{ flex: 1, minWidth: 0, alignItems: 'center' }}>
          <Text style={[txt.body, { fontWeight: '700' }]} accessibilityRole="header">{versionTitle(version.n)}</Text>
          <Text style={[txt.xsStrong, { color: isLatest ? C.primary : TINT.amberText }]}>{versionCaption(index, count)}</Text>
        </View>
        <Flip icon="right" label="Newer version" hidden={!many} disabled={isLatest} onPress={() => props.onGo(index + 1)} />
      </View>
      {many ? (
        <View style={styles.dots} accessibilityRole="tablist" accessibilityLabel="Versions">
          {props.titles.map((title, i) => (
            <Pressable key={title} onPress={() => props.onGo(i)} hitSlop={10} accessibilityRole="tab" accessibilityLabel={title}
              accessibilityState={{ selected: i === index }} style={styles.dotTap}>
              <View style={[styles.dot, i === index && { width: 18, backgroundColor: C.primary }]} />
            </Pressable>
          ))}
        </View>
      ) : null}
      <View style={styles.rowCenter}>
        <AudioClip project={ctx.project} hashes={version.cardHashes} label={`Play ${versionTitle(version.n)}`} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[txt.sm, { fontWeight: '600' }]} numberOfLines={1}>{ctx.name(version.by)} · {when(version.hlc)}</Text>
          <Text style={txt.xs}>{plural(version.cardHashes.length, 'take')}</Text>
        </View>
      </View>
      {version.changeNote ? <Text style={txt.sm} numberOfLines={2}>{version.changeNote}</Text> : null}
      <Pressable onPress={props.onOpen} accessibilityRole="button" style={({ pressed }) => [styles.openBtn, pressed && styles.pressed]}>
        <Text style={[txt.sm, { fontWeight: '700', color: C.primary }]}>Open the recording</Text>
        <Ico name="right" size={16} color={C.primary} />
      </Pressable>
      {props.madeAfter.length > 0 ? (
        <View style={styles.chips}>
          <Text style={txt.xsStrong}>Made after</Text>
          {props.madeAfter.map((m) => (
            <Pressable key={m.id} onPress={m.onPress} accessibilityRole="button" accessibilityLabel={`Made after ${m.label}. Show that version`}
              style={({ pressed }) => [styles.chip, { backgroundColor: TINT.amber }, pressed && styles.pressed]}>
              <Ico name="chat" size={12} color={TINT.amberText} />
              <Text style={[txt.xsStrong, { color: TINT.amberText }]}>{m.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function Flip(props: { icon: 'left' | 'right'; label: string; hidden: boolean; disabled: boolean; onPress: () => void }) {
  if (props.hidden) return <View style={{ width: target.min }} />;
  return (
    <Pressable onPress={props.onPress} disabled={props.disabled} accessibilityRole="button" accessibilityLabel={props.label}
      accessibilityState={{ disabled: props.disabled }}
      style={({ pressed }) => [styles.flip, props.disabled && { opacity: 0.25 }, pressed && styles.pressed]}>
      <Ico name={props.icon} size={22} color={C.dark} />
    </Pressable>
  );
}

/** What a review left on the path: its words (two lines) and anything to hear, playable in place. */
function ReviewAttachments(props: { ctx: Ctx; v: PassageView; review: ReviewView }) {
  const { ctx, v, review } = props;
  const makes = v.kind(review.kindId).produces;
  const parts = review.artifacts ?? [];
  if (!review.comment && !review.commentBlobHash && parts.length === 0) return null;
  return (
    <View style={{ gap: space.xs }}>
      {review.comment ? <Text style={[txt.xs, { fontStyle: 'italic' }]} numberOfLines={2}>“{review.comment}”</Text> : null}
      {review.commentBlobHash ? <ClipRow ctx={ctx} hashes={[review.commentBlobHash]} label="Voice feedback" /> : null}
      {parts.length > 0 ? (
        <ClipRow ctx={ctx} hashes={parts.map((c) => c.hash)} label={makes ? `The ${makes.what}` : 'What was captured'} />
      ) : null}
    </View>
  );
}

function ClipRow(props: { ctx: Ctx; hashes: string[]; label: string }) {
  return (
    <View style={styles.rowCenter}>
      <AudioClip project={props.ctx.project} hashes={props.hashes} label={`Play ${props.label.toLowerCase()}`} />
      <Text style={[txt.sm, { fontWeight: '600', flex: 1 }]} numberOfLines={1}>{props.label}</Text>
    </View>
  );
}

function LedTo(props: { version: Version; onPress: () => void }) {
  return (
    <Pressable onPress={props.onPress} accessibilityRole="button" accessibilityLabel={`Led to ${versionTitle(props.version.n)}. Show it`}
      style={({ pressed }) => [styles.chip, { backgroundColor: C.light }, pressed && styles.pressed]}>
      <Text style={[txt.xsStrong, { color: C.primary }]}>led to {versionTitle(props.version.n)}</Text>
      <Ico name="right" size={12} color={C.primary} />
    </Pressable>
  );
}

function LineText(props: { label?: string; text: string; muted?: boolean; onPress?: () => void }) {
  const body = (
    <Text style={[txt.sm, props.muted && { color: C.muted }, props.onPress && styles.underline]}>
      {props.label ? <Text style={{ fontWeight: '700' }}>{props.label}: </Text> : null}{props.text}
    </Text>
  );
  if (!props.onPress) return <View style={styles.lineText}>{body}</View>;
  return (
    <Pressable onPress={props.onPress} accessibilityRole="link" style={({ pressed }) => [styles.lineText, pressed && styles.pressed]}>{body}</Pressable>
  );
}

/** A kind's line on the latest version: who, what, which version, what it left, and the version it led to. */
function KindLine(props: {
  ctx: Ctx; v: PassageView; label?: string | undefined; status?: KindStatus; step: FlowStepStatus;
  onOpenReview: (id: string) => void; onVersion: (takeId?: string) => void; teamName?: (teamId: string) => string | undefined;
}) {
  const { ctx, v, status } = props;
  if (!status) return null;
  const r = status.review;
  const led = r ? ledTo(v.p, r) : undefined;
  return (
    <View style={styles.kindLine}>
      <View style={{ marginTop: 13 }}><StateMark state={status.state} size={18} /></View>
      <View style={{ flex: 1, minWidth: 0, alignItems: 'flex-start', gap: space.xs }}>
        <LineText {...(props.label ? { label: props.label } : {})} text={kindLineText(status, props.step, v.p, ctx.name, props.teamName)}
          muted={status.state === 'todo' || status.state === 'locked'} {...(r ? { onPress: () => props.onOpenReview(r.id) } : {})} />
        {r ? <ReviewAttachments ctx={ctx} v={v} review={r} /> : null}
        {led ? <LedTo version={led} onPress={() => props.onVersion(led.takeId)} /> : null}
      </View>
    </View>
  );
}

/** A kind's line on an older version: what that version heard, and the version that answered it. */
function OldKindLine(props: {
  ctx: Ctx; v: PassageView; label?: string | undefined; kindId: string; review?: ReviewView | undefined;
  onOpenReview: (id: string) => void; onVersion: (takeId?: string) => void;
}) {
  const { ctx, v, review } = props;
  const led = review ? ledTo(v.p, review) : undefined;
  return (
    <View style={styles.kindLine}>
      <View style={{ marginTop: 13 }}><StateMark state={review ? reviewMark(review) : 'todo'} size={18} /></View>
      <View style={{ flex: 1, minWidth: 0, alignItems: 'flex-start', gap: space.xs }}>
        <LineText {...(props.label ? { label: props.label } : {})} text={oldKindLineText(review, v.kind(props.kindId), ctx.name)} muted={!review}
          {...(review ? { onPress: () => props.onOpenReview(review.id) } : {})} />
        {review ? <ReviewAttachments ctx={ctx} v={v} review={review} /> : null}
        {led ? <LedTo version={led} onPress={() => props.onVersion(led.takeId)} /> : null}
        {review?.response?.decision === 'kept' ? <Text style={txt.xsStrong}>Kept, with a reason</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  rowCenter: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  pressed: { opacity: 0.7 },
  checkpointBadge: { position: 'absolute', top: -2, right: -2, width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center' },
  journeyRow: { flexDirection: 'row', gap: space.md },
  rail: { width: 44, alignItems: 'center' },
  line: { flex: 1, width: 3, borderRadius: 2, marginVertical: space.xs, minHeight: 16 },
  stepBox: { backgroundColor: C.card, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: C.border, overflow: 'hidden' },
  stepHead: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.md, minHeight: target.primary },
  stepBody: { paddingHorizontal: space.lg, paddingBottom: space.lg, gap: space.md },
  pills: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.sm },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: space.sm, paddingVertical: 2, borderRadius: radius.full },
  chev: { width: 32, height: 32, borderRadius: 16, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' },
  softBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', minHeight: target.min, paddingHorizontal: space.md, borderRadius: radius.md, backgroundColor: C.bg },
  backToLatest: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', marginLeft: 56, marginBottom: space.sm, minHeight: target.min, paddingHorizontal: space.md, borderRadius: radius.md, backgroundColor: TINT.amber },
  doneDot: { width: 40, height: 40, borderRadius: 20, backgroundColor: C.green, alignItems: 'center', justifyContent: 'center' },
  versionCard: { backgroundColor: C.bg, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: C.border, padding: space.sm, gap: space.sm },
  flip: { width: target.min, height: target.min, borderRadius: target.min / 2, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center' },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 2 },
  dotTap: { height: 24, paddingHorizontal: 3, justifyContent: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.border },
  openBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: target.min, borderRadius: radius.md, backgroundColor: C.card },
  chips: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 36, paddingHorizontal: space.md, borderRadius: radius.full },
  kindLine: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  lineText: { minHeight: target.min, justifyContent: 'center' },
  underline: { textDecorationLine: 'underline', textDecorationStyle: 'dotted' }
});
