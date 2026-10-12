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
// Drafts stay on the device (draftStore.ts) until published.
import {
  CALLOUT_KINDS, LICENSES, isLicense, orgLicense, subscriptionItemId, unitPrefixOf, unitTitle,
  type CalloutKind, type MediaRef, type StudyDoc, type StudyDoc2, type VersificationDoc
} from '@langquest-next/core';
import { Bold, List, TextQuote, type LucideIcon } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, TextInput, View, type NativeSyntheticEvent, type TextInputSelectionChangeEventData } from 'react-native';
import { Text } from '../text';
import { licenseText } from '../coreText';
import type { Ctx } from '../ctx';
import { t } from '../i18n';
import { formatNumber, formatTime } from '../i18n/format';
import {
  Badge, Banner, Card, Chip, ChipRow, EmptyState, Field, Group, Header, Ico, IconBtn, LinkBtn, PrimaryBtn, Row, Screen, SearchField,
  SectionLabel, Sheet, SmallBtn, txt, useLayout
} from '../kit';
import { useLibrary, useLibraryDocs, useSharedItems } from '../library/useLibrary';
import { LanguageField } from '../reference/LanguageField';
import { readerLanguage } from '../reference/languages';
import { failureMessage } from '../report';
import type { StudyGuide, StudyResource } from '../study/guides';
import { guideFromDoc, glossaryEntryOf } from '../study/guideMatch';
import { useStudyFileUri } from '../study/media';
import { AudioBar, CALLOUT_LOOK, calloutLabel, GlossarySheet, mediaKindLabel, MediaSheet, shownClock, StepPreview, useStudyAudio } from '../study/ui';
import { C, measure, radius, space, target, TINT, type as T } from '../theme';
import { VoiceNote } from '../voiceNote';
import {
  boldText, buildDoc, calloutText, draftFromDoc, draftProblems, draftReducer, linkText, listText, newDraft, nextId, untitledResource,
  type DraftAction, type DraftMedia, type DraftPanel, type DraftProblem, type DraftResource, type DraftStep, type DraftTerm, type GuideDraft, type Selection
} from './draft';
import { draftKey, dropDraft, loadDraft, saveDraft } from './draftStore';
import { canPickFiles, FileProblem, keepPicked, mediaKindFor, pickFile, uploadDraftFiles, type PickKind } from './files';
import { BLANK_METHOD, FIA_METHOD, methodFromDoc, type Method } from './methods';

type Dispatch = (a: DraftAction) => void;

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
  const canManage = ctx.session.can('manage_reference');
  const it = itemId ? lib.item(itemId) : null;
  const sourceHash = itemId ? it?.current ?? null : from ?? null;
  const own = useMemo(() => lib.items('material').filter((i) => i.current && !i.archived && i.source !== 'subscription'), [lib]);
  const docs = useLibraryDocs(orgId, [sourceHash, ...own.map((i) => i.current)]);
  const source = docs.get(sourceHash);
  // Written into a new guide's source and credit (the author can change them), so in the language showing.
  const orgName = ctx.org.state?.org?.value.name ?? t('guides.editor.ourOrganization');
  const license = orgLicense(ctx.org.state);
  const key = draftKey(orgId, { ...(itemId ? { itemId } : {}), ...(from ? { from } : {}) });

  const [draft, setDraft] = useState<GuideDraft | null>(null);
  const [restored, setRestored] = useState<number | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [looked, setLooked] = useState(false);
  const dispatch = useCallback<Dispatch>((a) => setDraft((d) => (d ? draftReducer(d, a) : d)), []);

  // A draft on this device wins; otherwise start from the guide being edited or adapted, or a new one.
  useEffect(() => {
    let live = true;
    setLooked(false);
    void loadDraft(key).then((saved) => {
      if (!live) return;
      if (saved) { setDraft(saved.draft); setRestored(saved.savedAt); setSavedAt(saved.savedAt); }
      setLooked(true);
    }).catch(() => { if (live) setLooked(true); });
    return () => { live = false; };
  }, [key]);
  useEffect(() => {
    if (!looked || draft) return;
    if (!sourceHash) { setDraft(newDraft({ method: FIA_METHOD, orgName, license, language: readerLanguage() })); return; }
    if (isStudy(source)) {
      setDraft(draftFromDoc(source, {
        docHash: sourceHash,
        ...(itemId && it?.source !== 'subscription' ? { itemId } : { adapt: { orgName, license } })
      }));
    }
  }, [looked, draft, sourceHash, source, itemId, it?.source, orgName, license]);

  // Saved on the device a moment after each change, so a closed tab loses nothing.
  const first = useRef(true);
  useEffect(() => {
    if (!draft) return;
    if (first.current) { first.current = false; return; }
    const timer = setTimeout(() => { void saveDraft(key, draft).then(setSavedAt).catch(() => undefined); }, 600);
    return () => clearTimeout(timer);
  }, [draft, key]);

  if (!canManage) return <Waiting ctx={ctx} title={t('guides.editor.notAllowed')} />;
  if (!draft) {
    const gone = looked && sourceHash && docs.get(sourceHash) && !isStudy(source);
    return <Waiting ctx={ctx} title={gone ? t('guides.editor.notAGuide') : t('common.loading')} {...(itemId && !it && ctx.org.state ? { sub: t('guides.editor.gone') } : {})} />;
  }
  return (
    <Editor ctx={ctx} draft={draft} setDraft={setDraft} dispatch={dispatch} draftKey={key} restored={restored} savedAt={savedAt}
      own={own.flatMap((i) => { const d = docs.get(i.current); return isStudy(d) && i.current !== sourceHash ? [methodFromDoc(i.itemId, d)] : []; })}
      isNew={!sourceHash} title={itemId ? t('guides.editor.editGuide') : from ? t('guides.editor.adaptGuide') : t('guides.editor.writeGuide')}
      newer={!!(itemId && it?.current && draft.basis?.docHash && draft.basis.docHash !== it.current)} />
  );
}

function Editor(props: {
  ctx: Ctx; draft: GuideDraft; setDraft: (d: GuideDraft) => void; dispatch: Dispatch; draftKey: string;
  restored: number | null; savedAt: number | null; own: Method[]; isNew: boolean; title: string;
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
      await dropDraft(props.draftKey);
      ctx.toast(t('guides.editor.published', { title: doc.title }));
      ctx.back();
    } catch (e) {
      // The draft stays on the device; publishing again picks up where this stopped.
      ctx.toast(t('guides.editor.notPublished', { reason: failureMessage('publish guide', e) }));
      setBusy(null);
    }
  }

  const counts: Record<DraftPanel, number | null> = { details: null, steps: draft.steps.length, media: draft.resources.length, glossary: draft.terms.length };
  const saved = props.savedAt ? t('guides.editor.savedAt', { time: formatTime(props.savedAt) }) : t('guides.editor.savedAsYouWrite');
  return (
    <Screen fixed={false} columnWidth={wide ? measure.report : undefined}
      header={<Header title={draft.title.trim() || props.title} {...(draft.title.trim() ? { sub: props.title } : {})} onBack={ctx.back} columnWidth={wide ? measure.report : undefined} />}
      footer={<PrimaryBtn label={busy ?? (draft.basis?.itemId ? t('guides.editor.publishNewVersion') : t('common.publish'))} onPress={() => void publish()} disabled={!!busy} />}>
      {/* Forms keep the reading width; only the steps use the whole window, side by side. */}
      <View style={[{ gap: space.md }, panel === 'steps' ? null : s.reading]}>
        {/* Tabs within the screen (kit ChipRow): they scroll sideways on a phone instead of shrinking. */}
        <View accessibilityRole="tablist">
          <ChipRow>
            {PANELS.map((p) => (
              <Chip key={p.id} icon={p.icon} label={panelLabel(p.id)} on={panel === p.id} onPress={() => setPanel(p.id)}
                {...(counts[p.id] !== null ? { count: counts[p.id]! } : {})} />
            ))}
          </ChipRow>
        </View>
        <Text style={[txt.xs, { paddingHorizontal: space.xs }]}>{saved}</Text>
        {props.restored && panel === 'details' ? (
          <Banner icon="history" title={t('guides.editor.restored', { time: formatTime(props.restored) })} body={t('guides.editor.restoredBody')} />
        ) : null}
        {props.newer ? (
          <Banner icon="history" tone="amber" title={t('guides.editor.newer')} body={t('guides.editor.newerBody')} />
        ) : null}
        {tried && problems.length > 0 ? <Problems problems={problems} current={panel} onPick={goTo} /> : null}
        {tried && problems.length === 0 ? <Banner icon="check" tone="green" title={t('guides.editor.ready')} /> : null}
        {panel === 'details' ? <DetailsPanel ctx={ctx} draft={draft} dispatch={dispatch} isNew={props.isNew} own={props.own} setDraft={props.setDraft} /> : null}
        {panel === 'steps' ? <StepsPanel ctx={ctx} draft={draft} dispatch={dispatch} stepId={stepId} setStepId={setStepId} preview={preview} setDraft={props.setDraft} /> : null}
        {panel === 'media' ? <MediaPanel ctx={ctx} draft={draft} dispatch={dispatch} setDraft={props.setDraft} /> : null}
        {panel === 'glossary' ? <GlossaryPanel ctx={ctx} draft={draft} dispatch={dispatch} setDraft={props.setDraft} /> : null}
      </View>
    </Screen>
  );
}

function Problems(props: { problems: DraftProblem[]; current: DraftPanel; onPick: (p: DraftProblem) => void }) {
  return (
    <View style={s.problems} accessibilityRole="alert">
      <Text style={[txt.sm, { fontWeight: '700', color: TINT.amberText }]}>{t('guides.editor.beforePublishing')}</Text>
      {props.problems.map((p, i) => (
        <Pressable key={`${p.panel}-${p.id ?? ''}-${i}`} onPress={() => props.onPick(p)} accessibilityRole="button"
          style={({ pressed }) => [s.problem, pressed && s.pressed]}>
          <Text style={[txt.sm, { flex: 1 }]}>{p.text}</Text>
          {p.panel !== props.current ? <Text style={[txt.xsStrong, { color: C.primary }]}>{panelLabel(p.panel)}</Text> : null}
        </Pressable>
      ))}
    </View>
  );
}

// ─── Details ───────────────────────────────────────────────────────────────────

/** What Undo's toast says after a method replaced the steps. */
function replacedWith(m: Method): string {
  if (m === FIA_METHOD) return t('guides.details.replacedFia');
  if (m === BLANK_METHOD) return t('guides.details.replacedBlank');
  return t('guides.details.replacedStepsOf', { title: m.from ?? m.label });
}

function DetailsPanel(props: { ctx: Ctx; draft: GuideDraft; dispatch: Dispatch; isNew: boolean; own: Method[]; setDraft: (d: GuideDraft) => void }) {
  const { ctx, draft, dispatch } = props;
  const set = (patch: Extract<DraftAction, { type: 'set' }>['patch']) => dispatch({ type: 'set', patch });
  const methods = [FIA_METHOD, BLANK_METHOD, ...props.own];
  const written = draft.steps.some((st) => st.text.trim() || st.audio);
  const shareAlike = draft.basis?.shareAlike;
  const useMethod = (m: Method) => {
    const before = draft;
    dispatch({ type: 'useMethod', method: m });
    if (written) ctx.toast(replacedWith(m), () => props.setDraft(before));
  };
  return (
    <View style={{ gap: space.md }}>
      {draft.basis?.adapted ? (
        <Banner icon="share" title={t('guides.details.adapted')}
          body={shareAlike ? t('guides.details.adaptedShareAlike', { license: licenseName(shareAlike) }) : t('guides.details.adaptedCredit')} />
      ) : null}
      <Field label={t('guides.details.title')} value={draft.title} onChangeText={(v) => set({ title: v })} placeholder={t('guides.details.titlePlaceholder')} autoCapitalize="sentences" />
      <SectionLabel label={t('guides.details.method')} />
      <ChipRow>
        {[...new Set(['FIA', ...props.own.map((m) => m.pattern).filter(Boolean), draft.pattern].filter(Boolean))].map((p) => (
          <Chip key={p} label={p} on={draft.pattern === p} onPress={() => set({ pattern: p })} />
        ))}
      </ChipRow>
      <Field label={t('guides.details.ownMethod')} value={draft.pattern} onChangeText={(v) => set({ pattern: v })} placeholder={t('guides.details.ownMethodPlaceholder')} autoCapitalize="words" />
      {props.isNew ? (
        <>
          <Text style={txt.xsStrong}>{t('guides.details.startWith')}</Text>
          <ChipRow>
            {methods.map((m) => <Chip key={m.id} label={m.label} on={false} onPress={() => useMethod(m)} />)}
          </ChipRow>
          <Text style={txt.xs}>{written ? t('guides.details.choosingReplaces') : t('guides.details.nowSteps', { count: draft.steps.length })}</Text>
        </>
      ) : null}
      <Field label={t('guides.details.about')} value={draft.about} onChangeText={(v) => set({ about: v })} placeholder={t('guides.details.aboutPlaceholder')} autoCapitalize="sentences" multiline />
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
            {LICENSES.map((l) => <Chip key={l} label={licenseText(l).name} on={draft.license === l} onPress={() => set({ license: l })} />)}
          </ChipRow>
          {isLicense(draft.license) ? <Text style={txt.xs}>{licenseText(draft.license).means}</Text> : null}
        </>
      )}
      <Field label={t('guides.details.credit')} value={draft.credit} onChangeText={(v) => set({ credit: v })}
        placeholder={t('guides.details.creditPlaceholder', { year: formatNumber(new Date().getFullYear(), { useGrouping: false }) })} autoCapitalize="sentences" />
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
      <Field label={t('guides.placement.verses')} value={draft.ref} onChangeText={(v) => dispatch({ type: 'set', patch: { ref: v } })} placeholder="LUK 15:11-32" autoCapitalize="none" />
      {draft.ref.trim() ? (
        <>
          <Text style={txt.xsStrong}>{t('guides.placement.numberedAs')}</Text>
          <ChipRow>
            {choices.map((c) => <Chip key={c.key} label={c.label} on={draft.versification === c.hash} onPress={() => dispatch({ type: 'set', patch: { versification: c.hash } })} />)}
          </ChipRow>
        </>
      ) : null}
      {draft.parts.length ? (
        <Group>
          {draft.parts.map((p, i) => (
            <Row key={`${p.template}/${p.node}`} icon="template" label={partLabel(p)} sub={t('guides.placement.partSub')} last={i === draft.parts.length - 1}
              right={<IconBtn name="close" label={t('guides.editor.remove', { name: partLabel(p) })} bg={C.light} color={C.primary}
                onPress={() => dispatch({ type: 'set', patch: { parts: draft.parts.filter((_, j) => j !== i) } })} />} />
          ))}
        </Group>
      ) : null}
      <SmallBtn label={t('guides.placement.linkPart')} icon="link" onPress={() => setPicking(true)} />
      <Text style={txt.xs}>{t('guides.placement.help')}</Text>
      <Sheet visible={picking} title={t('guides.placement.sheetTitle')} sub={t('guides.placement.sheetSub')} onClose={() => setPicking(false)}>
        <SearchField value={q} onChangeText={setQ} placeholder={t('guides.placement.search')} />
        {units.length === 0 ? <Text style={txt.smMuted}>{q ? t('common.nothingMatches', { query: q }) : t('guides.placement.noTemplate')}</Text> : null}
        <Group>
          {units.map((u, i) => (
            <Row key={u.unitId} icon="template" label={u.label} last={i === units.length - 1} onPress={() => {
              const slash = u.unitId.indexOf('/');
              const part = { template: u.unitId.slice(0, slash), node: u.unitId.slice(slash + 1) };
              if (!draft.parts.some((p) => p.template === part.template && p.node === part.node)) dispatch({ type: 'set', patch: { parts: [...draft.parts, part] } });
              setPicking(false);
            }} />
          ))}
        </Group>
      </Sheet>
    </View>
  );
}

// ─── Steps ─────────────────────────────────────────────────────────────────────

function StepsPanel(props: { ctx: Ctx; draft: GuideDraft; dispatch: Dispatch; stepId: string | null; setStepId: (id: string | null) => void; preview: StudyGuide; setDraft: (d: GuideDraft) => void }) {
  const { ctx, draft, dispatch } = props;
  const layout = useLayout();
  const sideBySide = layout.kind !== 'phone' && layout.contentWidth >= 960;
  const step = draft.steps.find((st) => st.id === props.stepId) ?? null;
  const index = step ? draft.steps.indexOf(step) : -1;
  const remove = (st: DraftStep) => {
    const before = draft;
    dispatch({ type: 'deleteStep', id: st.id });
    if (props.stepId === st.id) props.setStepId(null);
    ctx.toast(st.title ? t('guides.editor.removed', { name: st.title }) : t('guides.steps.stepRemoved'), () => props.setDraft(before));
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
          <StepRow key={st.id} step={st} index={i} count={draft.steps.length} on={st.id === props.stepId} last={i === draft.steps.length - 1}
            onOpen={() => props.setStepId(st.id)} onMove={(by) => dispatch({ type: 'moveStep', id: st.id, by })} onDelete={() => remove(st)} />
        ))}
      </Group>
      {draft.steps.length === 0 ? <Text style={txt.smMuted}>{t('guides.steps.none')}</Text> : null}
      <SmallBtn label={step ? t('guides.steps.addAfter') : t('guides.steps.add')} icon="plus" onPress={add} />
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
        <LinkBtn label={t('guides.steps.all')} onPress={() => props.setStepId(null)} />
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
  return (
    <View style={[s.stepRow, !props.last && s.rowBorder, props.on && { backgroundColor: C.light }]}>
      <Pressable onPress={props.onOpen} accessibilityRole="button" accessibilityState={{ selected: props.on }}
        accessibilityLabel={st.title ? t('guides.steps.rowLabel', { n, title: st.title, details: sub }) : t('guides.steps.rowLabelUntitled', { n, details: sub })}
        style={({ pressed }) => [{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: target.row }, pressed && s.pressed]}>
        <View style={s.stepNum}><Text style={[txt.sm, { fontWeight: '800', color: C.primary }]}>{formatNumber(n)}</Text></View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[txt.sm, { fontWeight: '700' }]} numberOfLines={1}>{st.title || t('guides.steps.untitled')}</Text>
          <Text style={txt.xs} numberOfLines={1}>{sub}</Text>
        </View>
      </Pressable>
      <IconBtn name="up" label={t('guides.steps.moveUp', { title: st.title })} onPress={() => props.onMove(-1)} disabled={props.index === 0} bg="transparent" color={C.primary} />
      <IconBtn name="down" label={t('guides.steps.moveDown', { title: st.title })} onPress={() => props.onMove(1)} disabled={props.index === props.count - 1} bg="transparent" color={C.primary} />
      <IconBtn name="trash" label={t('guides.editor.remove', { name: st.title })} onPress={props.onDelete} bg="transparent" color={TINT.redText} />
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
        <Field label={t('guides.steps.title')} value={step.title} onChangeText={(v) => update({ title: v })} placeholder={t('guides.steps.titlePlaceholder')} autoCapitalize="words" />
        <Field label={t('guides.steps.phase')} value={step.phase} onChangeText={(v) => update({ phase: v })} placeholder={t('guides.steps.phasePlaceholder')} autoCapitalize="words" />
        {phases.length > 1 ? (
          <ChipRow>{phases.map((p) => <Chip key={p} label={p} on={step.phase.trim() === p} onPress={() => update({ phase: p })} />)}</ChipRow>
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
            <Chip icon="edit" label={t('guides.steps.write')} on={view === 'write'} onPress={() => setView('write')} />
            <Chip icon="sparkle" label={t('common.preview')} on={view === 'preview'} onPress={() => setView('preview')} />
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

/** A toolbar button: an icon and a word, 48pt. */
function ToolBtn(props: { icon: LucideIcon; label: string; onPress: () => void; on?: boolean }) {
  const Icon = props.icon;
  return (
    <Pressable onPress={props.onPress} accessibilityRole="button" accessibilityLabel={props.label} accessibilityState={props.on !== undefined ? { expanded: props.on } : undefined}
      style={({ pressed }) => [s.tool, props.on && { backgroundColor: C.light, borderColor: C.primary }, pressed && s.pressed]}>
      <Icon size={18} color={C.primary} strokeWidth={2.4} />
      <Text style={[txt.xsStrong, { color: C.primary }]}>{props.label}</Text>
    </Pressable>
  );
}

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
  const linkables = [
    ...props.draft.resources.map((r) => ({ ref: r.ref, title: r.title || r.media[0]?.title || untitledResource(r.kind), icon: (r.kind === 'map' ? 'map' : 'camera') as 'map' | 'camera' })),
    ...props.draft.terms.map((term) => ({ ref: term.id, title: term.term || t('guides.text.untitledTerm'), icon: 'book' as const }))
  ];
  return (
    <View style={{ gap: space.sm }}>
      <View style={s.toolbar} accessibilityRole="toolbar">
        <ToolBtn icon={Bold} label={t('guides.text.bold')} onPress={() => apply(boldText(props.text, sel.current))} />
        <ToolBtn icon={List} label={t('guides.text.list')} onPress={() => apply(listText(props.text, sel.current))} />
        <ToolBtn icon={TextQuote} label={t('guides.text.callout')} on={tray === 'callout'} onPress={() => setTray(tray === 'callout' ? null : 'callout')} />
        <Pressable onPress={() => setTray(tray === 'link' ? null : 'link')} accessibilityRole="button" accessibilityLabel={t('guides.text.linkLabel')}
          accessibilityState={{ expanded: tray === 'link' }} style={({ pressed }) => [s.tool, tray === 'link' && { backgroundColor: C.light, borderColor: C.primary }, pressed && s.pressed]}>
          <Ico name="link" size={18} color={C.primary} />
          <Text style={[txt.xsStrong, { color: C.primary }]}>{t('guides.text.link')}</Text>
        </Pressable>
      </View>
      {tray === 'callout' ? (
        <View style={s.tray}>
          {CALLOUT_KINDS.map((k) => <CalloutChoice key={k} kind={k} onPress={() => apply(calloutText(props.text, sel.current, k))} />)}
        </View>
      ) : null}
      {tray === 'link' ? (
        <View style={s.tray}>
          {linkables.length === 0 ? <Text style={txt.smMuted}>{t('guides.text.nothingToLink')}</Text> : null}
          {linkables.map((l) => (
            <SmallBtn key={l.ref} label={`${l.title} · #${l.ref}`} icon={l.icon} onPress={() => apply(linkText(props.text, sel.current, l.ref, l.title))} />
          ))}
        </View>
      ) : null}
      <TextInput value={props.text} onChangeText={props.onChange} onSelectionChange={onSelection} {...(forced ? { selection: forced } : {})}
        multiline accessibilityLabel={t('guides.text.label')} placeholder={t('guides.text.placeholder')}
        placeholderTextColor={C.faint} autoCapitalize="sentences" style={s.textArea} textAlignVertical="top" />
      <Text style={txt.xs}>{t('guides.text.help')}</Text>
    </View>
  );
}

function CalloutChoice(props: { kind: CalloutKind; onPress: () => void }) {
  const look = CALLOUT_LOOK[props.kind];
  const Icon = look.icon;
  return (
    <Pressable onPress={props.onPress} accessibilityRole="button" accessibilityLabel={t('guides.text.insertCallout', { kind: calloutLabel(props.kind) })}
      style={({ pressed }) => [s.calloutChoice, { backgroundColor: look.bg, borderColor: look.edge }, pressed && s.pressed]}>
      <Icon size={16} color={look.ink} strokeWidth={2.4} />
      <Text style={[txt.xsStrong, { color: look.ink }]}>{calloutLabel(props.kind)}</Text>
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
          <IconBtn name="trash" label={props.removeLabel} onPress={() => props.onChange(null)} bg="transparent" color={TINT.redText} />
        </View>
      ) : (
        <>
          <VoiceNote ctx={ctx} label={props.recordLabel} hash={null}
            onChange={(hash, card) => { if (hash) props.onChange({ hash, format: card?.format ?? 'm4a', ...(card ? { seconds: Math.round(card.durationMs / 1000) } : {}) }); }} />
          {canPickFiles ? <SmallBtn label={t('guides.audio.upload')} icon="download" onPress={() => void upload()} /> : null}
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
  useEffect(() => () => audio.pause(), []); // eslint-disable-line react-hooks/exhaustive-deps
  return <AudioBar audio={audio} label={props.label} sub={props.audio.seconds ? shownClock(props.audio.seconds) : undefined} />;
}

// ─── Media ─────────────────────────────────────────────────────────────────────

function MediaPanel(props: { ctx: Ctx; draft: GuideDraft; dispatch: Dispatch; setDraft: (d: GuideDraft) => void }) {
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
  const remove = (r: DraftResource) => {
    const before = draft;
    dispatch({ type: 'deleteResource', ref: r.ref });
    ctx.toast(r.title ? t('guides.editor.removed', { name: r.title }) : t('guides.media.removed'), () => props.setDraft(before));
  };
  const section = (kind: 'media' | 'map') => draft.resources.filter((r) => r.kind === kind);
  return (
    <View style={{ gap: space.md }}>
      {!canPickFiles ? <Banner icon="globe" title={t('guides.media.onWeb')} body={t('guides.media.onWebBody')} /> : null}
      {error ? <Text style={txt.error}>{error}</Text> : null}
      <SectionLabel label={t('guides.media.picturesAndFilms', { n: section('media').length })} />
      {section('media').map((r) => <ResourceCard key={r.ref} ctx={ctx} r={r} dispatch={dispatch} onRemove={() => remove(r)} onAdd={(kind) => void add('media', kind, r)} />)}
      {canPickFiles ? (
        <View style={s.buttons}>
          <SmallBtn label={t('guides.media.addPicture')} icon="camera" onPress={() => void add('media', 'image')} disabled={busy} />
          <SmallBtn label={t('guides.media.addFilm')} icon="video" onPress={() => void add('media', 'video')} disabled={busy} />
        </View>
      ) : null}
      <SectionLabel label={t('guides.media.maps', { n: section('map').length })} />
      {section('map').map((r) => <ResourceCard key={r.ref} ctx={ctx} r={r} dispatch={dispatch} onRemove={() => remove(r)} onAdd={(kind) => void add('map', kind, r)} />)}
      {canPickFiles ? <SmallBtn label={t('guides.media.addMap')} icon="map" onPress={() => void add('map', 'image')} disabled={busy} /> : null}
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
        <Badge label={`#${r.ref}`} tone="brand" />
        <Text style={[txt.sm, { flex: 1, fontWeight: '700' }]} numberOfLines={1}>{r.title || untitledResource(r.kind)}</Text>
        <IconBtn name="trash" label={t('guides.editor.remove', { name: r.title || r.ref })} onPress={props.onRemove} bg="transparent" color={TINT.redText} />
      </View>
      <Field label={t('guides.media.title')} value={r.title} onChangeText={(v) => dispatch({ type: 'updateResource', ref: r.ref, patch: { title: v } })}
        placeholder={r.kind === 'map' ? t('guides.media.mapTitlePlaceholder') : t('guides.media.picturesTitlePlaceholder')} autoCapitalize="sentences" />
      <Field label={t('guides.media.description')} value={r.description} onChangeText={(v) => dispatch({ type: 'updateResource', ref: r.ref, patch: { description: v } })}
        placeholder={t('guides.media.descriptionPlaceholder')} autoCapitalize="sentences" />
      {r.media.map((m) => <MediaItem key={m.id} ctx={props.ctx} r={r} m={m} dispatch={dispatch} />)}
      {canPickFiles && r.kind === 'media' ? <SmallBtn label={t('guides.media.addAnother')} icon="plus" onPress={() => props.onAdd('image')} /> : null}
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
          <IconBtn name="close" label={m.title ? t('guides.editor.remove', { name: m.title }) : t('guides.media.removeThisPicture')} onPress={() => dispatch({ type: 'deleteMedia', ref: r.ref, id: m.id })} bg="transparent" color={C.muted} />
        </View>
        {r.kind === 'media' && m.kind !== 'video' ? (
          <ChipRow>
            {(['photo', 'illustration'] as const).map((k) => <Chip key={k} label={mediaKindLabel(k)} on={m.kind === k} onPress={() => patch({ kind: k })} />)}
          </ChipRow>
        ) : null}
        {r.media.length > 1 ? <Field label={t('guides.media.pictureTitle')} value={m.title} onChangeText={(v) => patch({ title: v })} placeholder={t('guides.media.pictureTitlePlaceholder')} autoCapitalize="sentences" /> : null}
        <Field label={t('guides.media.caption')} value={m.caption} onChangeText={(v) => patch({ caption: v })} placeholder={t('guides.media.captionPlaceholder')} autoCapitalize="sentences" />
      </View>
    </View>
  );
}

function ThumbImage(props: { uri: string; label: string }) {
  return <Image source={{ uri: props.uri }} accessibilityLabel={props.label} style={{ width: '100%', height: '100%' }} resizeMode="cover" />;
}

// ─── Glossary ──────────────────────────────────────────────────────────────────

function GlossaryPanel(props: { ctx: Ctx; draft: GuideDraft; dispatch: Dispatch; setDraft: (d: GuideDraft) => void }) {
  const { ctx, draft, dispatch } = props;
  const remove = (term: DraftTerm) => {
    const before = draft;
    dispatch({ type: 'deleteTerm', id: term.id });
    ctx.toast(term.term ? t('guides.editor.removed', { name: term.term }) : t('guides.glossary.removed'), () => props.setDraft(before));
  };
  return (
    <View style={{ gap: space.md }}>
      {draft.terms.length === 0 ? <Text style={txt.smMuted}>{t('guides.glossary.none')}</Text> : null}
      {draft.terms.map((term) => (
        <Card key={term.id}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <Badge label={`#${term.id}`} tone="brand" />
            <Text style={[txt.sm, { flex: 1, fontWeight: '700' }]} numberOfLines={1}>{term.term || t('guides.glossary.newTerm')}</Text>
            <IconBtn name="trash" label={term.term ? t('guides.editor.remove', { name: term.term }) : t('guides.glossary.removeThisTerm')} onPress={() => remove(term)} bg="transparent" color={TINT.redText} />
          </View>
          <Field label={t('guides.glossary.term')} value={term.term} onChangeText={(v) => dispatch({ type: 'updateTerm', id: term.id, patch: { term: v } })} placeholder={t('guides.glossary.termPlaceholder')} autoCapitalize="none" />
          <Field label={t('guides.glossary.hint')} value={term.hint} onChangeText={(v) => dispatch({ type: 'updateTerm', id: term.id, patch: { hint: v } })} placeholder={t('guides.glossary.hintPlaceholder')} autoCapitalize="sentences" />
          <Field label={t('guides.glossary.meaning')} value={term.body} onChangeText={(v) => dispatch({ type: 'updateTerm', id: term.id, patch: { body: v } })} placeholder={t('guides.glossary.meaningPlaceholder')} autoCapitalize="sentences" multiline />
          <AudioSlot ctx={ctx} label={t('guides.glossary.audio')} removeLabel={t('guides.glossary.removeAudio')} recordLabel={t('guides.glossary.record')} audio={term.audio}
            onChange={(audio) => dispatch({ type: 'setTermAudio', id: term.id, audio })} />
        </Card>
      ))}
      <SmallBtn label={t('guides.glossary.add')} icon="plus" onPress={() => dispatch({ type: 'addTerm' })} />
    </View>
  );
}

const s = StyleSheet.create({
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

