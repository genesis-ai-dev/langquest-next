// Moving one of the organization's library items to another organization
// (decisions.md 174), on the item's own screen: where its move stands, and
// a sheet that finds the organization and offers it. Only someone who
// manages this kind of item here sees it.
import type { LibraryItemView } from '@langquest-next/core';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { HelpRow } from '../helpMode/helpBadge';
import { t } from '../i18n';
import { formatDay } from '../i18n/format';
import type { Ctx } from '../shell/ctx';
import { Banner, GhostBtn, Group, LinkBtn, PrimaryBtn, Row, SearchField, Sheet } from '../ui/kit';
import { Text } from '../ui/text';
import { txt } from '../ui/textStyles';
import { C, space } from '../ui/theme';
import { OrgSeal } from '../verified/VerifiedSeal';
import { moveOfItem } from './model';
import { useLibraryMoves, type OfferAnswer } from './useLibraryMoves';

function problemText(answer: OfferAnswer): string {
  switch (answer) {
    case 'open': return t('moves.problem.open');
    case 'no_item': return t('moves.problem.noItem');
    case 'no_org': return t('moves.problem.noOrg');
    case 'not_allowed': return t('moves.problem.notAllowed');
    default: return t('moves.problem.offline');
  }
}

/**
 * `onMove`: where the item's settings are a sheet already, the page opens
 * the move sheet itself (MoveSheet) once that one closes.
 */
export function MoveItem(props: { ctx: Ctx; it: LibraryItemView; canManage: boolean; onMove?: () => void }) {
  const { ctx, it } = props;
  const moves = useLibraryMoves(ctx, props.canManage);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!props.canManage || it.source === 'subscription') return null;
  const move = moveOfItem(moves.moves, ctx.language.orgId, it.itemId);

  async function withdraw() {
    if (!move) return;
    setBusy(true);
    try { if (!await moves.withdraw(move.id)) ctx.toast(t('moves.problem.offline')); } finally { setBusy(false); }
  }

  if (move?.state === 'moved') {
    return <Banner icon="check" tone="green" title={t('moves.item.moved', { org: move.toOrgName })}
      body={t('moves.item.movedBody', { date: formatDay(move.movedAt!), count: move.followers ?? 0 })} />;
  }
  if (move?.state === 'accepted') {
    return <Banner icon="clock" tone="brand" title={t('moves.item.accepted', { org: move.toOrgName })} body={t('moves.item.acceptedBody', { org: move.toOrgName })} />;
  }
  if (move?.state === 'offered') {
    return (
      <View style={{ gap: space.sm }}>
        <Banner icon="clock" tone="brand" title={t('moves.item.offered', { org: move.toOrgName })} body={t('moves.item.offeredBody', { org: move.toOrgName })} />
        <LinkBtn label={t('moves.item.withdraw')} help={t('moves.item.withdrawHelp')} color={busy ? C.faint : C.primary} onPress={() => void withdraw()} />
      </View>
    );
  }
  if (it.archived || !it.current) return null;
  return (
    <>
      {move?.state === 'declined' ? <Text style={[txt.smMuted, { paddingHorizontal: space.xs }]}>{t('moves.item.declined', { org: move.toOrgName })}</Text> : null}
      <GhostBtn label={t('moves.item.move')} icon="swap" help={t('moves.item.moveHelp')} onPress={() => (props.onMove ? props.onMove() : setOpen(true))} />
      {props.onMove ? null : <MoveSheet visible={open} onClose={() => setOpen(false)} ctx={ctx} it={it} moves={moves} />}
    </>
  );
}

/** Find the organization, then say what happens and offer it. */
export function MoveSheet(props: { visible: boolean; onClose: () => void; ctx: Ctx; it: LibraryItemView; moves: ReturnType<typeof useLibraryMoves> }) {
  const { it, moves } = props;
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<{ org_id: string; name: string }[] | null>([]);
  const [to, setTo] = useState<{ org_id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => { if (props.visible) { setQuery(''); setFound([]); setTo(null); setProblem(null); } }, [props.visible]);
  useEffect(() => {
    if (query.trim().length < 2) { setFound([]); return; }
    let live = true;
    const id = setTimeout(() => { void moves.search(query.trim()).then((rows) => { if (live) setFound(rows); }); }, 300);
    return () => { live = false; clearTimeout(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- search when what is typed changes
  }, [query]);

  async function offer() {
    if (!to) return;
    setBusy(true); setProblem(null);
    try {
      const answer = await moves.offer(it.itemId, to.org_id);
      if (answer !== 'offered') { setProblem(problemText(answer)); return; }
      props.ctx.toast(t('moves.item.offeredToast', { org: to.name }));
      props.onClose();
    } finally { setBusy(false); }
  }

  return (
    <Sheet visible={props.visible} title={t('moves.sheet.title', { name: it.name })} sub={to ? to.name : t('moves.sheet.sub')} onClose={props.onClose}
      {...(to ? { onBack: () => setTo(null) } : {})}
      footer={to ? <PrimaryBtn label={t('moves.sheet.offer', { org: to.name })} icon="send" busy={busy} help={t('moves.sheet.offerHelp')} onPress={() => void offer()} /> : undefined}>
      {to ? (
        <View style={{ gap: space.md }}>
          <Text style={txt.body}>{t('moves.sheet.what', { org: to.name, name: it.name })}</Text>
          <Text style={txt.smMuted}>{t('moves.sheet.stays')}</Text>
        </View>
      ) : (
        <View style={{ gap: space.md }}>
          <Text style={txt.body}>{t('moves.sheet.intro')}</Text>
          <SearchField value={query} onChangeText={setQuery} placeholder={t('moves.sheet.search')} help={t('moves.sheet.searchHelp')} testID="move-search" />
          {found === null ? <Text style={txt.smMuted}>{t('moves.problem.offline')}</Text>
            : query.trim().length >= 2 && found.length === 0 ? <Text style={txt.smMuted}>{t('moves.sheet.none')}</Text> : null}
          {found && found.length ? (
            <Group>
              {found.map((o, i) => (
                <HelpRow key={o.org_id} of="moves.org">
                  <Row icon="building" label={o.name} afterLabel={<OrgSeal orgId={o.org_id} />} last={i === found.length - 1}
                    help={t('moves.sheet.orgHelp')} onPress={() => setTo(o)} />
                </HelpRow>
              ))}
            </Group>
          ) : null}
        </View>
      )}
      {problem ? <Text accessibilityRole="alert" style={[txt.sm, { color: C.red, fontWeight: '700' }]}>{problem}</Text> : null}
    </Sheet>
  );
}
