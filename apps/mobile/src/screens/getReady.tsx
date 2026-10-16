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
  commands, CUSTOM_FLOW, deriveFlow, keyTermsFor, languageName, languageProgress, materialsFor,
  goesWith, isTemplateDoc, recommendedFor, subscriptionItemId, templateBooks,
  type CollectionDoc, type EventSpec, type LibraryDoc, type SourceDoc
} from '@langquest-next/core';
import * as Crypto from 'expo-crypto';
import { useMemo, useState, type ReactNode } from 'react';
import { View } from 'react-native';
import { Text } from '../ui/text';
import type { LibraryChoice } from '../templates/contentTemplates';
import { deriveKinds } from '../i18n/coreText';
import type { Ctx } from '../shell/ctx';
import { useHelpMode } from '../helpMode/useHelpMode';
import { HelpRow } from '../helpMode/helpBadge';
import { t } from '../i18n';
import { formatClock, formatNumber } from '../i18n/format';
import { indexesFor } from '../sync/indexes';
import { Banner, Chip, EmptyState, Group, Header, PrimaryBtn, QuietLinks, Row, Screen, SectionLabel, Sheet } from '../ui/kit';
import { txt } from '../ui/textStyles';
import { sourceLine, type SharedItem } from '../library/model';
import { restoreChecks } from '../checks/undo';
import { useLibrary, useLibraryDocs, useSharedItems } from '../library/useLibrary';
import { booksInScope, LANGUAGE_SCOPES, languageScopeLabel, mayGrantAt, type LanguageScope } from '../org/orgAdmin';
import { recState, refKindOf, sourceFacts, type RefKind } from '../reference/model';
import { useRecommend } from '../reference/useReference';
import { guidesArriving, helpItems, type HelpItem } from '../reference/helpItemsModel';
import { referenceFailure } from '../reference/failureModel';
import { GuideLanguageSheet } from '../reference/GuideLanguageSheet';
import { chooseSetLanguage, guideSets, hideSet, originOf, patternOf, setKeyOf, setReach, type GuideSet, type ReferenceSay, type SetMember } from '../reference/guideSets';
import { docLanguage, inLanguages, languagesLine, languagesSays, readerLanguage, sameLanguage, teamLanguage, teamLanguages } from '../reference/languages';
import { memberIn } from '../reference/languageChoices';
import { ReferenceLanguageChip, ReferenceLanguagePage } from '../reference/ReferenceLanguagePage';
import { useReferenceLanguages } from '../reference/useReferenceLanguages';
import { failureMessage } from '../diagnostics/report';
import { contractsFor } from '../shell/screenContracts';
import { C, space } from '../ui/theme';
import { BigTop, CheckRow, SwitchRow, ChoiceCard, DashedRow, InviteCode, NumberedSteps, Pills, Question, QuietLink } from '../admin/admin';
import { useGroupInvite } from '../admin/useGroupInvite';
import {
  flowSub, flowTitle, flowWho, guideShortName, joinAnd, languageLabel, QUESTIONS, questionLabel, recordSummary, scopeOfBooks,
  type PlainRoleId } from '../admin/adminModel';
import { shareInvite } from '../invites/shareInvite';
import { ReadyChecklist } from '../admin/ready';
import { howItWorks, plainRoleHelp } from '../admin/readyText';
import { usePlainRoles, useReadySummary } from '../admin/useReadySummary';
import { useCheckChoices, type FlowEntry } from '../admin/useChoices';
import { TranslateQuestion } from '../breakup/TranslateStep';
import { useTranslate } from '../breakup/useTranslate';
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
        ? <PrimaryBtn label={questionLabel(QUESTIONS[next]!.id)} icon="right" help={t('getReady.nextQuestionHelp')}
            onPress={() => ctx.go('get_ready', { languageId: s.languageId, step: String(next + 1) })} />
        : <PrimaryBtn label={t('common.done')} icon="check" help={t('help.details.done')} onPress={ctx.back} />}>
      <ReadyChecklist ctx={ctx} s={s} />
      {help ? <QuietLink icon="playSolid" label={t('admin.howItWorks.link', { length: formatClock(40_000) })} detail={t('admin.howItWorks.detail')}
        onPress={() => { help.setOn(true); help.tell(t('admin.howItWorks.title'), howItWorks(s.name)); }} /> : null}
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
    ? <Header title={n === 2 ? t('getReady.page.title') : t('getReady.whatToTranslate')} sub={lang} onBack={ctx.back} />
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
  const doc = tq.doc;
  const inUse = tq.what === 'bible' ? !!tq.row?.inUse : tq.outline === tq.rec.current && !!tq.outline;
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
          tq.showContinue ? <PrimaryBtn label={t('common.next')} icon="right" disabled={!tq.canContinue} help={t('getReady.nextPageHelp')} onPress={() => { tq.advance(); }} /> : null
        ) : (
          <PrimaryBtn label={only ? (changed ? t('getReady.record.useThis') : t('getReady.record.keepIt')) : t('common.next')} icon={only ? 'check' : 'right'} busy={busy} disabled={!tq.ready && !only}
            help={only ? (changed ? t('getReady.record.useThisHelp') : t('getReady.record.keepItHelp')) : t('getReady.record.nextHelp')}
            onPress={() => void answer()} />
        )}
        {tq.page !== 'what' ? <QuietLinks items={[{ label: t('common.back'), icon: 'arrowL', help: t('getReady.backHelp'), onPress: () => { tq.retreat(); } }]} /> : null}
      </>}>
      <TranslateQuestion ctx={ctx} t={tq} lang={lang} canMake={lib.canWrite('template')} onMake={() => ctx.go('template_editor', { new: '1', kind: 'outline' })} />
      {doc?.bible && tq.last ? (
        <>
          <SectionLabel label={t('getReady.record.whichPart')} />
          <Pills>
            {/* help-each: each choice is a different part of the Bible */}
            {LANGUAGE_SCOPES.map((sc) => (
              <Chip key={sc} label={languageScopeLabel(sc)} on={pills === sc} help={sc === 'custom' ? t('getReady.record.chooseBooksHelp') : t('getReady.record.partHelp')}
                onPress={() => { setScope(sc); if (sc === 'custom' && !chosen) setChosen(new Set(wanted ?? templateBooks(doc).map((b) => b.book))); }} />
            ))}
          </Pills>
          {pills === 'custom' ? (
            <Pills>
              {templateBooks(doc).map((b) => (
                <HelpRow key={b.book} of="getReady.book">
                  <Chip label={b.name || b.book} on={books.has(b.book)} help={books.has(b.book) ? t('getReady.record.bookOnHelp') : t('getReady.record.bookOffHelp')}
                    onPress={() => setChosen(() => { const nextSet = new Set(books); if (nextSet.has(b.book)) nextSet.delete(b.book); else nextSet.add(b.book); return nextSet; })} />
                </HelpRow>
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
  const reads = teamLanguage(org, state, languageId);
  const languages = teamLanguages(org, state, languageId);
  const reader = readerLanguage();
  // Sibling languages arrive after the one already in the library (reference/helpItemsModel.ts).
  const docsPending = others.some((s) => !!s.latest_hash && !docs.get(s.latest_hash));
  const guidesIncoming = guidesArriving(shared.loaded, docsPending, !!docs.error);
  const out = helpItems({
    items, others, doc: docs.get, itemOf: lib.item, recommendations: org?.recommendations, state, offered, reads, reader, guidesIncoming
  });
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
  return { items: out, toggle, chooseLanguage, setOff, busy, may, reads, languages, loading: guidesIncoming, get: docs.get };
}

/**
 * A guide set's row asks which language, including when the set is already
 * on. Turning it off is the sheet's own control ("Don't offer …"). A
 * patterned collection that is on is the same choice, never a switch off.
 */
function onHelpPress(x: HelpItem, items: readonly HelpItem[], open: (x: HelpItem) => void, toggle: (x: HelpItem) => void) {
  if (x.set) { open(x); return; }
  const joined = x.itemId ? items.find((i) => i.set?.set.members.some((m) => m.itemId === x.itemId)) : undefined;
  if (joined) { open(joined); return; }
  if (x.on && x.kind === 'guide' && x.doc.format === 'collection@1' && patternOf(x.doc)) return;
  toggle(x);
}

/** What help mode says a help's switch does, as onHelpPress decides it: a guide set asks which language; anything else is offered or not. */
function helpItemLine(x: HelpItem, items: readonly HelpItem[]): string {
  if (x.set || (x.itemId && items.some((i) => i.set?.set.members.some((m) => m.itemId === x.itemId)))) return t('getReady.helps.setHelp');
  if (x.on && x.kind === 'guide' && x.doc.format === 'collection@1' && patternOf(x.doc)) return t('getReady.helps.patternOnHelp');
  return x.on ? t('admin.checkRow.offered') : t('admin.checkRow.notOffered');
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
    <GuideLanguageSheet key={item.key} set={item.set.set} chosen={item.set.reach} team={team} prefer={h.reads} busy={h.busy}
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

/** What will help them: the language of their reference material on a page of its own, then what is offered in it (decision 84). */
function HelpsStep(props: StepProps) {
  const [page, setPage] = useState<'language' | 'helps'>('language');
  // Opened from a ready language's What helps them to change the language: back there once it is saved.
  const languageOnly = props.only && props.ctx.params['page'] === 'language';
  return page === 'language'
    ? <ReferenceLanguageStep {...props} onDone={() => (languageOnly ? props.next() : setPage('helps'))} />
    : <HelpsList {...props} onLanguage={() => setPage('language')} />;
}

/**
 * The team's reference language: saved when it changes, and a guide set
 * (FIA) the team has follows it into that language when it is there.
 */
function ReferenceLanguageStep({ ctx, lang, header, onDone }: StepProps & { onDone: () => void }) {
  const state = ctx.language.state!;
  const org = ctx.org.state;
  const languageId = ctx.language.languageId;
  const lib = useLibrary(ctx);
  // The languages the team's material may be in, the main one first (decision 130).
  const current = teamLanguages(org, state, languageId);
  const [picked, setPicked] = useState<string[] | null>(null);
  const values = picked ?? current;
  const value = values[0]!;
  const refs = useReferenceLanguages(ctx, [...values, readerLanguage(), 'eng']);
  const may = ctx.session.can('manage_reference');
  const [busy, setBusy] = useState(false);

  async function save() {
    if (busy) return;
    const moved = languagesSays(current, values).length > 0;
    if (!may || !moved) { onDone(); return; }
    setBusy(true);
    const says: { type: 'v1.ReferenceLanguageSet' | 'v1.ReferenceLanguageAdded' | 'v1.ReferenceSet'; payload: object }[] = languagesSays(current, values);
    const undo: typeof says = languagesSays(values, current);
    try {
      // A guide set follows the main language only.
      for (const set of sameLanguage(value, current[0]) ? [] : refs.sets) {
        // A set the team has follows the language; one it does not have stays off.
        const reach = setReach(set, org?.recommendations, state);
        const m = memberIn(set, value);
        if (!m || !reach.length || (reach.length === 1 && sameLanguage(reach[0]!.language, value))) continue;
        const itemId = m.itemId ?? (m.shared!.subscribable ? await lib.subscribe(m.shared!, true) : await lib.copy(m.shared!));
        const held = { ...set, members: set.members.map((x) => (x === m ? { ...x, itemId, shared: null } : x)) };
        const plan = chooseSetLanguage(held, itemId, ctx.language.state);
        says.push(...plan.says.map((p) => ({ type: 'v1.ReferenceSet' as const, payload: p })));
        undo.push(...plan.undo.map((p) => ({ type: 'v1.ReferenceSet' as const, payload: p })));
      }
    } catch (e) {
      ctx.toast(t('common.notSaved', { reason: referenceFailure('reference language', e) })); // i18n-ignore: log label
      setBusy(false);
      return;
    }
    const specs = (list: typeof says) => list.map((x) => ({ id: Crypto.randomUUID(), ...x } as EventSpec));
    try {
      await ctx.act(specs(says), t('getReady.language.saved', { team: lang, language: joinAnd(values.map(languageLabel)) }), () => specs(undo));
    } catch {
      // ctx.act has already said "Not saved" and why.
      setBusy(false);
      return;
    }
    setBusy(false);
    onDone();
  }

  return (
    <Screen header={header} bodyStyle={PAD} footer={<PrimaryBtn label={t('common.next')} icon="right" busy={busy} help={t('getReady.language.nextHelp')} onPress={() => void save()} />}>
      <ReferenceLanguagePage team={lang} choices={refs.choices} value={values} first={current} onChange={setPicked} loading={refs.loading} />
      {!may ? <Banner icon="lock" title={t('common.viewOnly')} body={t('getReady.helps.viewOnly')} /> : null}
    </Screen>
  );
}

function HelpsList({ ctx, lang, header, next, onLanguage }: StepProps & { onLanguage: () => void }) {
  const languageId = ctx.language.languageId;
  const h = useHelpItems(ctx);
  const sheet = useSetSheet(h, lang);
  const numbering = useVerseNumbering(ctx);
  const comes = useComesWith(ctx);
  // Only what is in the team's language, and what the team already has (decision 130 amended).
  const offered = h.items.filter((x) => inTeamLanguage(x, h.languages));
  const bibles = offered.filter((x) => x.kind === 'source');
  const guides = offered.filter((x) => x.kind === 'guide');
  const notes = offered.filter((x) => x.kind === 'note' || x.kind === 'other');
  return (
    <Screen header={header} bodyStyle={PAD} footer={<PrimaryBtn label={t('common.next')} icon="right" help={t('getReady.nextHelp')} onPress={next} />}>
      <ReferenceLanguageChip languages={h.languages} onPress={onLanguage} />
      <Question>{questionLabel('helps')}</Question>
      <SectionLabel label={t('getReady.helps.biblesTheyUnderstand')} />
      <Group>
        {bibles.map((b) => {
          const doc = b.doc as SourceDoc;
          return (
            <HelpRow key={b.key} of="getReady.bible">
              <CheckRow label={`${languageLabel(doc.language)} · ${doc.abbreviation}`} sub={mediaText(mediaOf(doc, h.get))} checked={b.on}
                disabled={!h.may || h.busy} onToggle={() => void h.toggle(b)} playLabel={t('admin.checkRow.hear', { name: b.name })} playHelp={t('getReady.helps.openBibleHelp')}
                {...(b.itemId ? { onPlay: () => ctx.go('reference_source', { itemId: b.itemId!, languageId }) } : {})} />
            </HelpRow>
          );
        })}
        <Row icon="search" label={t('getReady.helps.findBible')} sub={bibles.length ? undefined : t('getReady.helps.noneChosen')} last
          help={t('getReady.helps.findBibleHelp')} onPress={() => ctx.go('reference_bibles', { languageId })} />
      </Group>
      {guides.length ? (
        <Group>
          {guides.map((g, i) => (
            <HelpRow key={g.key} of="getReady.guide">
              <SwitchRow icon="star" label={guides.length === 1 ? t('getReady.helps.studyGuides') : t('getReady.helps.namedGuides', { name: guideShortName(g.name) })}
                sub={[guides.length === 1 ? guideShortName(g.name) : fromLine(g), guideLanguageLine(g), g.on ? t('getReady.helps.onInline') : t('getReady.helps.offInline'), comes(g)].filter(Boolean).join(' · ')}
                on={g.on} disabled={!h.may || h.busy} help={helpItemLine(g, h.items)} onToggle={() => onHelpPress(g, h.items, sheet.open, (x) => void h.toggle(x))} last={i === guides.length - 1} />
            </HelpRow>
          ))}
        </Group>
      ) : h.loading ? <Text style={txt.smMuted}>{t('getReady.helps.lookingForGuides')}</Text> : null}
      {numbering.clash ? <NumberingNote clash={numbering.clash} onIgnore={numbering.ignore} /> : null}
      {notes.length ? (
        <>
          <SectionLabel label={t('getReady.helps.notesForTranslators')} />
          <Group>
            {notes.map((x, i) => (
              <HelpRow key={x.key} of="getReady.note">
                <SwitchRow icon="note" label={x.name} sub={[x.on ? t('getReady.helps.on') : t('getReady.helps.off'), languagesLine([docLanguage(x.doc)])].join(' · ')} on={x.on} disabled={!h.may || h.busy}
                  help={helpItemLine(x, h.items)} onToggle={() => void h.toggle(x)} last={i === notes.length - 1} />
              </HelpRow>
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
  const reads = languageLabel(h.reads);
  const [adding, setAdding] = useState(false);
  const terms = useMemo(() => keyTermsFor(state), [state]);
  const written = useMemo(() => materialsFor(state).filter((m) => m.kind !== 'questions' && m.kind !== 'key_terms' && m.kind !== 'fia_study'), [state]);
  const switchRow = (x: HelpItem, last: boolean, sub: string) => (
    <HelpRow key={x.key} of={`getReady.${x.kind}`}>
      <SwitchRow label={plainName(x.name, reads)} sub={sub} on={x.on} disabled={!h.may || h.busy} help={helpItemLine(x, h.items)}
        onToggle={() => onHelpPress(x, h.items, sheet.open, (item) => void h.toggle(item))} last={last} />
    </HelpRow>
  );
  const none = (label: string) => <Row label={label} sub={t('getReady.page.addToOffer')} muted last />;
  // Only what is in the team's language, and what the team already has (decision 130 amended).
  const offered = h.items.filter((x) => inTeamLanguage(x, h.languages));
  const bibles = offered.filter((x) => x.kind === 'source');
  const guides = offered.filter((x) => x.kind === 'guide');
  const notes = offered.filter((x) => x.kind === 'note' || x.kind === 'other');
  const rendered = terms.filter((term) => term.renderings.length > 0).length;
  const go = (to: Parameters<Ctx['go']>[0], params: Record<string, string>) => { setAdding(false); ctx.go(to, params); };
  return (
    <Screen header={<Header title={t('getReady.page.title')} sub={lang} onBack={ctx.back} />} bodyStyle={{ gap: space.sm }}
      footer={h.may ? <PrimaryBtn label={t('getReady.page.addMore')} icon="plus" help={t('getReady.page.addMoreHelp')} onPress={() => setAdding(true)} /> : undefined}>
      <ReferenceLanguageChip languages={h.languages} onPress={() => ctx.go('get_ready', { languageId, step: '2', only: '1', page: 'language' })} />
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
        }) : h.loading ? <Text style={txt.smMuted}>{t('getReady.helps.lookingForGuides')}</Text> : none(t('getReady.page.noGuides'))}
      </Group>
      <SectionLabel label={t('getReady.page.keyWords')} />
      <Group>
        <Row label={t('getReady.page.keyTerms')} sub={t('getReady.page.keyTermsSub', { count: terms.length, rendered: formatNumber(rendered), language: lang })} last
          help={t('getReady.page.keyTermsHelp')} onPress={() => ctx.go('key_terms', { languageId })} />
      </Group>
      <SectionLabel label={t('getReady.helps.notesForTranslators')} />
      <Group>
        {notes.map((x, i) => switchRow(x, i === notes.length - 1 && written.length === 0, [x.owner, languagesLine([docLanguage(x.doc)])].filter(Boolean).join(' · ')))}
        {written.map((m, i) => (
          <HelpRow key={m.materialId} of="getReady.writtenNote">
            <Row label={m.title} sub={t('getReady.page.writtenHere')} last={i === written.length - 1} help={t('getReady.page.noteHelp')}
              onPress={h.may ? () => ctx.go('material_editor', { materialId: m.materialId, languageId }) : undefined} />
          </HelpRow>
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

/**
 * Is a help offered to the team: in the language its material is in
 * (`reads`, set once for the language), or one the team already has. A
 * guide set (FIA) follows the team's language by itself.
 */
function inTeamLanguage(x: HelpItem, languages: readonly string[]): boolean {
  if (x.on || x.set) return true;
  return inLanguages(x.kind === 'source' ? (x.doc as SourceDoc).language : docLanguage(x.doc), languages);
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
      // A ready-made flow is copied into the language, its checks the language's own (decision 91).
      specs = commands(state, indexesFor(state)).copyFlow({ commandId: Crypto.randomUUID(), name: pick.c.name, kinds: kindsOf(pick.doc), steps: pick.doc.steps });
    } catch (e) {
      ctx.toast(t('common.notSaved', { reason: failureMessage('get ready: who checks', e) }));
      setBusy(false);
      return;
    }
    // Undo goes back to the checks it had, whose steps were never removed (core restoreFlow).
    const previous = state.flow?.value ? { flow: state.flow.value, steps: flow.steps } : null;
    const undo = previous ? () => {
      const s = ctx.language.state;
      return s ? restoreChecks(s, previous, Crypto.randomUUID()) : [];
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
      <HelpRow key={e.c.key} of="getReady.way">
        <ChoiceCard on={on} icon="people" title={titleOf(e.doc)} sub={sub} help={t('getReady.checks.wayHelp')} onPress={() => setPicked(e.c.key)}>
          {on && e.doc.steps.length ? <NumberedSteps items={flowWho(e.doc.steps, kindsOf(e.doc))} /> : null}
        </ChoiceCard>
      </HelpRow>
    );
  };
  return (
    <Screen header={header} bodyStyle={PAD}
      // Next waits for the ready-made list: pressed while it loads, it moved on without the suggested checks.
      footer={<PrimaryBtn label={key === 'choose' ? t('getReady.checks.chooseSteps') : t('common.next')} icon="right" busy={busy}
        {...(key === 'choose' ? {} : { help: t('getReady.checks.nextHelp') })} disabled={!loaded && key === null} onPress={() => void answer()} />}>
      <Question>{questionLabel('checks')}</Question>
      {/* Making your own comes first, set apart, so the ready-made list below can grow (design principle 12). */}
      {canUse ? (
        <ChoiceCard own on={key === 'choose'} icon="edit" title={t('getReady.checks.illChoose')} help={t('getReady.checks.illChooseHelp')} onPress={() => setPicked('choose')} />
      ) : null}
      {custom ? (
        <ChoiceCard on={key === 'custom'} icon="people" title={flowTitle(flow.steps, kinds)} sub={t('getReady.checks.ownSteps')} help={t('getReady.checks.keepOwnHelp')}
          onPress={() => setPicked('custom')}>
          {key === 'custom' ? <NumberedSteps items={flowWho(flow.steps, kinds)} /> : null}
        </ChoiceCard>
      ) : null}
      {main.map(card)}
      {rest.length ? (
        more ? (
          <>
            <SectionLabel label={t('getReady.checks.otherWays')} />
            {rest.map((e, i) => card(e, i + 1))}
          </>
        ) : <QuietLink icon="down" label={t('getReady.checks.otherWaysCount', { total: formatNumber(rest.length) })} detail={t('getReady.checks.otherWaysHelp')} onPress={() => setMore(true)} />
      ) : null}
      {entries.length === 0 ? <Text style={txt.smMuted}>{loaded ? t('getReady.checks.noWays') : t('common.loading')}</Text> : null}
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
        <PrimaryBtn label={t('common.done')} icon="check" help={t('help.details.done')} onPress={next} />
        {uri ? <QuietLinks items={[{ label: t('admin.invite.shareLink'), icon: 'send', help: t('admin.invite.shareLinkHelp'), onPress: () => shareInvite(ctx, uri) }]} /> : null}
      </>}>
      <Question>{questionLabel('invite')}</Question>
      {/* Making a new role comes first, set apart from the roles there are (design principle 12). */}
      {ctx.session.can('manage_roles') ? (
        <DashedRow icon="plus" label={t('admin.invite.newRole')} detail={t('admin.invite.newRoleHelp')} onPress={() => ctx.go('role_editor', { roleId: 'new' })} />
      ) : null}
      <Pills>
        {/* help-each: each plain role does different work */}
        {roles.choices.map((c) => <Chip key={c.id} label={c.chip} on={choice === c.id} help={plainRoleHelp(c.id)} onPress={() => setChoice(c.id)} />)}
        {more ? roles.others.map((r) => (
          <HelpRow key={r.id} of="getReady.otherRole">
            <Chip label={r.name} on={choice === r.id} help={t('admin.invite.pickRoleHelp')} onPress={() => setChoice(r.id)} />
          </HelpRow>
        )) : null}
        {!more && roles.others.length ? <Chip label={t('getReady.invite.somethingElse')} icon="plus" on={false} help={t('admin.invite.otherRolesHelp')} onPress={() => setMore(true)} /> : null}
      </Pills>
      {may ? <InviteCode state={invite} /> : (
        <Banner icon="lock" title={t('getReady.invite.cannotTitle')} body={t('getReady.invite.cannotBody', { language: lang })} />
      )}
    </Screen>
  );
}

export const contracts = contractsFor('get_ready');
