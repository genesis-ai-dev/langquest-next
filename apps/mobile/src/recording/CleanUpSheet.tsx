// Clean up's sheet (decision 177; Caleb's mockups 17 to 19, 2026-10-28):
// the parts it is offered for, cleaned on this phone while the sheet is
// open, each heard as recorded and cleaned, with a slider for how much
// noise to take out (Less to More), and one pick per part. One part: the
// part as recorded and the cleaned sound one above the other, each with
// Use or Not used. Several: the slider on top, and each part's
// Original or Cleaned. The button keeps the picks; Undo takes them back.
import type { CleanUpChoice } from '@langquest-next/core';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { PanResponder, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../ui/text';
import type { Ctx } from '../shell/ctx';
import { HelpBadge, HelpRow } from '../helpMode/helpBadge';
import { useHelpSpot } from '../helpMode/useHelpMode';
import { t } from '../i18n';
import { failureMessage } from '../diagnostics/report';
import { HelpInfo, Ico, PrimaryBtn, ProgressBar, Sheet, type IconName } from '../ui/kit';
import { txt } from '../ui/textStyles';
import { C, radius, space, target, type as T } from '../ui/theme';
import { useBars } from '../audio/useBars';
import { useClip } from '../audio/useClip';
import { mmss } from './model';
import { PartBars } from './partBars';
import { buttonLabel, limitAt, snapPlace, toneBars, type CleanUpPick } from './cleanUpModel';
import { useCleanUp, type CleanStatus, type CleanUp } from './useCleanUp';

export interface CleanUpPart { hash: string; label: string; durationMs?: number }

export function CleanUpSheet(props: {
  ctx: Ctx; open: boolean; parts: CleanUpPart[];
  /** How many of the card's parts were cleaned before, so are not here. */
  before: number;
  onClose: () => void;
  /** Keep the picks; true once they are kept. */
  onUse: (choices: CleanUpChoice[], limitDb: number | null) => Promise<boolean>;
}) {
  const { ctx, parts } = props;
  const hashes = useMemo(() => (props.open ? parts.map((p) => p.hash) : null), [props.open, parts]);
  const work = useCleanUp(ctx.language, hashes);
  const [picks, setPicks] = useState<Record<string, CleanUpPick>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // A part that could not be cleaned stays as recorded.
  const pickOf = (hash: string): CleanUpPick => (work.status[hash]?.at === 'failed' ? 'original' : picks[hash] ?? 'cleaned');
  const pick = (hash: string, to: CleanUpPick) => setPicks((was) => ({ ...was, [hash]: to }));
  const chosen = parts.map((p) => pickOf(p.hash));
  const waiting = parts.some((p, i) => chosen[i] === 'cleaned' && work.status[p.hash]?.at !== 'ready');
  const close = () => { if (busy) return; setPicks({}); setError(''); props.onClose(); };

  async function use() {
    if (busy || waiting) return;
    setBusy(true);
    setError('');
    try {
      const files = await work.keep(parts.filter((_, i) => chosen[i] === 'cleaned').map((p) => p.hash));
      const choices: CleanUpChoice[] = parts.map((p, i) => {
        const file = files.get(p.hash);
        return chosen[i] === 'cleaned' && file ? { hash: p.hash, use: 'cleaned', cleaned: file } : { hash: p.hash, use: 'original' };
      });
      if (await props.onUse(choices, work.limitDb)) { setPicks({}); props.onClose(); }
    } catch (e) {
      setError(t('common.notSaved', { reason: failureMessage('clean up: keep', e) }));
    } finally { setBusy(false); }
  }

  const one = parts.length === 1 ? parts[0]! : null;
  const sub = !one && props.before > 0 ? t('recording.cleanUp.cleanedBefore', { count: props.before }) : t('recording.cleanUp.removesNoise');
  return (
    <Sheet visible={props.open} title={one ? t('recording.cleanUp.titleOne', { part: one.label }) : t('recording.cleanUp.titleMany', { count: parts.length })} sub={sub} onClose={close}
      footer={<>
        {error ? <Text style={txt.error}>{error}</Text> : null}
        <PrimaryBtn label={buttonLabel(chosen)} help={t('recording.cleanUp.useHelp')} disabled={waiting || parts.length === 0} busy={busy} onPress={() => void use()} />
      </>}>
      {one ? (
        <OnePart ctx={ctx} part={one} work={work} pick={chosen[0]!} onPick={(to) => pick(one.hash, to)} />
      ) : (
        <>
          <NoiseSlider work={work} />
          {parts.map((p, i) => (
            <HelpRow key={p.hash} of="recording.cleanUp.part"><PartPick ctx={ctx} part={p} work={work} pick={chosen[i]!} onPick={(to) => pick(p.hash, to)} /></HelpRow>
          ))}
        </>
      )}
    </Sheet>
  );
}

/** One part: the part as recorded and the cleaned sound, one above the other, each with Use or Not used. */
function OnePart(props: { ctx: Ctx; part: CleanUpPart; work: CleanUp; pick: CleanUpPick; onPick: (to: CleanUpPick) => void }) {
  const { part, work } = props;
  const status = work.status[part.hash] ?? { at: 'waiting' };
  const sums = status.at === 'ready' ? status.sums : null;
  const plain = useBars(props.ctx.language, part.hash);
  const original = sums ? toneBars(sums) : null;
  const cleaned = sums ? toneBars(sums, limitAt(work.place)) : null;
  return (
    <>
      <SoundCard ctx={props.ctx} title={t('recording.cleanUp.original')} icon="mic" hash={part.hash} picked={props.pick === 'original'} onPick={() => props.onPick('original')}
        bars={<PartBars bars={original?.bars ?? plain} progress={null} {...(original ? { voice: original.voice } : {})} />} />
      <SoundCard ctx={props.ctx} title={t('recording.cleanUp.cleaned')} icon="sparkle" uri={work.preview[part.hash]} picked={props.pick === 'cleaned'} onPick={() => props.onPick('cleaned')}
        off={status.at !== 'ready'}
        bars={cleaned ? <PartBars bars={cleaned.bars} voice={cleaned.voice} progress={null} /> : <Cleaning status={status} label={part.label} />}>
        <NoiseSlider work={work} />
      </SoundCard>
    </>
  );
}

/** A sound to hear and pick: play, its name, Use or Not used, and its bars. */
function SoundCard(props: { ctx: Ctx; title: string; icon: IconName; hash?: string; uri?: string | undefined; picked: boolean; onPick: () => void; off?: boolean;
  bars: ReactNode; children?: ReactNode }) {
  const pickLabel = props.picked ? t('recording.cleanUp.use') : t('recording.cleanUp.notUsed');
  const pick = useHelpSpot(t('recording.cleanUp.pickLabel', { sound: props.title, state: pickLabel }), t('recording.cleanUp.pickHelp'), props.off ? undefined : props.onPick);
  return (
    <View style={[styles.card, props.picked && styles.cardPicked]}>
      <View style={styles.cardHead}>
        <PlayDot ctx={props.ctx} title={props.title} {...(props.hash ? { hash: props.hash } : {})} {...(props.uri ? { uri: props.uri } : {})} />
        <Ico name={props.icon} size={18} color={C.dark} />
        <Text style={[styles.name, { flex: 1 }]} numberOfLines={1}>{props.title}</Text>
        <Pressable onPress={pick.onPress} disabled={props.off && !pick.id} accessibilityRole="radio" accessibilityState={{ checked: props.picked, disabled: !!props.off }}
          accessibilityLabel={t('recording.cleanUp.pickLabel', { sound: props.title, state: pickLabel })} style={({ pressed }) => [styles.tagTap, pressed && styles.pressed]}>
          <View style={[styles.tag, props.picked ? styles.tagOn : styles.tagOff, props.off && styles.off]}>
            {props.picked ? <Ico name="check" size={14} color={C.white} strokeWidth={3} /> : null}
            <Text style={[styles.tagText, props.picked && { color: C.white }]}>{pickLabel}</Text>
          </View>
          <HelpBadge spot={pick} />
        </Pressable>
      </View>
      {props.bars}
      {props.children}
    </View>
  );
}

/** Several parts: each part's sound as picked, to hear, and Original or Cleaned. */
function PartPick(props: { ctx: Ctx; part: CleanUpPart; work: CleanUp; pick: CleanUpPick; onPick: (to: CleanUpPick) => void }) {
  const { part, work } = props;
  const status = work.status[part.hash] ?? { at: 'waiting' };
  const sums = status.at === 'ready' ? status.sums : null;
  const plain = useBars(props.ctx.language, part.hash);
  const tones = sums ? (props.pick === 'cleaned' ? toneBars(sums, limitAt(work.place)) : toneBars(sums)) : null;
  const cleanedOff = status.at !== 'ready';
  const mix = work.preview[part.hash];
  return (
    <View style={styles.partPick}>
      <View style={styles.cardHead}>
        <PlayDot ctx={props.ctx} title={part.label} {...(props.pick === 'cleaned' ? (mix ? { uri: mix } : {}) : { hash: part.hash })} />
        <Text style={styles.name}>{part.label}</Text>
        <Text style={styles.length}>{mmss(part.durationMs)}</Text>
        {tones ? <PartBars bars={tones.bars} voice={tones.voice} progress={null} />
          : status.at === 'cleaning' || status.at === 'waiting' ? <View style={{ flex: 1 }}><Cleaning status={status} label={part.label} /></View>
          : <PartBars bars={plain} progress={null} />}
      </View>
      {status.at === 'failed' ? <Text style={txt.error}>{status.error}</Text> : null}
      <View style={styles.segments} accessibilityRole="radiogroup">
        <Segment label={t('recording.cleanUp.original')} part={part.label} on={props.pick === 'original'} onPress={() => props.onPick('original')} />
        <Segment label={t('recording.cleanUp.cleaned')} part={part.label} on={props.pick === 'cleaned'} off={cleanedOff} onPress={() => props.onPick('cleaned')} />
      </View>
    </View>
  );
}

function Segment(props: { label: string; part: string; on: boolean; off?: boolean; onPress: () => void }) {
  const label = t('recording.cleanUp.segmentLabel', { part: props.part, sound: props.label });
  const spot = useHelpSpot(label, t('recording.cleanUp.pickHelp'), props.off ? undefined : props.onPress);
  return (
    <Pressable onPress={spot.onPress} disabled={props.off && !spot.id} accessibilityRole="radio" accessibilityState={{ checked: props.on, disabled: !!props.off }} accessibilityLabel={label}
      style={({ pressed }) => [styles.segment, props.on && styles.segmentOn, props.off && styles.off, pressed && styles.pressed]}>
      {props.on ? <Ico name="check" size={16} color={C.white} strokeWidth={3} /> : null}
      <Text style={[styles.segmentText, props.on && { color: C.white }]} numberOfLines={1}>{props.label}</Text>
      <HelpBadge spot={spot} />
    </Pressable>
  );
}

/** While a part is being cleaned: how far along, in place of its bars; or why it could not be. */
function Cleaning(props: { status: CleanStatus; label: string }) {
  if (props.status.at === 'failed') return <Text style={txt.error}>{props.status.error}</Text>;
  const done = props.status.at === 'cleaning' ? props.status.done : 0;
  return (
    <View style={styles.cleaning} accessible accessibilityLabel={t('recording.cleanUp.cleaning', { part: props.label })} accessibilityValue={{ min: 0, max: 100, now: Math.round(done * 100) }}>
      <ProgressBar value={done * 100} />
    </View>
  );
}

/** Play or pause one sound: a part as recorded by its file, or a mix by `uri`. */
function PlayDot(props: { ctx: Ctx; title: string; hash?: string; uri?: string }) {
  const clip = useClip(props.ctx.language, props.hash ? [props.hash] : [], props.uri ? { uri: props.uri } : undefined);
  const label = clip.playing ? t('recording.recorder.pausePart', { part: props.title }) : t('recording.player.playTitle', { title: props.title });
  const spot = useHelpSpot(label, t('recording.cleanUp.playHelp'), clip.toggle);
  return (
    <Pressable onPress={spot.onPress} disabled={!clip.available && !spot.id} accessibilityRole="button" accessibilityLabel={label}
      style={({ pressed }) => [styles.playTap, !clip.available && styles.off, pressed && styles.pressed]}>
      <View style={styles.playDot}><Ico name={clip.playing ? 'pause' : 'play'} size={16} color={C.primary} strokeWidth={2.6} fill={C.primary} /></View>
      <HelpBadge spot={spot} />
    </Pressable>
  );
}

/** How much noise to take out: Less to More, dragged or tapped; a screen reader steps it a sixth at a time. */
function NoiseSlider(props: { work: CleanUp }) {
  const { work } = props;
  const width = useRef(0);
  const from = useRef(0);
  const latest = useRef(work);
  latest.current = work;
  const at = (x: number) => (width.current > THUMB ? snapPlace((x - THUMB / 2) / (width.current - THUMB)) : latest.current.place);
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (e) => { from.current = e.nativeEvent.locationX; latest.current.setPlace(at(from.current), false); },
    onPanResponderMove: (_e, g) => latest.current.setPlace(at(from.current + g.dx), false),
    onPanResponderRelease: (_e, g) => latest.current.setPlace(at(from.current + g.dx), true),
    onPanResponderTerminate: (_e, g) => latest.current.setPlace(at(from.current + g.dx), true)
  }), []);
  const step = (by: number) => work.setPlace(Math.min(1, Math.max(0, work.place + by)), true);
  const label = t('recording.cleanUp.howMuch');
  return (
    <HelpInfo label={label} detail={t('recording.cleanUp.howMuchHelp')}>
      <View style={styles.slider}>
        <Text style={styles.end}>{t('recording.cleanUp.less')}</Text>
        <View style={styles.track} onLayout={(e) => { width.current = e.nativeEvent.layout.width; }} {...responder.panHandlers}
          accessible accessibilityRole="adjustable" accessibilityLabel={label} accessibilityValue={{ min: 0, max: 100, now: Math.round(work.place * 100) }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={(e) => step(e.nativeEvent.actionName === 'increment' ? 1 / 6 : -1 / 6)}>
          <View pointerEvents="none" style={styles.rail}>
            <View style={[styles.railOn, { width: `${work.place * 100}%` }]} />
          </View>
          <View pointerEvents="none" style={[styles.thumb, { left: `${work.place * 100}%`, marginLeft: -work.place * THUMB }]} />
        </View>
        <Text style={styles.end}>{t('recording.cleanUp.more')}</Text>
      </View>
    </HelpInfo>
  );
}

const THUMB = 28;

const styles = StyleSheet.create({
  card: { gap: space.sm, padding: space.md, borderRadius: radius.lg, borderWidth: 1, borderColor: C.border, backgroundColor: C.card },
  cardPicked: { borderWidth: 2, borderColor: C.primary, backgroundColor: C.light },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: target.min },
  name: { fontSize: T.base, fontWeight: '800', color: C.dark },
  length: { fontSize: T.sm, color: C.muted, fontVariant: ['tabular-nums'] },
  tagTap: { minHeight: target.min, justifyContent: 'center' },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: space.md, paddingVertical: 6, borderRadius: radius.full },
  tagOn: { backgroundColor: C.primary },
  tagOff: { backgroundColor: C.bg },
  tagText: { fontSize: T.sm, fontWeight: '700', color: C.muted },
  partPick: { gap: space.xs, paddingBottom: space.md, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: C.border },
  segments: { flexDirection: 'row', gap: space.xs, padding: space.xs, borderRadius: radius.md, backgroundColor: C.bg },
  segment: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xs, minHeight: target.min, borderRadius: radius.sm },
  segmentOn: { backgroundColor: C.primary },
  segmentText: { fontSize: T.base, fontWeight: '700', color: C.muted },
  cleaning: { flex: 1, minHeight: 26, justifyContent: 'center' },
  playTap: { minWidth: target.min, minHeight: target.min, alignItems: 'center', justifyContent: 'center' },
  playDot: { width: 36, height: 36, borderRadius: 18, backgroundColor: C.light, alignItems: 'center', justifyContent: 'center' },
  slider: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  end: { fontSize: T.sm, color: C.muted },
  track: { flex: 1, height: target.min, justifyContent: 'center' },
  rail: { height: 6, borderRadius: 3, backgroundColor: C.border, overflow: 'hidden', marginHorizontal: THUMB / 2 },
  railOn: { height: 6, backgroundColor: C.primary },
  thumb: { position: 'absolute', width: THUMB, height: THUMB, borderRadius: THUMB / 2, borderWidth: 3, borderColor: C.primary, backgroundColor: C.card },
  off: { opacity: 0.4 },
  pressed: { opacity: 0.7 }
});
