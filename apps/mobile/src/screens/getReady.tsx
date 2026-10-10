// Get ‹language› ready (decision 71; demo ADR-039, SIMPLE-12; the
// prototype's simple/admin.tsx AdminStart, RecordWhat, ListenTo, WhoChecks,
// InviteNow, PickTemplate and Helps). An admin who knows nothing about the
// app's model gets a language ready with four plain questions, each with the
// likely answer already picked:
//   1 What will they record?   the language's content template (as New Language and template_picker apply it)
//   2 What will help them?     Bibles and study guides offered to its team (the recommendations reference_bibles/guides write)
//   3 Who checks the recordings? its review flow (chosen as flows_home chooses it; "I'll choose the steps" opens the flow editor)
//   4 Invite your translators  a group code to scan (the invite RPC Invite by QR uses)
// Params: `languageId` (opens that language) and `step`: none for the
// checklist, '1'..'4' for the questions (Next walks on through the rest),
// 'helps' for What helps them on a ready language. `only: '1'` opens
// question 1 alone, as "What to translate" from a ready language's page.
import {
  commands, CUSTOM_FLOW, deriveFlow, deriveKinds, keyTermsFor, languageInfo, languageName, materialsFor,
  goesWith, isTemplateDoc, recommendedFor, subscriptionItemId, templateBooks,
  type CollectionDoc, type EventSpec, type LibraryDoc, type SourceDoc
} from '@langquest-next/core';
import * as Crypto from 'expo-crypto';
import { useMemo, useState, type ReactNode } from 'react';
import { Text, View } from 'react-native';
import { type LibraryChoice } from '../contentTemplates';
import type { Ctx } from '../ctx';
import { useHelpMode } from '../helpContext';
import { indexesFor } from '../indexes';
import { Banner, Chip, EmptyState, Group, Header, PrimaryBtn, QuietLinks, Row, Screen, SectionLabel, Sheet, txt } from '../kit';
import { sourceLine, type SharedItem } from '../library/model';
import { useLibrary, useLibraryDocs, useSharedItems } from '../library/useLibrary';
import { booksInScope, mayGrantAt, type LanguageScope } from '../orgAdmin';
import { languageOf, recState, refKindOf, sourceFacts, type RefKind } from '../reference/model';
import { referenceFailure, useRecommend } from '../reference/useReference';
import { failureMessage } from '../report';
import { contractsFor } from '../screenContracts';
import { shareText } from '../share';
import { C, space } from '../theme';
import {
  BigTop, CheckRow, SwitchRow, ChoiceCard, DashedRow, InviteCode, NumberedSteps, Pills, Question, QuietLink, useGroupInvite
} from '../simple/admin';
import {
  flowSub, flowTitle, flowWho, guideShortName, languageLabel, recordSummary, scopeOfBooks,
  type PlainRoleId } from '../simple/adminModel';
import { howItWorks, ReadyChecklist, usePlainRoles, useReadySummary } from '../simple/ready';
import { useCheckChoices, type FlowEntry } from '../simple/choices';
import { TranslateQuestion, useTranslate } from '../breakup/TranslateStep';
import { NumberingNote, RedoSheet } from '../breakup/parts';
import { useVerseNumbering } from '../breakup/useBreakup';

const PAD = { paddingHorizontal: 20, gap: 14 } as const;

export function GetReady(ctx: Ctx) {
  const step = ctx.params['step'];
  if (!ctx.language.state || !ctx.org.state) {
    return <Screen header={<Header title="Get ready" onBack={ctx.back} close />}><EmptyState icon="cloud" title="Loading" sub="Reading this language from this device." /></Screen>;
  }
  if (step === 'helps') return <HelpsPage ctx={ctx} />;
  const n = Number(step);
  if (n >= 1 && n <= 4) return <Questions ctx={ctx} start={n} only={ctx.params['only'] === '1'} />;
  return <Overview ctx={ctx} />;
}

// ---- the checklist -----------------------------------------------------------------------

function Overview({ ctx }: { ctx: Ctx }) {
  const s = useReadySummary(ctx);
  const help = useHelpMode();
  const next = s.readiness.current;
  return (
    <Screen header={<BigTop onBack={ctx.back} over={s.name} title={`Get ${s.name} ready`} />} bodyStyle={{ gap: space.md }}
      footer={next >= 0
        ? <PrimaryBtn label={['What will they record?', 'What will help them?', 'Who checks the recordings?', 'Invite your translators'][next]!} icon="right"
            onPress={() => ctx.go('get_ready', { languageId: s.languageId, step: String(next + 1) })} />
        : <PrimaryBtn label="Done" icon="check" onPress={ctx.back} />}>
      <ReadyChecklist ctx={ctx} s={s} />
      {help ? <QuietLink icon="playSolid" label="How this works · 0:40" detail="Hear how the four questions fit together."
        onPress={() => { help.setOn(true); help.explain('How this works', howItWorks(s.name)); }} /> : null}
    </Screen>
  );
}

// ---- the questions, one per screen ----------------------------------------------------------

interface StepProps {
  ctx: Ctx;
  lang: string;
  header: ReactNode;
  /** Answered: on to the next question, or back where the admin came from. */
  next: () => void;
  only: boolean;
}

function Questions({ ctx, start, only }: { ctx: Ctx; start: number; only: boolean }) {
  const [n, setN] = useState(start);
  const lang = languageName(ctx.org.state, ctx.language.languageId);
  const header = only
    ? <Header title="What to translate" sub={lang} onBack={ctx.back} />
    : <Header title={`Get ${lang} ready`} sub={`${n} of 4`} onBack={ctx.back} close />;
  const next = () => (only || n >= 4 ? ctx.back() : setN(n + 1));
  const props: StepProps = { ctx, lang, header, next, only };
  switch (n) {
    case 1: return <RecordStep {...props} />;
    case 2: return <HelpsStep {...props} />;
    // Choosing the steps opens the flow editor; coming back lands here, on what was saved.
    case 3: return <ChecksStep {...props} onChoose={() => setN(3)} />;
    default: return <InviteStep {...props} />;
  }
}

// ---- 1 What will they translate? (decision 74) ----------------------------------------------------

function RecordStep({ ctx, lang, header, next, only }: StepProps) {
  const state = ctx.language.state!;
  const languageId = ctx.language.languageId;
  const sel = state.template?.value;
  const t = useTranslate(ctx, languageId);
  const lib = t.ways.lib;
  const [scope, setScope] = useState<LanguageScope | null>(null);
  const [chosen, setChosen] = useState<Set<string> | null>(null);
  const [busy, setBusy] = useState(false);
  const doc = t.finalDoc;
  const inUse = t.what === 'bible' ? !!t.row?.inUse && t.finalDoc === t.doc : t.outline === t.rec.current && !!t.outline;
  const books = chosen ?? new Set(inUse ? sel?.books ?? [] : []);
  const pills: LanguageScope = scope ?? (inUse && sel ? scopeOfBooks(doc, sel.books) : 'nt');
  const wanted = doc?.bible ? booksInScope(doc, pills, books) : undefined;
  const same = (a: readonly string[] | undefined, b: readonly string[] | undefined) =>
    a === b || (!!a && !!b && a.length === b.length && a.every((x) => b.includes(x)));
  const changed = t.ready && (!inUse || !same(wanted, sel?.books));
  const canUse = ctx.session.can('manage_templates');
  // Any work at all, published or not: a change of numbering moves it (decision 80).
  const worked = useMemo(() => Object.keys(state.recordings).length + Object.keys(state.takes).length > 0, [state]);
  const [warn, setWarn] = useState(false);

  async function answer(confirmed = false) {
    if (busy) return;
    if (!changed) { next(); return; }
    // A new numbering changes sections that may hold work: say so first (decision 80).
    if (t.numberingChanged && worked && !confirmed) { setWarn(true); return; }
    setWarn(false);
    if (!canUse) { ctx.toast('Only people who set up languages can change this.'); return; }
    if (wanted && wanted.length === 0) { ctx.toast('Choose at least one book.'); return; }
    setBusy(true);
    try {
      const prev = state.template?.value;
      // Undo re-applies what it used before (none when that version is not on this device).
      const undo = prev?.itemId && prev.docHash
        ? await lib.applySpecs(prev.itemId, { docHash: prev.docHash, ...(prev.books ? { books: prev.books } : {}) }).catch(() => null)
        : null;
      const use = await t.resolve();
      const specs = await lib.applySpecs(use.itemId, { docHash: use.docHash, ...(wanted ? { books: wanted } : {}), ...(use.unitPrefix ? { unitPrefix: use.unitPrefix } : {}) });
      try {
        await ctx.act(specs, `${lang} translates ${recordSummary(use.doc, wanted, use.doc.name)}.`, undo ? () => undo : undefined);
      } catch { setBusy(false); return; }
      setBusy(false);
      next();
    } catch (e) {
      ctx.toast(failureMessage('get ready: what they translate', e));
      setBusy(false);
    }
  }

  return (
    <Screen header={header} bodyStyle={PAD}
      footer={<PrimaryBtn label={only ? (changed ? 'Use this' : 'Keep it') : 'Next'} icon={only ? 'check' : 'right'} busy={busy} disabled={!t.ready && !only}
        onPress={() => void answer()} />}>
      <TranslateQuestion ctx={ctx} t={t} lang={lang} canMake={canUse} onMake={() => ctx.go('template_editor', { new: '1' })} />
      {doc?.bible ? (
        <>
          <SectionLabel label="Which part of the Bible?" />
          <Pills>
            {(['nt', 'ot', 'all', 'custom'] as LanguageScope[]).map((sc) => (
              <Chip key={sc} label={{ nt: 'New Testament', ot: 'Old Testament', all: 'Whole Bible', custom: 'Choose books' }[sc]} on={pills === sc}
                onPress={() => { setScope(sc); if (sc === 'custom' && !chosen) setChosen(new Set(wanted ?? templateBooks(doc).map((b) => b.book))); }} />
            ))}
          </Pills>
          {pills === 'custom' ? (
            <Pills>
              {templateBooks(doc).map((b) => (
                <Chip key={b.book} label={b.name || b.book} on={books.has(b.book)}
                  onPress={() => setChosen(() => { const nextSet = new Set(books); if (nextSet.has(b.book)) nextSet.delete(b.book); else nextSet.add(b.book); return nextSet; })} />
              ))}
            </Pills>
          ) : null}
        </>
      ) : null}
      {changed && worked ? (
        <Text style={[txt.smMuted, { paddingHorizontal: space.xs }]}>Pieces that stay the same keep their recordings. What was recorded on a piece that changes is kept under "Earlier sections" on the new pieces.</Text>
      ) : null}
      {!canUse ? <Banner icon="lock" title="View only" body="Only people who set up languages can change what they translate." /> : null}
      <RedoSheet visible={warn} book={lang} numbering busy={busy} onClose={() => setWarn(false)} onConfirm={() => void answer(true)} />
    </Screen>
  );
}

// ---- 2 What will help them? ----------------------------------------------------------------------

interface HelpItem {
  key: string;
  /** In this organization's library; null for one another organization shares, followed when turned on. */
  itemId: string | null;
  shared: SharedItem | null;
  name: string;
  kind: RefKind;
  doc: LibraryDoc;
  on: boolean;
  owner: string;
}

/**
 * Everything that can help a language's team: the organization's Bibles,
 * guides and notes, and the Bibles and guides (in the language its team
 * reads) that other organizations share. On means recommended to this
 * language, as Bibles and Guides and Notes write it.
 */
function useHelpItems(ctx: Ctx) {
  const lib = useLibrary(ctx);
  const org = ctx.org.state;
  const state = ctx.language.state;
  const languageId = ctx.language.languageId;
  const shared = useSharedItems('material', lib.orgId);
  const items = lib.items('material').filter((it) => it.current && !it.archived);
  const others = shared.rows.filter((s) => s.latest_hash && !org?.library[subscriptionItemId(s.org_id, s.item_id)]);
  const docs = useLibraryDocs(lib.orgId, [...items.map((it) => it.current), ...others.map((s) => s.latest_hash)], { deps: false });
  const rec = useRecommend(ctx);
  const [busy, setBusy] = useState(false);
  const offered = recommendedFor(org?.recommendations, state);
  const reads = languageInfo(org, languageId)?.sourceCode ?? 'eng';
  const out: HelpItem[] = [];
  const say = state?.languageReferences ?? {};
  for (const it of items) {
    const doc = docs.get(it.current);
    const kind = refKindOf(doc);
    if (!doc || !kind || kind === 'questions') continue;
    // A Bible reaches the team when recommended; a guide or note in the library reaches it unless hidden here (reference/offered.ts).
    const on = kind === 'source' ? offered.has(it.itemId) : say[it.itemId]?.value !== 'hidden';
    out.push({ key: it.itemId, itemId: it.itemId, shared: null, name: it.name, kind, doc, on, owner: sourceLine(it) });
  }
  for (const s of others) {
    const doc = docs.get(s.latest_hash);
    const kind = refKindOf(doc);
    if (!doc || (kind !== 'source' && kind !== 'guide')) continue;
    if (kind === 'guide' && languageOf(doc) && languageOf(doc) !== reads) continue;
    out.push({ key: `shared:${s.org_id}/${s.item_id}`, itemId: null, shared: s, name: s.name, kind, doc, on: false, owner: `From ${s.org_name}` });
  }
  // By name, examples last; never by on or off, so a row stays put when it is switched.
  const rank = (h: HelpItem) => (/example/i.test(h.name) ? 1 : 0);
  out.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  const may = ctx.session.can('manage_reference');
  async function toggle(h: HelpItem) {
    if (busy || !may || !languageId) return;
    setBusy(true);
    try {
      // Another organization's is followed first, with automatic updates (copied when it may not be followed).
      const itemId = h.itemId ?? (h.shared!.subscribable ? await lib.subscribe(h.shared!, true) : await lib.copy(h.shared!));
      const level = { kind: 'language' as const, languageId };
      const r = recState(org?.recommendations, state, level, itemId);
      // Off: a Bible stops being recommended here (hidden when the organization recommends it); a guide or note is hidden here.
      // On: what was hidden follows the organization again, else it is recommended here.
      const action = h.on
        ? (h.kind === 'source' && !r.org ? 'inherit' : 'hide')
        : (r.language === 'hidden' && (r.org || h.kind !== 'source') ? 'inherit' : 'recommend');
      await rec.run(level, itemId, h.name, action);
    } catch (e) {
      ctx.toast(`Not saved. ${referenceFailure('offer reference', e)}`);
    } finally {
      setBusy(false);
    }
  }
  return { items: out, toggle, busy, may, loading: !shared.loaded, get: docs.get };
}

/** "Audio and text", "Audio", "Text". */
function mediaOf(doc: SourceDoc, get: (h: string | null | undefined) => LibraryDoc | null): string {
  const f = sourceFacts(doc, get);
  const text = f.text.OT || f.text.NT;
  const audio = f.audio.OT || f.audio.NT;
  return text && audio ? 'Audio and text' : audio ? 'Audio' : text ? 'Text' : 'Listed';
}

/**
 * Whether a guide set was made for how this language's Bible is broken up
 * (decision 74): "goes with your FIA passages", or, when it is broken up
 * another way, that the guides follow FIA's passages.
 */
function useComesWith(ctx: Ctx) {
  const sel = ctx.language.state?.template?.value;
  const docs = useLibraryDocs(ctx.language.orgId, [sel?.docHash], { deps: false });
  const t = docs.get(sel?.docHash);
  return (g: HelpItem): string => {
    if (g.kind !== 'guide' || g.doc.format !== 'collection@1') return '';
    const c = g.doc as CollectionDoc;
    const pattern = c.pattern ?? (/\bFIA\b/.test(c.title) ? 'FIA' : undefined);
    if (!pattern || !t || !isTemplateDoc(t) || !t.bible) return '';
    return goesWith(t, pattern) ? `goes with your ${pattern} passages` : `made for ${pattern}'s passages`;
  };
}

function HelpsStep({ ctx, header, next }: StepProps) {
  const languageId = ctx.language.languageId;
  const h = useHelpItems(ctx);
  const numbering = useVerseNumbering(ctx);
  const comes = useComesWith(ctx);
  const bibles = h.items.filter((x) => x.kind === 'source');
  const guides = h.items.filter((x) => x.kind === 'guide');
  const notes = h.items.filter((x) => x.kind === 'note' || x.kind === 'other');
  return (
    <Screen header={header} bodyStyle={PAD} footer={<PrimaryBtn label="Next" icon="right" onPress={next} />}>
      <Question>What will help them?</Question>
      <SectionLabel label="Bibles they understand" />
      <Group>
        {bibles.map((b) => {
          const doc = b.doc as SourceDoc;
          return (
            <CheckRow key={b.key} label={`${languageLabel(doc.language)} · ${doc.abbreviation}`} sub={mediaOf(doc, h.get)} checked={b.on}
              disabled={!h.may || h.busy} onToggle={() => void h.toggle(b)} playLabel={`Hear ${b.name}`}
              {...(b.itemId ? { onPlay: () => ctx.go('reference_source', { itemId: b.itemId!, languageId }) } : {})} />
          );
        })}
        <Row icon="search" label="Find another Bible" sub={bibles.length ? undefined : 'None chosen yet'} last
          onPress={() => ctx.go('reference_bibles', { languageId })} />
      </Group>
      {guides.length ? (
        <Group>
          {guides.map((g, i) => (
            <SwitchRow key={g.key} icon="star" label={guides.length === 1 ? 'Study guides' : `${guideShortName(g.name)} study guides`}
              sub={[guides.length === 1 ? guideShortName(g.name) : sourceShort(g.owner), g.on ? 'on' : 'off', comes(g)].filter(Boolean).join(' · ')}
              on={g.on} disabled={!h.may || h.busy} onToggle={() => void h.toggle(g)} last={i === guides.length - 1} />
          ))}
        </Group>
      ) : h.loading ? <Text style={txt.smMuted}>Looking for study guides…</Text> : null}
      {numbering.clash ? <NumberingNote clash={numbering.clash} onIgnore={numbering.ignore} /> : null}
      {notes.length ? (
        <>
          <SectionLabel label="Notes for translators" />
          <Group>
            {notes.map((x, i) => (
              <SwitchRow key={x.key} icon="note" label={x.name} sub={x.on ? 'On' : 'Off'} on={x.on} disabled={!h.may || h.busy}
                onToggle={() => void h.toggle(x)} last={i === notes.length - 1} />
            ))}
          </Group>
        </>
      ) : null}
      {!h.may ? <Banner icon="lock" title="View only" body="Only people who choose Bibles and guides can change this." /> : null}
    </Screen>
  );
}

/** What helps them, on a ready language: every kind of help with a switch each, and Add more. */
function HelpsPage({ ctx }: { ctx: Ctx }) {
  const state = ctx.language.state!;
  const languageId = ctx.language.languageId;
  const lang = languageName(ctx.org.state, languageId);
  const h = useHelpItems(ctx);
  const reads = languageLabel(languageInfo(ctx.org.state, languageId)?.sourceCode ?? 'eng');
  const [adding, setAdding] = useState(false);
  const terms = useMemo(() => keyTermsFor(state), [state]);
  const written = useMemo(() => materialsFor(state).filter((m) => m.kind !== 'questions' && m.kind !== 'key_terms' && m.kind !== 'fia_study'), [state]);
  const switchRow = (x: HelpItem, last: boolean, sub: string) => (
    <SwitchRow key={x.key} label={plainName(x.name, reads)} sub={sub} on={x.on} disabled={!h.may || h.busy} onToggle={() => void h.toggle(x)} last={last} />
  );
  const none = (what: string) => <Row label={`No ${what} yet`} sub="Add more to offer some" muted last />;
  const bibles = h.items.filter((x) => x.kind === 'source');
  const guides = h.items.filter((x) => x.kind === 'guide');
  const notes = h.items.filter((x) => x.kind === 'note' || x.kind === 'other');
  const rendered = terms.filter((t) => t.renderings.length > 0).length;
  const go = (to: Parameters<Ctx['go']>[0], params: Record<string, string>) => { setAdding(false); ctx.go(to, params); };
  return (
    <Screen header={<Header title="What helps them" sub={lang} onBack={ctx.back} />} bodyStyle={{ gap: space.sm }}
      footer={h.may ? <PrimaryBtn label="Add more" icon="plus" onPress={() => setAdding(true)} /> : undefined}>
      <SectionLabel label="Bibles" />
      <Group>
        {bibles.length ? bibles.map((b, i) => {
          const doc = b.doc as SourceDoc;
          return switchRow(b, i === bibles.length - 1, `${languageLabel(doc.language)} · ${mediaOf(doc, h.get).toLowerCase()}`);
        }) : none('Bibles')}
      </Group>
      <SectionLabel label="Study guides" />
      <Group>
        {guides.length ? guides.map((g, i) => {
          const entries = g.doc.format === 'collection@1' ? (g.doc as CollectionDoc).entries.length : 0;
          return switchRow(g, i === guides.length - 1, [g.owner.startsWith('From ') ? g.owner : sourceShort(g.owner), entries ? `${entries.toLocaleString('en-US')} passage${entries === 1 ? '' : 's'} covered` : ''].filter(Boolean).join(' · '));
        }) : none('study guides')}
      </Group>
      <SectionLabel label="Key words" />
      <Group>
        <Row label="Key terms" sub={`${terms.length.toLocaleString('en-US')} words · ${rendered} with a ${lang} word`} last
          onPress={() => ctx.go('key_terms', { languageId })} />
      </Group>
      <SectionLabel label="Notes for translators" />
      <Group>
        {notes.map((x, i) => switchRow(x, i === notes.length - 1 && written.length === 0, x.owner))}
        {written.map((m, i) => (
          <Row key={m.materialId} label={m.title} sub="Written here, for this language" last={i === written.length - 1}
            onPress={h.may ? () => ctx.go('material_editor', { materialId: m.materialId, languageId }) : undefined} />
        ))}
        {notes.length + written.length === 0 ? none('notes') : null}
      </Group>
      <Sheet visible={adding} title="Add more" sub={`Something to help ${lang}'s translators`} onClose={() => setAdding(false)}>
        <Group>
          <Row icon="search" label="A Bible" sub="One they understand, with text or audio" onPress={() => go('reference_bibles', { languageId })} />
          <Row icon="star" label="A study guide" sub="Follow one others share, or write your own" onPress={() => go('reference_guides', { languageId })} />
          <Row icon="note" label="A note for translators" sub="Something to know before recording" onPress={() => go('material_editor', { itemId: 'new', kind: 'note', languageId })} />
          <Row icon="key" label="Key words" sub="Words to say the same way every time" onPress={() => go('key_terms', { languageId })} />
          <Row icon="layers" label="Everything in your library" sub="Question sets, sharing and more" last onPress={() => go('reference_home', { languageId })} />
        </Group>
      </Sheet>
    </Screen>
  );
}

/** "FIA study guides (English)" for a team that reads English: "FIA study guides". */
function plainName(name: string, reads: string): string {
  return name.replace(new RegExp(`\\s*\\(${reads}\\)\\s*$`), '').trim() || name;
}

/** "Following LangQuest · updates automatically" -> "From LangQuest". */
function sourceShort(line: string): string {
  const m = /^Following (.+?) ·/.exec(line);
  return m ? `From ${m[1]}` : line;
}

// ---- 3 Who checks the recordings? -------------------------------------------------------------

function ChecksStep({ ctx, header, next, onChoose }: StepProps & { onChoose: () => void }) {
  const state = ctx.language.state!;
  const languageId = ctx.language.languageId;
  const kinds = useMemo(() => deriveKinds(state), [state]);
  const flow = useMemo(() => deriveFlow(state), [state]);
  const custom = flow.flowId === CUSTOM_FLOW;
  const { lib, entries, current, starter, first, main, rest, kindsOf, titleOf, loaded } = useCheckChoices(ctx, flow.itemId, kinds);
  const [picked, setPicked] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const key = picked ?? (custom ? 'custom' : first?.c.key ?? null);
  const canUse = ctx.session.can('manage_flows');

  async function answer() {
    if (busy) return;
    if (key === 'choose') { ctx.go('flow_editor', { languageId, steps: 'language' }); onChoose(); return; }
    const pick = entries.find((e) => e.c.key === key);
    if (!pick || pick.c === current || key === 'custom') { next(); return; }
    if (!canUse) { ctx.toast('Only people who choose who checks can change this.'); return; }
    setBusy(true);
    let specs: EventSpec[];
    try {
      const itemId = pick.c.source === 'shared' ? (pick.c.shared.subscribable ? await lib.subscribe(pick.c.shared, true) : await lib.copy(pick.c.shared)) : pick.c.item.itemId;
      specs = await lib.applySpecs(itemId, { docHash: pick.c.hash });
    } catch (e) {
      ctx.toast(`Not saved. ${failureMessage('get ready: who checks', e)}`);
      setBusy(false);
      return;
    }
    // Undo goes back to the checks it had, whose steps were never removed (core restoreFlow).
    const previous = state.flow?.value ? { flow: state.flow.value, steps: flow.steps } : null;
    const undo = previous ? () => {
      const s = ctx.language.state;
      return s ? commands(s, indexesFor(s)).restoreFlow({ commandId: Crypto.randomUUID(), previous }) : [];
    } : undefined;
    try {
      await ctx.act(specs, `${titleOf(pick.doc)} checks the recordings.`, undo);
    } catch { setBusy(false); return; }
    setBusy(false);
    next();
  }

  const card = (e: FlowEntry, i: number) => {
    const on = key === e.c.key;
    const sub = e.c === current ? 'In use' : e === starter && i === 0 ? 'Suggested' : flowSub(e.doc.steps);
    return (
      <ChoiceCard key={e.c.key} on={on} icon="people" title={titleOf(e.doc)} sub={sub} onPress={() => setPicked(e.c.key)}>
        {on && e.doc.steps.length ? <NumberedSteps items={flowWho(e.doc.steps, kindsOf(e.doc))} /> : null}
      </ChoiceCard>
    );
  };
  return (
    <Screen header={header} bodyStyle={PAD}
      footer={<PrimaryBtn label={key === 'choose' ? 'Choose the steps' : 'Next'} icon="right" busy={busy} onPress={() => void answer()} />}>
      <Question>Who checks the recordings?</Question>
      {custom ? (
        <ChoiceCard on={key === 'custom'} icon="people" title={flowTitle(flow.steps, kinds)} sub="In use · your own steps" onPress={() => setPicked('custom')}>
          {key === 'custom' ? <NumberedSteps items={flowWho(flow.steps, kinds)} /> : null}
        </ChoiceCard>
      ) : null}
      {main.map(card)}
      {canUse ? (
        <ChoiceCard on={key === 'choose'} icon="edit" title="I'll choose the steps" onPress={() => setPicked('choose')} />
      ) : null}
      {rest.length ? (
        more ? (
          <>
            <SectionLabel label="Other ways to check" />
            {rest.map((e, i) => card(e, i + 1))}
          </>
        ) : <QuietLink icon="down" label={`Other ways to check · ${rest.length}`} onPress={() => setMore(true)} />
      ) : null}
      {entries.length === 0 ? <Text style={txt.smMuted}>{loaded ? 'No ways to check yet. Choose the steps yourself.' : 'Loading…'}</Text> : null}
      <Text style={[txt.sm, { color: C.muted, paddingHorizontal: space.xs }]}>Pick the people later, or when you invite them.</Text>
    </Screen>
  );
}

// ---- 4 Invite your translators -------------------------------------------------------------------

function InviteStep({ ctx, lang, header, next }: StepProps) {
  const languageId = ctx.language.languageId;
  const scope = { level: 'language' as const, languageId };
  const roles = usePlainRoles(ctx, scope);
  const [choice, setChoice] = useState<PlainRoleId | string>('translate');
  const [more, setMore] = useState(false);
  const may = ctx.session.can('invite_members') && mayGrantAt(ctx.org.state, ctx.session.actorId, scope);
  const roleId = roles.choices.find((c) => c.id === choice)?.roleId ?? roles.others.find((r) => r.id === choice)?.id ?? null;
  const invite = useGroupInvite(ctx.language.orgId, may ? roleId : null, may ? scope : null, `${lang} team`);
  const uri = invite && 'uri' in invite ? invite.uri : null;
  return (
    <Screen header={header} bodyStyle={PAD}
      footer={<>
        <PrimaryBtn label="Done" icon="check" onPress={next} />
        {uri ? <QuietLinks items={[{ label: 'Share as a link', icon: 'send', onPress: () => void shareText(uri).then((r) => {
          if (r === 'copied') ctx.toast('Invite link copied. Paste it into a message.');
          else if (r === 'failed') ctx.toast('Could not share it. Show the code instead.');
        }) }]} /> : null}
      </>}>
      <Question>Invite your translators</Question>
      <Pills>
        {roles.choices.map((c) => <Chip key={c.id} label={c.chip} on={choice === c.id} onPress={() => setChoice(c.id)} />)}
        {more ? roles.others.map((r) => <Chip key={r.id} label={r.name} on={choice === r.id} onPress={() => setChoice(r.id)} />) : null}
        {!more && (roles.others.length || ctx.session.can('manage_roles')) ? <Chip label="Something else" icon="plus" on={false} onPress={() => setMore(true)} /> : null}
      </Pills>
      {more && ctx.session.can('manage_roles') ? (
        <DashedRow icon="plus" label="Something else: make a new role" onPress={() => ctx.go('role_editor', { roleId: 'new' })} />
      ) : null}
      {may ? <InviteCode state={invite} /> : (
        <Banner icon="lock" title="Only people who can invite here can show a code" body={`Ask someone who runs ${lang}'s team to invite your translators.`} />
      )}
    </Screen>
  );
}

export const contracts = contractsFor('get_ready');
