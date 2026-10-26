// What waits on this device to upload and what went up, by passage (decisions.md
// 166): the bar over every screen while anything waits, and the top of the Sync
// screen with its "Waiting to upload" and "Uploaded" lists. The words count
// recordings and changes, never the event names a sync speaks in.
import { unitTitle } from '@langquest-next/core';
import type { SentEntry } from '@langquest-next/sync';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../ui/text';
import type { Ctx } from '../shell/ctx';
import { Card, Group, Ico, Row, SectionLabel, ShowMore, type IconName } from '../ui/kit';
import { HelpBadge } from '../helpMode/helpBadge';
import { useHelpSpot } from '../helpMode/useHelpMode';
import { txt } from '../ui/textStyles';
import { t } from '../i18n';
import { formatDay, formatDayTime, formatTime } from '../i18n/format';
import { C, radius, space, TINT } from '../ui/theme';
import { PackageBoxes, TransitScene, WaveArrow } from './transit';
import { useSyncStatus } from './useSyncStatus';
import { useWaitingElsewhere } from './useWaitingElsewhere';
import { barState, dayKind, sentDays, waitingCounts, waitingRows, type WaitingCounts } from './uploadsModel';

/** How long "All uploaded" stays on the bar once the last thing went up. */
const DONE_SHOWN_MS = 4000;

/** "3 recordings waiting to upload", or the changes when no recording waits. */
function waitingWords(c: WaitingCounts): string {
  return c.recordings > 0 ? t('uploads.barRecordings', { count: c.recordings }) : t('uploads.barChanges', { count: c.changes });
}

/**
 * Over every screen while anything made on this device waits to upload: how
 * many, growing as people record, and whether it is going up or the device
 * is offline. "All uploaded" for a moment once the last of it went. Tapping
 * opens the Sync screen, as the tabs open theirs (chrome, decisions.md 166);
 * `onOpen` is null where leaving is not wanted (the recorder).
 */
export function UploadBar(props: { ctx: Ctx; onOpen: (() => void) | null }) {
  const status = useSyncStatus();
  const counts = waitingCounts(status, useWaitingElsewhere(props.ctx));
  const offline = props.ctx.language.online === false;
  // "Uploading" only while a file is going up this moment (decisions.md 166).
  const moving = !offline && status.uploading.size > 0;
  const total = counts.recordings + counts.changes;
  const [justEmptied, setJustEmptied] = useState(false);
  const was = useRef(total);
  useEffect(() => {
    const emptied = was.current > 0 && total === 0;
    was.current = total;
    if (total > 0) { setJustEmptied(false); return undefined; }
    if (!emptied) return undefined;
    setJustEmptied(true);
    const timer = setTimeout(() => setJustEmptied(false), DONE_SHOWN_MS);
    return () => clearTimeout(timer);
  }, [total]);
  const bar = barState(counts, offline, justEmptied);
  const label = !bar ? '' : bar.kind === 'done' ? t('uploads.allUploaded') : waitingWords(bar.counts);
  const state = bar?.kind === 'waiting' ? (bar.offline ? t('account.sync.standing.offline') : moving ? t('uploads.uploading') : '') : '';
  const spot = useHelpSpot(label, t('uploads.barHelp'), props.onOpen ?? undefined);
  if (!bar) return null;
  const tone = bar.kind === 'done' ? { bg: TINT.green, fg: TINT.greenText, icon: 'check' as IconName }
    : bar.offline ? { bg: TINT.amber, fg: TINT.amberText, icon: 'upload' as IconName } : { bg: C.light, fg: C.primary, icon: 'upload' as IconName };
  const body = (
    <>
      {/* Going up: the arrow wave; offline or done, a still mark. */}
      {bar.kind === 'waiting' && moving ? <View style={styles.wave}><WaveArrow direction="up" color={tone.fg} size={11} /></View> : <Ico name={tone.icon} size={20} color={tone.fg} />}
      <Text style={[txt.sm, { flex: 1, fontWeight: '700', color: tone.fg }]}>{label}</Text>
      {state ? <Text style={[txt.xsStrong, { color: tone.fg }]}>{state}</Text> : null}
      {props.onOpen ? <Ico name="right" size={18} color={tone.fg} /> : null}
    </>
  );
  const spoken = state ? `${label}, ${state}` : label;
  if (!props.onOpen) {
    return <View testID="upload-bar" style={[styles.bar, { backgroundColor: tone.bg }]} accessible accessibilityLabel={spoken}>{body}</View>;
  }
  return (
    <Pressable testID="upload-bar" onPress={spot.onPress} accessibilityRole="button" accessibilityLabel={spoken}
      style={({ pressed }) => [styles.bar, { backgroundColor: tone.bg }, pressed && { opacity: 0.7 }]}>
      {body}
      <HelpBadge spot={spot} />
    </Pressable>
  );
}

/**
 * The top of the Sync screen: recordings as packages between this device
 * and the cloud, with how many wait to go up and to come down (transit.tsx),
 * then everything uploaded and when it last went, or how much waits and
 * whether it is going up now.
 */
export function UploadsCard(props: { ctx: Ctx }) {
  const status = useSyncStatus();
  const counts = waitingCounts(status, useWaitingElsewhere(props.ctx));
  const offline = props.ctx.language.online === false;
  const movingUp = !offline && status.uploading.size > 0;
  const last = status.sent.reduce((m, e) => Math.max(m, e.at), 0);
  const waiting = counts.recordings + counts.changes > 0;
  const title = waiting ? waitingWords(counts) : t('uploads.allUploaded');
  const sub = waiting ? (movingUp ? t('uploads.uploading') : t('uploads.savedHere'))
    : last ? t('uploads.lastUpload', { when: dayKind(new Date(last).setHours(0, 0, 0, 0), Date.now()) === 'today' ? formatTime(last) : formatDayTime(last) }) : null;
  return (
    <Card>
      <TransitScene up={counts.recordings > 0 ? counts.recordings : counts.changes} down={status.pendingDown} offline={offline}
        movingUp={movingUp} movingDown={!offline && status.downloading.size > 0} />
      <View style={styles.head} accessible accessibilityLabel={[title, sub].filter(Boolean).join('. ')}>
        {waiting ? null : <View style={[styles.tile, { backgroundColor: TINT.green }]}><Ico name="check" size={22} color={TINT.greenText} /></View>}
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[txt.body, { fontWeight: '800' }]}>{title}</Text>
          {sub ? <Text style={txt.smMuted}>{sub}</Text> : null}
        </View>
      </View>
    </Card>
  );
}

/** "Waiting to upload": each passage with something waiting, "7 of 9 recordings uploaded", then changes about no passage. */
export function WaitingList(props: { ctx: Ctx; changes: readonly (string | null)[] }) {
  const { ctx } = props;
  const status = useSyncStatus();
  const elsewhere = useWaitingElsewhere(ctx);
  const state = ctx.language.state;
  const rows = waitingRows(status.uploads, props.changes, (id) => state?.units[id]?.order ?? id);
  if (rows.length === 0 && elsewhere.length === 0) return null;
  const languageId = ctx.language.languageId;
  return (
    <>
      <SectionLabel label={t('uploads.waitingTitle')} />
      <Group>
        {rows.map((r, i) => {
          const title = r.unitId && state?.units[r.unitId] ? unitTitle(state, r.unitId) : t('uploads.otherChanges');
          const uploaded = r.recordings ? r.recordings.of - r.recordings.waiting : 0;
          // Recording one part makes several changes; with its recordings waiting, they are what the passage is waiting on.
          const sub = r.recordings ? t('uploads.recordingsUploaded', { uploaded, count: r.recordings.of }) : t('uploads.changesWaiting', { count: r.changes });
          const open = r.unitId && languageId && state?.units[r.unitId] ? () => ctx.openPassage(r.unitId!, languageId) : undefined;
          return (
            <Row key={r.unitId ?? 'other'} testID={`waiting-${r.unitId ?? 'other'}`} icon="upload" iconColor={C.primary} label={title} sub={sub}
              help={t('account.sync.eventHelp')} last={i === rows.length - 1} {...(open ? { onPress: open } : {})}
              {...(r.recordings ? { below: <PackageBoxes uploaded={uploaded} total={r.recordings.of} offline={ctx.language.online === false} /> } : {})} />
          );
        })}
        {/* Other languages: what waits there goes when each is next open. */}
        {elsewhere.map((e, i) => (
          <Row key={e.languageId} testID={`waiting-language-${e.languageId}`} icon="globe" iconColor={C.primary} label={e.name}
            sub={waitingWords({ recordings: e.files, changes: e.changes })} last={i === elsewhere.length - 1} />
        ))}
      </Group>
    </>
  );
}

/** One line of "Uploaded": the passage, its time and what went. */
function sentWords(e: SentEntry): string {
  const what = e.files > 0 ? t('uploads.recordings', { count: e.files }) : t('uploads.changes', { count: e.changes });
  return `${formatTime(e.at)} · ${what}`;
}

const SENT_STEP = 15;

/** "Uploaded": what this device sent, by day, newest first, each with its time. */
export function SentList(props: { ctx: Ctx }) {
  const { ctx } = props;
  const status = useSyncStatus();
  const [limit, setLimit] = useState(SENT_STEP);
  if (status.sent.length === 0) return null;
  const state = ctx.language.state;
  const languageId = ctx.language.languageId;
  const now = Date.now();
  const days = sentDays(status.sent, limit);
  return (
    <>
      <SectionLabel label={t('uploads.uploadedTitle')} />
      {days.map((d) => {
        const kind = dayKind(d.start, now);
        return (
          <View key={d.start} style={{ gap: space.xs }}>
            <Text style={[txt.xsStrong, { color: C.muted, paddingHorizontal: space.xs }]}>
              {kind === 'today' ? t('time.today') : kind === 'yesterday' ? t('time.yesterday') : formatDay(d.start)}
            </Text>
            <Group>
              {d.entries.map((e, i) => {
                const known = e.unitId && state?.units[e.unitId];
                const open = known && languageId ? () => ctx.openPassage(e.unitId!, languageId) : undefined;
                return (
                  <Row key={`${e.unitId ?? 'other'}-${e.at}`} icon="check" iconColor={TINT.greenText} iconBg={TINT.green}
                    label={known ? unitTitle(state!, e.unitId!) : t('uploads.otherChanges')} sub={sentWords(e)}
                    help={t('account.sync.eventHelp')} last={i === d.entries.length - 1} {...(open ? { onPress: open } : {})} />
                );
              })}
            </Group>
          </View>
        );
      })}
      <ShowMore remaining={status.sent.length - limit} step={SENT_STEP} onMore={() => setLimit((n) => n + SENT_STEP)} />
    </>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 48, marginHorizontal: space.sm, marginTop: space.xs,
    paddingHorizontal: space.md, paddingVertical: space.xs, borderRadius: radius.md },
  wave: { width: 20, alignItems: 'center' },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  tile: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }
});
