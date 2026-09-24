// Avatar P. Status drill-down: status_home → language_status → book_status → piece_status → piece_assign / piece_stage → piece_version / piece_review.
import { bottleneck, deriveBooks, derivePieces, deriveTakeStatus, nextAction, percentDone, type Piece } from '@langquest-next/core';
import { BookOpen, Check, Globe, Mic } from 'lucide-react-native';
import { useState, type ReactNode } from 'react';
import { Text, View } from 'react-native';
import { indexesFor } from '../indexes';
import type { Ctx } from '../ctx';
import { Badge, Footer, Header, Note, Row, Screen, Section } from '../pui';
import { colors, space } from '../theme';
import { Card, DualProgressBar, StatusIcon, text } from '../ui';
import { Byline } from '../UserChip';

function lanePieces(ctx: Ctx, laneId: string): Piece[] {
  return ctx.project.state ? derivePieces(ctx.project.state, laneId, indexesFor(ctx.project.state)) : [];
}

const STATUS_COLOR: Record<Piece['status'], string> = {
  unassigned: colors.mutedForeground,
  doing: colors.translate,
  waiting: colors.review,
  done: colors.done
};

export function StatusHome(ctx: Ctx) {
  const { state } = ctx.project;
  const lanes = state ? Object.entries(state.lanes) : [];
  return (
    <Screen>
      <Header
        title="Status"
        sub={ctx.session.isAdmin ? undefined : 'Read-only overview of language progress.'}
        action={ctx.session.isAdmin ? <Badge label="Assign" color={colors.translate} /> : undefined}
      />
      <Section label={state?.project?.value.name ?? 'Project'}>
        {lanes.length === 0 ? <Row label="No languages yet" last /> : null}
        {lanes.map(([laneId, lane], i) => {
          const pieces = lanePieces(ctx, laneId);
          return (
            <Row
              key={laneId}
              icon={Globe}
              label={lane.languoidId}
              sub={`${pieces.length} pieces · ${bottleneck(pieces)}`}
              badge={`${percentDone(pieces)}%`}
              onPress={() => ctx.go('language_status', { laneId })}
              last={i === lanes.length - 1}
            />
          );
        })}
      </Section>
      {ctx.session.isAdmin ? <Footer label="Give assignment" onPress={() => ctx.go('give_assignment')} /> : null}
    </Screen>
  );
}

export function LanguageStatus(ctx: Ctx) {
  const { state } = ctx.project;
  const laneId = ctx.params['laneId'] ?? '';
  const pieces = lanePieces(ctx, laneId);
  const books = state ? deriveBooks(state) : [];
  return (
    <Screen>
      <Header title={state?.lanes[laneId]?.languoidId ?? laneId} sub={`${books.length} books · ${pieces.length} pieces · ${bottleneck(pieces)}`} onBack={ctx.back} />
      <Card>
        <DualProgressBar translatedPct={Math.round((100 * pieces.filter((p) => p.status !== 'unassigned' && p.stage !== 'Not started').length) / Math.max(1, pieces.length))} approvedPct={percentDone(pieces)} type="translate" />
      </Card>
      <Section label="Books">
        {books.map((b, i) => {
          const bp = pieces.filter((p) => p.bookId === b.unitId);
          return (
            <Row key={b.unitId} icon={BookOpen} bookId={b.unitId} label={b.label} sub={`${bp.length} pieces · ${bottleneck(bp)}`} badge={`${percentDone(bp)}%`} onPress={() => ctx.go('book_status', { laneId, bookId: b.unitId })} last={i === books.length - 1} />
          );
        })}
      </Section>
    </Screen>
  );
}

export function BookStatus(ctx: Ctx) {
  const { state } = ctx.project;
  const laneId = ctx.params['laneId'] ?? '';
  const bookId = ctx.params['bookId'] ?? '';
  const pieces = lanePieces(ctx, laneId).filter((p) => p.bookId === bookId);
  return (
    <Screen>
      <Header title={state?.units[bookId]?.label ?? bookId} sub={`${pieces.length} pieces · ${bottleneck(pieces)}`} onBack={ctx.back} />
      <Section label="Passages">
        {pieces.map((p, i) => (
          <Row
            key={p.unitId}
            icon={Mic}
            label={p.label}
            sub={p.assignee ? <Byline before={`${p.stage} ·`} id={p.assignee} /> : p.stage}
            right={<Badge label={p.status} color={STATUS_COLOR[p.status]} />}
            onPress={() => ctx.go('piece_status', { laneId, unitId: p.unitId })}
            last={i === pieces.length - 1}
          />
        ))}
      </Section>
    </Screen>
  );
}

/** Stage history rows for a piece: submission, then one row per review decision. */
function rounds(ctx: Ctx, piece: Piece) {
  const { state } = ctx.project;
  if (!state || !piece.takeId) return [];
  const out: { id: string; stage: string; sub: ReactNode; verdict: string }[] = [];
  const sub = state.submissions[piece.takeId];
  if (sub) out.push({ id: 'submit', stage: 'Draft', sub: <Byline before="submitted by" id={sub.actorId} />, verdict: 'drafted' });
  for (const [stepId, byActor] of Object.entries(state.reviews[piece.takeId] ?? {})) {
    for (const [actor, r] of Object.entries(byActor)) {
      out.push({ id: `${stepId}:${actor}`, stage: stepId, sub: <Byline before="reviewed by" id={actor} />, verdict: r.value.decision === 'approve' ? 'approved' : 'suggestions' });
    }
  }
  return out;
}

export function PieceStatus(ctx: Ctx) {
  const { state } = ctx.project;
  const laneId = ctx.params['laneId'] ?? '';
  const unitId = ctx.params['unitId'] ?? '';
  const piece = lanePieces(ctx, laneId).find((p) => p.unitId === unitId);
  if (!state || !piece) return <Note>Piece not found.</Note>;
  const next = nextAction(piece, state);
  const history = rounds(ctx, piece);
  return (
    <Screen footer={ctx.session.isAdmin && next.kind !== 'none' ? <Footer label={next.label} onPress={() => ctx.go('piece_assign', { laneId, unitId, kind: next.kind, stepId: next.stepId ?? '' })} /> : undefined}>
      <Header title={piece.label} sub={`${state.lanes[laneId]?.languoidId} · ${state.units[piece.bookId ?? '']?.label ?? ''}`} onBack={ctx.back} />
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <Text style={[text.h4, { flex: 1 }]}>{piece.stage}</Text>
          <Badge label={piece.status} color={STATUS_COLOR[piece.status]} />
        </View>
        {piece.assignee ? <Byline before="Assigned to" id={piece.assignee} /> : <Text style={text.muted}>Unassigned</Text>}
        <Text style={text.muted}>Next: {next.label}</Text>
      </Card>
      <Section label="Stage history">
        {history.length === 0 ? <Row label="Nothing submitted yet" last /> : null}
        {history.map((r, i) => (
          <Row key={r.id} label={r.stage} sub={r.sub} badge={r.verdict} onPress={() => ctx.go('piece_stage', { laneId, unitId, round: r.id })} last={i === history.length - 1} />
        ))}
      </Section>
    </Screen>
  );
}

export function PieceAssign(ctx: Ctx) {
  const { state, append } = ctx.project;
  const laneId = ctx.params['laneId'] ?? '';
  const unitId = ctx.params['unitId'] ?? '';
  const role = ctx.params['kind'] === 'review' ? 'reviewer' : 'translator';
  const [who, setWho] = useState('');
  const [due, setDue] = useState('Sep 30');
  const members = state ? Object.entries(state.members).filter(([, m]) => !m.removed.value) : [];
  async function send() {
    await append('v1.AssignmentMade', { unitId, laneId, profileId: who, role, dueDate: due });
    ctx.back();
  }
  return (
    <Screen footer={<Footer label="Send assignment" onPress={() => void send()} disabled={!who} />}>
      <Header title={role === 'reviewer' ? `Assign ${ctx.params['stepId']}` : 'Assign translation'} sub={state?.units[unitId]?.label} onBack={ctx.back} />
      <Section label="Assignee">
        {members.map(([id, m], i) => (
          <Row key={id} personId={id} sub={m.role.value} onPress={() => setWho(id)} right={who === id ? <Check size={18} color={colors.translate} /> : <View />} last={i === members.length - 1} />
        ))}
      </Section>
      <Section label="Due date">
        {['Sep 15', 'Sep 30', 'Oct 15'].map((d, i, a) => (
          <Row key={d} label={d} onPress={() => setDue(d)} right={due === d ? <Check size={18} color={colors.translate} /> : <View />} last={i === a.length - 1} />
        ))}
      </Section>
    </Screen>
  );
}

export function PieceStage(ctx: Ctx) {
  const { state } = ctx.project;
  const laneId = ctx.params['laneId'] ?? '';
  const unitId = ctx.params['unitId'] ?? '';
  const round = ctx.params['round'] ?? '';
  const piece = lanePieces(ctx, laneId).find((p) => p.unitId === unitId);
  if (!state || !piece || !piece.takeId) return <Note>Round not found.</Note>;
  const isReview = round !== 'submit';
  return (
    <Screen>
      <Header title={isReview ? round.split(':')[0]! : 'Draft'} sub={piece.label} onBack={ctx.back} />
      <Section label="This round">
        <Row label="Submitted content" sub={`${state.takes[piece.takeId]?.cardHashes.length ?? 0} cards`} onPress={() => ctx.go('piece_version', { laneId, unitId, takeId: piece.takeId! })} />
        <Row label="Review" sub={isReview ? 'decision recorded' : 'not reviewed in this round'} onPress={isReview ? () => ctx.go('piece_review', { laneId, unitId, takeId: piece.takeId!, round }) : undefined} last />
      </Section>
    </Screen>
  );
}

export function PieceVersion(ctx: Ctx) {
  const { state } = ctx.project;
  const takeId = ctx.params['takeId'] ?? '';
  const take = state?.takes[takeId];
  if (!state || !take) return <Note>Version not found.</Note>;
  const st = deriveTakeStatus(state, takeId, indexesFor(state));
  const terms = Object.entries(state.references).filter(([, r]) => r.unitId === take.unitId && r.kind === 'key_terms');
  return (
    <Screen>
      <Header title="Version" sub={<Byline before={`${state.units[take.unitId]?.label} · by`} id={take.actorId} />} onBack={ctx.back} />
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <StatusIcon outcome={st.outcome} />
          <Text style={text.body}>{take.cardHashes.length} cards</Text>
        </View>
        {take.parentTakeId ? <Text style={text.small}>Re-recorded from an earlier take</Text> : null}
      </Card>
      {terms.length ? (
        <Section label="Key terms">
          {terms.map(([id, r], i) => (
            <Row key={id} label={r.text ?? id} onPress={() => ctx.go('key_term_detail', { refId: id })} last={i === terms.length - 1} />
          ))}
        </Section>
      ) : null}
      <Section label="Reviews">
        {Object.entries(state.reviews[takeId] ?? {}).flatMap(([stepId, byActor]) =>
          Object.entries(byActor).map(([actor, r]) => (
            <Row key={`${stepId}:${actor}`} label={stepId} sub={<Byline id={actor} />} badge={r.value.decision === 'approve' ? 'approved' : 'suggestions'} onPress={() => ctx.go('piece_review', { ...ctx.params, round: `${stepId}:${actor}` })} />
          ))
        )}
        <Row label="" last />
      </Section>
    </Screen>
  );
}

export function PieceReview(ctx: Ctx) {
  const { state } = ctx.project;
  const takeId = ctx.params['takeId'] ?? '';
  const [stepId = '', actor = ''] = (ctx.params['round'] ?? '').split(':');
  const review = state?.reviews[takeId]?.[stepId]?.[actor]?.value;
  if (!state || !review) return <Note>Review not found.</Note>;
  const approved = review.decision === 'approve';
  return (
    <Screen>
      <Header title={stepId} sub={<Byline before="by" id={actor} />} onBack={ctx.back} />
      <Card style={{ backgroundColor: approved ? 'rgba(41,163,118,0.12)' : 'rgba(243,117,27,0.12)' }}>
        <Text style={text.h4}>{approved ? 'Approved' : 'Suggestions'}</Text>
        {review.comment ? <Text style={text.body}>{review.comment}</Text> : null}
      </Card>
      {review.answers ? (
        <Section label="Answers">
          {Object.entries(review.answers).map(([q, a], i, arr) => (
            <Row key={q} label={q} badge={a} last={i === arr.length - 1} />
          ))}
        </Section>
      ) : null}
      <Section label="Version">
        <Row label="Reviewed version" onPress={() => ctx.go('piece_version', ctx.params)} last />
      </Section>
    </Screen>
  );
}

import { contractsFor } from '../screenContracts';
export const contracts = contractsFor('status_home', 'language_status', 'book_status', 'piece_status', 'piece_assign', 'piece_stage', 'piece_version', 'piece_review');
