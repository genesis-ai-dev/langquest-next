// The passage record's Versions page (decisions.md 82): everything recorded
// for the passage, to work on freely. A person's drafts first, each one to
// hear, edit, publish or delete (with Undo); then the published versions,
// newest first, each to hear, open, or edit into a new draft (a published
// version never changes), and the latest one asked for its next check. The
// footer starts a new version from nothing. The record's history follows.
import { commands, draftsBy, type DraftView, type Version } from '@langquest-next/core';
import * as Crypto from 'expo-crypto';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Ctx } from '../ctx';
import type { ScreenId } from '../flow';
import { indexesFor } from '../indexes';
import { Badge, Header, IconBtn, Ico, PrimaryBtn, Screen, SectionLabel, SmallBtn, txt } from '../kit';
import { plural, versionTitle, when, type PassageView } from '../passageView';
import { problemText } from '../recording/parts';
import { cardDurations, sameCards } from '../recording/workspaceModel';
import { mmss, totalMs } from '../simple/model';
import { useClip } from '../simple/useClip';
import { C, radius, space, target } from '../theme';
import { versionReviewsSummary } from './record';
import { draftName, startedFrom } from './versionsModel';

export function VersionsPage(props: {
  ctx: Ctx; v: PassageView; canRecord: boolean;
  /** Asking for the latest version's next check, when it is this person's to ask. */
  ask?: { label: string; onPress: () => void };
  go: (to: ScreenId, extra?: Record<string, string>) => void;
  onBack: () => void;
  /** The study, reviews by version and the history, under the versions. */
  history: ReactNode;
}) {
  const { ctx, v } = props;
  const { p, state, unitId } = v;
  const me = ctx.session.actorId;
  const mine = draftsBy(p, me);
  const durations = cardDurations(state, unitId);
  const length = (hashes: readonly string[]) => `${plural(hashes.length, 'part')} · ${mmss(totalMs(hashes.map((h) => durations.get(h))))}`;

  const remove = (d: DraftView, name: string) => {
    let specs;
    try {
      specs = commands(state, indexesFor(state)).deleteDraft({ commandId: Crypto.randomUUID(), unitId, takeId: d.takeId, actorId: me });
    } catch (e) {
      ctx.toast(`Not deleted: ${problemText('versions: delete draft', e)}`);
      return;
    }
    // Undo continues the deleted take with the same parts, so it is the same draft again.
    void ctx.act(specs, `${name} deleted.`, () => {
      const s = ctx.language.state ?? state;
      return commands(s, indexesFor(s)).keepTake({ commandId: Crypto.randomUUID(), unitId, cardHashes: d.cardHashes, actorId: me, parentTakeId: d.takeId });
    }).catch(() => { /* ctx.act said what went wrong */ });
  };

  return (
    <Screen header={<Header title="Versions" sub={v.title} onBack={props.onBack} close />}
      footer={props.canRecord ? <PrimaryBtn label="New version" icon="plus" onPress={() => props.go('workspace', { fresh: '1' })} /> : undefined}>
      {mine.length > 0 ? <SectionLabel label={mine.length > 1 ? 'Your drafts' : 'Your draft'} /> : null}
      {mine.map((d) => {
        const name = draftName(mine, d.rootTakeId);
        const from = startedFrom(p.versions, d.basedOnTakeId);
        const unchanged = !!p.latest && sameCards(d.cardHashes, p.latest.cardHashes);
        return (
          <ItemCard key={d.takeId} ctx={ctx} hashes={d.cardHashes} title={name}
            lines={[length(d.cardHashes) + (from && from !== p.latest?.n ? ` · from ${versionTitle(from)}` : ''), `Saved ${when(d.hlc).replace('Just now', 'just now')}`]}
            trailing={<IconBtn name="trash" label={`Delete ${name}`} bg="transparent" color={C.muted} size={44} onPress={() => remove(d, name)} />}>
            {props.canRecord ? <SmallBtn label="Edit" icon="edit" onPress={() => props.go('workspace', { draftId: d.rootTakeId })} /> : null}
            {props.canRecord ? (
              <SmallBtn label="Publish" icon="send" tone="primary" disabled={unchanged}
                onPress={() => props.go('workspace', { draftId: d.rootTakeId, publish: '1' })} />
            ) : null}
          </ItemCard>
        );
      })}
      {mine.length === 0 && props.canRecord ? (
        <Text style={[txt.smMuted, { textAlign: 'center' }]}>No drafts. Edit a version below, or start a new one.</Text>
      ) : null}
      {p.versions.length > 0 ? <SectionLabel label="Published" /> : null}
      {[...p.versions].reverse().map((ver) => (
        <VersionCard key={ver.takeId} ctx={ctx} v={v} ver={ver} latest={ver.takeId === p.latest?.takeId} length={length(ver.cardHashes)}
          canRecord={props.canRecord} {...(ver.takeId === p.latest?.takeId && props.ask ? { ask: props.ask } : {})}
          onOpen={() => props.go('version_detail', { takeId: ver.takeId })} onEdit={() => props.go('workspace', { from: ver.takeId })} />
      ))}
      {props.history}
    </Screen>
  );
}

function VersionCard(props: {
  ctx: Ctx; v: PassageView; ver: Version; latest: boolean; length: string; canRecord: boolean;
  ask?: { label: string; onPress: () => void }; onOpen: () => void; onEdit: () => void;
}) {
  const { ctx, v, ver } = props;
  const reviews = v.p.reviews.filter((r) => r.versionN === ver.n);
  const title = versionTitle(ver.n);
  return (
    <ItemCard ctx={ctx} hashes={ver.cardHashes} title={title} onOpen={props.onOpen} badge={props.latest ? 'Latest' : undefined}
      lines={[`${ctx.name(ver.by)} · ${when(ver.hlc)}`, props.length, ...(reviews.length ? [versionReviewsSummary(reviews, v.kinds)] : [])]}
      trailing={<Ico name="right" size={22} color={C.muted} />}>
      {props.canRecord ? <SmallBtn label="Edit" icon="edit" onPress={props.onEdit} /> : null}
      {props.ask ? <SmallBtn label={props.ask.label} icon="send" tone="primary" onPress={props.ask.onPress} /> : null}
    </ItemCard>
  );
}

/** One draft or version: play it, its name and what it holds, then its buttons. */
function ItemCard(props: {
  ctx: Ctx; hashes: string[]; title: string; lines: string[]; badge?: string | undefined; trailing?: ReactNode;
  onOpen?: () => void; children?: ReactNode;
}) {
  const clip = useClip(props.ctx.language, props.hashes);
  const body = (
    <>
      <View style={styles.titleRow}>
        <Text style={styles.title} numberOfLines={1}>{props.title}</Text>
        {props.badge ? <Badge label={props.badge} tone="brand" /> : null}
      </View>
      {props.lines.map((l, i) => <Text key={i} style={txt.smMuted} numberOfLines={2}>{l}</Text>)}
    </>
  );
  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Pressable onPress={clip.toggle} disabled={!clip.available} accessibilityRole="button" accessibilityLabel={`${clip.playing ? 'Pause' : 'Play'} ${props.title}`}
          style={({ pressed }) => [styles.play, !clip.available && { opacity: 0.4 }, pressed && { opacity: 0.7 }]}>
          <Ico name={clip.playing ? 'pause' : 'play'} size={20} color={C.primary} strokeWidth={2.6} fill={C.primary} />
        </Pressable>
        {props.onOpen ? (
          <Pressable onPress={props.onOpen} accessibilityRole="button" accessibilityLabel={`Open ${props.title}`}
            style={({ pressed }) => [{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center' }, pressed && { opacity: 0.7 }]}>
            <View style={{ flex: 1, minWidth: 0 }}>{body}</View>
            {props.trailing}
          </Pressable>
        ) : (
          <>
            <View style={{ flex: 1, minWidth: 0 }}>{body}</View>
            {props.trailing}
          </>
        )}
      </View>
      {props.children ? <View style={styles.actions}>{props.children}</View> : null}
      {clip.error ? <Text style={txt.error}>{clip.error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: C.card, borderRadius: radius.lg, borderWidth: 1, borderColor: C.border, padding: space.md, gap: space.sm },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  play: { width: target.min, height: target.min, borderRadius: target.min / 2, backgroundColor: C.light, alignItems: 'center', justifyContent: 'center' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  title: { fontSize: 18, fontWeight: '800', color: C.dark, flexShrink: 1 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, paddingLeft: target.min + space.md }
});
