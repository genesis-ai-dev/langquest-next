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
  commands, CUSTOM_FLOW, deriveFlow, keyTermsFor, languageInfo, languageName, languageProgress, materialsFor,
  goesWith, isTemplateDoc, recommendedFor, subscriptionItemId, templateBooks,
  type CollectionDoc, type EventSpec, type LibraryDoc, type SourceDoc
} from '@langquest-next/core';
import * as Crypto from 'expo-crypto';
import { useMemo, useState, type ReactNode } from 'react';
import { View } from 'react-native';
import { Text } from '../text';
import { type LibraryChoice } from '../contentTemplates';
import { deriveKinds } from '../coreText';
import type { Ctx } from '../ctx';
import { useHelpMode } from '../helpContext';
import { t } from '../i18n';
import { formatClock, formatNumber } from '../i18n/format';
import { indexesFor } from '../indexes';
import { Banner, Chip, EmptyState, Group, Header, PrimaryBtn, QuietLinks, Row, Screen, SectionLabel, Sheet, txt } from '../kit';
import { sourceLine, type SharedItem } from '../library/model';
import { useLibrary, useLibraryDocs, useSharedItems } from '../library/useLibrary';
import { booksInScope, LANGUAGE_SCOPES, languageScopeLabel, mayGrantAt, type LanguageScope } from '../orgAdmin';
import { recState, refKindOf, sourceFacts, type RefKind } from '../reference/model';
import { referenceFailure, useRecommend } from '../reference/useReference';
import { GuideLanguageSheet } from '../reference/GuideLanguageSheet';
import { chooseSetLanguage, guideSets, hideSet, originOf, setKeyOf, setReach, type GuideSet, type ReferenceSay, type SetMember } from '../reference/guideSets';
import { docLanguage, languagesLine, readerLanguage, sameLanguage } from '../reference/languages';
import { failureMessage } from '../report';
import { contractsFor } from '../screenContracts';
import { C, space } from '../theme';
import {
  BigTop, CheckRow, SwitchRow, ChoiceCard, DashedRow, InviteCode, NumberedSteps, Pills, Question, QuietLink, useGroupInvite
} from '../simple/admin';
import {
  flowSub, flowTitle, flowWho, guideShortName, languageLabel, QUESTIONS, questionLabel, recordSummary, scopeOfBooks,
  type PlainRoleId } from '../simple/adminModel';
import { shareInvite } from '../simple/invite';
import { howItWorks, ReadyChecklist, usePlainRoles, useReadySummary } from '../simple/ready';
import { useCheckChoices, type FlowEntry } from '../simple/choices';
import { TranslateQuestion, useTranslate } from '../breakup/TranslateStep';
import { NumberingNote, RedoSheet } from '../breakup/parts';
import { useVerseNumbering } from '../breakup/useBreakup';

const PAD = { paddingHorizontal: 20, gap: 14 } as const;

export function GetReady(ctx: Ctx) {
  const step = ctx.params['step'];
  if (!ctx.language.state || !ctx.org.state) {
    return <Screen header={<Header title={t('getReady.loading.title')} onBack={ctx.back} close />}><EmptyState icon="cloud" title={t('getReady.loading.empty')} sub={t('getReady.loading.sub')} /></Screen>;
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
    <Screen header={<BigTop onBack={ctx.back} over={s.name} title={t('getReady.title', { language: s.name })} />} bodyStyle={{ gap: space.md }}
      footer={next >= 0
        ? <PrimaryBtn label={questionLabel(QUESTIONS[next]!.id)} icon="right"
            onPress={() => ctx.go('get_ready', { languageId: s.languageId, step: String(next + 1) })} />
        : <PrimaryBtn label={t('common.done')} icon="check" onPress={ctx.back} />}>
      <ReadyChecklist ctx={ctx} s={s} />
      {help ? <QuietLink icon="playSolid" label={t('admin.howItWorks.link', { length: formatClock(40_000) })} detail={t('admin.howItWorks.detail')}
        onPress={() => { help.setOn(true); help.explain(t('admin.howItWorks.title'), howItWorks(s.name)); }} /> : null}
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
    ? <Header title={t('getReady.whatToTranslate')} sub={lang} onBack={ctx.back} />
    : <Header title={t('getReady.title', { language: lang })} sub={t('getReady.stepOf', { step: formatNumber(n), total: formatNumber(4) })} onBack={ctx.back} close />;
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
  const tq = useTranslate(ctx, languageId);
  const lib = tq.ways.lib;
  const [scope, setScope] = useState<LanguageScope | null>(null);
  const [chosen, setChosen] = useState<Set<string> | null>(null);
  const [busy, setBusy] = useState(false);
  const doc = tq.finalDoc;
  const inUse = tq.what === 'bible' ? !!tq.row?.inUse && tq.finalDoc === tq.doc : tq.outline === tq.rec.current && !!tq.outline;
  const books = chosen ?? new Set(inUse ? sel?.books ?? [] : []);
  const pills: LanguageScope = scope ?? (inUse && sel ? scopeOfBooks(doc, sel.books) : 'nt');
  const wanted = doc?.bible ? booksInScope(doc, pills, books) : undefined;
  const same = (a: readonly string[] | undefined, b: readonly string[] | undefined) =>
    a === b || (!!a && !!b && a.length === b.length && a.every((x) => b.includes(x)));
  const changed = tq.ready && (!inUse || !same(wanted, sel?.books));
  const canUse = ctx.session.can('manage_templates');
  // Any work at all, published or not: a change of numbering moves it (decision 80).
  const worked = useMemo(() => Object.keys(state.recordings).length + Object.keys(state.takes).length > 0, [state]);
  const [warn, setWarn] = useState(false);

  async function answer(confirmed = false) {
    if (busy) return;
    if (!changed) { next(); return; }
    // A new numbering changes sections that may hold work: say so first (decision 80).
    if (tq.numberingChanged && worked && !confirmed) { setWarn(true); return; }
    setWarn(false);
    if (!canUse) { ctx.toast(t('getReady.record.onlySetUp')); return; }
    if (wanted && wanted.length === 0) { ctx.toast(t('getReady.record.chooseABook')); return; }
    setBusy(true);
    try {
      const prev = state.template?.value;
      // Undo re-applies what it used before (none when that version is not on this device).
      const undo = prev?.itemId && prev.docHash
        ? await lib.applySpecs(prev.itemId, { docHash: prev.docHash, ...(prev.books ? { books: prev.books } : {}) }).catch(() => null)
        : null;
      const use = await tq.resolve();
      const specs = await lib.applySpecs(use.itemId, { docHash: use.docHash, ...(wanted ? { books: wanted } : {}), ...(use.unitPrefix ? { unitPrefix: use.unitPrefix } : {}) });
      try {
        await ctx.act(specs, t('getReady.record.saved', { language: lang, what: recordSummary(use.doc, wanted, use.doc.name) }), undo ? () => undo : undefined);
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
      footer={<>
        {/* One question a screen: the pages before the last move on inside the question (decision 80). */}
        {!tq.last ? (
          tq.showContinue ? <PrimaryBtn label={t('common.next')} icon="right" disabled={!tq.canContinue} onPress={() => { tq.advance(); }} /> : null
        ) : (
          <PrimaryBtn label={only ? (changed ? t('getReady.record.useThis') : t('getReady.record.keepIt')) : t('common.next')} icon={only ? 'check' : 'right'} busy={busy} disabled={!tq.ready && !only}
            onPress={() => void answer()} />
        )}
        {tq.page !== 'what' ? <QuietLinks items={[{ label: t('common.back'), icon: 'arrowL', onPress: () => { tq.retreat(); } }]} /> : null}
      </>}>
      <TranslateQuestion ctx={ctx} t={tq} lang={lang} canMake={canUse} onMake={() => ctx.go('template_editor', { new: '1' })} />
      {doc?.bible && tq.last ? (
        <>
          <SectionLabel label={t('getReady.record.whichPart')} />
          <Pills>
            {LANGUAGE_SCOPES.map((sc) => (
              <Chip key={sc} label={languageScopeLabel(sc)} on={pills === sc}
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
      {changed && worked && tq.last ? (
        <Text style={[txt.smMuted, { paddingHorizontal: space.xs }]}>{t('getReady.record.keepEarlier')}</Text>
      ) : null}
      {!canUse ? <Banner icon="lock" title={t('common.viewOnly')} body={t('getReady.record.viewOnly')} /> : null}
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
  /** Where it comes from, as a line under its name. */
  owner: string;
  /** The organization it is followed from or shared by, when it is another's. */
  from: string | null;
  /** A guide set in several languages (FIA), chosen as one with its language (decision 84), and what of it reaches the team. */
  set?: { set: GuideSet; reach: SetMember[] };
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
  const reader = readerLanguage();
  const out: HelpItem[] = [];
  const say = state?.languageReferences ?? {};
  // FIA's collections, one per language, are one row whose language is chosen (decision 84).
  const sets = guideSets(items.map((it) => ({ it, doc: docs.get(it.current) })), others.map((s) => ({ s, doc: docs.get(s.latest_hash) })));
  const setKeys = new Set(sets.map((x) => x.key));
  for (const set of sets) {
    const reach = setReach(set, org?.recommendations, state);
    const first = reach[0] ?? set.members[0]!;
    const doc = first.itemId ? docs.get(lib.item(first.itemId)?.current) : docs.get(first.shared?.latest_hash);
    const heldFrom = set.members.map((m) => (m.itemId ? lib.item(m.itemId)?.subscription?.sourceOrgName ?? lib.item(m.itemId)?.copiedFrom?.orgName : m.shared?.org_name)).find(Boolean) ?? null;
    if (!doc) continue;
    out.push({ key: `set:${set.key}`, itemId: null, shared: null, name: set.name, kind: 'guide', doc, on: reach.length > 0,
      owner: heldFrom ? t('getReady.helps.fromOrg', { org: heldFrom }) : '', from: heldFrom, set: { set, reach } });
  }
  for (const it of items) {
    const doc = docs.get(it.current);
    const kind = refKindOf(doc);
    if (!doc || !kind || kind === 'questions') continue;
    if (setKeys.has(setKeyOf(originOf(it), doc) ?? '')) continue;
    // A Bible reaches the team when recommended; a guide or note in the library reaches it unless hidden here (reference/offered.ts).
    const on = kind === 'source' ? offered.has(it.itemId) : say[it.itemId]?.value !== 'hidden';
    const following = it.source === 'subscription' && it.subscription?.active ? it.subscription.sourceOrgName : null;
    out.push({ key: it.itemId, itemId: it.itemId, shared: null, name: it.name, kind, doc, on, owner: sourceLine(it), from: following });
  }
  for (const s of others) {
    const doc = docs.get(s.latest_hash);
    const kind = refKindOf(doc);
    if (!doc || (kind !== 'source' && kind !== 'guide')) continue;
    if (setKeys.has(setKeyOf(s.org_id, doc) ?? '')) continue;
    // Another organization's guides in a language the team may read: the language's own or the reader's.
    const lang = docLanguage(doc);
    if (kind === 'guide' && lang && !sameLanguage(lang, reads) && !sameLanguage(lang, reader)) continue;
    out.push({ key: `shared:${s.org_id}/${s.item_id}`, itemId: null, shared: s, name: s.name, kind, doc, on: false, owner: t('getReady.helps.fromOrg', { org: s.org_name }), from: s.org_name });
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
      ctx.toast(t('common.notSaved', { reason: referenceFailure('offer reference', e) })); // i18n-ignore: log label
    } finally {
      setBusy(false);
    }
  }
  /** Language-stream writes for one set's says, with Undo, in one step. */
  async function sayAll(plan: { says: ReferenceSay[]; undo: ReferenceSay[] }, message: string) {
    const specs = (list: ReferenceSay[]) => list.map((p) => ({ id: Crypto.randomUUID(), type: 'v1.ReferenceSet', payload: p } as EventSpec));
    if (!plan.says.length) return;
    try {
      await ctx.act(specs(plan.says), message, () => specs(plan.undo));
    } catch {
      // ctx.act has already said "Not saved" and why.
    }
  }
  /** Offer a guide set in one language: taken into the library first when it is another organization's, then the team's only language of it. */
  async function chooseLanguage(h: HelpItem, m: SetMember) {
    if (busy || !may || !languageId || !h.set) return;
    setBusy(true);
    try {
      const itemId = m.itemId ?? (m.shared!.subscribable ? await lib.subscribe(m.shared!, true) : await lib.copy(m.shared!));
      const set = { ...h.set.set, members: h.set.set.members.map((x) => (x === m ? { ...x, itemId, shared: null } : x)) };
      const now = ctx.language.state;
      await sayAll(chooseSetLanguage(set, itemId, now), t('getReady.helps.setChosen', { name: guideShortName(set.name), language: languageLabel(m.language) }));
    } catch (e) {
      ctx.toast(t('common.notSaved', { reason: referenceFailure('choose guide language', e) })); // i18n-ignore: log label
    } finally {
      setBusy(false);
    }
  }
  /** Stop offering a guide set to the team, in every language. */
  async function setOff(h: HelpItem) {
    if (busy || !may || !languageId || !h.set) return;
    setBusy(true);
    await sayAll(hideSet(h.set.set, ctx.language.state), t('getReady.helps.setOff', { name: guideShortName(h.set.set.name) }));
    setBusy(false);
  }
  return { items: out, toggle, chooseLanguage, setOff, busy, may, loading: !shared.loaded, get: docs.get };
}

/** What a guide row says of its language: the set's languages chosen, or how many it comes in; a single guide's own. */
function guideLanguageLine(h: HelpItem): string {
  if (h.set) return h.set.reach.length ? languagesLine(h.set.reach.map((m) => m.language)) : t('getReady.helps.inLanguages', { count: h.set.set.members.length });
  return languagesLine([docLanguage(h.doc)]);
}

/** The language sheet for a guide set row, while one is open. */
function useSetSheet(h: ReturnType<typeof useHelpItems>, team: string) {
  const [open, setOpen] = useState<string | null>(null);
  const item = h.items.find((x) => x.key === open && x.set) ?? null;
  const close = () => setOpen(null);
  const sheet = item?.set ? (
    <GuideLanguageSheet key={item.key} set={item.set.set} chosen={item.set.reach} team={team} busy={h.busy}
      onUse={(m) => void h.chooseLanguage(item, m).then(close)}
      {...(item.on ? { onOff: () => void h.setOff(item).then(close) } : {})} onClose={close} />
  ) : null;
  return { open: (x: HelpItem) => setOpen(x.key), sheet };
}

type Media = 'both' | 'audio' | 'text' | 'listed';

/** What a Bible has: audio and text, one of them, or only its listing. */
function mediaOf(doc: SourceDoc, get: (h: string | null | undefined) => LibraryDoc | null): Media {
  const f = sourceFacts(doc, get);
  const text = f.text.OT || f.text.NT;
  const audio = f.audio.OT || f.audio.NT;
  return text && audio ? 'both' : audio ? 'audio' : text ? 'text' : 'listed';
}

/** "Audio and text", "Audio", "Text"; `inline` for after a language: "English · audio and text". */
function mediaText(media: Media, inline = false): string {
  switch (media) {
    case 'both': return inline ? t('getReady.media.bothInline') : t('getReady.media.both');
    case 'audio': return inline ? t('getReady.media.audioInline') : t('getReady.media.audio');
    case 'text': return inline ? t('getReady.media.textInline') : t('getReady.media.text');
    case 'listed': return inline ? t('getReady.media.listedInline') : t('getReady.media.listed');
  }
}

/**
 * Whether a guide set was made for how this language's Bible is broken up
 * (decision 74): "goes with your FIA passages", or, when it is broken up
 * another way, that the guides follow FIA's passages.
 */
function useComesWith(ctx: Ctx) {
  const sel = ctx.language.state?.template?.value;
  const docs = useLibraryDocs(ctx.language.orgId, [sel?.docHash], { deps: false });
  const tpl = docs.get(sel?.docHash);
  return (g: HelpItem): string => {
    if (g.kind !== 'guide' || g.doc.format !== 'collection@1') return '';
    const c = g.doc as CollectionDoc;
    const pattern = c.pattern ?? (/\bFIA\b/.test(c.title) ? 'FIA' : undefined);
    if (!pattern || !tpl || !isTemplateDoc(tpl) || !tpl.bible) return '';
    return goesWith(tpl, pattern) ? t('getReady.helps.goesWith', { pattern }) : t('getReady.helps.madeFor', { pattern });
  };
}

function HelpsStep({ ctx, lang, header, next }: StepProps) {
  const languageId = ctx.language.languageId;
  const h = useHelpItems(ctx);
  const sheet = useSetSheet(h, lang);
  const numbering = useVerseNumbering(ctx);
  const comes = useComesWith(ctx);
  const bibles = h.items.filter((x) => x.kind === 'source');
  const guides = h.items.filter((x) => x.kind === 'guide');
  const notes = h.items.filter((x) => x.kind === 'note' || x.kind === 'other');
  return (
    <Screen header={header} bodyStyle={PAD} footer={<PrimaryBtn label={t('common.next')} icon="right" onPress={next} />}>
      <Question>{questionLabel('helps')}</Question>
      <SectionLabel label={t('getReady.helps.biblesTheyUnderstand')} />
      <Group>
        {bibles.map((b) => {
          const doc = b.doc as SourceDoc;
          return (
            <CheckRow key={b.key} label={`${languageLabel(doc.language)} · ${doc.abbreviation}`} sub={mediaText(mediaOf(doc, h.get))} checked={b.on}
              disabled={!h.may || h.busy} onToggle={() => void h.toggle(b)} playLabel={t('admin.checkRow.hear', { name: b.name })}
              {...(b.itemId ? { onPlay: () => ctx.go('reference_source', { itemId: b.itemId!, languageId }) } : {})} />
          );
        })}
        <Row icon="search" label={t('getReady.helps.findBible')} sub={bibles.length ? undefined : t('getReady.helps.noneChosen')} last
          onPress={() => ctx.go('reference_bibles', { languageId })} />
      </Group>
      {guides.length ? (
        <Group>
          {guides.map((g, i) => (
            <SwitchRow key={g.key} icon="star" label={guides.length === 1 ? t('getReady.helps.studyGuides') : t('getReady.helps.namedGuides', { name: guideShortName(g.name) })}
              sub={[guides.length === 1 ? guideShortName(g.name) : fromLine(g), guideLanguageLine(g), g.on ? t('getReady.helps.onInline') : t('getReady.helps.offInline'), comes(g)].filter(Boolean).join(' · ')}
              on={g.on} disabled={!h.may || h.busy} onToggle={() => (g.set ? sheet.open(g) : void h.toggle(g))} last={i === guides.length - 1} />
          ))}
        </Group>
      ) : h.loading ? <Text style={txt.smMuted}>{t('getReady.helps.lookingForGuides')}</Text> : null}
      {numbering.clash ? <NumberingNote clash={numbering.clash} onIgnore={numbering.ignore} /> : null}
      {notes.length ? (
        <>
          <SectionLabel label={t('getReady.helps.notesForTranslators')} />
          <Group>
            {notes.map((x, i) => (
              <SwitchRow key={x.key} icon="note" label={x.name} sub={[x.on ? t('getReady.helps.on') : t('getReady.helps.off'), languagesLine([docLanguage(x.doc)])].join(' · ')} on={x.on} disabled={!h.may || h.busy}
                onToggle={() => void h.toggle(x)} last={i === notes.length - 1} />
            ))}
          </Group>
        </>
      ) : null}
      {!h.may ? <Banner icon="lock" title={t('common.viewOnly')} body={t('getReady.helps.viewOnly')} /> : null}
      {sheet.sheet}
    </Screen>
  );
}

/** What helps them, on a ready language: every kind of help with a switch each, and Add more. */
function HelpsPage({ ctx }: { ctx: Ctx }) {
  const state = ctx.language.state!;
  const languageId = ctx.language.languageId;
  const lang = languageName(ctx.org.state, languageId);
  const h = useHelpItems(ctx);
  const sheet = useSetSheet(h, lang);
  const reads = languageLabel(languageInfo(ctx.org.state, languageId)?.sourceCode ?? 'eng');
  const [adding, setAdding] = useState(false);
  const terms = useMemo(() => keyTermsFor(state), [state]);
  const written = useMemo(() => materialsFor(state).filter((m) => m.kind !== 'questions' && m.kind !== 'key_terms' && m.kind !== 'fia_study'), [state]);
  const switchRow = (x: HelpItem, last: boolean, sub: string) => (
    <SwitchRow key={x.key} label={plainName(x.name, reads)} sub={sub} on={x.on} disabled={!h.may || h.busy} onToggle={() => (x.set ? sheet.open(x) : void h.toggle(x))} last={last} />
  );
  const none = (label: string) => <Row label={label} sub={t('getReady.page.addToOffer')} muted last />;
  const bibles = h.items.filter((x) => x.kind === 'source');
  const guides = h.items.filter((x) => x.kind === 'guide');
  const notes = h.items.filter((x) => x.kind === 'note' || x.kind === 'other');
  const rendered = terms.filter((term) => term.renderings.length > 0).length;
  const go = (to: Parameters<Ctx['go']>[0], params: Record<string, string>) => { setAdding(false); ctx.go(to, params); };
  return (
    <Screen header={<Header title={t('getReady.page.title')} sub={lang} onBack={ctx.back} />} bodyStyle={{ gap: space.sm }}
      footer={h.may ? <PrimaryBtn label={t('getReady.page.addMore')} icon="plus" onPress={() => setAdding(true)} /> : undefined}>
      <SectionLabel label={t('getReady.page.bibles')} />
      <Group>
        {bibles.length ? bibles.map((b, i) => {
          const doc = b.doc as SourceDoc;
          return switchRow(b, i === bibles.length - 1, `${languageLabel(doc.language)} · ${mediaText(mediaOf(doc, h.get), true)}`);
        }) : none(t('getReady.page.noBibles'))}
      </Group>
      <SectionLabel label={t('getReady.helps.studyGuides')} />
      <Group>
        {guides.length ? guides.map((g, i) => {
          // A set counts the passages of the languages chosen; off, none.
          const entries = g.set ? g.set.reach.reduce((n, m) => Math.max(n, m.passages), 0) : g.doc.format === 'collection@1' ? (g.doc as CollectionDoc).entries.length : 0;
          return switchRow(g, i === guides.length - 1, [fromLine(g), guideLanguageLine(g), entries ? t('getReady.page.passagesCovered', { count: entries }) : ''].filter(Boolean).join(' · '));
        }) : none(t('getReady.page.noGuides'))}
      </Group>
      <SectionLabel label={t('getReady.page.keyWords')} />
      <Group>
        <Row label={t('getReady.page.keyTerms')} sub={t('getReady.page.keyTermsSub', { count: terms.length, rendered: formatNumber(rendered), language: lang })} last
          onPress={() => ctx.go('key_terms', { languageId })} />
      </Group>
      <SectionLabel label={t('getReady.helps.notesForTranslators')} />
      <Group>
        {notes.map((x, i) => switchRow(x, i === notes.length - 1 && written.length === 0, [x.owner, languagesLine([docLanguage(x.doc)])].filter(Boolean).join(' · ')))}
        {written.map((m, i) => (
          <Row key={m.materialId} label={m.title} sub={t('getReady.page.writtenHere')} last={i === written.length - 1}
            onPress={h.may ? () => ctx.go('material_editor', { materialId: m.materialId, languageId }) : undefined} />
        ))}
        {notes.length + written.length === 0 ? none(t('getReady.page.noNotes')) : null}
      </Group>
      <Sheet visible={adding} title={t('getReady.page.addMore')} sub={t('getReady.add.sub', { language: lang })} onClose={() => setAdding(false)}>
        <Group>
          <Row icon="search" label={t('getReady.add.bible')} sub={t('getReady.add.bibleSub')} onPress={() => go('reference_bibles', { languageId })} />
          <Row icon="star" label={t('getReady.add.guide')} sub={t('getReady.add.guideSub')} onPress={() => go('reference_guides', { languageId })} />
          <Row icon="note" label={t('getReady.add.note')} sub={t('getReady.add.noteSub')} onPress={() => go('material_editor', { itemId: 'new', kind: 'note', languageId })} />
          <Row icon="key" label={t('getReady.page.keyWords')} sub={t('getReady.add.keyWordsSub')} onPress={() => go('key_terms', { languageId })} />
          <Row icon="layers" label={t('getReady.add.library')} sub={t('getReady.add.librarySub')} last onPress={() => go('reference_home', { languageId })} />
        </Group>
      </Sheet>
      {sheet.sheet}
    </Screen>
  );
}

/** "FIA study guides (English)" for a team that reads English: "FIA study guides". */
function plainName(name: string, reads: string): string {
  return name.replace(new RegExp(`\\s*\\(${reads}\\)\\s*$`), '').trim() || name;
}

/** "From LangQuest" for one followed from or shared by another organization, else where it comes from. */
function fromLine(h: HelpItem): string {
  return h.from ? t('getReady.helps.fromOrg', { org: h.from }) : h.owner;
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
    if (!canUse) { ctx.toast(t('getReady.checks.onlyChoosers')); return; }
    setBusy(true);
    let specs: EventSpec[];
    try {
      const itemId = pick.c.source === 'shared' ? (pick.c.shared.subscribable ? await lib.subscribe(pick.c.shared, true) : await lib.copy(pick.c.shared)) : pick.c.item.itemId;
      specs = await lib.applySpecs(itemId, { docHash: pick.c.hash });
    } catch (e) {
      ctx.toast(t('common.notSaved', { reason: failureMessage('get ready: who checks', e) }));
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
      await ctx.act(specs, t('getReady.checks.saved', { title: titleOf(pick.doc) }), undo);
    } catch { setBusy(false); return; }
    setBusy(false);
    next();
  }

  const card = (e: FlowEntry, i: number) => {
    const on = key === e.c.key;
    const sub = e.c === current ? t('getReady.checks.inUse') : e === starter && i === 0 ? t('getReady.checks.suggested') : flowSub(e.doc.steps);
    return (
      <ChoiceCard key={e.c.key} on={on} icon="people" title={titleOf(e.doc)} sub={sub} onPress={() => setPicked(e.c.key)}>
        {on && e.doc.steps.length ? <NumberedSteps items={flowWho(e.doc.steps, kindsOf(e.doc))} /> : null}
      </ChoiceCard>
    );
  };
  return (
    <Screen header={header} bodyStyle={PAD}
      footer={<PrimaryBtn label={key === 'choose' ? t('getReady.checks.chooseSteps') : t('common.next')} icon="right" busy={busy} onPress={() => void answer()} />}>
      <Question>{questionLabel('checks')}</Question>
      {custom ? (
        <ChoiceCard on={key === 'custom'} icon="people" title={flowTitle(flow.steps, kinds)} sub={t('getReady.checks.ownSteps')} onPress={() => setPicked('custom')}>
          {key === 'custom' ? <NumberedSteps items={flowWho(flow.steps, kinds)} /> : null}
        </ChoiceCard>
      ) : null}
      {main.map(card)}
      {canUse ? (
        <ChoiceCard on={key === 'choose'} icon="edit" title={t('getReady.checks.illChoose')} onPress={() => setPicked('choose')} />
      ) : null}
      {rest.length ? (
        more ? (
          <>
            <SectionLabel label={t('getReady.checks.otherWays')} />
            {rest.map((e, i) => card(e, i + 1))}
          </>
        ) : <QuietLink icon="down" label={t('getReady.checks.otherWaysCount', { total: formatNumber(rest.length) })} onPress={() => setMore(true)} />
      ) : null}
      {entries.length === 0 ? <Text style={txt.smMuted}>{loaded ? t('getReady.checks.noWays') : t('common.loading')}</Text> : null}
      <Text style={[txt.sm, { color: C.muted, paddingHorizontal: space.xs }]}>{t('getReady.checks.pickPeopleLater')}</Text>
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
  const invite = useGroupInvite(ctx.language.orgId, may ? roleId : null, may ? scope : null, t('admin.invite.teamLabel', { name: lang }));
  const uri = invite && 'uri' in invite ? invite.uri : null;
  return (
    <Screen header={header} bodyStyle={PAD}
      footer={<>
        <PrimaryBtn label={t('common.done')} icon="check" onPress={next} />
        {uri ? <QuietLinks items={[{ label: t('admin.invite.shareLink'), icon: 'send', onPress: () => shareInvite(ctx, uri) }]} /> : null}
      </>}>
      <Question>{questionLabel('invite')}</Question>
      <Pills>
        {roles.choices.map((c) => <Chip key={c.id} label={c.chip} on={choice === c.id} onPress={() => setChoice(c.id)} />)}
        {more ? roles.others.map((r) => <Chip key={r.id} label={r.name} on={choice === r.id} onPress={() => setChoice(r.id)} />) : null}
        {!more && (roles.others.length || ctx.session.can('manage_roles')) ? <Chip label={t('getReady.invite.somethingElse')} icon="plus" on={false} onPress={() => setMore(true)} /> : null}
      </Pills>
      {more && ctx.session.can('manage_roles') ? (
        <DashedRow icon="plus" label={t('admin.invite.newRole')} onPress={() => ctx.go('role_editor', { roleId: 'new' })} />
      ) : null}
      {may ? <InviteCode state={invite} /> : (
        <Banner icon="lock" title={t('getReady.invite.cannotTitle')} body={t('getReady.invite.cannotBody', { language: lang })} />
      )}
    </Screen>
  );
}

export const contracts = contractsFor('get_ready');
