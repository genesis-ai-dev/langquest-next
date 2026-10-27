// Offers from other organizations to move one of their library items here
// (decisions.md 174), at the top of the library page for its kind: take it
// as a new item or in place of one of this organization's own, or turn it
// down. Only someone who manages that kind here sees them.
import { orgName, type LibraryKind } from '@langquest-next/core';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { HelpRow } from '../helpMode/helpBadge';
import { t } from '../i18n';
import type { Ctx } from '../shell/ctx';
import { Group, LinkBtn, PrimaryBtn, Row, SectionLabel, Sheet } from '../ui/kit';
import { Text } from '../ui/text';
import { txt } from '../ui/textStyles';
import { C, space } from '../ui/theme';
import { OrgLine } from '../verified/VerifiedSeal';
import { offersFor, placesFor, type LibraryMove } from './model';
import { useLibraryMoves, type TakeAnswer } from './useLibraryMoves';

function problemText(answer: TakeAnswer | 'decline'): string {
  switch (answer) {
    case 'not_open': return t('moves.problem.notOpen');
    case 'not_allowed': return t('moves.problem.notAllowed');
    case 'bad_item': return t('moves.problem.badItem');
    default: return t('moves.problem.offline');
  }
}

export function MoveOffers(props: { ctx: Ctx; kinds: readonly LibraryKind[]; canManage: boolean }) {
  const moves = useLibraryMoves(props.ctx, props.canManage);
  const [open, setOpen] = useState<string | null>(null);
  const offers = offersFor(moves.moves, props.ctx.language.orgId, props.kinds);
  if (!props.canManage || !offers.length) return null;
  const opened = offers.find((m) => m.id === open) ?? null;
  return (
    <>
      <SectionLabel label={t('moves.offers.title')} />
      <Group>
        {offers.map((m, i) => (
          <HelpRow key={m.id} of="moves.offer">
            <Row icon="download" label={m.name} sub={m.state === 'accepted' ? t('moves.offers.finishing') : t('moves.offers.from', { org: m.fromOrgName })}
              badge={t('moves.offers.badge')} badgeTone="amber" last={i === offers.length - 1}
              help={t('moves.offers.help')} testID={`move-offer-${m.fromItem}`} onPress={() => setOpen(m.id)} />
          </HelpRow>
        ))}
      </Group>
      {opened ? <OfferSheet ctx={props.ctx} move={opened} moves={moves} onClose={() => setOpen(null)} /> : null}
    </>
  );
}

function OfferSheet(props: { ctx: Ctx; move: LibraryMove; moves: ReturnType<typeof useLibraryMoves>; onClose: () => void }) {
  const { ctx, move, moves } = props;
  const here = orgName(ctx.org.state) ?? '';
  const places = placesFor(ctx.org.state?.library ?? {}, move.kind);
  const [into, setInto] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => { setInto(null); setChoosing(false); setProblem(null); }, [move.id]);
  const finishing = move.state === 'accepted';

  async function take() {
    setBusy(true); setProblem(null);
    try {
      const answer = await moves.take(move, into ?? undefined);
      if (answer !== 'taken') { setProblem(problemText(answer)); return; }
      ctx.toast(t('moves.offer.taken', { name: move.name }));
      props.onClose();
    } finally { setBusy(false); }
  }

  async function decline() {
    setBusy(true); setProblem(null);
    try {
      if (!await moves.decline(move.id)) { setProblem(problemText('decline')); return; }
      ctx.toast(t('moves.offer.declinedToast', { org: move.fromOrgName }));
      props.onClose();
    } finally { setBusy(false); }
  }

  const intoName = places.find((p) => p.itemId === into)?.name;
  return (
    <Sheet visible title={t('moves.offer.title', { name: move.name })} sub={move.fromOrgName} onClose={props.onClose}
      {...(choosing ? { onBack: () => setChoosing(false) } : {})}
      footer={choosing ? undefined : (
        <PrimaryBtn label={finishing ? t('moves.offer.finish') : intoName ? t('moves.offer.takeInto', { name: intoName }) : t('moves.offer.take')}
          icon="check" busy={busy} help={t('moves.offer.takeHelp')} onPress={() => void take()} />
      )}>
      {choosing ? (
        <Group>
          {places.map((p, i) => (
            <HelpRow key={p.itemId} of="moves.place">
              <Row label={p.name} role="radio" selected={into === p.itemId} last={i === places.length - 1} help={t('moves.offer.placeHelp')}
                onPress={() => { setInto(p.itemId); setChoosing(false); }} />
            </HelpRow>
          ))}
        </Group>
      ) : (
        <View style={{ gap: space.md }}>
          <OrgLine style={txt.body} text={t('moves.offer.body', { from: move.fromOrgName, org: here })} orgName={move.fromOrgName} orgId={move.fromOrg} />
          <Text style={txt.smMuted}>{t('moves.offer.after', { from: move.fromOrgName })}</Text>
          {finishing ? <Text style={txt.sm}>{t('moves.offers.finishing')}</Text> : null}
          {!finishing && places.length ? (
            <Group>
              <Row label={t('moves.offer.asNew')} role="radio" selected={into === null} help={t('moves.offer.asNewHelp')} onPress={() => setInto(null)} />
              <Row label={t('moves.offer.inPlace')} sub={intoName} role="radio" selected={into !== null} last help={t('moves.offer.inPlaceHelp')}
                onPress={() => setChoosing(true)} />
            </Group>
          ) : null}
          {!finishing ? <LinkBtn label={t('moves.offer.decline')} help={t('moves.offer.declineHelp')} color={C.muted} onPress={() => void decline()} /> : null}
        </View>
      )}
      {problem ? <Text accessibilityRole="alert" style={[txt.sm, { color: C.red, fontWeight: '700' }]}>{problem}</Text> : null}
    </Sheet>
  );
}
