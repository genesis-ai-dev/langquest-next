// The passage record's Versions page (decisions.md 83): everything recorded
// for the passage, to work on freely. A person's drafts first, each one to
// hear, edit, publish or delete (with Undo); then the published versions,
// newest first, each to hear, open, or edit into a new draft (a published
// version never changes), and the latest one asked for its next check. The
// published ones are deleted by whoever published them (LAN-83). Deleting
// a draft or a version asks first (ConfirmDelete). The footer starts a new
// version from nothing. The record's history follows.
import { canDeleteVersion, commands, draftsBy, partsMedium, writtenText, type DraftView, type Version } from '@langquest-next/core';
import { deleteVersion } from './deleteVersion';
import { ConfirmDelete } from '../ui/ConfirmDelete';
import * as Crypto from 'expo-crypto';
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { Ctx } from '../shell/ctx';
import type { ScreenId } from '../shell/flow';
import { t } from '../i18n';
import { indexesFor } from '../sync/indexes';
import { Badge, Header, IconBtn, Ico, PrimaryBtn, Screen, SectionLabel, SmallBtn } from '../ui/kit';
import { txt } from '../ui/textStyles';
import { versionTitle, when, type PassageView } from './passageView';
import { failureMessage } from '../diagnostics/report';
import { cardDurations, sameCards } from '../recording/workspaceModel';
import { mmss, totalMs } from '../recording/model';
import { useClip } from '../audio/useClip';
import { Text } from '../ui/text';
import { useHelpSpot } from '../helpMode/useHelpMode';
import { HelpBadge, HelpRow } from '../helpMode/helpBadge';
import { C, radius, space, target, TINT } from '../ui/theme';
import { versionReviewsSummary } from './record';
import { draftName, startedFrom } from './versionsModel';
import { useVersesHeld } from './useVerses';

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
  const versesHeld = useVersesHeld(ctx, state, unitId);
  // "2 parts · 0:17", and the verses they hold when they have any: "2 parts · 0:17 · Verses 1–2". Written: "3 verses written" (decisions.md 141).
  const length = (hashes: readonly string[]) => partsMedium(hashes) === 'writing' ? t('writing.publishSub', { count: hashes.length })
    : [t('recording.parts.groupSub', { count: hashes.length, length: mmss(totalMs(hashes.map((h) => durations.get(h)))) }), versesHeld(hashes)].filter(Boolean).join(' · ');
  const saved = (hlc: string) => {
    const w = when(hlc);
    return w === t('time.justNow') ? t('passage.versions.savedJustNow') : t('passage.versions.saved', { when: w });
  };

  // What is being deleted, once its bin is tapped: the sheet asks first.
  const [asking, setAsking] = useState<{ name: string; sub: string; go: () => void } | null>(null);
  const remove = (d: DraftView, name: string) => {
    let specs;
    try {
      specs = commands(state, indexesFor(state)).deleteDraft({ commandId: Crypto.randomUUID(), unitId, takeId: d.takeId, actorId: me });
    } catch (e) {
      ctx.toast(t('passage.versions.notDeleted', { reason: failureMessage('versions: delete draft', e) }));
      return;
    }
    void ctx.act(specs, t('passage.versions.deleted', { name })).catch(() => { /* ctx.act said what went wrong */ });
  };

  return (
    <Screen header={<Header title={t('passage.versions.title')} sub={v.title} onBack={props.onBack} close />}
      footer={props.canRecord ? <PrimaryBtn label={t('passage.versions.newVersion')} icon="plus" help={t('passage.versions.newVersionHelp')} onPress={() => props.go('workspace', { fresh: '1' })} /> : undefined}>
      {mine.length > 0 ? <SectionLabel label={mine.length > 1 ? t('passage.versions.yourDrafts') : t('passage.versions.yourDraft')} /> : null}
      {mine.map((d) => {
        const name = draftName(mine, d.rootTakeId);
        const from = startedFrom(p.versions, d.basedOnTakeId);
        const unchanged = !!p.latest && sameCards(d.cardHashes, p.latest.cardHashes);
        return (
          <HelpRow key={d.takeId} of="versions.draft">
            <ItemCard ctx={ctx} hashes={d.cardHashes} title={name}
              lines={[from && from !== p.latest?.n ? t('passage.versions.lengthFrom', { length: length(d.cardHashes), version: versionTitle(from) }) : length(d.cardHashes), saved(d.hlc)]}
              trailing={<IconBtn name="trash" label={t('passage.versions.delete', { name })} help={t('passage.versions.deleteHelp')} bg="transparent" color={C.muted} size={44}
                onPress={() => setAsking({ name, sub: length(d.cardHashes), go: () => remove(d, name) })} />}>
              {props.canRecord ? <SmallBtn label={t('common.edit')} icon="edit" help={t('passage.versions.editDraftHelp')} onPress={() => props.go('workspace', { draftId: d.rootTakeId })} /> : null}
              {props.canRecord ? (
                <SmallBtn label={t('common.done')} icon="send" tone="primary" disabled={unchanged} help={t('passage.versions.doneHelp')}
                  onPress={() => props.go('workspace', { draftId: d.rootTakeId, publish: '1' })} />
              ) : null}
            </ItemCard>
          </HelpRow>
        );
      })}
      {p.versions.length > 0 ? <SectionLabel label={t('passage.versions.published')} /> : null}
      {[...p.versions].reverse().map((ver) => (
        <HelpRow key={ver.takeId} of="versions.version">
          <VersionCard ctx={ctx} v={v} ver={ver} latest={ver.takeId === p.latest?.takeId} length={length(ver.cardHashes)}
            canRecord={props.canRecord} {...(ver.takeId === p.latest?.takeId && props.ask ? { ask: props.ask } : {})}
            {...(props.canRecord && canDeleteVersion(p, ver.takeId, me) ? { onDelete: () => setAsking({ name: versionTitle(ver.n), sub: length(ver.cardHashes), go: () => deleteVersion(ctx, v, ver) }) } : {})}
            onOpen={() => props.go('version_detail', { takeId: ver.takeId })} onEdit={() => props.go('workspace', ver.medium === 'writing' ? { write: '1' } : { from: ver.takeId })} />
        </HelpRow>
      ))}
      {props.history}
      <ConfirmDelete visible={!!asking} name={asking?.name ?? ''} {...(asking?.sub ? { sub: asking.sub } : {})}
        onClose={() => setAsking(null)} onConfirm={() => { const go = asking?.go; setAsking(null); go?.(); }} />
    </Screen>
  );
}

function VersionCard(props: {
  ctx: Ctx; v: PassageView; ver: Version; latest: boolean; length: string; canRecord: boolean;
  ask?: { label: string; onPress: () => void }; onOpen: () => void; onEdit: () => void; onDelete?: () => void;
}) {
  const { ctx, v, ver } = props;
  const reviews = v.p.reviews.filter((r) => r.versionN === ver.n);
  const title = versionTitle(ver.n);
  return (
    <ItemCard ctx={ctx} hashes={ver.cardHashes} title={title} onOpen={props.onOpen} badge={props.latest ? t('passage.versions.latest') : undefined}
      lines={[`${ctx.name(ver.by)} · ${when(ver.hlc)}`, props.length, ...(reviews.length ? [versionReviewsSummary(reviews, v.kinds)] : [])]}
      trailing={<Ico name="right" size={22} color={C.muted} />}>
      {props.canRecord ? <SmallBtn label={t('common.edit')} icon="edit" help={t('passage.versions.editVersionHelp')} onPress={props.onEdit} /> : null}
      {props.ask ? <SmallBtn label={props.ask.label} icon="send" tone="primary" help={t('passage.page.mainHelp.ask')} onPress={props.ask.onPress} /> : null}
      {props.onDelete ? (
        <View style={{ marginLeft: 'auto' }}>
          <IconBtn name="trash" label={t('passage.versions.delete', { name: title })} help={t('passage.versions.deleteVersionHelp')} bg="transparent" color={C.muted} size={44} onPress={props.onDelete} />
        </View>
      ) : null}
    </ItemCard>
  );
}

/** One draft or version: play it, its name and what it holds, then its buttons. */
function ItemCard(props: {
  ctx: Ctx; hashes: string[]; title: string; lines: string[]; badge?: string | undefined; trailing?: ReactNode;
  onOpen?: () => void; children?: ReactNode;
}) {
  const written = partsMedium(props.hashes) === 'writing';
  const clip = useClip(props.ctx.language, written ? [] : props.hashes);
  // A written version shows its first words, and a pen where a recording has play (decision 141).
  const words = written ? props.hashes.map((h) => writtenText(props.ctx.language.state!, h) ?? '').join(' ').trim() : '';
  const playLabel = clip.playing ? t('recording.recorder.pausePart', { part: props.title }) : t('recording.player.playTitle', { title: props.title });
  const play = useHelpSpot(playLabel, undefined, clip.toggle);
  const openLabel = t('passage.versions.open', { title: props.title });
  const open = useHelpSpot(openLabel, t('passage.page.openVersionHelp'), props.onOpen);
  const body = (
    <>
      <View style={styles.titleRow}>
        <Text style={[styles.title, { flexShrink: 1 }]}>{props.title}</Text>
        {props.badge ? <Badge label={props.badge} tone="brand" /> : null}
      </View>
      {/* The team's own words, shortened in the list; they show in full where the version opens (decision 139). */}
      {words ? <Text style={txt.sm} numberOfLines={2}>{words}</Text> : null}
      {props.lines.map((l, i) => <Text key={i} style={txt.smMuted}>{l}</Text>)}
    </>
  );
  return (
    <View style={styles.card}>
      <View style={styles.head}>
        {written ? (
          <View style={[styles.play, { backgroundColor: TINT.green }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <Ico name="edit" size={20} color={TINT.greenText} />
          </View>
        ) : (
          <Pressable onPress={play.onPress} disabled={!clip.available} accessibilityRole="button" accessibilityLabel={playLabel}
            style={({ pressed }) => [styles.play, !clip.available && { opacity: 0.4 }, pressed && { opacity: 0.7 }]}>
            <Ico name={clip.playing ? 'pause' : 'play'} size={20} color={C.primary} strokeWidth={2.6} fill={C.primary} />
            <HelpBadge spot={play} />
          </Pressable>
        )}
        {props.onOpen ? (
          <Pressable onPress={open.onPress} accessibilityRole="button" accessibilityLabel={openLabel}
            style={({ pressed }) => [{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center' }, pressed && { opacity: 0.7 }]}>
            <View style={{ flex: 1, minWidth: 0 }}>{body}</View>
            {props.trailing}
            <HelpBadge spot={open} />
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
  titleRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm },
  title: { fontSize: 18, fontWeight: '800', color: C.dark, flexShrink: 1 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, paddingLeft: target.min + space.md }
});
