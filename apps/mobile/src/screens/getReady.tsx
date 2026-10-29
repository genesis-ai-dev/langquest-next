// Get ‹language› ready (decision 71; demo ADR-039, SIMPLE-12; the
// prototype's simple/admin.tsx AdminStart, RecordWhat, ListenTo, WhoChecks,
// InviteNow, PickTemplate and Helps). An admin who knows nothing about the
// app's model gets a language ready with four plain questions, each with the
// likely answer already picked:
//   1 What will they record?   the language's content template (as New Language and its Content template page apply it)
//   2 What will help them?     Bibles, study guides and key words offered to its team (the recommendations reference_bibles/guides write),
//                              searched from a bar at the top, and what goes with what (FIA's guides and key words, decision 172)
//   3 Who checks the recordings? its review flow (chosen as flows_home chooses it; "I'll choose the steps" opens the flow editor)
//   4 Invite your translators  a group code to scan (the invite RPC Invite by QR uses)
// Params: `languageId` (opens that language) and `step`: none for the
// checklist, '1'..'4' for the questions (Next walks on through the rest),
// 'template', 'helps' and 'flow' for a ready language's three picks (decision 138). `only: '1'` opens
// question 1 alone, as "What to translate" from a ready language's page.
import {
  commands, CUSTOM_FLOW, deriveFlow, keyTermsFor, languageName, materialsFor,
  followerItemId, goesWith, isTemplateDoc, recommendedFor, templateBooks,
  type CollectionDoc, type EventSpec, type LibraryDoc, type SourceDoc
} from '@langquest-next/core';
import * as Crypto from 'expo-crypto';
import { ConfirmDelete } from '../ui/ConfirmDelete';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { View } from 'react-native';
import { Text } from '../ui/text';
import type { LibraryChoice } from '../templates/contentTemplatesModel';
import { deriveKinds } from '../i18n/coreText';
import type { Ctx } from '../shell/ctx';
import { useHelpMode } from '../helpMode/useHelpMode';
import { HelpRow } from '../helpMode/helpBadge';
import { t } from '../i18n';
import { formatClock, formatNumber } from '../i18n/format';
import { indexesFor } from '../sync/indexes';
import { Badge, Banner, Chip, EmptyState, Group, Header, PrimaryBtn, QuietLinks, Row, Screen, SearchField, SectionLabel, Sheet } from '../ui/kit';
import { useHardwareBack } from '../ui/useHardwareBack';
import { txt } from '../ui/textStyles';
import { sourceLine, type SharedItem } from '../library/model';
import { useLibrary, useLibraryDocs, useSharedItems } from '../library/useLibrary';
import { booksInScope, LANGUAGE_SCOPES, languageScopeLabel, mayGrantAt, type LanguageScope } from '../org/orgAdmin';
import { recState, refKindOf, sourceFacts, type RefKind } from '../reference/model';
import { useRecommend } from '../reference/useReference';
import {
  guidesArriving, helpItems, helpSections, inLibrary, matchesWords, relatedLinks, searchHelps, turnOnSay, turnOnWith, type HelpItem, type TurnOn
} from '../reference/helpItemsModel';
import { referenceFailure } from '../reference/failureModel';
import { GuideLanguageSheet } from '../reference/GuideLanguageSheet';
import { chooseSetLanguage, guideSets, hideSet, isWordSet, originOf, patternOf, setKeyOf, setReach, type GuideSet, type ReferenceSay, type SetMember } from '../reference/guideSets';
import { docLanguage, inLanguages, languagesLine, languagesSays, readerLanguage, sameLanguage, teamLanguage, teamLanguages } from '../reference/languages';
import { memberIn } from '../reference/languageChoices';
import { ReferenceLanguageChip, ReferenceLanguagePage } from '../reference/ReferenceLanguagePage';
import { useReferenceLanguages } from '../reference/useReferenceLanguages';
import { failureMessage } from '../diagnostics/report';
import { contractsFor } from '../shell/screenContracts';
import { C, space, TINT } from '../ui/theme';
import { BigTop, CheckRow, SwitchRow, ChoiceCard, DashedRow, InviteCode, NumberedSteps, Pills, Question, QuietLink, RowLink } from '../admin/admin';
import { useGroupInvite } from '../admin/useGroupInvite';
import {
  sameChecks,
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
import { ContentTemplatePage } from '../templates/ContentTemplatePage';
import { ReviewFlowPage } from '../checks/ReviewFlowPage';
import { useVerseNumbering } from '../breakup/useBreakup';

const PAD = { paddingHorizontal: 20, gap: 14 } as const;

export function GetReady(ctx: Ctx) {
  const step = ctx.params['step'];
  if (!ctx.language.state || !ctx.org.state) {
    return <Screen header={<Header title={t('getReady.loading.title')} onBack={ctx.back} close />}><EmptyState icon="cloud" title={t('getReady.loading.empty')} sub={t('getReady.loading.sub')} /></Screen>;
  }
  // A ready language's three picks (decision 138): what it uses, its other options, and the organization's shelf.
  if (step === 'template') return <ContentTemplatePage ctx={ctx} />;
  if (step === 'helps') return <HelpsPage ctx={ctx} />;
  if (step === 'flow') return <ReviewFlowPage ctx={ctx} />;
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
  /** To the question before, when there is one: on screen for iPhone and the web, which have no Back key (UI audit, finding 48). */
  back?: () => void;
}

/** The footer's quiet Back, one page or question before. */
function StepBack(props: { onPress?: () => void }) {
  return props.onPress ? <QuietLinks items={[{ label: t('common.back'), icon: 'arrowL', help: t('getReady.backHelp'), onPress: props.onPress }]} /> : null;
}

function Questions({ ctx, start, only }: { ctx: Ctx; start: number; only: boolean }) {
  const [n, setN] = useState(start);
  const lang = languageName(ctx.org.state, ctx.language.languageId);
  const header = only
    ? <Header title={n === 2 ? t('org.languages.row') : t('getReady.whatToTranslate')} sub={lang} onBack={ctx.back} />
    : <Header title={t('getReady.title', { language: lang })} sub={t('getReady.stepOf', { step: formatNumber(n), total: formatNumber(4) })} onBack={ctx.back} close />;
  const next = () => (only || n >= 4 ? ctx.back() : setN(n + 1));
  // A phone's Back goes to the question before, down to the one this opened on, then leaves; ✕ leaves at once (decision 137).
  useHardwareBack(n > start, () => setN(n - 1));
  const props: StepProps = { ctx, lang, header, next, only, ...(n > start ? { back: () => setN(n - 1) } : {}) };
  switch (n) {
    case 1: return <RecordStep {...props} />;
    case 2: return <HelpsStep {...props} />;
    // Choosing the steps opens the flow editor; coming back lands here, on what was saved.
    case 3: return <ChecksStep {...props} />;
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
  const lines = ctx.language.lines;
  const worked = useMemo(() => { for (const u of lines.worked()) if (lines.get(u).worked) return true; return false; }, [lines]);
  const [warn, setWarn] = useState(false);
  // A phone's Back goes back a page of the question, as the Back under it does (decision 137); from the first, it leaves.
  useHardwareBack(tq.page !== 'what', () => { tq.retreat(); });

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
      const use = await tq.resolve();
      const specs = await lib.applySpecs(use.itemId, { docHash: use.docHash, ...(wanted ? { books: wanted } : {}), ...(use.unitPrefix ? { unitPrefix: use.unitPrefix } : {}) });
      try {
        await ctx.act(specs, t('getReady.record.saved', { language: lang, what: recordSummary(use.doc, wanted, use.doc.name) }));
      } catch { setBusy(false); return; }
      setBusy(false);
      next();
    } catch (e) {
      ctx.toast(failureMessage('get ready: what they translate', e), 'problem');
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
        <StepBack onPress={tq.page !== 'what' ? () => { tq.retreat(); } : undefined} />
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
 * guides, key words and notes, and the Bibles, guides and key words (in the
 * language its team reads) that other organizations share. On means
 * recommended to this language, as Bibles and Guides and Notes write it.
 * Turning one on turns on what goes with it (decision 172).
 */
function useHelpItems(ctx: Ctx) {
  const lib = useLibrary(ctx);
  const org = ctx.org.state;
  const state = ctx.language.state;
  const languageId = ctx.language.languageId;
  const shared = useSharedItems('material', lib.orgId);
  const items = lib.items('material').filter((it) => it.current && !it.archived);
  const others = shared.rows.filter((s) => s.latest_hash && !org?.library[followerItemId(org?.library ?? {}, s.org_id, s.item_id)]);
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
  const readsName = languageLabel(reads);
  /** Its item in the library: another organization's is followed first, with automatic updates (copied when it may not be followed). */
  const take = async (x: { itemId: string | null; shared: SharedItem | null }) =>
    x.itemId ?? (x.shared!.subscribable ? await lib.subscribe(x.shared!, true) : await lib.copy(x.shared!));
  /** The says that turn on what goes with something turned on (decision 172): a set in the language `turnOnWith` chose, anything else as its switch would. */
  async function withSays(plan: readonly TurnOn[]): Promise<ReferenceSay[]> {
    const level = { kind: 'language' as const, languageId };
    const now = ctx.language.state;
    const says: ReferenceSay[] = [];
    for (const { item, member } of plan) {
      if (item.set && member) {
        const itemId = await take(member);
        const set = { ...item.set.set, members: item.set.set.members.map((x) => (x === member ? { ...x, itemId, shared: null } : x)) };
        says.push(...chooseSetLanguage(set, itemId, now).says);
      } else {
        const itemId = await take(item);
        says.push(turnOnSay(itemId, item.kind, recState(org?.recommendations, now, level, itemId)));
      }
    }
    return says;
  }
  const withMessage = (h: HelpItem, plan: readonly TurnOn[]) =>
    t('getReady.helps.turnedOnWith', { name: helpName(h, readsName), related: joinAnd(plan.map((p) => helpName(p.item, readsName))) });
  async function toggle(h: HelpItem) {
    if (busy || !may || !languageId) return;
    setBusy(true);
    try {
      const itemId = await take(h);
      const level = { kind: 'language' as const, languageId };
      const r = recState(org?.recommendations, state, level, itemId);
      // Turned on, what goes with it comes on too, in one step that its switch takes back (decisions 134, 172); off touches nothing else.
      const plan = turnOnWith(h, out, docLanguage(h.doc), reader);
      if (plan.length) {
        await sayAll({ says: [turnOnSay(itemId, h.kind, r), ...await withSays(plan)] }, withMessage(h, plan));
        return;
      }
      // Off: a Bible or key-word list stops being recommended here (hidden when the organization recommends it); a guide or note is hidden here.
      // On: what was hidden follows the organization again, else it is recommended here.
      const chosenOnly = h.kind === 'source' || h.kind === 'words';
      const action = h.on
        ? (chosenOnly && !r.org ? 'inherit' : 'hide')
        : (r.language === 'hidden' && (r.org || !chosenOnly) ? 'inherit' : 'recommend');
      await rec.run(level, itemId, h.name, action);
    } catch (e) {
      ctx.toast(t('common.notSaved', { reason: referenceFailure('offer reference', e) }), 'problem'); // i18n-ignore: log label
    } finally {
      setBusy(false);
    }
  }
  /** Language-stream writes for one set's says, in one step; the same row changes it back (decision 134). */
  async function sayAll(plan: { says: ReferenceSay[] }, message: string) {
    const specs = (list: ReferenceSay[]) => list.map((p) => ({ id: Crypto.randomUUID(), type: 'v1.ReferenceSet', payload: p } as EventSpec));
    if (!plan.says.length) return;
    try {
      await ctx.act(specs(plan.says), message);
    } catch {
      // ctx.act has already said "Not saved" and why.
    }
  }
  /**
   * Offer a guide set (or FIA's key words) in one language: taken into the library first when it is another organization's,
   * then the team's only language of it. Turned on, what goes with it comes on too, in this language as far as it can (decision 172).
   */
  async function chooseLanguage(h: HelpItem, m: SetMember) {
    if (busy || !may || !languageId || !h.set) return;
    setBusy(true);
    try {
      const itemId = await take(m);
      const set = { ...h.set.set, members: h.set.set.members.map((x) => (x === m ? { ...x, itemId, shared: null } : x)) };
      const now = ctx.language.state;
      const plan = turnOnWith(h, out, m.language, reader);
      const says = [...chooseSetLanguage(set, itemId, now).says, ...await withSays(plan)];
      const message = plan.length ? withMessage(h, plan)
        : isWordSet(set) ? t('getReady.helps.wordSetChosen', { name: set.name, language: languageLabel(m.language) })
        : t('getReady.helps.setChosen', { name: guideShortName(set.name), language: languageLabel(m.language) });
      await sayAll({ says }, message);
    } catch (e) {
      ctx.toast(t('common.notSaved', { reason: referenceFailure('choose guide language', e) }), 'problem'); // i18n-ignore: log label
    } finally {
      setBusy(false);
    }
  }
  /** Stop offering a guide set to the team, in every language. */
  async function setOff(h: HelpItem) {
    if (busy || !may || !languageId || !h.set) return;
    setBusy(true);
    await sayAll(hideSet(h.set.set, ctx.language.state), isWordSet(h.set.set)
      ? t('getReady.helps.wordSetOff', { name: h.set.set.name })
      : t('getReady.helps.setOff', { name: guideShortName(h.set.set.name) }));
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

/** What a guide or key-word row says of its language: the set's languages chosen, or how many it comes in; a single one's own. */
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
  // Opened from a ready language's Reference material (or its Languages) to change the language: back there once it is saved.
  const languageOnly = props.only && props.ctx.params['page'] === 'language';
  // A phone's Back from what is offered goes back to the language, the page before (decision 137).
  useHardwareBack(page === 'helps', () => setPage('language'));
  return page === 'language'
    ? <ReferenceLanguageStep {...props} onDone={() => (languageOnly ? props.next() : setPage('helps'))} />
    : <HelpsList {...props} onLanguage={() => setPage('language')} />;
}

/**
 * The team's reference language: saved when it changes, and a guide set
 * (FIA) the team has follows it into that language when it is there.
 */
function ReferenceLanguageStep({ ctx, lang, header, back, onDone }: StepProps & { onDone: () => void }) {
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
      }
    } catch (e) {
      ctx.toast(t('common.notSaved', { reason: referenceFailure('reference language', e) }), 'problem'); // i18n-ignore: log label
      setBusy(false);
      return;
    }
    const specs = (list: typeof says) => list.map((x) => ({ id: Crypto.randomUUID(), ...x } as EventSpec));
    try {
      // Choosing the earlier languages again changes it back (decision 134).
      await ctx.act(specs(says), t('getReady.language.saved', { team: lang, language: joinAnd(values.map(languageLabel)) }));
    } catch {
      // ctx.act has already said "Not saved" and why.
      setBusy(false);
      return;
    }
    setBusy(false);
    onDone();
  }

  return (
    <Screen header={header} bodyStyle={PAD} footer={<>
      <PrimaryBtn label={t('common.next')} icon="right" busy={busy} help={t('getReady.language.nextHelp')} onPress={() => void save()} />
      <StepBack onPress={back} />
    </>}>
      <ReferenceLanguagePage team={lang} choices={refs.choices} value={values} first={current} onChange={setPicked} loading={refs.loading} />
      {!may ? <Banner icon="lock" title={t('common.viewOnly')} body={t('getReady.helps.viewOnly')} /> : null}
    </Screen>
  );
}

/** A "Goes with" filter in the search bar: the family it shows, the row whose link put it there, and that row's name. */
interface GoesWith { family: string; key: string; name: string }

const NO_LINKS: ReadonlyMap<string, number> = new Map();

/**
 * The search bar over a list of helps (decision 172): words typed, and a
 * "Goes with" filter a row's related link puts in it; the two combine.
 * Either one looks through everything, past the team's language, with what
 * the organization does not have yet listed last (`helpSections`).
 */
function useHelpSearch(items: readonly HelpItem[]) {
  const [query, setQuery] = useState('');
  const [goesWith, setGoesWith] = useState<GoesWith | null>(null);
  const searching = !!query.trim() || !!goesWith;
  const found = searching ? searchHelps(items, query, goesWith?.family ?? null) : [];
  const filter = goesWith ? {
    filter: {
      label: t('getReady.helps.goesWithFilter', { name: goesWith.name }), clearLabel: t('getReady.helps.clearGoesWith'),
      clearHelp: t('getReady.helps.clearGoesWithHelp'), onClear: () => setGoesWith(null)
    }
  } : {};
  const bar = (
    <View style={{ gap: space.xs }}>
      <SearchField value={query} onChangeText={setQuery} placeholder={t('getReady.helps.search')} help={t('getReady.helps.searchHelp')} {...filter} />
      {goesWith ? <Text style={[txt.xs, { paddingHorizontal: space.xs }]}>{t('getReady.helps.familyNote', { name: goesWith.name })}</Text>
        : searching ? <Text style={[txt.xs, { paddingHorizontal: space.xs }]}>{t('getReady.helps.searchHint')}</Text> : null}
    </View>
  );
  /**
   * Under a row: while "Goes with" filters the list, that it goes with the
   * row the filter names; otherwise, on the row `links` names, how many
   * related resources are on, a tap from showing only them.
   */
  const below = (x: HelpItem, name: string, links: ReadonlyMap<string, number>): ReactNode => {
    if (goesWith) {
      return x.key !== goesWith.key && x.family === goesWith.family
        ? <View style={{ flexDirection: 'row' }}><Badge label={t('getReady.helps.goesWithFilter', { name: goesWith.name })} tone="brand" /></View>
        : undefined;
    }
    const n = links.get(x.key);
    return n && x.family ? <RowLink label={t('getReady.helps.relatedOn', { count: n })} help={t('getReady.helps.relatedHelp')}
      onPress={() => setGoesWith({ family: x.family!, key: x.key, name })} /> : undefined;
  };
  /** Nothing found: what was typed, or the filter. */
  const nothing = query.trim() ? t('common.nothingMatches', { query: query.trim() }) : t('reference.guides.nothingMatches');
  return { query, searching, found, goesWith, bar, below, nothing };
}

/** A help's name as its row shows it, for a toast: "FIA study guides", "FIA key words", without the team's language. */
function helpName(x: HelpItem, reads: string): string {
  return x.kind === 'guide' ? t('getReady.helps.namedGuides', { name: guideShortName(x.name) }) : plainName(x.name, reads);
}

/** "302 words": a key-word set's, in the language chosen (nothing while it is off); a single list's own. */
function wordsLine(x: HelpItem): string {
  const count = x.set ? x.set.reach.reduce((n, m) => Math.max(n, m.passages), 0) : x.doc.format === 'material@1' ? x.doc.terms?.length ?? 0 : 0;
  return count ? t('reference.words', { count }) : '';
}

function HelpsList({ ctx, lang, header, next, onLanguage }: StepProps & { onLanguage: () => void }) {
  const languageId = ctx.language.languageId;
  const h = useHelpItems(ctx);
  const sheet = useSetSheet(h, lang);
  const numbering = useVerseNumbering(ctx);
  const comes = useComesWith(ctx);
  const search = useHelpSearch(h.items);
  const reads = languageLabel(h.reads);
  // Only what is in the team's language, and what the team already has (decision 130 amended); a search looks through everything.
  const s = search.searching ? helpSections(search.found, true) : helpSections(h.items.filter((x) => inTeamLanguage(x, h.languages)), false);
  const links = search.searching ? NO_LINKS : relatedLinks([...s.bibles, ...s.guides, ...s.words, ...s.notes], h.items);
  const press = (x: HelpItem) => onHelpPress(x, h.items, sheet.open, (item) => void h.toggle(item));
  const onOff = (x: HelpItem) => (x.on ? t('getReady.helps.onInline') : t('getReady.helps.offInline'));
  const bibleRow = (b: HelpItem, last: boolean) => {
    const doc = b.doc as SourceDoc;
    return (
      <HelpRow key={b.key} of="getReady.bible">
        <CheckRow label={`${languageLabel(doc.language)} · ${doc.abbreviation}`} sub={mediaText(mediaOf(doc, h.get))} checked={b.on} highlight={search.query} last={last}
          disabled={!h.may || h.busy} onToggle={() => void h.toggle(b)} playLabel={t('admin.checkRow.hear', { name: b.name })} playHelp={t('getReady.helps.openBibleHelp')}
          {...(b.itemId ? { onPlay: () => ctx.go('bible_explore', { itemId: b.itemId!, languageId }) } : {})} />
      </HelpRow>
    );
  };
  const guideRow = (g: HelpItem, last: boolean) => {
    const label = t('getReady.helps.namedGuides', { name: guideShortName(g.name) });
    return (
      <HelpRow key={g.key} of="getReady.guide">
        <SwitchRow icon="star" label={label} highlight={search.query} sub={[fromLine(g), guideLanguageLine(g), onOff(g), comes(g)].filter(Boolean).join(' · ')}
          on={g.on} disabled={!h.may || h.busy} help={helpItemLine(g, h.items)} onToggle={() => press(g)} last={last} below={search.below(g, label, links)} />
      </HelpRow>
    );
  };
  const wordRow = (x: HelpItem, last: boolean) => {
    const label = plainName(x.name, reads);
    return (
      <HelpRow key={x.key} of="getReady.words">
        <SwitchRow icon="key" iconColor={TINT.amberText} label={label} highlight={search.query} sub={[fromLine(x), guideLanguageLine(x), wordsLine(x), onOff(x)].filter(Boolean).join(' · ')}
          on={x.on} disabled={!h.may || h.busy} help={helpItemLine(x, h.items)} onToggle={() => press(x)} last={last} below={search.below(x, label, links)} />
      </HelpRow>
    );
  };
  const noteRow = (x: HelpItem, last: boolean) => (
    <HelpRow key={x.key} of="getReady.note">
      <SwitchRow icon="note" label={x.name} highlight={search.query}
        sub={[inLibrary(x) ? '' : fromLine(x), x.on ? t('getReady.helps.on') : t('getReady.helps.off'), languagesLine([docLanguage(x.doc)])].filter(Boolean).join(' · ')}
        on={x.on} disabled={!h.may || h.busy} help={helpItemLine(x, h.items)} onToggle={() => press(x)} last={last} below={search.below(x, x.name, links)} />
    </HelpRow>
  );
  const rowOf = (x: HelpItem, last: boolean) => (x.kind === 'source' ? bibleRow(x, last) : x.kind === 'guide' ? guideRow(x, last) : x.kind === 'words' ? wordRow(x, last) : noteRow(x, last));
  return (
    <Screen header={header} bodyStyle={PAD} footer={<>
      <PrimaryBtn label={t('common.next')} icon="right" help={t('getReady.nextHelp')} onPress={next} />
      <StepBack onPress={onLanguage} />
    </>}>
      <ReferenceLanguageChip languages={h.languages} onPress={onLanguage} />
      <Question>{questionLabel('helps')}</Question>
      {search.bar}
      {s.bibles.length || !search.searching ? (
        <>
          <SectionLabel label={t('getReady.helps.biblesTheyUnderstand')} />
          <Group>
            {s.bibles.map((b, i) => bibleRow(b, search.searching && i === s.bibles.length - 1))}
            {/* Finding another Bible belongs to the whole list, not to a search of it. */}
            {!search.searching ? (
              <Row icon="book" label={t('getReady.helps.findBible')} sub={s.bibles.length ? undefined : t('getReady.helps.noneChosen')} last
                help={t('getReady.helps.findBibleHelp')} onPress={() => ctx.go('reference_bibles', { languageId })} />
            ) : null}
          </Group>
        </>
      ) : null}
      {s.guides.length ? (
        <>
          <SectionLabel label={t('getReady.helps.studyGuides')} />
          <Group>{s.guides.map((g, i) => guideRow(g, i === s.guides.length - 1))}</Group>
        </>
      ) : h.loading && !search.searching ? <Text style={txt.smMuted}>{t('getReady.helps.lookingForGuides')}</Text> : null}
      {numbering.clash && !search.searching ? <NumberingNote clash={numbering.clash} onIgnore={numbering.ignore} /> : null}
      {s.words.length ? (
        <>
          <SectionLabel label={t('getReady.page.keyWords')} />
          <Group>{s.words.map((x, i) => wordRow(x, i === s.words.length - 1))}</Group>
        </>
      ) : null}
      {s.notes.length ? (
        <>
          <SectionLabel label={t('getReady.helps.notesForTranslators')} />
          <Group>{s.notes.map((x, i) => noteRow(x, i === s.notes.length - 1))}</Group>
        </>
      ) : null}
      {s.notYet.length ? (
        <>
          <SectionLabel label={t('getReady.helps.notInLibrary')} />
          <Group>{s.notYet.map((x, i) => rowOf(x, i === s.notYet.length - 1))}</Group>
        </>
      ) : null}
      {search.searching && !search.found.length ? <Text style={[txt.smMuted, { paddingHorizontal: space.xs }]}>{search.nothing}</Text> : null}
      {!h.may ? <Banner icon="lock" title={t('common.viewOnly')} body={t('getReady.helps.viewOnly')} /> : null}
      {sheet.sheet}
    </Screen>
  );
}

/**
 * Reference material, on a ready language: every kind of help with a switch each, Add more, and the organization's whole shelf (decision 138),
 * searched from a bar at the top, the team's own key terms beside the key-word lists (decision 172).
 */
function HelpsPage({ ctx }: { ctx: Ctx }) {
  const state = ctx.language.state!;
  const languageId = ctx.language.languageId;
  const lang = languageName(ctx.org.state, languageId);
  const h = useHelpItems(ctx);
  const sheet = useSetSheet(h, lang);
  const search = useHelpSearch(h.items);
  const reads = languageLabel(h.reads);
  const [adding, setAdding] = useState(false);
  // A note for every language goes to the organization's library; without that, it is written in this language (UI audit, finding 54).
  const noteTo: Record<string, string> = useLibrary(ctx).canWrite('material') ? { itemId: 'new', kind: 'note', languageId } : { languageId };
  const terms = useMemo(() => keyTermsFor(state), [state]);
  const written = useMemo(() => materialsFor(state).filter((m) => m.kind !== 'questions' && m.kind !== 'key_terms' && m.kind !== 'fia_study'), [state]);
  // Only what is in the team's language, and what the team already has (decision 130 amended); a search looks through everything.
  const s = search.searching ? helpSections(search.found, true) : helpSections(h.items.filter((x) => inTeamLanguage(x, h.languages)), false);
  const links = search.searching ? NO_LINKS : relatedLinks([...s.bibles, ...s.guides, ...s.words, ...s.notes], h.items);
  const switchRow = (x: HelpItem, last: boolean, sub: string) => {
    const label = plainName(x.name, reads);
    return (
      <HelpRow key={x.key} of={`getReady.${x.kind}`}>
        <SwitchRow label={label} sub={sub} on={x.on} highlight={search.query} disabled={!h.may || h.busy} help={helpItemLine(x, h.items)}
          onToggle={() => onHelpPress(x, h.items, sheet.open, (item) => void h.toggle(item))} last={last} below={search.below(x, label, links)} />
      </HelpRow>
    );
  };
  const bibleRow = (b: HelpItem, last: boolean) => {
    const doc = b.doc as SourceDoc;
    return switchRow(b, last, `${languageLabel(doc.language)} · ${mediaText(mediaOf(doc, h.get), true)}`);
  };
  const guideRow = (g: HelpItem, last: boolean) => {
    // A set counts the passages of the languages chosen; off, none.
    const entries = g.set ? g.set.reach.reduce((n, m) => Math.max(n, m.passages), 0) : g.doc.format === 'collection@1' ? (g.doc as CollectionDoc).entries.length : 0;
    return switchRow(g, last, [fromLine(g), guideLanguageLine(g), entries ? t('getReady.page.passagesCovered', { count: entries }) : ''].filter(Boolean).join(' · '));
  };
  const wordRow = (x: HelpItem, last: boolean) => switchRow(x, last, [fromLine(x), guideLanguageLine(x), wordsLine(x)].filter(Boolean).join(' · '));
  const noteRow = (x: HelpItem, last: boolean) => switchRow(x, last, [x.owner, languagesLine([docLanguage(x.doc)])].filter(Boolean).join(' · '));
  const rowOf = (x: HelpItem, last: boolean) => (x.kind === 'source' ? bibleRow(x, last) : x.kind === 'guide' ? guideRow(x, last) : x.kind === 'words' ? wordRow(x, last) : noteRow(x, last));
  const none = (label: string) => <Row label={label} sub={t('getReady.page.addToOffer')} muted last />;
  // While searching, the team's own key terms and the notes written here show when the words typed are in them; "Goes with" shows neither.
  const showTerms = !search.goesWith && matchesWords(t('getReady.page.keyWords'), search.query);
  const ownNotes = search.goesWith ? [] : written.filter((m) => matchesWords(m.title, search.query));
  const rendered = terms.filter((term) => term.renderings.length > 0).length;
  const found = search.found.length + ownNotes.length + (showTerms ? 1 : 0);
  const go = (to: Parameters<Ctx['go']>[0], params: Record<string, string>) => { setAdding(false); ctx.go(to, params); };
  return (
    <Screen header={<Header title={t('org.language.referenceMaterial')} sub={lang} onBack={ctx.back} />} bodyStyle={{ gap: space.sm }}
      footer={h.may ? <PrimaryBtn label={t('getReady.page.addMore')} icon="plus" help={t('getReady.page.addMoreHelp')} onPress={() => setAdding(true)} /> : undefined}>
      <ReferenceLanguageChip languages={h.languages} onPress={() => ctx.go('get_ready', { languageId, step: '2', only: '1', page: 'language' })} />
      {search.bar}
      {s.bibles.length || !search.searching ? (
        <>
          <SectionLabel label={t('getReady.page.bibles')} />
          <Group>{s.bibles.length ? s.bibles.map((b, i) => bibleRow(b, i === s.bibles.length - 1)) : none(t('getReady.page.noBibles'))}</Group>
        </>
      ) : null}
      {s.guides.length || !search.searching ? (
        <>
          <SectionLabel label={t('getReady.helps.studyGuides')} />
          <Group>
            {s.guides.length ? s.guides.map((g, i) => guideRow(g, i === s.guides.length - 1))
              : h.loading ? <Text style={txt.smMuted}>{t('getReady.helps.lookingForGuides')}</Text> : none(t('getReady.page.noGuides'))}
          </Group>
        </>
      ) : null}
      {s.words.length || showTerms ? (
        <>
          <SectionLabel label={t('getReady.page.keyWords')} />
          <Group>
            {/* The team's own words first, then the lists it is offered (FIA's key words). */}
            {showTerms ? (
              // Named by what it holds: the section above already says Key words (UI audit, finding 18).
              <Row label={t('getReady.page.keyTermsSub', { count: terms.length, rendered: formatNumber(rendered), language: lang })} last={!s.words.length}
                help={t('getReady.page.keyTermsHelp')} onPress={() => ctx.go('key_terms', { languageId })} />
            ) : null}
            {s.words.map((x, i) => wordRow(x, i === s.words.length - 1))}
          </Group>
        </>
      ) : null}
      {s.notes.length || ownNotes.length || !search.searching ? (
        <>
          <SectionLabel label={t('getReady.helps.notesForTranslators')} />
          <Group>
            {s.notes.map((x, i) => noteRow(x, i === s.notes.length - 1 && ownNotes.length === 0))}
            {ownNotes.map((m, i) => (
              <HelpRow key={m.materialId} of="getReady.writtenNote">
                <Row label={m.title} sub={t('getReady.page.writtenHere')} last={i === ownNotes.length - 1} help={t('getReady.page.noteHelp')}
                  onPress={h.may ? () => ctx.go('material_editor', { materialId: m.materialId, languageId }) : undefined} />
              </HelpRow>
            ))}
            {s.notes.length + ownNotes.length === 0 ? none(t('getReady.page.noNotes')) : null}
          </Group>
        </>
      ) : null}
      {s.notYet.length ? (
        <>
          <SectionLabel label={t('getReady.helps.notInLibrary')} />
          <Group>{s.notYet.map((x, i) => rowOf(x, i === s.notYet.length - 1))}</Group>
        </>
      ) : null}
      {search.searching && !found ? <Text style={[txt.smMuted, { paddingHorizontal: space.xs }]}>{search.nothing}</Text> : null}
      {/* Last, the organization's whole shelf (decision 138). */}
      {ctx.session.can('manage_reference') ? (
        <Group>
          <Row icon="layers" label={t('getReady.helps.all')} help={t('getReady.helps.allHelp')} last onPress={() => ctx.go('reference_home', { languageId })} />
        </Group>
      ) : null}
      <Sheet visible={adding} title={t('getReady.page.addMore')} sub={t('getReady.add.sub', { language: lang })} onClose={() => setAdding(false)}>
        <Group>
          <Row icon="book" label={t('getReady.add.bible')} sub={t('getReady.add.bibleSub')} onPress={() => go('reference_bibles', { languageId })} />
          <Row icon="star" label={t('getReady.add.guide')} sub={t('getReady.add.guideSub')} onPress={() => go('reference_guides', { languageId })} />
          <Row icon="note" label={t('getReady.add.note')} sub={t('getReady.add.noteSub')} onPress={() => go('material_editor', noteTo)} />
          <Row icon="key" label={t('getReady.page.keyWords')} sub={t('getReady.add.keyWordsSub')} last onPress={() => go('key_terms', { languageId })} />
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

function ChecksStep({ ctx, header, next, back }: StepProps) {
  const state = ctx.language.state!;
  const languageId = ctx.language.languageId;
  const kinds = useMemo(() => deriveKinds(state), [state]);
  const flow = useMemo(() => deriveFlow(state), [state]);
  const custom = flow.flowId === CUSTOM_FLOW;
  const { lib, entries, current, starter, first, main, rest, kindsOf, titleOf, loaded } = useCheckChoices(ctx, flow.itemId, kinds, teamLanguages(ctx.org.state, state, languageId));
  const [picked, setPicked] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const key = picked ?? (custom ? 'custom' : first?.c.key ?? null);
  const canUse = ctx.session.can('manage_flows');
  // Back from choosing the checks yourself, the checks saved there are the answer and the footer moves on (UI audit, finding 100).
  const chose = useRef(false);
  useEffect(() => {
    if (chose.current && custom && flow.steps.length > 0) { chose.current = false; setPicked('custom'); }
  }, [custom, flow]);

  // Its own checks would be gone for good: it asks before a ready-made set replaces them (decision 134).
  const [replacing, setReplacing] = useState<FlowEntry | null>(null);
  async function answer() {
    if (busy) return;
    if (key === 'choose') { chose.current = true; ctx.go('flow_editor', { languageId, steps: 'language', done: '1' }); return; }
    const pick = entries.find((e) => e.c.key === key);
    if (!pick || pick.c === current || key === 'custom') { next(); return; }
    if (!canUse) { ctx.toast(t('getReady.checks.onlyChoosers')); return; }
    // Checks still as a ready-made set made them can be chosen again: only the language's own are asked about.
    if (custom && flow.steps.length > 0 && !entries.some((e) => sameChecks(flow.steps, e.doc.steps))) { setReplacing(pick); return; }
    await takeFlow(pick);
  }
  async function takeFlow(pick: FlowEntry) {
    setBusy(true);
    let specs: EventSpec[];
    try {
      // A ready-made flow is copied into the language, its checks the language's own (decision 91).
      specs = commands(state, indexesFor(state)).copyFlow({ commandId: Crypto.randomUUID(), name: pick.c.name, kinds: kindsOf(pick.doc), steps: pick.doc.steps });
    } catch (e) {
      ctx.toast(t('common.notSaved', { reason: failureMessage('get ready: who checks', e) }), 'problem');
      setBusy(false);
      return;
    }
    try {
      await ctx.act(specs, t('getReady.checks.saved', { title: titleOf(pick.doc) }));
    } catch { setBusy(false); return; }
    setBusy(false);
    next();
  }

  const card = (e: FlowEntry, i: number) => {
    const on = key === e.c.key;
    const sub = e.c === current ? t('getReady.checks.inUse') : e === starter && i === 0 ? t('getReady.checks.suggested') : flowSub(e.doc.steps);
    return (
      <HelpRow key={e.c.key} of="getReady.way">
        <ChoiceCard on={on} icon="flow" title={titleOf(e.doc)} sub={sub} help={t('getReady.checks.wayHelp')} onPress={() => setPicked(e.c.key)}>
          {on && e.doc.steps.length ? <NumberedSteps items={flowWho(e.doc.steps, kindsOf(e.doc))} /> : null}
        </ChoiceCard>
      </HelpRow>
    );
  };
  return (
    <Screen header={header} bodyStyle={PAD}
      // Next waits for the ready-made list: pressed while it loads, it moved on without the suggested checks.
      footer={<>
        <PrimaryBtn label={key === 'choose' ? t('getReady.checks.chooseSteps') : t('common.next')} icon="right" busy={busy}
          {...(key === 'choose' ? {} : { help: t('getReady.checks.nextHelp') })} disabled={!loaded && key === null} onPress={() => void answer()} />
        <StepBack onPress={back} />
      </>}>
      <Question>{questionLabel('checks')}</Question>
      {/* Making your own comes first, set apart, so the ready-made list below can grow (design principle 12). */}
      {canUse ? (
        <ChoiceCard own on={key === 'choose'} icon="edit" title={t('getReady.checks.illChoose')} help={t('getReady.checks.illChooseHelp')} onPress={() => setPicked('choose')} />
      ) : null}
      {custom ? (
        <ChoiceCard on={key === 'custom'} icon="flow" title={flowTitle(flow.steps, kinds)} sub={t('getReady.checks.ownSteps')} help={t('getReady.checks.keepOwnHelp')}
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
      <ConfirmDelete visible={!!replacing} name={replacing ? titleOf(replacing.doc) : ''} replaces
        title={t('checks.flows.replaceAsk', { language: languageName(ctx.org.state, languageId), name: replacing ? titleOf(replacing.doc) : '' })} confirmLabel={t('checks.flows.use', { name: replacing ? titleOf(replacing.doc) : '' })}
        onClose={() => setReplacing(null)} onConfirm={() => { const r = replacing; setReplacing(null); if (r) void takeFlow(r); }} />
    </Screen>
  );
}

// ---- 4 Invite your translators -------------------------------------------------------------------

function InviteStep({ ctx, lang, header, next, back }: StepProps) {
  const languageId = ctx.language.languageId;
  const scope = { level: 'language' as const, languageId };
  const roles = usePlainRoles(ctx, scope);
  const [choice, setChoice] = useState<PlainRoleId | string>('translate');
  const [more, setMore] = useState(false);
  const may = ctx.session.can('invite_members') && mayGrantAt(ctx.org.state, ctx.session.actorId, scope);
  const roleId = roles.choices.find((c) => c.id === choice)?.roleId ?? roles.others.find((r) => r.id === choice)?.id ?? null;
  const invite = useGroupInvite(ctx.language.orgId, may ? roleId : null, may ? scope : null, t('admin.invite.teamLabel', { name: lang }));
  const uri = invite && 'uri' in invite ? invite.uri : null;
  // A role made from here ("Something else: make a new role") comes back chosen, its code shown, as on Invite someone.
  const rolesBefore = useRef<Set<string> | null>(null);
  const otherIds = roles.others.map((r) => r.id).join('|');
  useEffect(() => {
    const before = rolesBefore.current;
    const made = before ? roles.others.find((r) => !before.has(r.id)) : undefined;
    if (made) { rolesBefore.current = null; setMore(true); setChoice(made.id); }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `otherIds` names what changes in `roles.others`
  }, [otherIds]);
  function newRole() {
    rolesBefore.current = new Set(roles.others.map((r) => r.id));
    ctx.go('role_editor', { roleId: 'new' });
  }
  return (
    <Screen header={header} bodyStyle={PAD}
      footer={<>
        <PrimaryBtn label={t('common.done')} icon="check" help={t('help.details.done')} onPress={next} />
        {uri || back ? <QuietLinks items={[
          ...(uri ? [{ label: t('admin.invite.shareLink'), icon: 'send' as const, help: t('admin.invite.shareLinkHelp'), onPress: () => shareInvite(ctx, uri) }] : []),
          ...(back ? [{ label: t('common.back'), icon: 'arrowL' as const, help: t('getReady.backHelp'), onPress: back }] : [])
        ]} /> : null}
      </>}>
      <Question>{questionLabel('invite')}</Question>
      {/* Making a new role comes first, set apart from the roles there are (design principle 12). */}
      {ctx.session.can('manage_roles') ? (
        <DashedRow icon="plus" label={t('admin.invite.newRole')} detail={t('admin.invite.newRoleHelp')} onPress={newRole} />
      ) : null}
      <Pills>
        {/* help-each: each plain role does different work */}
        {roles.choices.map((c) => <Chip key={c.id} label={c.chip} on={choice === c.id} help={plainRoleHelp(c.id)} onPress={() => setChoice(c.id)} />)}
        {more ? roles.others.map((r) => (
          <HelpRow key={r.id} of="getReady.otherRole">
            <Chip label={r.name} on={choice === r.id} help={t('admin.invite.pickRoleHelp')} onPress={() => setChoice(r.id)} />
          </HelpRow>
        )) : null}
        {!more && roles.others.length ? <Chip label={t('admin.invite.otherRoles', { total: formatNumber(roles.others.length) })} icon="down" on={false} help={t('admin.invite.otherRolesHelp')} onPress={() => setMore(true)} /> : null}
      </Pills>
      {may ? <InviteCode state={invite} /> : (
        <Banner icon="lock" title={t('getReady.invite.cannotTitle')} body={t('getReady.invite.cannotBody', { language: lang })} />
      )}
    </Screen>
  );
}

export const contracts = contractsFor('get_ready');
