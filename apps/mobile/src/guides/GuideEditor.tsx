// The guide editor (Write a guide; app-only screen `guide_editor`, reached
// from Reference Material and from a study guide's Edit or Copy to adapt).
// An organization writes study material with everything FIA's has: steps
// to check off, each with text and audio; callouts of each kind in the
// text; pictures, maps and films the text links to; glossary terms with
// audio. It publishes as a `study@2` library document (docs/library.md,
// docs/reference-material.md), read by the study screens like FIA's.
//
// Web first: on a wide window the steps sit beside the step being written,
// and the text beside its preview. On a phone it still works: edit the text
// and record step audio; pictures and films are added in the web app.
//
// Publishing uploads the draft's files to the organization's guide files,
// then useLibrary.publish appends 'v1.LibraryItemDefined' (a new guide) and
// 'v1.LibraryVersionPublished'; verses numbered in another organization's
// versification follow it first ('v1.LibrarySubscribed', 'v1.LibraryPinned').
// Drafts stay on the device (draftStore.ts), the writer's own, until Done
// publishes them; the saved mark in the header shows they are kept
// (decision 127). Undo and Redo beside it take back and put back every
// change, typing in one field joined into one step, kept with the draft
// until it is published; no toast offers Undo (decision 134).
import {
  CALLOUT_KINDS, LICENSES, isLicense, orgLicense, subscriptionItemId, unitPrefixOf, unitTitle,
  type CalloutKind, type MediaRef, type StudyDoc, type StudyDoc2, type VersificationDoc
} from '@langquest-next/core';
import { Bold, List, TextQuote, type LucideIcon } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Image, Pressable, StyleSheet, TextInput, View, type NativeSyntheticEvent, type TextInputSelectionChangeEventData } from 'react-native';
import { Text } from '../ui/text';
import { licenseText } from '../i18n/coreText';
import type { Ctx } from '../shell/ctx';
import { t } from '../i18n';
import { formatNumber } from '../i18n/format';
import { useHelpSpot } from '../helpMode/useHelpMode';
import { HelpBadge, HelpRow } from '../helpMode/helpBadge';
import { Badge, Banner, Card, Chip, ChipRow, EmptyState, Field, Group, Header, HelpInfo, Ico, IconBtn, LinkBtn, PrimaryBtn, Row, Screen, SearchField, SectionLabel, Sheet, SmallBtn } from '../ui/kit';
import { useHardwareBack } from '../ui/useHardwareBack';
import { txt } from '../ui/textStyles';
import { useLayout } from '../ui/useLayout';
import { useLibrary, useLibraryDocs, useSharedItems } from '../library/useLibrary';
import { LanguageField } from '../reference/LanguageField';
import { readerLanguage } from '../reference/languages';
import { failureMessage, reportError } from '../diagnostics/report';
import type { StudyGuide, StudyResource } from '../study/guides';
import { guideFromDoc, glossaryEntryOf } from '../study/guideMatch';
import { useStudyFileUri } from '../study/useStudyFileUri';
import { AudioBar, GlossarySheet, MediaSheet, StepPreview } from '../study/ui';
import { CALLOUT_LOOK, calloutLabel, mediaKindLabel, shownClock } from '../study/studyText';
import { useStudyAudio } from '../study/useStudyAudio';
import { C, measure, radius, space, target, TINT, type as T } from '../ui/theme';
import { SavedMark } from '../ui/SavedMark';
import { UndoRedo, type UndoRedoProps } from '../ui/undoRedo';
import { useUndoHistory } from '../drafts/useUndoHistory';
import { forgetUndoHistory } from '../drafts/undoHistory';
import { didEdit, redoStep, undoStep } from '../ui/undoModel';
import { useSaveStatus } from '../ui/useSaveStatus';
import type { SaveStatus } from '../ui/savedModel';
import { VoiceNote } from '../audio/voiceNote';
import {
  boldText, buildDoc, calloutText, draftFromDoc, draftProblems, draftReducer, linkText, listText, newDraft, nextId, untitledResource,
  type DraftAction, type DraftMedia, type DraftPanel, type DraftProblem, type DraftResource, type DraftStep, type DraftTerm, type GuideDraft, type Selection
} from './draft';
import { draftKey, dropDraft, guideHistoryKey, loadDraft, parseGuideHistory, saveDraft, unownedDraftKey } from './draftStore';
import { editKey } from './draft';
import { canPickFiles, FileProblem, keepPicked, mediaKindFor, pickFile, uploadDraftFiles, type PickKind } from './files';
import { BLANK_METHOD, FIA_METHOD, methodFromDoc, type Method } from './methods';

/** A change to the draft; `what` names it for a screen reader ("Step 3 removed") when Undo takes it back. */
type Dispatch = (a: DraftAction, what?: string) => void;

const PANELS: { id: DraftPanel; icon: 'edit' | 'sparkle' | 'media' | 'book' }[] = [
  { id: 'details', icon: 'edit' },
  { id: 'steps', icon: 'sparkle' },
  { id: 'media', icon: 'media' },
  { id: 'glossary', icon: 'book' }
];

function panelLabel(panel: DraftPanel): string {
  switch (panel) {
    case 'details': return t('guides.editor.panels.details');
    case 'steps': return t('guides.editor.panels.steps');
    case 'media': return t('guides.editor.panels.media');
    case 'glossary': return t('guides.editor.panels.glossary');
  }
}

/** What help mode says a panel's tab shows. */
function panelHelp(panel: DraftPanel): string {
  switch (panel) {
    case 'details': return t('guides.editor.panels.detailsHelp');
    case 'steps': return t('guides.editor.panels.stepsHelp');
    case 'media': return t('guides.editor.panels.mediaHelp');
    case 'glossary': return t('guides.editor.panels.glossaryHelp');
  }
}

/** A license's name, or its id when the app does not know it. */
const licenseName = (license: string) => (isLicense(license) ? licenseText(license).name : license);

const isStudy = (d: unknown): d is StudyDoc | StudyDoc2 => !!d && typeof d === 'object' && ['study@1', 'study@2'].includes((d as { format?: string }).format ?? '');

/** A stand-in while the draft or its source loads, or when this person may not write guides. */
function Waiting(props: { ctx: Ctx; title: string; sub?: string }) {
  return (
    <Screen header={<Header title={t('guides.editor.writeGuide')} onBack={props.ctx.back} />}>
      <EmptyState icon="sparkle" title={props.title} {...(props.sub ? { sub: props.sub } : {})} />
    </Screen>
  );
}

export function GuideEditorScreen({ ctx }: { ctx: Ctx }) {
  const lib = useLibrary(ctx);
  const orgId = lib.orgId;
  const itemId = ctx.params['itemId'];
  const from = ctx.params['from'];
  // A guide is published to the organization's library, which needs organization scope (library/model.ts `mayWriteLibrary`).
  const canManage = lib.canWrite('material');
  const it = itemId ? lib.item(itemId) : null;
  const sourceHash = itemId ? it?.current ?? null : from ?? null;
  const own = useMemo(() => lib.items('material').filter((i) => i.current && !i.archived && i.source !== 'subscription'), [lib]);
  const docs = useLibraryDocs(orgId, [sourceHash, ...own.map((i) => i.current)]);
  const source = docs.get(sourceHash);
  // Written into a new guide's source and credit (the author can change them), so in the language showing.
  const orgName = ctx.org.state?.org?.value.name ?? t('guides.editor.ourOrganization');
  const license = orgLicense(ctx.org.state);
  const which = { ...(itemId ? { itemId } : {}), ...(from ? { from } : {}) };
  const key = draftKey(orgId, ctx.session.actorId, which);
  const unowned = unownedDraftKey(orgId, which);

  const [draft, setDraftState] = useState<GuideDraft | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [looked, setLooked] = useState(false);
  const draftRef = useRef<GuideDraft | null>(null);
  const setDraft = useCallback((d: GuideDraft) => { draftRef.current = d; setDraftState(d); }, []);
  // Undo and Redo (decision 134): every change, kept with the draft on this device until it is published.
  const historyKey = guideHistoryKey(key);
  const undo = useUndoHistory(historyKey, parseGuideHistory);
  const setHistory = undo.set;
  const dispatch = useCallback<Dispatch>((a, what) => {
    const d = draftRef.current;
    if (!d) return;
    const next = draftReducer(d, a);
    if (next === d) return;
    setDraft(next);
    setHistory((h) => didEdit(h, { before: d, after: next, ...(what ? { what } : {}) }, editKey(a), Date.now()));
  }, [setDraft, setHistory]);
  const travel = (which: 'undo' | 'redo') => {
    const step = which === 'undo' ? undoStep(undo.history) : redoStep(undo.history);
    if (!step) return;
    setDraft(step.to);
    setHistory(step.history);
    AccessibilityInfo.announceForAccessibility(step.what ? t(which === 'undo' ? 'common.undoneWhat' : 'common.redoneWhat', { what: step.what })
      : which === 'undo' ? t('common.undone') : t('translate.redone'));
  };
  const lastDone = undo.history.done[undo.history.done.length - 1];
  const lastUndone = undo.history.undone[undo.history.undone.length - 1];

  // This person's draft on this device wins; otherwise start from the guide being edited or adapted, or a new one.
  useEffect(() => {
    let live = true;
    setLooked(false);
    void loadDraft(key, unowned).then((saved) => {
      if (!live) return;
      if (saved) { setDraft(saved.draft); setSavedAt(saved.savedAt); }
      setLooked(true);
    }).catch(() => { if (live) setLooked(true); });
    return () => { live = false; };
  }, [key, unowned, setDraft]);
  useEffect(() => {
    if (!looked || draft) return;
    if (!sourceHash) { setDraft(newDraft({ method: FIA_METHOD, orgName, license, language: readerLanguage() })); return; }
    if (isStudy(source)) {
      setDraft(draftFromDoc(source, {
        docHash: sourceHash,
        ...(itemId && it?.source !== 'subscription' ? { itemId } : { adapt: { orgName, license } })
      }));
    }
  }, [looked, draft, sourceHash, source, itemId, it?.source, orgName, license, setDraft]);

  // Kept on the device a moment after each change, and at once on leaving, so a closed tab loses nothing.
  // The saved mark spins while a change waits to be kept and turns into a check once it is.
  const first = useRef(true);
  const pending = useRef<GuideDraft | null>(null);
  const round = useRef(0);
  const [writing, setWriting] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!draft) return;
    if (first.current) { first.current = false; return; }
    const n = ++round.current;
    pending.current = draft;
    setWriting(true);
    const timer = setTimeout(() => {
      if (round.current !== n) return;
      pending.current = null;
      void saveDraft(key, draft).then(
        (at) => { if (round.current === n) { setSavedAt(at); setFailed(false); setWriting(false); } },
        (e: unknown) => { reportError('guide draft: save', e); if (round.current === n) { setFailed(true); setWriting(false); } }
      );
    }, 600);
    return () => clearTimeout(timer);
  }, [draft, key]);
  useEffect(() => () => {
    const left = pending.current;
    pending.current = null;
    if (left) void saveDraft(key, left).catch((e: unknown) => { reportError('guide draft: save', e); });
  }, [key]);
  const status = useSaveStatus(writing, savedAt !== null, failed);
  /** Published: the draft is forgotten, with any change still waiting to be kept, and its undo history. */
  const finished = useCallback(async () => {
    round.current++;
    pending.current = null;
    await dropDraft(key);
    forgetUndoHistory(historyKey);
  }, [key, historyKey]);

  if (!canManage) return <Waiting ctx={ctx} title={t('guides.editor.notAllowed')} />;
  if (!draft) {
    const gone = looked && sourceHash && docs.get(sourceHash) && !isStudy(source);
    return <Waiting ctx={ctx} title={gone ? t('guides.editor.notAGuide') : t('common.loading')} {...(itemId && !it && ctx.org.state ? { sub: t('guides.editor.gone') } : {})} />;
  }
  return (
    <Editor ctx={ctx} draft={draft} dispatch={dispatch} status={status} finished={finished}
      undo={{ canUndo: !!lastDone && undo.loaded, canRedo: !!lastUndone && undo.loaded, ...(lastDone?.what ? { undoWhat: lastDone.what } : {}),
        ...(lastUndone?.what ? { redoWhat: lastUndone.what } : {}), onUndo: () => travel('undo'), onRedo: () => travel('redo') }}
      own={own.flatMap((i) => { const d = docs.get(i.current); return isStudy(d) && i.current !== sourceHash ? [methodFromDoc(i.itemId, d)] : []; })}
      isNew={!sourceHash} title={itemId ? t('guides.editor.editGuide') : from ? t('guides.editor.adaptGuide') : t('guides.editor.writeGuide')}
      newer={!!(itemId && it?.current && draft.basis?.docHash && draft.basis.docHash !== it.current)} />
  );
}

function Editor(props: {
  ctx: Ctx; draft: GuideDraft; dispatch: Dispatch; undo: UndoRedoProps;
  /** How keeping the draft on this device is going, for the saved mark. */
  status: SaveStatus;
  /** Forgets the draft once it is published. */
  finished: () => Promise<void>;
  own: Method[]; isNew: boolean; title: string;
  /** Someone published a version after this draft began. */
  newer: boolean;
}) {
  const { ctx, draft, dispatch } = props;
  const lib = useLibrary(ctx);
  const layout = useLayout();
  const wide = layout.kind !== 'phone';
  const [panel, setPanel] = useState<DraftPanel>('details');
  const [stepId, setStepId] = useState<string | null>(wide ? draft.steps[0]?.id ?? null : null);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const problems = useMemo(() => draftProblems(draft), [draft]);
  const sharedV = useSharedItems('versification', lib.orgId);
  const preview = useMemo(() => guideFromDoc('preview', buildDoc(draft)), [draft]);

  const goTo = (p: DraftProblem) => { setPanel(p.panel); if (p.panel === 'steps' && p.id) setStepId(p.id); };

  /** Make the verse numbering readable here first: follow it, or copy it when its owner does not allow following. */
  async function ensureVersification() {
    const hash = draft.ref.trim() ? draft.versification : null;
    if (!hash || lib.items('versification').some((v) => v.current === hash)) return;
    const s = sharedV.rows.find((r) => r.latest_hash === hash && !lib.item(subscriptionItemId(r.org_id, r.item_id))?.subscription?.active);
    if (s) await (s.subscribable ? lib.subscribe(s, true) : lib.copy(s));
  }

  async function publish() {
    if (busy) return;
    if (problems.length) {
      setTried(true);
      goTo(problems[0]!);
      ctx.toast(problems.length === 1 ? t('guides.editor.oneToFix') : t('guides.editor.toFix', { count: problems.length }));
      return;
    }
    setBusy(t('guides.editor.publishing'));
    try {
      await ensureVersification();
      await uploadDraftFiles(lib.orgId, draft, (done, total) => { if (total) setBusy(t('guides.editor.uploading', { n: Math.min(done + 1, total), total })); });
      setBusy(t('guides.editor.publishing'));
      const doc = buildDoc(draft);
      await lib.publish({
        kind: 'material', ...(draft.basis?.itemId ? { itemId: draft.basis.itemId } : {}), name: doc.title,
        // The item's description, like its name, is the author's: in the language showing.
        description: doc.pattern ? t('guides.editor.itemDescriptionPattern', { pattern: doc.pattern }) : t('guides.editor.itemDescription'), doc
      });
      await props.finished();
      ctx.toast(t('guides.editor.published', { title: doc.title }));
      ctx.back();
    } catch (e) {
      // The draft stays on the device; publishing again picks up where this stopped.
      ctx.toast(t('guides.editor.notPublished', { reason: failureMessage('publish guide', e) }));
      setBusy(null);
    }
  }

  const counts: Record<DraftPanel, number | null> = { details: null, steps: draft.steps.length, media: draft.resources.length, glossary: draft.terms.length };
  return (
    <Screen fixed={false} columnWidth={wide ? measure.report : undefined}
      header={<Header title={draft.title.trim() || props.title} {...(draft.title.trim() ? { sub: props.title } : {})} onBack={ctx.back} columnWidth={wide ? measure.report : undefined}
        action={(
          <View style={s.headerActs}>
            <UndoRedo {...props.undo} help={{ undo: t('guides.editor.undoHelp'), redo: t('common.redoHelp') }} />
            <SavedMark status={props.status} help={t('saved.draftHelp')} />
          </View>
        )} />}
      footer={<PrimaryBtn label={busy ?? t('common.done')} icon="check" onPress={() => void publish()} disabled={!!busy}
        help={t('guides.editor.publishHelp')} />}>
      {/* Forms keep the reading width; only the steps use the whole window, side by side. */}
      <View style={[{ gap: space.md }, panel === 'steps' ? null : s.reading]}>
        {/* Tabs within the screen (kit ChipRow): they scroll sideways on a phone instead of shrinking. */}
        <View accessibilityRole="tablist">
          <ChipRow>
            {/* help-each: each tab shows a different part of the guide */}
            {PANELS.map((p) => (
              <Chip key={p.id} icon={p.icon} label={panelLabel(p.id)} on={panel === p.id} onPress={() => setPanel(p.id)} help={panelHelp(p.id)}
                {...(counts[p.id] !== null ? { count: counts[p.id]! } : {})} />
            ))}
          </ChipRow>
        </View>
        {props.newer ? (
          <Banner icon="history" tone="amber" title={t('guides.editor.newer')} body={t('guides.editor.newerBody')} />
        ) : null}
        {tried && problems.length > 0 ? <Problems problems={problems} current={panel} onPick={goTo} /> : null}
        {tried && problems.length === 0 ? <Banner icon="check" tone="green" title={t('guides.editor.ready')} /> : null}
        {panel === 'details' ? <DetailsPanel ctx={ctx} draft={draft} dispatch={dispatch} isNew={props.isNew} own={props.own} /> : null}
        {panel === 'steps' ? <StepsPanel ctx={ctx} draft={draft} dispatch={dispatch} stepId={stepId} setStepId={setStepId} preview={preview} /> : null}
        {panel === 'media' ? <MediaPanel ctx={ctx} draft={draft} dispatch={dispatch} /> : null}
        {panel === 'glossary' ? <GlossaryPanel ctx={ctx} draft={draft} dispatch={dispatch} /> : null}
      </View>
    </Screen>
  );
}

function Problems(props: { problems: DraftProblem[]; current: DraftPanel; onPick: (p: DraftProblem) => void }) {
  return (
    <View style={s.problems} accessibilityRole="alert">
      <Text style={[txt.sm, { fontWeight: '700', color: TINT.amberText }]}>{t('guides.editor.beforePublishing')}</Text>
      {props.problems.map((p, i) => (
        <HelpRow key={`${p.panel}-${p.id ?? ''}-${i}`} of="guide.problem">
          <ProblemRow problem={p} current={props.current} onPick={props.onPick} />
        </HelpRow>
      ))}
    </View>
  );
}

/** One thing to fix before publishing: tap to go to it. */
function ProblemRow(props: { problem: DraftProblem; current: DraftPanel; onPick: (p: DraftProblem) => void }) {
  const p = props.problem;
  const spot = useHelpSpot(p.text, t('guides.editor.problemHelp'), () => props.onPick(p));
  return (
    <Pressable onPress={spot.onPress} accessibilityRole="button"
      style={({ pressed }) => [s.problem, pressed && s.pressed]}>
      <Text style={[txt.sm, { flex: 1 }]}>{p.text}</Text>
      {p.panel !== props.current ? <Text style={[txt.xsStrong, { color: C.primary }]}>{panelLabel(p.panel)}</Text> : null}
      <HelpBadge spot={spot} inset />
    </Pressable>
  );
}

// ─── Details ───────────────────────────────────────────────────────────────────

/** What a method replacing the steps is called, for Undo. */
function replacedWith(m: Method): string {
  if (m === FIA_METHOD) return t('guides.details.replacedFia');
  if (m === BLANK_METHOD) return t('guides.details.replacedBlank');
  return t('guides.details.replacedStepsOf', { title: m.from ?? m.label });
}

function DetailsPanel(props: { ctx: Ctx; draft: GuideDraft; dispatch: Dispatch; isNew: boolean; own: Method[] }) {
  const { ctx, draft, dispatch } = props;
  const set = (patch: Extract<DraftAction, { type: 'set' }>['patch']) => dispatch({ type: 'set', patch });
  const methods = [FIA_METHOD, BLANK_METHOD, ...props.own];
  const written = draft.steps.some((st) => st.text.trim() || st.audio);
  const shareAlike = draft.basis?.shareAlike;
  // Steps already written are replaced, and Undo brings them back.
  const pickMethod = (m: Method) => dispatch({ type: 'useMethod', method: m }, written ? replacedWith(m) : undefined);
  return (
    <View style={{ gap: space.md }}>
      {draft.basis?.adapted ? (
        <Banner icon="share" title={t('guides.details.adapted')}
          body={shareAlike ? t('guides.details.adaptedShareAlike', { license: licenseName(shareAlike) }) : t('guides.details.adaptedCredit')} />
      ) : null}
      <Field label={t('guides.details.title')} value={draft.title} onChangeText={(v) => set({ title: v })} placeholder={t('guides.details.titlePlaceholder')} autoCapitalize="sentences"
        help={t('guides.details.titleHelp')} />
      <SectionLabel label={t('guides.details.method')} />
      <ChipRow>
        {[...new Set(['FIA', ...props.own.map((m) => m.pattern).filter(Boolean), draft.pattern].filter(Boolean))].map((p) => (
          <HelpRow key={p} of="guide.method">
            <Chip label={p} on={draft.pattern === p} help={t('guides.details.methodHelp')} onPress={() => set({ pattern: p })} />
          </HelpRow>
        ))}
      </ChipRow>
      <Field label={t('guides.details.ownMethod')} value={draft.pattern} onChangeText={(v) => set({ pattern: v })} placeholder={t('guides.details.ownMethodPlaceholder')} autoCapitalize="words"
        help={t('guides.details.ownMethodHelp')} />
      {props.isNew ? (
        <>
          <Text style={txt.xsStrong}>{t('guides.details.startWith')}</Text>
          <ChipRow>
            {methods.map((m) => (
              <HelpRow key={m.id} of="guide.startWith"><Chip label={m.label} on={false} help={t('guides.details.startWithHelp')} onPress={() => pickMethod(m)} /></HelpRow>
            ))}
          </ChipRow>
          <Text style={txt.xs}>{written ? t('guides.details.choosingReplaces') : t('guides.details.nowSteps', { count: draft.steps.length })}</Text>
        </>
      ) : null}
      <Field label={t('guides.details.about')} value={draft.about} onChangeText={(v) => set({ about: v })} placeholder={t('guides.details.aboutPlaceholder')} autoCapitalize="sentences" multiline
        help={t('guides.details.aboutPlaceholder')} />
      <LanguageField label={t('guides.details.language')} value={draft.language || null} onChange={(code) => set({ language: code })} />

      <SectionLabel label={t('guides.details.whereItApplies')} />
      <Placement ctx={ctx} draft={draft} dispatch={dispatch} />

      <SectionLabel label={t('guides.details.licenseAndCredit')} />
      {shareAlike ? (
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <Ico name="lock" size={18} color={C.muted} />
            <Text style={[txt.sm, { fontWeight: '700', flex: 1 }]}>{licenseName(shareAlike)}</Text>
          </View>
          <Text style={txt.xs}>{t('guides.details.shareAlike')}</Text>
        </Card>
      ) : (
        <>
          <ChipRow>
            {/* help-each: each license means something different */}
            {LICENSES.map((l) => <Chip key={l} label={licenseText(l).name} on={draft.license === l} help={licenseText(l).means} onPress={() => set({ license: l })} />)}
          </ChipRow>
          {isLicense(draft.license) ? <Text style={txt.xs}>{licenseText(draft.license).means}</Text> : null}
        </>
      )}
      <Field label={t('guides.details.credit')} value={draft.credit} onChangeText={(v) => set({ credit: v })}
        placeholder={t('guides.details.creditPlaceholder', { year: formatNumber(new Date().getFullYear(), { useGrouping: false }) })} autoCapitalize="sentences"
        help={t('guides.details.creditHelp')} />
      <Field label={t('guides.details.source')} value={draft.source} onChangeText={(v) => set({ source: v })} placeholder={t('guides.details.sourcePlaceholder')} autoCapitalize="sentences" />
    </View>
  );
}

/** A verse range in a numbering, or parts of the content templates the languages use. */
function Placement(props: { ctx: Ctx; draft: GuideDraft; dispatch: Dispatch }) {
  const { ctx, draft, dispatch } = props;
  const lib = useLibrary(ctx);
  const state = ctx.language.state;
  const [picking, setPicking] = useState(false);
  const [q, setQ] = useState('');
  const sharedV = useSharedItems('versification', lib.orgId);
  const ownV = lib.items('versification').filter((v) => v.current && !v.archived);
  const docs = useLibraryDocs(lib.orgId, [draft.versification]);
  const choices = [
    ...ownV.map((v) => ({ key: v.itemId, label: v.name, hash: v.current! })),
    ...sharedV.rows.filter((r) => !ownV.some((v) => v.current === r.latest_hash)).map((r) => ({ key: `${r.org_id}/${r.item_id}`, label: `${r.name} · ${r.org_name}`, hash: r.latest_hash }))
  ];
  if (draft.versification && !choices.some((c) => c.hash === draft.versification)) {
    choices.unshift({ key: 'doc', label: docs.get<VersificationDoc>(draft.versification)?.name ?? t('guides.placement.itsNumbering'), hash: draft.versification });
  }
  const units = useMemo(() => {
    if (!state || !picking) return [];
    const needle = q.trim().toLowerCase();
    return Object.keys(state.units)
      .filter((u) => unitPrefixOf(u) !== null)
      .map((u) => ({ unitId: u, label: unitTitle(state, u) }))
      .filter((u) => !needle || u.label.toLowerCase().includes(needle))
      .sort((x, y) => x.label.localeCompare(y.label))
      .slice(0, 60);
  }, [state, picking, q]);
  const partLabel = (p: { template: string; node: string }) => {
    const unitId = `${p.template}/${p.node}`;
    return state?.units[unitId] ? unitTitle(state, unitId) : p.node;
  };
  return (
    <View style={{ gap: space.md }}>
      {/* i18n-ignore: the placeholder is a verse reference in the form the field reads */}
      <Field label={t('guides.placement.verses')} value={draft.ref} onChangeText={(v) => dispatch({ type: 'set', patch: { ref: v } })} placeholder="LUK 15:11-32" autoCapitalize="none"
        help={t('guides.placement.versesHelp')} />
      {draft.ref.trim() ? (
        <>
          <Text style={txt.xsStrong}>{t('guides.placement.numberedAs')}</Text>
          <ChipRow>
            {choices.map((c) => (
              <HelpRow key={c.key} of="guide.numbering">
                <Chip label={c.label} on={draft.versification === c.hash} help={t('guides.placement.numberingHelp')} onPress={() => dispatch({ type: 'set', patch: { versification: c.hash } })} />
              </HelpRow>
            ))}
          </ChipRow>
        </>
      ) : null}
      {draft.parts.length ? (
        <Group>
          {draft.parts.map((p, i) => (
            <HelpRow key={`${p.template}/${p.node}`} of="guide.part">
              <Row icon="template" label={partLabel(p)} sub={t('guides.placement.partSub')} last={i === draft.parts.length - 1}
                right={<IconBtn name="close" label={t('guides.editor.remove', { name: partLabel(p) })} bg={C.light} color={C.primary} help={t('guides.placement.removeHelp')}
                  onPress={() => dispatch({ type: 'set', patch: { parts: draft.parts.filter((_, j) => j !== i) } })} />} />
            </HelpRow>
          ))}
        </Group>
      ) : null}
      <SmallBtn label={t('guides.placement.linkPart')} icon="link" help={t('guides.placement.linkPartHelp')} onPress={() => setPicking(true)} />
      <Text style={txt.xs}>{t('guides.placement.help')}</Text>
      <Sheet visible={picking} title={t('guides.placement.sheetTitle')} sub={t('guides.placement.sheetSub')} onClose={() => setPicking(false)}>
        <SearchField value={q} onChangeText={setQ} placeholder={t('guides.placement.search')} />
        {units.length === 0 ? <Text style={txt.smMuted}>{q ? t('common.nothingMatches', { query: q }) : t('guides.placement.noTemplate')}</Text> : null}
        <Group>
          {units.map((u, i) => (
            <HelpRow key={u.unitId} of="guide.unit">
              <Row icon="template" label={u.label} last={i === units.length - 1} help={t('guides.placement.unitHelp')} onPress={() => {
                const slash = u.unitId.indexOf('/');
                const part = { template: u.unitId.slice(0, slash), node: u.unitId.slice(slash + 1) };
                if (!draft.parts.some((p) => p.template === part.template && p.node === part.node)) dispatch({ type: 'set', patch: { parts: [...draft.parts, part] } });
                setPicking(false);
              }} />
            </HelpRow>
          ))}
        </Group>
      </Sheet>
    </View>
  );
}

// ─── Steps ─────────────────────────────────────────────────────────────────────

function StepsPanel(props: { ctx: Ctx; draft: GuideDraft; dispatch: Dispatch; stepId: string | null; setStepId: (id: string | null) => void; preview: StudyGuide }) {
  const { ctx, draft, dispatch } = props;
  const layout = useLayout();
  const sideBySide = layout.kind !== 'phone' && layout.contentWidth >= 960;
  const step = draft.steps.find((st) => st.id === props.stepId) ?? null;
  const index = step ? draft.steps.indexOf(step) : -1;
  // On a phone one step is open at a time: Back goes to all the steps, as "All steps" does (decision 135).
  const setStepId = props.setStepId;
  useHardwareBack(!sideBySide && !!step, () => setStepId(null));
  const remove = (st: DraftStep) => {
    dispatch({ type: 'deleteStep', id: st.id }, st.title ? t('guides.editor.removed', { name: st.title }) : t('guides.steps.stepRemoved'));
    if (props.stepId === st.id) props.setStepId(null);
  };
  const add = () => {
    // The reducer names a new step the same way, so it can be opened straight away.
    const id = nextId('s', draft.steps.map((st) => st.id));
    dispatch({ type: 'addStep', ...(step ? { after: step.id } : {}) });
    props.setStepId(id);
  };

  const list = (
    <View style={{ gap: space.sm }}>
      <Group>
        {draft.steps.map((st, i) => (
          <HelpRow key={st.id} of="guide.step">
            <StepRow step={st} index={i} count={draft.steps.length} on={st.id === props.stepId} last={i === draft.steps.length - 1}
              onOpen={() => props.setStepId(st.id)} onMove={(by) => dispatch({ type: 'moveStep', id: st.id, by })} onDelete={() => remove(st)} />
          </HelpRow>
        ))}
      </Group>
      {draft.steps.length === 0 ? <Text style={txt.smMuted}>{t('guides.steps.none')}</Text> : null}
      <SmallBtn label={step ? t('guides.steps.addAfter') : t('guides.steps.add')} icon="plus" help={t('guides.steps.addHelp')} onPress={add} />
    </View>
  );
  if (sideBySide) {
    return (
      <View style={s.split}>
        <View style={s.splitList}>{list}</View>
        <View style={{ flex: 1, minWidth: 0 }}>
          {step ? <StepEditor key={step.id} ctx={ctx} draft={draft} step={step} index={index} dispatch={dispatch} preview={props.preview} />
            : <EmptyState icon="sparkle" title={t('guides.steps.pick')} sub={t('guides.steps.pickSub')} />}
        </View>
      </View>
    );
  }
  if (step) {
    return (
      <View style={{ gap: space.md }}>
        <LinkBtn label={t('guides.steps.all')} help={t('guides.steps.allHelp')} onPress={() => props.setStepId(null)} />
        <StepEditor key={step.id} ctx={ctx} draft={draft} step={step} index={index} dispatch={dispatch} preview={props.preview} />
      </View>
    );
  }
  return list;
}

function StepRow(props: { step: DraftStep; index: number; count: number; on: boolean; last: boolean; onOpen: () => void; onMove: (by: -1 | 1) => void; onDelete: () => void }) {
  const st = props.step;
  const words = st.text.trim() ? st.text.trim().split(/\s+/).length : 0;
  const sub = [st.phase, words ? t('guides.steps.words', { count: words }) : t('guides.steps.noText'), st.audio ? t('guides.steps.hasAudio') : null].filter(Boolean).join(' · ');
  const n = props.index + 1;
  const open = useHelpSpot(st.title || t('guides.steps.untitled'), t('guides.steps.openHelp'), props.onOpen);
  return (
    <View style={[s.stepRow, !props.last && s.rowBorder, props.on && { backgroundColor: C.light }]}>
      <Pressable onPress={open.onPress} accessibilityRole="button" accessibilityState={{ selected: props.on }}
        accessibilityLabel={st.title ? t('guides.steps.rowLabel', { n, title: st.title, details: sub }) : t('guides.steps.rowLabelUntitled', { n, details: sub })}
        style={({ pressed }) => [{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: target.row }, pressed && s.pressed]}>
        <View style={s.stepNum}><Text style={[txt.sm, { fontWeight: '800', color: C.primary }]}>{formatNumber(n)}</Text></View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[txt.sm, { fontWeight: '700' }]} numberOfLines={1}>{st.title || t('guides.steps.untitled')}</Text>
          <Text style={txt.xs} numberOfLines={1}>{sub}</Text>
        </View>
        <HelpBadge spot={open} inset />
      </Pressable>
      <IconBtn name="up" label={t('guides.steps.moveUp', { title: st.title })} help={t('guides.steps.moveUpHelp')} onPress={() => props.onMove(-1)} disabled={props.index === 0} bg="transparent" color={C.primary} />
      <IconBtn name="down" label={t('guides.steps.moveDown', { title: st.title })} help={t('guides.steps.moveDownHelp')} onPress={() => props.onMove(1)} disabled={props.index === props.count - 1} bg="transparent" color={C.primary} />
      <IconBtn name="trash" label={t('guides.editor.remove', { name: st.title })} help={t('guides.steps.removeHelp')} onPress={props.onDelete} bg="transparent" color={TINT.redText} />
    </View>
  );
}

function StepEditor(props: { ctx: Ctx; draft: GuideDraft; step: DraftStep; index: number; dispatch: Dispatch; preview: StudyGuide }) {
  const { ctx, draft, step, dispatch } = props;
  const layout = useLayout();
  const sideBySide = layout.kind !== 'phone' && layout.contentWidth >= 1080;
  const [view, setView] = useState<'write' | 'preview'>('write');
  const [opened, setOpened] = useState<StudyResource | null>(null);
  const update = (patch: Partial<Omit<DraftStep, 'id' | 'audio'>>) => dispatch({ type: 'updateStep', id: step.id, patch });
  const phases = [...new Set(draft.steps.map((st) => st.phase.trim()).filter(Boolean))];
  const openRef = (ref: string) => { const r = props.preview.resources.find((x) => x.ref === ref); if (r) setOpened(r); };
  const entry = opened?.kind === 'term' ? glossaryEntryOf(props.preview, opened.ref) : null;

  const editor = <TextEditor draft={draft} text={step.text} onChange={(text) => update({ text })} />;
  const preview = (
    <View style={{ gap: space.sm }}>
      <Text style={txt.xs}>{t('guides.steps.previewHelp')}</Text>
      <StepPreview text={step.text} onOpenRef={openRef} />
    </View>
  );
  return (
    <View style={{ gap: space.md }}>
      <Card>
        <Text style={txt.label}>{t('guides.steps.stepNumber', { n: props.index + 1 })}</Text>
        <Field label={t('guides.steps.title')} value={step.title} onChangeText={(v) => update({ title: v })} placeholder={t('guides.steps.titlePlaceholder')} autoCapitalize="words"
          help={t('guides.steps.titleHelp')} />
        <Field label={t('guides.steps.phase')} value={step.phase} onChangeText={(v) => update({ phase: v })} placeholder={t('guides.steps.phasePlaceholder')} autoCapitalize="words" />
        {phases.length > 1 ? (
          <ChipRow>
            {phases.map((p) => <HelpRow key={p} of="guide.phase"><Chip label={p} on={step.phase.trim() === p} help={t('guides.steps.phaseHelp')} onPress={() => update({ phase: p })} /></HelpRow>)}
          </ChipRow>
        ) : null}
        <Field label={t('guides.steps.purpose')} value={step.purpose} onChangeText={(v) => update({ purpose: v })} placeholder={t('guides.steps.purposePlaceholder')} autoCapitalize="sentences" />
      </Card>
      <AudioSlot ctx={ctx} label={t('guides.steps.audio')} removeLabel={t('guides.steps.removeAudio')} audio={step.audio} recordLabel={t('guides.steps.record')}
        onChange={(audio) => dispatch({ type: 'setStepAudio', id: step.id, audio })} />
      {sideBySide ? (
        <View style={s.split}>
          <View style={{ flex: 1, minWidth: 0 }}>{editor}</View>
          <View style={{ flex: 1, minWidth: 0 }}>{preview}</View>
        </View>
      ) : (
        <>
          <ChipRow>
            <Chip icon="edit" label={t('guides.steps.write')} on={view === 'write'} help={t('guides.steps.showWriteHelp')} onPress={() => setView('write')} />
            <Chip icon="sparkle" label={t('common.preview')} on={view === 'preview'} help={t('guides.steps.showPreviewHelp')} onPress={() => setView('preview')} />
          </ChipRow>
          {view === 'write' ? editor : preview}
        </>
      )}
      {opened && opened.kind !== 'term' ? <MediaSheet resource={opened} source={props.preview.pattern ? t('guides.steps.mediaOf', { pattern: props.preview.pattern }) : t('guides.steps.guideMedia')} orgId={ctx.language.orgId} onClose={() => setOpened(null)} /> : null}
      {opened && entry ? (
        <GlossarySheet entry={entry} source={props.preview.source} orgId={ctx.language.orgId} hasKeyTerm={false} onOpenTerm={() => undefined} onClose={() => setOpened(null)} />
      ) : null}
    </View>
  );
}

/** A toolbar button: an icon and a word, 48pt. `help`: what help mode says it does. */
function ToolBtn(props: { icon: LucideIcon; label: string; onPress: () => void; on?: boolean; help: string }) {
  const Icon = props.icon;
  const spot = useHelpSpot(props.label, props.help, props.onPress);
  return (
    <Pressable onPress={spot.onPress} accessibilityRole="button" accessibilityLabel={props.label} accessibilityState={props.on !== undefined ? { expanded: props.on } : undefined}
      style={({ pressed }) => [s.tool, props.on && { backgroundColor: C.light, borderColor: C.primary }, pressed && s.pressed]}>
      <Icon size={18} color={C.primary} strokeWidth={2.4} />
      <Text style={[txt.xsStrong, { color: C.primary }]}>{props.label}</Text>
      <HelpBadge spot={spot} />
    </Pressable>
  );
}

/** A field's press while help is on: it explains itself; typing waits until help is off (as kit's Field). */
const TYPE_HERE = () => undefined;

/** The step's markdown, with bold, list, callouts of each kind and links to pictures, maps and terms. */
function TextEditor(props: { draft: GuideDraft; text: string; onChange: (text: string) => void }) {
  const sel = useRef<Selection>({ start: props.text.length, end: props.text.length });
  const [forced, setForced] = useState<Selection | undefined>(undefined);
  const [tray, setTray] = useState<'callout' | 'link' | null>(null);
  const apply = (r: { text: string; selection: Selection }) => {
    props.onChange(r.text);
    sel.current = r.selection;
    setForced(r.selection);
    setTray(null);
  };
  const onSelection = (e: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => {
    sel.current = e.nativeEvent.selection;
    if (forced) setForced(undefined);
  };
  const link = useHelpSpot(t('guides.text.link'), t('guides.text.linkHelp'), () => setTray(tray === 'link' ? null : 'link'));
  const area = useHelpSpot(t('guides.text.label'), t('guides.text.areaHelp'), TYPE_HERE);
  const linkables = [
    ...props.draft.resources.map((r) => ({ ref: r.ref, title: r.title || r.media[0]?.title || untitledResource(r.kind), icon: (r.kind === 'map' ? 'map' : 'camera') as 'map' | 'camera' })),
    ...props.draft.terms.map((term) => ({ ref: term.id, title: term.term || t('guides.text.untitledTerm'), icon: 'book' as const }))
  ];
  return (
    <View style={{ gap: space.sm }}>
      <View style={s.toolbar} accessibilityRole="toolbar">
        <ToolBtn icon={Bold} label={t('guides.text.bold')} help={t('guides.text.boldHelp')} onPress={() => apply(boldText(props.text, sel.current))} />
        <ToolBtn icon={List} label={t('guides.text.list')} help={t('guides.text.listHelp')} onPress={() => apply(listText(props.text, sel.current))} />
        <ToolBtn icon={TextQuote} label={t('guides.text.callout')} help={t('guides.text.calloutHelp')} on={tray === 'callout'} onPress={() => setTray(tray === 'callout' ? null : 'callout')} />
        <Pressable onPress={link.onPress} accessibilityRole="button" accessibilityLabel={t('guides.text.linkLabel')}
          accessibilityState={{ expanded: tray === 'link' }} style={({ pressed }) => [s.tool, tray === 'link' && { backgroundColor: C.light, borderColor: C.primary }, pressed && s.pressed]}>
          <Ico name="link" size={18} color={C.primary} />
          <Text style={[txt.xsStrong, { color: C.primary }]}>{t('guides.text.link')}</Text>
          <HelpBadge spot={link} />
        </Pressable>
      </View>
      {tray === 'callout' ? (
        <View style={s.tray}>
          {CALLOUT_KINDS.map((k) => <HelpRow key={k} of="guide.callout"><CalloutChoice kind={k} onPress={() => apply(calloutText(props.text, sel.current, k))} /></HelpRow>)}
        </View>
      ) : null}
      {tray === 'link' ? (
        <View style={s.tray}>
          {linkables.length === 0 ? <Text style={txt.smMuted}>{t('guides.text.nothingToLink')}</Text> : null}
          {linkables.map((l) => (
            <HelpRow key={l.ref} of="guide.linkable">
              <SmallBtn label={`${l.title} · #${l.ref}`} icon={l.icon} help={t('guides.text.linkToHelp')} onPress={() => apply(linkText(props.text, sel.current, l.ref, l.title))} />
            </HelpRow>
          ))}
        </View>
      ) : null}
      <View>
        <TextInput value={props.text} onChangeText={props.onChange} onSelectionChange={onSelection} {...(forced ? { selection: forced } : {})}
          multiline accessibilityLabel={t('guides.text.label')} placeholder={t('guides.text.placeholder')} editable={!area.id}
          placeholderTextColor={C.faint} autoCapitalize="sentences" style={s.textArea} textAlignVertical="top" />
        {/* While help is on, it takes the tap so the field explains itself instead of opening the keyboard (kit's HelpCover). */}
        {area.id ? (
          <Pressable onPress={area.onPress} accessibilityRole="button" accessibilityLabel={t('guides.text.label')} style={StyleSheet.absoluteFill}>
            <HelpBadge spot={area} />
          </Pressable>
        ) : null}
      </View>
      <Text style={txt.xs}>{t('guides.text.help')}</Text>
    </View>
  );
}

function CalloutChoice(props: { kind: CalloutKind; onPress: () => void }) {
  const look = CALLOUT_LOOK[props.kind];
  const Icon = look.icon;
  const spot = useHelpSpot(calloutLabel(props.kind), t('guides.text.insertCalloutHelp'), props.onPress);
  return (
    <Pressable onPress={spot.onPress} accessibilityRole="button" accessibilityLabel={t('guides.text.insertCallout', { kind: calloutLabel(props.kind) })}
      style={({ pressed }) => [s.calloutChoice, { backgroundColor: look.bg, borderColor: look.edge }, pressed && s.pressed]}>
      <Icon size={16} color={look.ink} strokeWidth={2.4} />
      <Text style={[txt.xsStrong, { color: look.ink }]}>{calloutLabel(props.kind)}</Text>
      <HelpBadge spot={spot} />
    </Pressable>
  );
}

// ─── Audio for a step or a term ────────────────────────────────────────────────────

/** Play what is there, or record it (any device), or upload a file (web). */
function AudioSlot(props: { ctx: Ctx; label: string; removeLabel: string; recordLabel: string; audio: MediaRef | undefined; onChange: (a: MediaRef | null) => void }) {
  const { ctx } = props;
  const [error, setError] = useState('');
  const has = !!(props.audio?.hash || props.audio?.url);
  async function upload() {
    setError('');
    try {
      const file = await pickFile('audio');
      if (file) props.onChange(await keepPicked(file, 'audio'));
    } catch (e) {
      setError(e instanceof FileProblem ? e.message : failureMessage('guide audio upload', e));
    }
  }
  return (
    <Card>
      <Text style={txt.label}>{props.label}</Text>
      {has ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <View style={{ flex: 1, minWidth: 0 }}><MediaPlayer orgId={ctx.language.orgId} audio={props.audio!} label={props.label} /></View>
          <IconBtn name="trash" label={props.removeLabel} help={t('guides.audio.removeHelp')} onPress={() => props.onChange(null)} bg="transparent" color={TINT.redText} />
        </View>
      ) : (
        <>
          <VoiceNote ctx={ctx} label={props.recordLabel} hash={null}
            onChange={(hash, card) => { if (hash) props.onChange({ hash, format: card?.format ?? 'm4a', ...(card ? { seconds: Math.round(card.durationMs / 1000) } : {}) }); }} />
          {canPickFiles ? <SmallBtn label={t('guides.audio.upload')} icon="download" help={t('guides.audio.uploadHelp')} onPress={() => void upload()} /> : null}
        </>
      )}
      {error ? <Text style={txt.error}>{error}</Text> : null}
    </Card>
  );
}

function MediaPlayer(props: { orgId: string; audio: MediaRef; label: string }) {
  const file = props.audio.hash ? { hash: props.audio.hash, format: props.audio.format ?? 'm4a' } : undefined;
  const { uri } = useStudyFileUri(props.orgId, file, props.audio.url);
  const audio = useStudyAudio(uri, props.audio.seconds ?? 30);
  useEffect(() => () => audio.pause(), []); // eslint-disable-line react-hooks/exhaustive-deps -- it reads only refs, so the first draw's copy is enough on unmount
  return <AudioBar audio={audio} label={props.label} sub={props.audio.seconds ? shownClock(props.audio.seconds) : undefined} />;
}

// ─── Media ─────────────────────────────────────────────────────────────────────

function MediaPanel(props: { ctx: Ctx; draft: GuideDraft; dispatch: Dispatch }) {
  const { ctx, draft, dispatch } = props;
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function add(panel: 'media' | 'map', kind: PickKind, into?: DraftResource) {
    setError('');
    try {
      const file = await pickFile(kind);
      if (!file) return;
      setBusy(true);
      const ref = await keepPicked(file, kind);
      const name = file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
      // A new set takes the file's name; a picture added to a set gets its own title.
      const media: Omit<DraftMedia, 'id'> = { kind: mediaKindFor(kind, panel), title: into ? name : '', caption: '', file: ref };
      dispatch(into ? { type: 'addMedia', ref: into.ref, media } : { type: 'addResource', kind: panel, title: name, media });
    } catch (e) {
      setError(e instanceof FileProblem ? e.message : failureMessage('guide media upload', e));
    } finally {
      setBusy(false);
    }
  }
  const remove = (r: DraftResource) => dispatch({ type: 'deleteResource', ref: r.ref }, r.title ? t('guides.editor.removed', { name: r.title }) : t('guides.media.removed'));
  const section = (kind: 'media' | 'map') => draft.resources.filter((r) => r.kind === kind);
  return (
    <View style={{ gap: space.md }}>
      {!canPickFiles ? <Banner icon="globe" title={t('guides.media.onWeb')} body={t('guides.media.onWebBody')} /> : null}
      {error ? <Text style={txt.error}>{error}</Text> : null}
      <SectionLabel label={t('guides.media.picturesAndFilms', { n: section('media').length })} />
      {section('media').map((r) => (
        <HelpRow key={r.ref} of="guide.pictures">
          <ResourceCard ctx={ctx} r={r} dispatch={dispatch} onRemove={() => remove(r)} onAdd={(kind) => void add('media', kind, r)} />
        </HelpRow>
      ))}
      {canPickFiles ? (
        <View style={s.buttons}>
          <SmallBtn label={t('guides.media.addPicture')} icon="camera" help={t('guides.media.addPictureHelp')} onPress={() => void add('media', 'image')} disabled={busy} />
          <SmallBtn label={t('guides.media.addFilm')} icon="video" help={t('guides.media.addFilmHelp')} onPress={() => void add('media', 'video')} disabled={busy} />
        </View>
      ) : null}
      <SectionLabel label={t('guides.media.maps', { n: section('map').length })} />
      {section('map').map((r) => (
        <HelpRow key={r.ref} of="guide.map">
          <ResourceCard ctx={ctx} r={r} dispatch={dispatch} onRemove={() => remove(r)} onAdd={(kind) => void add('map', kind, r)} />
        </HelpRow>
      ))}
      {canPickFiles ? <SmallBtn label={t('guides.media.addMap')} icon="map" help={t('guides.media.addMapHelp')} onPress={() => void add('map', 'image')} disabled={busy} /> : null}
      <Text style={txt.xs}>
        {busy ? t('guides.media.keeping') : t('guides.media.copies', { pixels: formatNumber(500) })}
      </Text>
      <Text style={txt.xs}>{t('guides.media.linkHelp')}</Text>
    </View>
  );
}

function ResourceCard(props: { ctx: Ctx; r: DraftResource; dispatch: Dispatch; onRemove: () => void; onAdd: (kind: PickKind) => void }) {
  const { r, dispatch } = props;
  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <HelpInfo label={`#${r.ref}`} detail={t('guides.editor.refHelp')}><Badge label={`#${r.ref}`} tone="brand" /></HelpInfo>
        <Text style={[txt.sm, { flex: 1, fontWeight: '700' }]} numberOfLines={1}>{r.title || untitledResource(r.kind)}</Text>
        <IconBtn name="trash" label={t('guides.editor.remove', { name: r.title || r.ref })} help={t('guides.media.removeHelp')} onPress={props.onRemove} bg="transparent" color={TINT.redText} />
      </View>
      <Field label={t('guides.media.title')} value={r.title} onChangeText={(v) => dispatch({ type: 'updateResource', ref: r.ref, patch: { title: v } })}
        placeholder={r.kind === 'map' ? t('guides.media.mapTitlePlaceholder') : t('guides.media.picturesTitlePlaceholder')} autoCapitalize="sentences"
        help={t('guides.media.titleHelp')} />
      <Field label={t('guides.media.description')} value={r.description} onChangeText={(v) => dispatch({ type: 'updateResource', ref: r.ref, patch: { description: v } })}
        placeholder={t('guides.media.descriptionPlaceholder')} autoCapitalize="sentences" />
      {r.media.map((m) => <HelpRow key={m.id} of="guide.mediaItem"><MediaItem ctx={props.ctx} r={r} m={m} dispatch={dispatch} /></HelpRow>)}
      {canPickFiles && r.kind === 'media' ? <SmallBtn label={t('guides.media.addAnother')} icon="plus" help={t('guides.media.addAnotherHelp')} onPress={() => props.onAdd('image')} /> : null}
    </Card>
  );
}

function MediaItem(props: { ctx: Ctx; r: DraftResource; m: DraftMedia; dispatch: Dispatch }) {
  const { r, m, dispatch } = props;
  const file = m.file.lowHash ? { hash: m.file.lowHash, format: m.kind === 'video' ? 'mp4' : 'jpg' } : m.file.hash ? { hash: m.file.hash, format: m.file.format ?? 'jpg' } : undefined;
  const { uri } = useStudyFileUri(props.ctx.language.orgId, m.kind === 'video' ? undefined : file, m.file.url);
  const patch = (p: Partial<Omit<DraftMedia, 'id'>>) => dispatch({ type: 'updateMedia', ref: r.ref, id: m.id, patch: p });
  const status = m.kind === 'video' ? (m.file.lowHash ? t('guides.media.filmCopyReady') : t('guides.media.filmNoCopy'))
    : m.file.lowHash ? t('guides.media.pictureCopyReady') : m.file.url ? t('guides.media.pictureFromLink') : t('guides.media.picture');
  return (
    <View style={s.mediaItem}>
      <View style={s.thumb}>
        {uri ? <ThumbImage uri={uri} label={m.title} /> : <Ico name={m.kind === 'video' ? 'video' : m.kind === 'map' ? 'map' : 'camera'} size={28} color={C.faint} />}
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: space.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <Text style={[txt.xs, { flex: 1 }]}>{status}</Text>
          <IconBtn name="close" label={m.title ? t('guides.editor.remove', { name: m.title }) : t('guides.media.removeThisPicture')} help={t('guides.media.removeFromSetHelp')} onPress={() => dispatch({ type: 'deleteMedia', ref: r.ref, id: m.id })} bg="transparent" color={C.muted} />
        </View>
        {r.kind === 'media' && m.kind !== 'video' ? (
          <ChipRow>
            {/* help-each: a photo and an illustration are explained differently */}
            {(['photo', 'illustration'] as const).map((k) => <Chip key={k} label={mediaKindLabel(k)} on={m.kind === k} help={k === 'photo' ? t('guides.media.photoHelp') : t('guides.media.illustrationHelp')} onPress={() => patch({ kind: k })} />)}
          </ChipRow>
        ) : null}
        {r.media.length > 1 ? <Field label={t('guides.media.pictureTitle')} value={m.title} onChangeText={(v) => patch({ title: v })} placeholder={t('guides.media.pictureTitlePlaceholder')} autoCapitalize="sentences" /> : null}
        <Field label={t('guides.media.caption')} value={m.caption} onChangeText={(v) => patch({ caption: v })} placeholder={t('guides.media.captionPlaceholder')} autoCapitalize="sentences"
          help={t('guides.media.captionPlaceholder')} />
      </View>
    </View>
  );
}

function ThumbImage(props: { uri: string; label: string }) {
  return <Image source={{ uri: props.uri }} accessibilityLabel={props.label} style={{ width: '100%', height: '100%' }} resizeMode="cover" />;
}

// ─── Glossary ──────────────────────────────────────────────────────────────────

function GlossaryPanel(props: { ctx: Ctx; draft: GuideDraft; dispatch: Dispatch }) {
  const { ctx, draft, dispatch } = props;
  const remove = (term: DraftTerm) => dispatch({ type: 'deleteTerm', id: term.id }, term.term ? t('guides.editor.removed', { name: term.term }) : t('guides.glossary.removed'));
  return (
    <View style={{ gap: space.md }}>
      {draft.terms.length === 0 ? <Text style={txt.smMuted}>{t('guides.glossary.none')}</Text> : null}
      {draft.terms.map((term) => (
        <HelpRow key={term.id} of="guide.term"><Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <HelpInfo label={`#${term.id}`} detail={t('guides.editor.refHelp')}><Badge label={`#${term.id}`} tone="brand" /></HelpInfo>
            <Text style={[txt.sm, { flex: 1, fontWeight: '700' }]} numberOfLines={1}>{term.term || t('guides.glossary.newTerm')}</Text>
            <IconBtn name="trash" label={term.term ? t('guides.editor.remove', { name: term.term }) : t('guides.glossary.removeThisTerm')} help={t('guides.glossary.removeHelp')} onPress={() => remove(term)} bg="transparent" color={TINT.redText} />
          </View>
          <Field label={t('guides.glossary.term')} value={term.term} onChangeText={(v) => dispatch({ type: 'updateTerm', id: term.id, patch: { term: v } })} placeholder={t('guides.glossary.termPlaceholder')} autoCapitalize="none"
            help={t('guides.glossary.termHelp')} />
          <Field label={t('guides.glossary.hint')} value={term.hint} onChangeText={(v) => dispatch({ type: 'updateTerm', id: term.id, patch: { hint: v } })} placeholder={t('guides.glossary.hintPlaceholder')} autoCapitalize="sentences"
            help={t('guides.glossary.hintHelp')} />
          <Field label={t('guides.glossary.meaning')} value={term.body} onChangeText={(v) => dispatch({ type: 'updateTerm', id: term.id, patch: { body: v } })} placeholder={t('guides.glossary.meaningPlaceholder')} autoCapitalize="sentences" multiline
            help={t('guides.glossary.meaningPlaceholder')} />
          <AudioSlot ctx={ctx} label={t('guides.glossary.audio')} removeLabel={t('guides.glossary.removeAudio')} recordLabel={t('guides.glossary.record')} audio={term.audio}
            onChange={(audio) => dispatch({ type: 'setTermAudio', id: term.id, audio })} />
        </Card></HelpRow>
      ))}
      <SmallBtn label={t('guides.glossary.add')} icon="plus" help={t('guides.glossary.addHelp')} onPress={() => dispatch({ type: 'addTerm' })} />
    </View>
  );
}

const s = StyleSheet.create({
  headerActs: { flexDirection: 'row', alignItems: 'center' },
  pressed: { opacity: 0.7 },
  reading: { width: '100%', maxWidth: measure.column, alignSelf: 'center' },
  problems: { backgroundColor: TINT.amber, borderRadius: radius.lg, padding: space.md, gap: space.xs },
  problem: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: target.min },
  split: { flexDirection: 'row', gap: space.lg, alignItems: 'flex-start' },
  splitList: { width: 340, gap: space.sm },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingLeft: space.md, paddingRight: space.xs, backgroundColor: C.card },
  rowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: C.border },
  stepNum: { width: 32, height: 32, borderRadius: 16, borderWidth: 1.5, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  toolbar: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  tool: { minHeight: target.min, minWidth: target.min, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.md,
    borderRadius: radius.md, borderWidth: 1.5, borderColor: C.border, backgroundColor: C.card },
  tray: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, padding: space.sm, borderRadius: radius.md, backgroundColor: C.card, borderWidth: StyleSheet.hairlineWidth, borderColor: C.border },
  calloutChoice: { minHeight: target.min, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.md, borderRadius: radius.md, borderLeftWidth: 4, borderWidth: 1 },
  textArea: { minHeight: 320, borderRadius: radius.lg, borderWidth: 1.5, borderColor: C.border, backgroundColor: C.card, padding: space.lg,
    fontSize: T.sm, lineHeight: 24, color: C.dark },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  mediaItem: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start', paddingTop: space.sm, borderTopWidth: StyleSheet.hairlineWidth, borderColor: C.border },
  thumb: { width: 96, height: 72, borderRadius: radius.md, overflow: 'hidden', backgroundColor: TINT.gray, alignItems: 'center', justifyContent: 'center' }
});

