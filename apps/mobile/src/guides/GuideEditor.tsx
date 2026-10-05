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
  CALLOUT_KINDS, LICENSE_INFO, LICENSES, isLicense, orgLicense, subscriptionItemId, templateOfUnit, unitTitle,
  type CalloutKind, type MediaRef, type StudyDoc, type StudyDoc2, type VersificationDoc
} from '@langquest-next/core';
import { Bold, List, TextQuote, type LucideIcon } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, TextInput, View, type NativeSyntheticEvent, type TextInputSelectionChangeEventData } from 'react-native';
import type { Ctx } from '../ctx';
import {
  Badge, Banner, Card, Chip, ChipRow, EmptyState, Field, Group, Header, Ico, IconBtn, LinkBtn, PrimaryBtn, Row, Screen, SearchField,
  SectionLabel, Sheet, SmallBtn, txt, useLayout
} from '../kit';
import { useLibrary, useLibraryDocs, useSharedItems } from '../library/useLibrary';
import { failureMessage } from '../report';
import type { StudyGuide, StudyResource } from '../study/guides';
import { guideFromDoc, glossaryEntryOf } from '../study/guideMatch';
import { useStudyFileUri } from '../study/media';
import { AudioBar, CALLOUT_LOOK, GlossarySheet, MediaSheet, StepPreview, useStudyAudio } from '../study/ui';
import { clock } from '../study/text';
import { C, measure, radius, space, target, TINT, type as T } from '../theme';
import { VoiceNote } from '../voiceNote';
import {
  boldText, buildDoc, calloutText, draftFromDoc, draftProblems, draftReducer, linkText, listText, newDraft, nextId,
  type DraftAction, type DraftMedia, type DraftPanel, type DraftProblem, type DraftResource, type DraftStep, type DraftTerm, type GuideDraft, type Selection
} from './draft';
import { draftKey, dropDraft, loadDraft, saveDraft } from './draftStore';
import { canPickFiles, FileProblem, keepPicked, mediaKindFor, pickFile, uploadDraftFiles, type PickKind } from './files';
import { BLANK_METHOD, FIA_METHOD, methodFromDoc, type Method } from './methods';

type Dispatch = (a: DraftAction) => void;

const PANELS: { id: DraftPanel; label: string; icon: 'edit' | 'sparkle' | 'media' | 'book' }[] = [
  { id: 'details', label: 'Details', icon: 'edit' },
  { id: 'steps', label: 'Steps', icon: 'sparkle' },
  { id: 'media', label: 'Media', icon: 'media' },
  { id: 'glossary', label: 'Glossary', icon: 'book' }
];

const isStudy = (d: unknown): d is StudyDoc | StudyDoc2 => !!d && typeof d === 'object' && ['study@1', 'study@2'].includes((d as { format?: string }).format ?? '');
const time = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/** A stand-in while the draft or its source loads, or when this person may not write guides. */
function Waiting(props: { ctx: Ctx; title: string; sub?: string }) {
  return (
    <Screen header={<Header title="Write a guide" onBack={props.ctx.back} />}>
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
  const orgName = ctx.org.state?.org?.value.name ?? 'Our organization';
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
    if (!sourceHash) { setDraft(newDraft({ method: FIA_METHOD, orgName, license })); return; }
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
    const t = setTimeout(() => { void saveDraft(key, draft).then(setSavedAt).catch(() => undefined); }, 600);
    return () => clearTimeout(t);
  }, [draft, key]);

  if (!canManage) return <Waiting ctx={ctx} title="Only people who manage reference material can write guides." />;
  if (!draft) {
    const gone = looked && sourceHash && docs.get(sourceHash) && !isStudy(source);
    return <Waiting ctx={ctx} title={gone ? 'That is not a study guide.' : 'Loading…'} {...(itemId && !it && ctx.org.state ? { sub: 'This guide is not in your library any more.' } : {})} />;
  }
  return (
    <Editor ctx={ctx} draft={draft} setDraft={setDraft} dispatch={dispatch} draftKey={key} restored={restored} savedAt={savedAt}
      own={own.flatMap((i) => { const d = docs.get(i.current); return isStudy(d) && i.current !== sourceHash ? [methodFromDoc(i.itemId, d)] : []; })}
      isNew={!sourceHash} title={itemId ? 'Edit guide' : from ? 'Adapt a guide' : 'Write a guide'}
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
      ctx.toast(problems.length === 1 ? 'One thing to fix before publishing.' : `${problems.length} things to fix before publishing.`);
      return;
    }
    setBusy('Publishing…');
    try {
      await ensureVersification();
      await uploadDraftFiles(lib.orgId, draft, (done, total) => { if (total) setBusy(`Uploading ${Math.min(done + 1, total)} of ${total}…`); });
      setBusy('Publishing…');
      const doc = buildDoc(draft);
      await lib.publish({
        kind: 'material', ...(draft.basis?.itemId ? { itemId: draft.basis.itemId } : {}), name: doc.title,
        description: `Study guide${doc.pattern ? ` · ${doc.pattern}` : ''}`, doc
      });
      await dropDraft(props.draftKey);
      ctx.toast(`${doc.title} is published. Phones get it when they next sync.`);
      ctx.back();
    } catch (e) {
      // The draft stays on the device; publishing again picks up where this stopped.
      ctx.toast(`${failureMessage('publish guide', e)} Your draft is kept.`);
      setBusy(null);
    }
  }

  const counts: Record<DraftPanel, number | null> = { details: null, steps: draft.steps.length, media: draft.resources.length, glossary: draft.terms.length };
  const saved = props.savedAt ? `Draft saved on this device at ${time(props.savedAt)}.` : 'Drafts are saved on this device as you write.';
  return (
    <Screen fixed={false} columnWidth={wide ? measure.report : undefined}
      header={<Header title={draft.title.trim() || props.title} {...(draft.title.trim() ? { sub: props.title } : {})} onBack={ctx.back} columnWidth={wide ? measure.report : undefined} />}
      footer={<PrimaryBtn label={busy ?? (draft.basis?.itemId ? 'Publish new version' : 'Publish')} onPress={() => void publish()} disabled={!!busy} />}>
      {/* Forms keep the reading width; only the steps use the whole window, side by side. */}
      <View style={[{ gap: space.md }, panel === 'steps' ? null : s.reading]}>
        {/* Tabs within the screen (kit ChipRow): they scroll sideways on a phone instead of shrinking. */}
        <View accessibilityRole="tablist">
          <ChipRow>
            {PANELS.map((p) => (
              <Chip key={p.id} icon={p.icon} label={p.label} on={panel === p.id} onPress={() => setPanel(p.id)}
                {...(counts[p.id] !== null ? { count: counts[p.id]! } : {})} />
            ))}
          </ChipRow>
        </View>
        <Text style={[txt.xs, { paddingHorizontal: space.xs }]}>{saved} One person edits a guide at a time.</Text>
        {props.restored && panel === 'details' ? (
          <Banner icon="history" title={`Your draft from ${time(props.restored)} is open.`} body="Publish it, or keep writing. Nothing is published until you do." />
        ) : null}
        {props.newer ? (
          <Banner icon="history" tone="amber" title="A newer version was published after you started this draft."
            body="Publishing yours makes it the next version, without their changes." />
        ) : null}
        {tried && problems.length > 0 ? <Problems problems={problems} current={panel} onPick={goTo} /> : null}
        {tried && problems.length === 0 ? <Banner icon="check" tone="green" title="Ready to publish." /> : null}
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
      <Text style={[txt.sm, { fontWeight: '700', color: TINT.amberText }]}>Before publishing</Text>
      {props.problems.map((p, i) => (
        <Pressable key={`${p.panel}-${p.id ?? ''}-${i}`} onPress={() => props.onPick(p)} accessibilityRole="button"
          style={({ pressed }) => [s.problem, pressed && s.pressed]}>
          <Text style={[txt.sm, { flex: 1 }]}>{p.text}</Text>
          {p.panel !== props.current ? <Text style={[txt.xsStrong, { color: C.primary }]}>{PANELS.find((x) => x.id === p.panel)?.label}</Text> : null}
        </Pressable>
      ))}
    </View>
  );
}

// ─── Details ───────────────────────────────────────────────────────────────────

function DetailsPanel(props: { ctx: Ctx; draft: GuideDraft; dispatch: Dispatch; isNew: boolean; own: Method[]; setDraft: (d: GuideDraft) => void }) {
  const { ctx, draft, dispatch } = props;
  const set = (patch: Extract<DraftAction, { type: 'set' }>['patch']) => dispatch({ type: 'set', patch });
  const methods = [FIA_METHOD, BLANK_METHOD, ...props.own];
  const written = draft.steps.some((st) => st.text.trim() || st.audio);
  const shareAlike = draft.basis?.shareAlike;
  const useMethod = (m: Method) => {
    const before = draft;
    dispatch({ type: 'useMethod', method: m });
    if (written) ctx.toast(`Steps replaced with ${m.label.toLowerCase()}.`, () => props.setDraft(before));
  };
  return (
    <View style={{ gap: space.md }}>
      {draft.basis?.adapted ? (
        <Banner icon="share" title="Adapted from someone else's guide"
          body={shareAlike
            ? `It is shared under ${LICENSE_INFO[shareAlike as keyof typeof LICENSE_INFO]?.name ?? shareAlike}, which is share-alike: what you make from it stays under the same license, with their credit.`
            : 'Their credit stays with it. Your changes publish as your own guide; theirs never changes.'} />
      ) : null}
      <Field label="Title" value={draft.title} onChangeText={(v) => set({ title: v })} placeholder="e.g. Luke 15:11–32, or Clean water" autoCapitalize="sentences" />
      <SectionLabel label="Method" />
      <ChipRow>
        {[...new Set(['FIA', ...props.own.map((m) => m.pattern).filter(Boolean), draft.pattern].filter(Boolean))].map((p) => (
          <Chip key={p} label={p} on={draft.pattern === p} onPress={() => set({ pattern: p })} />
        ))}
      </ChipRow>
      <Field label="Or your own name for it" value={draft.pattern} onChangeText={(v) => set({ pattern: v })} placeholder="e.g. Story study" autoCapitalize="words" />
      {props.isNew ? (
        <>
          <Text style={txt.xsStrong}>Start with these steps</Text>
          <ChipRow>
            {methods.map((m) => <Chip key={m.id} label={m.label} on={false} onPress={() => useMethod(m)} />)}
          </ChipRow>
          <Text style={txt.xs}>{written ? 'Choosing replaces the steps you have. You can undo it.' : `Now: ${draft.steps.length} step${draft.steps.length === 1 ? '' : 's'}.`}</Text>
        </>
      ) : null}
      <Field label="About" value={draft.about} onChangeText={(v) => set({ about: v })} placeholder="What the guide does, in a sentence or two" autoCapitalize="sentences" multiline />
      <Field label="Language of the text" value={draft.language} onChangeText={(v) => set({ language: v.trim().toLowerCase() })} placeholder="eng" autoCapitalize="none" />

      <SectionLabel label="Where it applies" />
      <Placement ctx={ctx} draft={draft} dispatch={dispatch} />

      <SectionLabel label="License and credit" />
      {shareAlike ? (
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <Ico name="lock" size={18} color={C.muted} />
            <Text style={[txt.sm, { fontWeight: '700', flex: 1 }]}>{LICENSE_INFO[shareAlike as keyof typeof LICENSE_INFO]?.name ?? shareAlike}</Text>
          </View>
          <Text style={txt.xs}>Share-alike applies: an adaptation keeps the license of what it adapts.</Text>
        </Card>
      ) : (
        <>
          <ChipRow>
            {LICENSES.map((l) => <Chip key={l} label={LICENSE_INFO[l].name} on={draft.license === l} onPress={() => set({ license: l })} />)}
          </ChipRow>
          {isLicense(draft.license) ? <Text style={txt.xs}>{LICENSE_INFO[draft.license].means}</Text> : null}
        </>
      )}
      <Field label="Credit" value={draft.credit} onChangeText={(v) => set({ credit: v })} placeholder="© 2026 Your organization" autoCapitalize="sentences" />
      <Field label="Where it comes from (shown with the guide)" value={draft.source} onChangeText={(v) => set({ source: v })} placeholder="Your organization" autoCapitalize="sentences" />
    </View>
  );
}

/** A verse range in a numbering, or parts of the content templates the languages use. */
function Placement(props: { ctx: Ctx; draft: GuideDraft; dispatch: Dispatch }) {
  const { ctx, draft, dispatch } = props;
  const lib = useLibrary(ctx);
  const state = ctx.project.state;
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
    choices.unshift({ key: 'doc', label: docs.get<VersificationDoc>(draft.versification)?.name ?? 'Its numbering', hash: draft.versification });
  }
  const units = useMemo(() => {
    if (!state || !picking) return [];
    const needle = q.trim().toLowerCase();
    return Object.keys(state.units)
      .filter((u) => templateOfUnit(u)?.catalogVersion === 0)
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
      <Field label="Verses" value={draft.ref} onChangeText={(v) => dispatch({ type: 'set', patch: { ref: v } })} placeholder="LUK 15:11-32" autoCapitalize="none" />
      {draft.ref.trim() ? (
        <>
          <Text style={txt.xsStrong}>Numbered as in</Text>
          <ChipRow>
            {choices.map((c) => <Chip key={c.key} label={c.label} on={draft.versification === c.hash} onPress={() => dispatch({ type: 'set', patch: { versification: c.hash } })} />)}
          </ChipRow>
        </>
      ) : null}
      {draft.parts.length ? (
        <Group>
          {draft.parts.map((p, i) => (
            <Row key={`${p.template}/${p.node}`} icon="template" label={partLabel(p)} sub="A part of a content template" last={i === draft.parts.length - 1}
              right={<IconBtn name="close" label={`Remove ${partLabel(p)}`} bg={C.light} color={C.primary}
                onPress={() => dispatch({ type: 'set', patch: { parts: draft.parts.filter((_, j) => j !== i) } })} />} />
          ))}
        </Group>
      ) : null}
      <SmallBtn label="Link a part of a template" icon="link" onPress={() => setPicking(true)} />
      <Text style={txt.xs}>Bible passages are found by their verses. Lessons and stories in an outline template are found by the part you link.</Text>
      <Sheet visible={picking} title="Link a part" sub="Parts of the content templates your languages use." onClose={() => setPicking(false)}>
        <SearchField value={q} onChangeText={setQ} placeholder="Search parts" />
        {units.length === 0 ? <Text style={txt.smMuted}>{q ? `Nothing matches “${q}”.` : 'No language uses a library template yet.'}</Text> : null}
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
    ctx.toast(`${st.title || 'The step'} was removed.`, () => props.setDraft(before));
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
      {draft.steps.length === 0 ? <Text style={txt.smMuted}>No steps yet.</Text> : null}
      <SmallBtn label={step ? 'Add a step after this one' : 'Add a step'} icon="plus" onPress={add} />
    </View>
  );
  if (sideBySide) {
    return (
      <View style={s.split}>
        <View style={s.splitList}>{list}</View>
        <View style={{ flex: 1, minWidth: 0 }}>
          {step ? <StepEditor key={step.id} ctx={ctx} draft={draft} step={step} index={index} dispatch={dispatch} preview={props.preview} />
            : <EmptyState icon="sparkle" title="Pick a step" sub="It opens here to write." />}
        </View>
      </View>
    );
  }
  if (step) {
    return (
      <View style={{ gap: space.md }}>
        <LinkBtn label="‹ All steps" onPress={() => props.setStepId(null)} />
        <StepEditor key={step.id} ctx={ctx} draft={draft} step={step} index={index} dispatch={dispatch} preview={props.preview} />
      </View>
    );
  }
  return list;
}

function StepRow(props: { step: DraftStep; index: number; count: number; on: boolean; last: boolean; onOpen: () => void; onMove: (by: -1 | 1) => void; onDelete: () => void }) {
  const st = props.step;
  const words = st.text.trim() ? st.text.trim().split(/\s+/).length : 0;
  const sub = [st.phase, words ? `${words} words` : 'No text yet', st.audio ? 'audio' : null].filter(Boolean).join(' · ');
  return (
    <View style={[s.stepRow, !props.last && s.rowBorder, props.on && { backgroundColor: C.light }]}>
      <Pressable onPress={props.onOpen} accessibilityRole="button" accessibilityState={{ selected: props.on }}
        accessibilityLabel={`Step ${props.index + 1}: ${st.title || 'untitled'}. ${sub}`}
        style={({ pressed }) => [{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: target.row }, pressed && s.pressed]}>
        <View style={s.stepNum}><Text style={[txt.sm, { fontWeight: '800', color: C.primary }]}>{props.index + 1}</Text></View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[txt.sm, { fontWeight: '700' }]} numberOfLines={1}>{st.title || 'Untitled step'}</Text>
          <Text style={txt.xs} numberOfLines={1}>{sub}</Text>
        </View>
      </Pressable>
      <IconBtn name="up" label={`Move ${st.title} up`} onPress={() => props.onMove(-1)} disabled={props.index === 0} bg="transparent" color={C.primary} />
      <IconBtn name="down" label={`Move ${st.title} down`} onPress={() => props.onMove(1)} disabled={props.index === props.count - 1} bg="transparent" color={C.primary} />
      <IconBtn name="trash" label={`Remove ${st.title}`} onPress={props.onDelete} bg="transparent" color={TINT.redText} />
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
      <Text style={txt.xs}>As the study step shows it. Tap a link to check it.</Text>
      <StepPreview text={step.text} onOpenRef={openRef} />
    </View>
  );
  return (
    <View style={{ gap: space.md }}>
      <Card>
        <Text style={txt.label}>Step {props.index + 1}</Text>
        <Field label="Title" value={step.title} onChangeText={(v) => update({ title: v })} placeholder="e.g. Setting the Stage" autoCapitalize="words" />
        <Field label="Phase (a group of steps)" value={step.phase} onChangeText={(v) => update({ phase: v })} placeholder="e.g. Familiarize" autoCapitalize="words" />
        {phases.length > 1 ? (
          <ChipRow>{phases.map((p) => <Chip key={p} label={p} on={step.phase.trim() === p} onPress={() => update({ phase: p })} />)}</ChipRow>
        ) : null}
        <Field label="Purpose (one line under the title)" value={step.purpose} onChangeText={(v) => update({ purpose: v })} placeholder="What this step is for" autoCapitalize="sentences" />
      </Card>
      <AudioSlot ctx={ctx} label="Step audio" audio={step.audio} recordLabel="Record this step"
        onChange={(audio) => dispatch({ type: 'setStepAudio', id: step.id, audio })} />
      {sideBySide ? (
        <View style={s.split}>
          <View style={{ flex: 1, minWidth: 0 }}>{editor}</View>
          <View style={{ flex: 1, minWidth: 0 }}>{preview}</View>
        </View>
      ) : (
        <>
          <ChipRow>
            <Chip icon="edit" label="Write" on={view === 'write'} onPress={() => setView('write')} />
            <Chip icon="sparkle" label="Preview" on={view === 'preview'} onPress={() => setView('preview')} />
          </ChipRow>
          {view === 'write' ? editor : preview}
        </>
      )}
      {opened && opened.kind !== 'term' ? <MediaSheet resource={opened} source={`${props.preview.pattern || 'Guide'} media`} orgId={ctx.project.orgId} onClose={() => setOpened(null)} /> : null}
      {opened && entry ? (
        <GlossarySheet entry={entry} source={props.preview.source} orgId={ctx.project.orgId} hasKeyTerm={false} onOpenTerm={() => undefined} onClose={() => setOpened(null)} />
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
    ...props.draft.resources.map((r) => ({ ref: r.ref, title: r.title || r.media[0]?.title || (r.kind === 'map' ? 'Map' : 'Pictures'), icon: (r.kind === 'map' ? 'map' : 'camera') as 'map' | 'camera' })),
    ...props.draft.terms.map((t) => ({ ref: t.id, title: t.term || 'Term', icon: 'book' as const }))
  ];
  return (
    <View style={{ gap: space.sm }}>
      <View style={s.toolbar} accessibilityRole="toolbar">
        <ToolBtn icon={Bold} label="Bold" onPress={() => apply(boldText(props.text, sel.current))} />
        <ToolBtn icon={List} label="List" onPress={() => apply(listText(props.text, sel.current))} />
        <ToolBtn icon={TextQuote} label="Callout" on={tray === 'callout'} onPress={() => setTray(tray === 'callout' ? null : 'callout')} />
        <Pressable onPress={() => setTray(tray === 'link' ? null : 'link')} accessibilityRole="button" accessibilityLabel="Link a picture, map or term"
          accessibilityState={{ expanded: tray === 'link' }} style={({ pressed }) => [s.tool, tray === 'link' && { backgroundColor: C.light, borderColor: C.primary }, pressed && s.pressed]}>
          <Ico name="link" size={18} color={C.primary} />
          <Text style={[txt.xsStrong, { color: C.primary }]}>Link</Text>
        </Pressable>
      </View>
      {tray === 'callout' ? (
        <View style={s.tray}>
          {CALLOUT_KINDS.map((k) => <CalloutChoice key={k} kind={k} onPress={() => apply(calloutText(props.text, sel.current, k))} />)}
        </View>
      ) : null}
      {tray === 'link' ? (
        <View style={s.tray}>
          {linkables.length === 0 ? <Text style={txt.smMuted}>Add pictures, maps or glossary terms first; then link them here.</Text> : null}
          {linkables.map((l) => (
            <SmallBtn key={l.ref} label={`${l.title} · #${l.ref}`} icon={l.icon} onPress={() => apply(linkText(props.text, sel.current, l.ref, l.title))} />
          ))}
        </View>
      ) : null}
      <TextInput value={props.text} onChangeText={props.onChange} onSelectionChange={onSelection} {...(forced ? { selection: forced } : {})}
        multiline accessibilityLabel="Step text" placeholder={'Write the step. A blank line starts a new paragraph.\n\n> [!action] Stop here and discuss…'}
        placeholderTextColor={C.faint} autoCapitalize="sentences" style={s.textArea} textAlignVertical="top" />
      <Text style={txt.xs}>Select words before Bold, Callout or Link to use them. Each paragraph, list item and callout is a part the team can note.</Text>
    </View>
  );
}

function CalloutChoice(props: { kind: CalloutKind; onPress: () => void }) {
  const look = CALLOUT_LOOK[props.kind];
  const Icon = look.icon;
  return (
    <Pressable onPress={props.onPress} accessibilityRole="button" accessibilityLabel={`Insert a ${look.label} callout`}
      style={({ pressed }) => [s.calloutChoice, { backgroundColor: look.bg, borderColor: look.edge }, pressed && s.pressed]}>
      <Icon size={16} color={look.ink} strokeWidth={2.4} />
      <Text style={[txt.xsStrong, { color: look.ink }]}>{look.label}</Text>
    </Pressable>
  );
}

// ─── Audio for a step or a term ────────────────────────────────────────────────────

/** Play what is there, or record it (any device), or upload a file (web). */
function AudioSlot(props: { ctx: Ctx; label: string; recordLabel: string; audio: MediaRef | undefined; onChange: (a: MediaRef | null) => void }) {
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
          <View style={{ flex: 1, minWidth: 0 }}><MediaPlayer orgId={ctx.project.orgId} audio={props.audio!} label={props.label} /></View>
          <IconBtn name="trash" label={`Remove ${props.label.toLowerCase()}`} onPress={() => props.onChange(null)} bg="transparent" color={TINT.redText} />
        </View>
      ) : (
        <>
          <VoiceNote ctx={ctx} unitId="" laneId="" label={props.recordLabel} hash={null}
            onChange={(hash, card) => { if (hash) props.onChange({ hash, format: card?.format ?? 'm4a', ...(card ? { seconds: Math.round(card.durationMs / 1000) } : {}) }); }} />
          {canPickFiles ? <SmallBtn label="Or upload an audio file" icon="download" onPress={() => void upload()} /> : null}
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
  return <AudioBar audio={audio} label={props.label} sub={props.audio.seconds ? clock(props.audio.seconds) : undefined} />;
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
    ctx.toast(`${r.title || 'It'} was removed.`, () => props.setDraft(before));
  };
  const section = (kind: 'media' | 'map') => draft.resources.filter((r) => r.kind === kind);
  return (
    <View style={{ gap: space.md }}>
      {!canPickFiles ? <Banner icon="globe" title="Add pictures, maps and films in the web app." body="Here you can rename them and write their captions." /> : null}
      {error ? <Text style={txt.error}>{error}</Text> : null}
      <SectionLabel label={`Pictures and films · ${section('media').length}`} />
      {section('media').map((r) => <ResourceCard key={r.ref} ctx={ctx} r={r} dispatch={dispatch} onRemove={() => remove(r)} onAdd={(kind) => void add('media', kind, r)} />)}
      {canPickFiles ? (
        <View style={s.buttons}>
          <SmallBtn label="Add a picture" icon="camera" onPress={() => void add('media', 'image')} disabled={busy} />
          <SmallBtn label="Add a film" icon="video" onPress={() => void add('media', 'video')} disabled={busy} />
        </View>
      ) : null}
      <SectionLabel label={`Maps · ${section('map').length}`} />
      {section('map').map((r) => <ResourceCard key={r.ref} ctx={ctx} r={r} dispatch={dispatch} onRemove={() => remove(r)} onAdd={(kind) => void add('map', kind, r)} />)}
      {canPickFiles ? <SmallBtn label="Add a map" icon="map" onPress={() => void add('map', 'image')} disabled={busy} /> : null}
      <Text style={txt.xs}>
        {busy ? 'Keeping the file and making a phone copy…' : 'Pictures get a small copy for phones (500 pixels, JPEG). Films are kept as they are: no small phone copy is made yet, so phones get the full film.'}
      </Text>
      <Text style={txt.xs}>Link one from a step with Link, or by writing its ref: [the well](#m1).</Text>
    </View>
  );
}

function ResourceCard(props: { ctx: Ctx; r: DraftResource; dispatch: Dispatch; onRemove: () => void; onAdd: (kind: PickKind) => void }) {
  const { r, dispatch } = props;
  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <Badge label={`#${r.ref}`} tone="brand" />
        <Text style={[txt.sm, { flex: 1, fontWeight: '700' }]} numberOfLines={1}>{r.title || (r.kind === 'map' ? 'Map' : 'Pictures')}</Text>
        <IconBtn name="trash" label={`Remove ${r.title || r.ref}`} onPress={props.onRemove} bg="transparent" color={TINT.redText} />
      </View>
      <Field label="Title" value={r.title} onChangeText={(v) => dispatch({ type: 'updateResource', ref: r.ref, patch: { title: v } })} placeholder={r.kind === 'map' ? 'e.g. Judea and Samaria' : 'e.g. Carob pods'} autoCapitalize="sentences" />
      <Field label="Description (optional)" value={r.description} onChangeText={(v) => dispatch({ type: 'updateResource', ref: r.ref, patch: { description: v } })} placeholder="Shown above the pictures" autoCapitalize="sentences" />
      {r.media.map((m) => <MediaItem key={m.id} ctx={props.ctx} r={r} m={m} dispatch={dispatch} />)}
      {canPickFiles && r.kind === 'media' ? <SmallBtn label="Add another picture to this set" icon="plus" onPress={() => props.onAdd('image')} /> : null}
    </Card>
  );
}

function MediaItem(props: { ctx: Ctx; r: DraftResource; m: DraftMedia; dispatch: Dispatch }) {
  const { r, m, dispatch } = props;
  const file = m.file.lowHash ? { hash: m.file.lowHash, format: m.kind === 'video' ? 'mp4' : 'jpg' } : m.file.hash ? { hash: m.file.hash, format: m.file.format ?? 'jpg' } : undefined;
  const { uri } = useStudyFileUri(props.ctx.project.orgId, m.kind === 'video' ? undefined : file, m.file.url);
  const patch = (p: Partial<Omit<DraftMedia, 'id'>>) => dispatch({ type: 'updateMedia', ref: r.ref, id: m.id, patch: p });
  const status = m.kind === 'video' ? (m.file.lowHash ? 'Film · phone copy ready' : 'Film · phone copy not made yet')
    : m.file.lowHash ? 'Picture · phone copy ready' : m.file.url ? 'Picture from a link' : 'Picture';
  return (
    <View style={s.mediaItem}>
      <View style={s.thumb}>
        {uri ? <ThumbImage uri={uri} label={m.title} /> : <Ico name={m.kind === 'video' ? 'video' : m.kind === 'map' ? 'map' : 'camera'} size={28} color={C.faint} />}
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: space.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <Text style={[txt.xs, { flex: 1 }]}>{status}</Text>
          <IconBtn name="close" label={`Remove ${m.title || 'this picture'}`} onPress={() => dispatch({ type: 'deleteMedia', ref: r.ref, id: m.id })} bg="transparent" color={C.muted} />
        </View>
        {r.kind === 'media' && m.kind !== 'video' ? (
          <ChipRow>
            {(['photo', 'illustration'] as const).map((k) => <Chip key={k} label={k === 'photo' ? 'Photo' : 'Illustration'} on={m.kind === k} onPress={() => patch({ kind: k })} />)}
          </ChipRow>
        ) : null}
        {r.media.length > 1 ? <Field label="Picture title" value={m.title} onChangeText={(v) => patch({ title: v })} placeholder="Title" autoCapitalize="sentences" /> : null}
        <Field label="Caption" value={m.caption} onChangeText={(v) => patch({ caption: v })} placeholder="One sentence under it" autoCapitalize="sentences" />
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
  const remove = (t: DraftTerm) => {
    const before = draft;
    dispatch({ type: 'deleteTerm', id: t.id });
    ctx.toast(`${t.term || 'The term'} was removed.`, () => props.setDraft(before));
  };
  return (
    <View style={{ gap: space.md }}>
      {draft.terms.length === 0 ? <Text style={txt.smMuted}>No glossary terms yet. A term opens from a step's link, with its meaning and audio.</Text> : null}
      {draft.terms.map((t) => (
        <Card key={t.id}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <Badge label={`#${t.id}`} tone="brand" />
            <Text style={[txt.sm, { flex: 1, fontWeight: '700' }]} numberOfLines={1}>{t.term || 'New term'}</Text>
            <IconBtn name="trash" label={`Remove ${t.term || 'this term'}`} onPress={() => remove(t)} bg="transparent" color={TINT.redText} />
          </View>
          <Field label="Term" value={t.term} onChangeText={(v) => dispatch({ type: 'updateTerm', id: t.id, patch: { term: v } })} placeholder="e.g. sin" autoCapitalize="none" />
          <Field label="Hint (a few words)" value={t.hint} onChangeText={(v) => dispatch({ type: 'updateTerm', id: t.id, patch: { hint: v } })} placeholder="e.g. doing wrong" autoCapitalize="sentences" />
          <Field label="Meaning" value={t.body} onChangeText={(v) => dispatch({ type: 'updateTerm', id: t.id, patch: { body: v } })} placeholder="What it means, in plain words" autoCapitalize="sentences" multiline />
          <AudioSlot ctx={ctx} label="Term audio" recordLabel="Record the term" audio={t.audio} onChange={(audio) => dispatch({ type: 'setTermAudio', id: t.id, audio })} />
        </Card>
      ))}
      <SmallBtn label="Add a term" icon="plus" onPress={() => dispatch({ type: 'addTerm' })} />
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

