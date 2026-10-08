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
import { commands, type EventSpec, type KindDef, type Version } from '@langquest-next/core';
import * as Crypto from 'expo-crypto';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { AudioClip } from '../audioClip';
import { ClipPlayer } from '../clipPlayer';
import type { Ctx } from '../ctx';
import { TITLES } from '../flow';
import { useHelpPress } from '../helpContext';
import { indexesFor } from '../indexes';
import { Banner, Field, Header, Ico, IconBtn, PrimaryBtn, Screen, Sheet, txt, useLayout } from '../kit';
import { passageCrumbs, versionTitle, type PassageView } from '../passageView';
import { useBackTranslationDraft } from '../recording/backTranslationDraft';
import { backParts, nextPart, noteText, partAfter, pieceFor, piecesInOrder, saidLine, sourceParts, type BackPart, type MomentNote } from '../recording/backTranslationParts';
import { problemText, SaveProblem } from '../recording/parts';
import { SplitPane } from '../recording/SplitPane';
import { MIN_BOTTOM, MIN_BOTTOM_RECORDING } from '../recording/splitModel';
import { useListenLoop } from '../recording/useListenLoop';
import { VadControls, VadPanel } from '../recording/VadTakeover';
import { backTranslationDraftKey, cardDurations, mmss, unsavedParts } from '../recording/workspaceModel';
import { reportError } from '../report';
import { RequestBanner } from '../reviewing/parts';
import { lift } from '../shadow';
import { C, radius, space, target, TINT, type as T, withAlpha } from '../theme';
import { useRecorder, type RecordedCard } from '../useRecorder';
import { VoiceNote } from '../voiceNote';

export function BackTranslationBody({ ctx, v, kind, of }: { ctx: Ctx; v: PassageView; kind: KindDef; of: Version }) {
  const { state, unitId, languageId, p } = v;
  const produces = kind.produces!;
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
      ctx.toast(`Part ${target.index + 1} deleted.`, async () => {
        try { for (const c of target.cards) await drafts.add(c); } catch (e) { ctx.toast(`Not restored: ${problemText('back translation: restore part', e)}`); }
      });
    } catch (e) {
      ctx.toast(`Not deleted: ${problemText('back translation: delete part', e)}`);
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
      ctx.toast(`Not published: ${problemText('back translation: save', e)}`);
      return;
    }
    setSaving(true);
    try {
      await ctx.act(specs, `${capitalize(produces.what)} published.`);
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
    : rec.failureCount > 0 ? <SaveProblem message={rec.error || 'A part did not save.'} retryLabel="Retry saving" busy={rec.busy} onRetry={() => void rec.retryFailed()} />
    : rec.error ? <SaveProblem message={rec.error} /> : null;
  const who = of.by === me ? 'You' : ctx.name(of.by).split(' ')[0] ?? ctx.name(of.by);
  const partLabel = part ? `Part ${part.index + 1}` : '';

  return (
    <Screen fixed
      header={wide
        ? <Header title={capitalize(produces.what)} sub={`${v.language} → ${produces.into}`} crumbs={passageCrumbs(ctx, v, TITLES.back_translation)} onBack={ctx.back} close />
        : <Header title={v.title} sub={`${capitalize(produces.what)} · into ${produces.into}`} onBack={ctx.back} close />}
      footer={session ? <VadControls rec={rec} onStop={() => void loop.toggle()} /> : (
        <View style={styles.footer}>
          <Text style={[txt.sm, styles.footLabel]} numberOfLines={2}>{partLabel}</Text>
          <BigRecord disabled={blocked || rec.failureCount > 0 || !part} label={partLabel} onPress={() => void loop.toggle()} />
          <View style={styles.footSide}>
            <PublishBtn disabled={pieces.length === 0 || blocked || rec.failureCount > 0} onPress={() => setConfirming(true)} />
          </View>
        </View>
      )}>
      <SplitPane memoryKey="back_translation" minBottom={session ? MIN_BOTTOM_RECORDING : MIN_BOTTOM}
        topStyle={styles.topPane} bottomStyle={styles.bottomPane}
        top={({ compact, open }) => compact ? (
          <Pressable onPress={open} accessibilityRole="button" accessibilityLabel={`Open ${v.language} ${versionTitle(of.n)}, ${partLabel}`} style={({ pressed }) => [styles.bar, pressed && { opacity: 0.7 }]}>
            <Ico name="listen" size={18} color={C.primary} />
            <Text style={[txt.sm, { flex: 1, fontWeight: '700' }]} numberOfLines={1}>{v.language} · {versionTitle(of.n)} · {partLabel.toLowerCase()}</Text>
            <Text style={[txt.xsStrong, { color: C.primary }]}>Open</Text>
          </Pressable>
        ) : (
          <ScrollView contentContainerStyle={styles.paneBody} accessibilityLabel={`Listen to ${versionTitle(of.n)}, ${partLabel}`}>
            {request && (request.note || request.noteBlobHash) ? <RequestBanner ctx={ctx} request={request} /> : null}
            {madeFrom ? (
              <Banner icon="history" tone="amber" title={`Your parts were made from ${versionTitle(madeFrom.n)}`}
                body={`${versionTitle(of.n)} is out now, and publishing puts your ${produces.what} with it. Listen again and redo any part that changed.`} />
            ) : null}
            {part ? (
              <ClipPlayer language={ctx.language} hashes={[part.hash]} listen={loop.hooks}
                title={`${v.language} · ${versionTitle(of.n)} · ${partLabel.toLowerCase()}`}
                sub={`${who} · drag back and forth as often as you like`}
                onNote={(s) => setNoteAt(Math.round(s * 1000))} />
            ) : null}
            <Text style={[txt.xs, { paddingHorizontal: space.xs }]}>
              Say each part in {produces.into}, in your own words. Notes and earlier checks are hidden on purpose, so only the recording shapes what you say.
            </Text>
          </ScrollView>
        )}
        bottom={({ compact, open }) => session ? <VadPanel rec={rec} phase={loop.phase} count={part?.cards.length ?? 0} noun="piece" onResume={loop.resumeNow} /> : compact ? (
          <Pressable onPress={open} accessibilityRole="button" accessibilityLabel={`Open your ${produces.what}`} style={({ pressed }) => [styles.bar, pressed && { opacity: 0.7 }]}>
            <Ico name="mic" size={18} color={C.primary} />
            <Text style={[txt.sm, { flex: 1, fontWeight: '700' }]}>{partLabel} · {saidLine(parts)}</Text>
            <Text style={[txt.xsStrong, { color: C.primary }]}>Open</Text>
          </Pressable>
        ) : (
          <ScrollView contentContainerStyle={styles.paneBody} accessibilityLabel={`Your ${produces.what}, ${saidLine(parts)}`}>
            {problem}
            {!drafts.loaded ? <Text style={[txt.smMuted, { textAlign: 'center' }]}>Loading your parts…</Text> : parts.map((x) => (
              <PartCard key={x.index} ctx={ctx} part={x} into={produces.into} focused={x.index === focus} disabled={blocked}
                onPick={() => setPicked(x.index)} onDelete={() => void clearPart(x)} />
            ))}
            {notes.length ? (
              <Text style={[txt.xs, { textAlign: 'center' }]}>{notes.length} note{notes.length === 1 ? '' : 's'} for the {checkedBy ?? 'next check'} · they go with it when you publish</Text>
            ) : null}
          </ScrollView>
        )} />

      {noteAt !== null && part ? (
        <MomentSheet ctx={ctx} part={part.index} atMs={noteAt} hash={noteHash} onHash={setNoteHash} checkedBy={checkedBy}
          onClose={() => setNoteAt(null)}
          onSave={(text) => { setNotes((n) => [...n, { part: part.index, atMs: noteAt, text: text || 'said in the voice note' }]); setNoteAt(null); }} />
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
  const label = `Part ${part.index + 1}`;
  const sub = focused ? (said ? `${mmss(part.saidMs)} in ${props.into} · record to add more` : 'Saying it next') : said ? `${mmss(part.saidMs)} in ${props.into}` : '';
  const press = useHelpPress(label, said ? 'Said. Tap to hear the part again or redo it.' : 'Tap to work on this part.', props.onPick);
  return (
    <View style={[styles.part, focused && styles.partNow]}>
      <Pressable onPress={press} disabled={props.disabled} accessibilityRole="button" accessibilityState={{ selected: focused }}
        accessibilityLabel={`${label}${sub ? `, ${sub}` : ''}`} style={({ pressed }) => [styles.partHead, pressed && { opacity: 0.7 }]}>
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
          <AudioClip language={props.ctx.language} hashes={part.cards.map((c) => c.hash)} label={`Play your ${label.toLowerCase()}`} disabled={props.disabled} />
          <Text style={[txt.sm, { flex: 1 }]}>Hear what you said</Text>
          <IconBtn name="trash" label={`Delete ${label.toLowerCase()} to say it again`} bg="transparent" color={C.muted} disabled={props.disabled} onPress={props.onDelete} />
        </View>
      ) : null}
    </View>
  );
}

/** The big red record button with its halo, sized for the footer. */
function BigRecord(props: { disabled: boolean; label: string; onPress: () => void }) {
  const press = useHelpPress('Record', `Say ${props.label.toLowerCase()} in your own words. Pause between thoughts; tap stop when you finish.`, props.onPress);
  return (
    <View style={[styles.halo, props.disabled && { opacity: 0.45 }]}>
      <Pressable onPress={press} disabled={props.disabled} accessibilityRole="button" accessibilityLabel={`Record ${props.label.toLowerCase()}`}
        accessibilityHint="Speak, pausing between parts. Tap stop when you finish." accessibilityState={{ disabled: props.disabled }}
        style={({ pressed }) => [styles.record, pressed && { transform: [{ scale: 0.95 }] }]}>
        <Ico name="mic" size={34} color={C.white} />
      </Pressable>
    </View>
  );
}

function PublishBtn(props: { disabled: boolean; onPress: () => void }) {
  const press = useHelpPress('Publish', 'Saves the back translation for the team, then asks for the next check.', props.onPress);
  return (
    <Pressable onPress={press} disabled={props.disabled} accessibilityRole="button" accessibilityLabel="Publish" accessibilityState={{ disabled: props.disabled }}
      style={({ pressed }) => [styles.publish, props.disabled && { opacity: 0.45 }, pressed && { opacity: 0.7 }]}>
      <Text style={styles.publishLabel}>Publish</Text>
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
    <Sheet visible title={`A note at ${mmss(props.atMs)} in part ${props.part + 1}`}
      sub={`What was hard to say here? The ${props.checkedBy ?? 'next check'} hears it with your back translation.`} onClose={props.onClose}
      footer={<PrimaryBtn label="Add note" disabled={!text.trim() && !props.hash} onPress={() => props.onSave(text.trim())} />}>
      <VoiceNote ctx={props.ctx} label="Say it" hash={props.hash} onChange={(h) => props.onHash(h)} />
      <Field value={text} onChangeText={setText} placeholder="Or type it — e.g. a word with no English match" multiline />
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
    <Sheet visible title={`Publish the ${props.what}?`}
      sub={`Of ${versionTitle(props.of.n)}. ${props.checkedBy ? `The ${props.checkedBy} listens to it next.` : 'It goes on the passage record.'}`}
      onClose={props.onClose}
      footer={<PrimaryBtn label={`Publish ${props.what}`} icon="send" busy={props.busy} onPress={() => props.onPublish(text)} />}>
      <View style={styles.checks}>
        <Text style={txt.sm}>✓ {saidLine(props.parts)}</Text>
        {missing.length ? <Text style={[txt.sm, { color: TINT.amberText }]}>Nothing yet for part {missing.join(', ')}</Text> : null}
        {props.notes.length ? <Text style={txt.sm}>✓ {props.notes.length} note{props.notes.length === 1 ? '' : 's'} at moments</Text> : null}
      </View>
      <Text style={[txt.sm, { fontWeight: '700' }]}>Anything that was hard to say back? <Text style={[txt.sm, { color: C.muted, fontWeight: '400' }]}>Optional</Text></Text>
      <VoiceNote ctx={props.ctx} label="Say it" hash={props.hash} onChange={(h) => props.onHash(h)} />
      <Field value={text} onChangeText={setText} placeholder="Or type it — e.g. a word with no English match" multiline />
    </Sheet>
  );
}

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
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
