// Back translation in the recording workspace (demo SIMPLE-11, ADR-036;
// the agreed "bt" screen): the same split as recording, with only the
// version being back-translated on top, cut into the parts it was recorded
// in. The top is the big player of the part being worked on (Back 10 s, a
// timeline to drag back and forth, Note at a moment); the bottom a card per
// part, said ones green, the next one lit. The footer is the part's name,
// the big red record button and Publish. Playing pauses the microphone and
// recording picks up again when it stops (listen, speak, listen, LAN-23).
//
// The parts are kept on this device until Publish (decision 30): each
// recorded piece goes to a local draft with the moment in the version its
// part starts (`atMs`), and Publish puts them in one core produceContent,
// in part order. Publishing returns to the passage record with
// `published=bt:<time>`, where the next check is asked (demo ADR-034).
import { commands, DEFAULT_KINDS, type EventSpec, type KindDef, type Version } from '@langquest-next/core';
import * as Crypto from 'expo-crypto';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { AudioClip } from '../audioClip';
import { ClipPlayer } from '../clipPlayer';
import { localKind } from '../coreText';
import type { Ctx } from '../ctx';
import { screenTitle } from '../flow';
import { useHelpPress } from '../helpContext';
import { currentLocale, t } from '../i18n';
import { formatClock, formatNumber } from '../i18n/format';
import { indexesFor } from '../indexes';
import { Banner, Field, Header, Ico, IconBtn, PrimaryBtn, Screen, Sheet, txt, useLayout } from '../kit';
import { passageCrumbs, type PassageView } from '../passageView';
import { useBackTranslationDraft } from '../recording/backTranslationDraft';
import { backParts, nextPart, noteText, partAfter, pieceFor, piecesInOrder, saidLine, sourceParts, type BackPart, type MomentNote } from '../recording/backTranslationParts';
import { SaveProblem } from '../recording/parts';
import { SplitPane } from '../recording/SplitPane';
import { MIN_BOTTOM, MIN_BOTTOM_RECORDING } from '../recording/splitModel';
import { useListenLoop } from '../recording/useListenLoop';
import { VadControls, VadPanel } from '../recording/VadTakeover';
import { backTranslationDraftKey, cardDurations, unsavedParts } from '../recording/workspaceModel';
import { failureMessage, reportError } from '../report';
import { RequestBanner } from '../reviewing/parts';
import { lift } from '../shadow';
import { C, radius, space, target, TINT, type as T, withAlpha } from '../theme';
import { useRecorder, type RecordedCard } from '../useRecorder';
import { VoiceNote } from '../voiceNote';

export function BackTranslationBody({ ctx, v, kind, of }: { ctx: Ctx; v: PassageView; kind: KindDef; of: Version }) {
  const { state, unitId, languageId, p } = v;
  const produces = kind.produces!;
  const shipped = shippedBackTranslation(kind);
  const me = ctx.session.actorId;
  const checkedBy = produces.checkedBy ? v.kind(produces.checkedBy).name : undefined;
  // A wide window names the passage in the crumbs above the title.
  const wide = useLayout().kind !== 'phone';
  const drafts = useBackTranslationDraft(backTranslationDraftKey({ languageId, actorId: me, unitId, kindId: kind.id }), of.takeId);
  const unsaved = useMemo(() => unsavedParts(state, drafts.draft), [state, drafts.draft]);
  const durations = useMemo(() => cardDurations(state, unitId), [state, unitId]);
  const source = useMemo(() => sourceParts(of.cardHashes, (h) => durations.get(h)), [of.cardHashes, durations]);
  const parts = useMemo(() => backParts(source, unsaved), [source, unsaved]);
  const madeFrom = drafts.draft && unsaved.length > 0 && drafts.draft.fromTakeId !== of.takeId
    ? p.versions.find((x) => x.takeId === drafts.draft!.fromTakeId) : undefined;
  const requestId = ctx.params['requestId'];
  const request = (requestId ? p.requests.find((r) => r.id === requestId) : undefined)
    ?? p.openRequests.find((r) => r.what === 'review' && r.kindId === kind.id && r.profileId === me);

  // The part being worked on: the next one to say, until the person picks another.
  const [picked, setPicked] = useState<number | null>(null);
  const focus = Math.min(picked ?? nextPart(parts), Math.max(0, parts.length - 1));
  const part = parts[focus];
  const focusRef = useRef(focus);
  focusRef.current = focus;
  const sourceRef = useRef(source);
  sourceRef.current = source;

  // Each piece lands in the draft already saying which part it is about.
  const add = drafts.add;
  const persist = useCallback(async (card: RecordedCard) => {
    const at = sourceRef.current[focusRef.current];
    const piece = { hash: card.ref.hash, durationMs: card.durationMs, format: card.ref.format };
    await add(at ? pieceFor(at, piece) : piece);
  }, [add]);
  const rec = useRecorder(persist);
  const loop = useListenLoop(rec);
  const session = loop.phase !== 'off';
  const recording = session || rec.manualOn;
  const [working, setWorking] = useState(false);
  const blocked = recording || rec.busy || working || !drafts.loaded || !!drafts.problem;

  // When a part has been said and recording stops, the next part to say lights up.
  const saidFor = useRef<number | null>(null);
  useEffect(() => {
    if (session) { saidFor.current = focusRef.current; return; }
    if (saidFor.current === null || rec.busy) return;
    const was = saidFor.current;
    if (parts[was]?.cards.length) { saidFor.current = null; setPicked(partAfter(parts, was)); }
  }, [session, rec.busy, parts]);

  async function clearPart(target: BackPart) {
    if (blocked || target.cards.length === 0) return;
    setWorking(true);
    try {
      for (const c of target.cards) await drafts.remove(c.hash);
      setPicked(target.index);
      ctx.toast(t('backTranslation.partDeleted', { n: target.index + 1 }), async () => {
        try { for (const c of target.cards) await drafts.add(c); } catch (e) { ctx.toast(t('backTranslation.notRestored', { reason: failureMessage('back translation: restore part', e) })); }
      });
    } catch (e) {
      ctx.toast(t('backTranslation.notDeleted', { reason: failureMessage('back translation: delete part', e) }));
    } finally { setWorking(false); }
  }

  // ---- notes at moments, and publishing ----
  const [notes, setNotes] = useState<MomentNote[]>([]);
  const [noteHash, setNoteHash] = useState<string | null>(null);
  const [noteAt, setNoteAt] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const pieces = piecesInOrder(parts);
  async function publish(extra: string) {
    const note = noteText(notes, extra);
    let specs: EventSpec[];
    try {
      specs = commands(state, indexesFor(state)).produceContent({
        commandId: Crypto.randomUUID(), fromTakeId: of.takeId, kindId: kind.id, cards: pieces,
        ...(note ? { note } : {}), ...(noteHash ? { noteBlobHash: noteHash } : {}), ...(request ? { requestId: request.id } : {})
      });
    } catch (e) {
      ctx.toast(t('backTranslation.notPublished', { reason: failureMessage('back translation: save', e) }));
      return;
    }
    setSaving(true);
    try {
      await ctx.act(specs, shipped ? t('backTranslation.published') : t('backTranslation.whatPublished', { what: capitalize(produces.what) }));
    } catch {
      setSaving(false); // ctx.act said what went wrong
      return;
    }
    // On the record now; a draft left behind is harmless (saved parts are never offered again).
    await drafts.clear().catch((e: unknown) => { reportError('back translation: clear draft', e); });
    setSaving(false);
    setConfirming(false);
    // Publish, then ask (demo ADR-034): the record opens with the next check (usually the consultant) ready.
    ctx.go('passage_record', { unitId, languageId, published: `bt:${Date.now()}` });
  }

  const problem = drafts.problem ? <SaveProblem message={drafts.problem} />
    : rec.failureCount > 0 ? <SaveProblem message={rec.error || t('backTranslation.partNotSaved')} retryLabel={t('backTranslation.retrySaving')} busy={rec.busy} onRetry={() => void rec.retryFailed()} />
    : rec.error ? <SaveProblem message={rec.error} /> : null;
  const mine = of.by === me;
  const who = ctx.name(of.by).split(' ')[0] ?? ctx.name(of.by);
  const partN = part ? part.index + 1 : null;
  const partLabel = partN ? t('backTranslation.part', { n: partN }) : '';
  const playerTitle = partN ? t('backTranslation.barTitle', { language: v.language, n: of.n, part: partN }) : t('backTranslation.barTitleNoPart', { language: v.language, n: of.n });

  return (
    <Screen fixed
      header={wide
        ? <Header title={shipped ? t('backTranslation.title') : capitalize(produces.what)} sub={t('backTranslation.fromInto', { from: v.language, into: produces.into })}
          crumbs={passageCrumbs(ctx, v, screenTitle('back_translation'))} onBack={ctx.back} close />
        : <Header title={v.title} sub={shipped ? t('backTranslation.subInto', { into: produces.into }) : t('backTranslation.whatInto', { what: capitalize(produces.what), into: produces.into })}
          onBack={ctx.back} close />}
      footer={session ? <VadControls rec={rec} onStop={() => void loop.toggle()} /> : (
        <View style={styles.footer}>
          <Text style={[txt.sm, styles.footLabel]} numberOfLines={2}>{partLabel}</Text>
          <BigRecord disabled={blocked || rec.failureCount > 0 || !part} part={partN} onPress={() => void loop.toggle()} />
          <View style={styles.footSide}>
            <PublishBtn disabled={pieces.length === 0 || blocked || rec.failureCount > 0} onPress={() => setConfirming(true)} />
          </View>
        </View>
      )}>
      <SplitPane memoryKey="back_translation" minBottom={session ? MIN_BOTTOM_RECORDING : MIN_BOTTOM}
        topStyle={styles.topPane} bottomStyle={styles.bottomPane}
        top={({ compact, open }) => compact ? (
          <Pressable onPress={open} accessibilityRole="button" style={({ pressed }) => [styles.bar, pressed && { opacity: 0.7 }]}
            accessibilityLabel={partN ? t('backTranslation.openPart', { language: v.language, n: of.n, part: partN }) : t('backTranslation.openVersion', { language: v.language, n: of.n })}>
            <Ico name="listen" size={18} color={C.primary} />
            <Text style={[txt.sm, { flex: 1, fontWeight: '700' }]} numberOfLines={1}>{playerTitle}</Text>
            <Text style={[txt.xsStrong, { color: C.primary }]}>{t('backTranslation.open')}</Text>
          </Pressable>
        ) : (
          <ScrollView contentContainerStyle={styles.paneBody}
            accessibilityLabel={partN ? t('backTranslation.listenToPart', { n: of.n, part: partN }) : t('backTranslation.listenTo', { n: of.n })}>
            {request && (request.note || request.noteBlobHash) ? <RequestBanner ctx={ctx} request={request} /> : null}
            {madeFrom ? (
              <Banner icon="history" tone="amber" title={t('backTranslation.madeFrom', { n: madeFrom.n })}
                body={t('backTranslation.madeFromBody', { n: of.n, what: produces.what })} />
            ) : null}
            {part ? (
              <ClipPlayer language={ctx.language} hashes={[part.hash]} listen={loop.hooks}
                title={playerTitle}
                sub={mine ? t('backTranslation.youDrag') : t('backTranslation.nameDrag', { name: who })}
                onNote={(s) => setNoteAt(Math.round(s * 1000))} />
            ) : null}
            <Text style={[txt.xs, { paddingHorizontal: space.xs }]}>
              {t('backTranslation.sayEachPart', { into: produces.into })}
            </Text>
          </ScrollView>
        )}
        bottom={({ compact, open }) => session ? <VadPanel rec={rec} phase={loop.phase} count={part?.cards.length ?? 0} noun="piece" onResume={loop.resumeNow} /> : compact ? (
          <Pressable onPress={open} accessibilityRole="button" accessibilityLabel={t('backTranslation.openYour', { what: produces.what })} style={({ pressed }) => [styles.bar, pressed && { opacity: 0.7 }]}>
            <Ico name="mic" size={18} color={C.primary} />
            <Text style={[txt.sm, { flex: 1, fontWeight: '700' }]}>{partLabel} · {saidLine(parts)}</Text>
            <Text style={[txt.xsStrong, { color: C.primary }]}>{t('backTranslation.open')}</Text>
          </Pressable>
        ) : (
          <ScrollView contentContainerStyle={styles.paneBody} accessibilityLabel={t('backTranslation.yourWhat', { what: produces.what, said: saidLine(parts) })}>
            {problem}
            {!drafts.loaded ? <Text style={[txt.smMuted, { textAlign: 'center' }]}>{t('backTranslation.loadingParts')}</Text> : parts.map((x) => (
              <PartCard key={x.index} ctx={ctx} part={x} into={produces.into} focused={x.index === focus} disabled={blocked}
                onPick={() => setPicked(x.index)} onDelete={() => void clearPart(x)} />
            ))}
            {notes.length ? (
              <Text style={[txt.xs, { textAlign: 'center' }]}>
                {checkedBy ? t('backTranslation.notesFor', { count: notes.length, check: checkedBy }) : t('backTranslation.notesForNext', { count: notes.length })}
              </Text>
            ) : null}
          </ScrollView>
        )} />

      {noteAt !== null && part ? (
        <MomentSheet ctx={ctx} part={part.index} atMs={noteAt} hash={noteHash} onHash={setNoteHash} checkedBy={checkedBy}
          onClose={() => setNoteAt(null)}
          onSave={(text) => {
            // i18n-ignore: stored in the event log with the back translation's note (noteText)
            setNotes((n) => [...n, { part: part.index, atMs: noteAt, text: text || 'said in the voice note' }]);
            setNoteAt(null);
          }} />
      ) : null}
      {confirming ? (
        <PublishSheet ctx={ctx} what={produces.what} of={of} checkedBy={checkedBy} parts={parts} notes={notes} busy={saving}
          hash={noteHash} onHash={setNoteHash} onClose={() => setConfirming(false)} onPublish={(extra) => void publish(extra)} />
      ) : null}
    </Screen>
  );
}

/** A part's card: said (green check, how long in English), the one being said (lit), or still to come. */
function PartCard(props: { ctx: Ctx; part: BackPart; into: string; focused: boolean; disabled: boolean; onPick: () => void; onDelete: () => void }) {
  const { part, focused } = props;
  const said = part.cards.length > 0;
  const n = part.index + 1;
  const label = t('backTranslation.part', { n });
  const length = formatClock(part.saidMs);
  const sub = focused ? (said ? t('backTranslation.saidInMore', { length, into: props.into }) : t('backTranslation.sayingNext'))
    : said ? t('backTranslation.saidIn', { length, into: props.into }) : '';
  const press = useHelpPress(label, said ? t('backTranslation.partSaidHelp') : t('backTranslation.partTapHelp'), props.onPick);
  return (
    <View style={[styles.part, focused && styles.partNow]}>
      <Pressable onPress={press} disabled={props.disabled} accessibilityRole="button" accessibilityState={{ selected: focused }}
        accessibilityLabel={sub ? t('backTranslation.partA11y', { part: label, sub }) : label} style={({ pressed }) => [styles.partHead, pressed && { opacity: 0.7 }]}>
        <View style={[styles.partMark, said ? { backgroundColor: C.green } : focused ? { backgroundColor: C.primary } : { backgroundColor: C.light }]}>
          <Ico name={said ? 'check' : 'mic'} size={said ? 20 : 18} color={said || focused ? C.white : withAlpha(C.primary, 0.35)} strokeWidth={said ? 3 : 2.2} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.partTitle}>{label}</Text>
          {sub ? <Text style={[txt.sm, { color: C.muted }]}>{sub}</Text> : null}
        </View>
      </Pressable>
      {focused && said ? (
        <View style={styles.partActions}>
          <AudioClip language={props.ctx.language} hashes={part.cards.map((c) => c.hash)} label={t('backTranslation.playYourPart', { n })} disabled={props.disabled} />
          <Text style={[txt.sm, { flex: 1 }]}>{t('backTranslation.hearWhatYouSaid')}</Text>
          <IconBtn name="trash" label={t('backTranslation.deletePart', { n })} bg="transparent" color={C.muted} disabled={props.disabled} onPress={props.onDelete} />
        </View>
      ) : null}
    </View>
  );
}

/** The big red record button with its halo, sized for the footer. */
/** `part` is the part's number (from 1), or null when there is no part to say. */
function BigRecord(props: { disabled: boolean; part: number | null; onPress: () => void }) {
  const n = props.part;
  const press = useHelpPress(t('common.record'), n ? t('backTranslation.recordHelp', { n }) : undefined, props.onPress);
  return (
    <View style={[styles.halo, props.disabled && { opacity: 0.45 }]}>
      <Pressable onPress={press} disabled={props.disabled} accessibilityRole="button" accessibilityLabel={n ? t('backTranslation.recordPart', { n }) : t('common.record')}
        accessibilityHint={t('backTranslation.recordHint')} accessibilityState={{ disabled: props.disabled }}
        style={({ pressed }) => [styles.record, pressed && { transform: [{ scale: 0.95 }] }]}>
        <Ico name="mic" size={34} color={C.white} />
      </Pressable>
    </View>
  );
}

function PublishBtn(props: { disabled: boolean; onPress: () => void }) {
  const press = useHelpPress(t('common.publish'), t('backTranslation.publishHelp'), props.onPress);
  return (
    <Pressable onPress={press} disabled={props.disabled} accessibilityRole="button" accessibilityLabel={t('common.publish')} accessibilityState={{ disabled: props.disabled }}
      style={({ pressed }) => [styles.publish, props.disabled && { opacity: 0.45 }, pressed && { opacity: 0.7 }]}>
      <Text style={styles.publishLabel}>{t('common.publish')}</Text>
    </Pressable>
  );
}

/** A note at a moment of a part, for whoever checks the back translation. */
function MomentSheet(props: {
  ctx: Ctx; part: number; atMs: number; hash: string | null; checkedBy: string | undefined;
  onHash: (h: string | null) => void; onClose: () => void; onSave: (text: string) => void;
}) {
  const [text, setText] = useState('');
  return (
    <Sheet visible title={t('backTranslation.noteAtPart', { time: formatClock(props.atMs), part: props.part + 1 })}
      sub={props.checkedBy ? t('backTranslation.noteSub', { check: props.checkedBy }) : t('backTranslation.noteSubNext')} onClose={props.onClose}
      footer={<PrimaryBtn label={t('backTranslation.addNote')} disabled={!text.trim() && !props.hash} onPress={() => props.onSave(text.trim())} />}>
      <VoiceNote ctx={props.ctx} label={t('common.sayIt')} hash={props.hash} onChange={(h) => props.onHash(h)} />
      <Field value={text} onChangeText={setText} placeholder={t('backTranslation.typeNoMatch')} multiline />
    </Sheet>
  );
}

/** Publishing is a real step, so it confirms (ADR-028): what is said, what is missing, and a last word. */
function PublishSheet(props: {
  ctx: Ctx; what: string; of: Version; checkedBy: string | undefined; parts: BackPart[]; notes: MomentNote[]; busy: boolean;
  hash: string | null; onHash: (h: string | null) => void; onClose: () => void; onPublish: (extra: string) => void;
}) {
  const [text, setText] = useState('');
  const missing = props.parts.filter((x) => x.cards.length === 0).map((x) => x.index + 1);
  return (
    <Sheet visible title={t('backTranslation.publishThe', { what: props.what })}
      sub={props.checkedBy ? t('backTranslation.publishSubCheck', { n: props.of.n, check: props.checkedBy }) : t('backTranslation.publishSub', { n: props.of.n })}
      onClose={props.onClose}
      footer={<PrimaryBtn label={t('backTranslation.publishWhat', { what: props.what })} icon="send" busy={props.busy} onPress={() => props.onPublish(text)} />}>
      <View style={styles.checks}>
        <Text style={txt.sm}>✓ {saidLine(props.parts)}</Text>
        {missing.length ? (
          <Text style={[txt.sm, { color: TINT.amberText }]}>{t('backTranslation.nothingYet', { count: missing.length, parts: missing.map((n) => formatNumber(n)).join(', ') })}</Text>
        ) : null}
        {props.notes.length ? <Text style={txt.sm}>✓ {t('backTranslation.notesAtMoments', { count: props.notes.length })}</Text> : null}
      </View>
      <Text style={[txt.sm, { fontWeight: '700' }]}>{t('backTranslation.hardToSayBack')} <Text style={[txt.sm, { color: C.muted, fontWeight: '400' }]}>{t('backTranslation.optional')}</Text></Text>
      <VoiceNote ctx={props.ctx} label={t('common.sayIt')} hash={props.hash} onChange={(h) => props.onHash(h)} />
      <Field value={text} onChangeText={setText} placeholder={t('backTranslation.typeNoMatch')} multiline />
    </Sheet>
  );
}

/**
 * Whether this is the shipped back translation in its shipped words (in the
 * language showing): its heading and toast are then whole catalog strings.
 */
function shippedBackTranslation(kind: KindDef): boolean {
  if (kind.id !== 'bt') return false;
  const shipped = DEFAULT_KINDS.find((k) => k.id === 'bt');
  return !!shipped && localKind(shipped).produces?.what === kind.produces?.what;
}

/** An organization's own word for what its kind makes (library content), as a heading: its first letter capitalised. */
function capitalize(s: string): string {
  return s ? s.charAt(0).toLocaleUpperCase(currentLocale()) + s.slice(1) : s;
}

const styles = StyleSheet.create({
  topPane: { backgroundColor: C.bg },
  bottomPane: { backgroundColor: C.card },
  paneBody: { padding: space.lg, gap: space.sm + 2 },
  bar: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.lg, minHeight: 48 },
  part: { borderRadius: radius.lg, borderWidth: 1, borderColor: C.border, backgroundColor: C.card, overflow: 'hidden' },
  partNow: { borderWidth: 2, borderColor: C.primary },
  partHead: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: target.primary, paddingHorizontal: space.md, paddingVertical: space.sm },
  partMark: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  partTitle: { fontSize: T.base + 1, fontWeight: '800', color: C.dark },
  partActions: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.md, paddingBottom: space.sm, borderTopWidth: StyleSheet.hairlineWidth, borderColor: C.border, paddingTop: space.sm },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.lg },
  footLabel: { flex: 1, textAlign: 'right', color: C.muted },
  footSide: { flex: 1, alignItems: 'flex-start' },
  halo: { width: 96, height: 96, borderRadius: 48, backgroundColor: withAlpha(C.red, 0.12), alignItems: 'center', justifyContent: 'center' },
  record: { width: 76, height: 76, borderRadius: 38, backgroundColor: C.red, alignItems: 'center', justifyContent: 'center', ...lift({ color: C.red, opacity: 0.35, radius: 12, y: 6, elevation: 4 }) },
  publish: { minWidth: 96, minHeight: target.primary, paddingHorizontal: space.lg, borderRadius: radius.lg, borderWidth: 1, borderColor: C.border, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center' },
  publishLabel: { fontSize: T.base, fontWeight: '800', color: C.primary },
  checks: { backgroundColor: C.light, borderRadius: radius.lg, paddingHorizontal: space.lg, paddingVertical: space.md, gap: space.xs }
});
