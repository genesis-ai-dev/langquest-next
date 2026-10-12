// The record of what was used (docs/reference-material.md, core
// references.ts): a screen collects what it offered and what the person
// played, chose or opened, and appends `v1.ReferencesUsed` with the
// version or review it describes. The passage record shows it again under
// each version and each review.
import { usedOn, type LanguageState, type UsedReference } from '@langquest-next/core';
import { useMemo, useRef } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../text';
import type { Ctx } from '../ctx';
import { t } from '../i18n';
import { Ico, txt } from '../kit';
import { C, radius, space } from '../theme';
import { madeWithLine, usedItems } from './model';

export interface Usage {
  /** Offered on this screen: kept once, updated as documents arrive. */
  offer: (items: UsedReference[]) => void;
  /** Played, chosen or opened. */
  open: (itemId: string) => void;
  /** What to record now. */
  items: () => UsedReference[];
}

/** One screen's record of what it offered and what was used, for the length of the visit. */
export function useUsage(): Usage {
  const offered = useRef(new Map<string, UsedReference>());
  const opened = useRef(new Set<string>());
  return useMemo<Usage>(() => ({
    offer: (items) => { for (const i of items) offered.current.set(i.itemId, { ...i, opened: offered.current.get(i.itemId)?.opened ?? i.opened }); },
    open: (itemId) => { opened.current.add(itemId); },
    items: () => usedItems(offered.current, opened.current)
  }), []);
}

function kindName(kind: UsedReference['kind']): string {
  switch (kind) {
    case 'source': return t('sources.used.kindSource');
    case 'guide': return t('sources.used.kindGuide');
    case 'note': return t('sources.used.kindNote');
    case 'questions': return t('sources.used.kindQuestions');
  }
}

/** "Made with BSB (opened), FIA" under a version or a review; tap for the list. Nothing when nothing was recorded. */
export function UsedLine(props: { ctx: Ctx; state: LanguageState; subject: { takeId?: string; reviewId?: string }; detailsKey: string }) {
  const items = useMemo(() => usedOn(props.state, props.subject), [props.state, props.subject.takeId, props.subject.reviewId]); // eslint-disable-line react-hooks/exhaustive-deps
  const d = props.ctx.details(props.detailsKey);
  if (items.length === 0) return null;
  return (
    <View style={styles.box}>
      <Pressable onPress={d.onToggle} accessibilityRole="button" accessibilityState={{ expanded: d.open }}
        accessibilityLabel={d.open ? t('sources.used.hideList', { line: madeWithLine(items) }) : t('sources.used.showList', { line: madeWithLine(items) })}
        style={({ pressed }) => [styles.line, pressed && { opacity: 0.7 }]}>
        <Ico name="book" size={16} color={C.muted} />
        <Text style={[txt.xs, { flex: 1 }]} numberOfLines={d.open ? undefined : 2}>{madeWithLine(items)}</Text>
        <Ico name={d.open ? 'up' : 'down'} size={16} color={C.muted} />
      </Pressable>
      {d.open ? items.map((u) => (
        <View key={u.itemId} style={styles.item}>
          <Text style={[txt.sm, { fontWeight: '700' }]}>{u.name}<Text style={[txt.xs, { fontWeight: '400' }]}> · {kindName(u.kind)}{u.ref ? ` · ${u.ref}` : ''}</Text></Text>
          <Text style={txt.xs}>{u.opened ? (u.kind === 'source' ? t('sources.used.played') : t('sources.used.opened')) : t('sources.used.notOpened')}{u.by ? ` · ${props.ctx.name(u.by)}` : ''}</Text>
          {u.copyright ? <Text style={txt.xs}>{u.copyright}</Text> : null}
        </View>
      )) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderRadius: radius.lg, backgroundColor: C.card, borderWidth: StyleSheet.hairlineWidth, borderColor: C.border, overflow: 'hidden' },
  line: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, paddingVertical: space.sm },
  item: { paddingHorizontal: space.md, paddingVertical: space.sm, gap: 2, borderTopWidth: StyleSheet.hairlineWidth, borderColor: C.border }
});
