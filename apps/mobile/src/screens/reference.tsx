// Reference material by level (docs/reference-material.md; app-only screens,
// reasons in test/specParity.test.ts). The demo's one Reference Library
// (config.tsx ReferenceLibraryScreen, ORG-8) grows into what the owner asked
// for: an organization recommends options, a language narrows or adds to
// them for its team, translators still choose for themselves, and everyone
// sees what has audio and what can be kept offline.
//   Bibles        recommended sources at this level, adding one (LangQuest's or Bible Brain's)
//   Bible         one source: text, audio, timings per testament, offline, copyright; verse timings
//   Guides/Notes  guides and notes with recommendations and a filter
//   Coverage      which recommended material reaches each of a language's passages
//   What helps    one passage: its text a tap away in a Bible you choose, what each help says
//                 there, Show here / Hide here, and Add a help, a note for translators first
//                 (demo ADR-042; design principles 12, 13)
// One main action per screen, the rest one labelled tap away (decision 56).
// Pure reading lives in src/reference/ (model.ts, coverage.ts, timings.ts, offered.ts).
import {
  derivePassage, keyTermsForUnit, languageName, type libraryUnitRange, materialsFor, unitTitle,
  type RecommendationSource, type SourceDoc, type TemplateDoc, type VersificationDoc
} from '@langquest-next/core';
import * as Crypto from 'expo-crypto';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '../ui/text';
import type { Ctx } from '../shell/ctx';
import { t } from '../i18n';
import { formatNumber } from '../i18n/format';
import { indexesFor } from '../sync/indexes';
import { Badge, Banner, Card, Chip, ChipRow, Disclosure, EmptyState, GhostBtn, Group, Header, PrimaryBtn, ProgressBar, Row, Screen, SearchField, SectionLabel, Sheet, ShowMore, SmallBtn } from '../ui/kit';
import { txt } from '../ui/textStyles';
import { useOpenDetail } from '../ui/useLayout';
import { sourceLine, type SharedItem } from '../library/model';
import { useLibrary, useLibraryDocs, useSharedItems } from '../library/useLibrary';
import { noteExpected } from '../diagnostics/report';
import { BibleError, bibleDetail, biblesIn, bibleSearchAvailable, heldDetail, searchLanguages, type BibleDetail, type BibleLanguage, type BibleSummary } from '../sources/bibleBrainAdmin';
import { coverageSummary, itemReaches } from '../reference/coverage';
import {
  biblebrainItemId, offlineLine, orgLevelCan, recActions, recLabel, recState, recTone,
  sourceFacts, sourceFromBible, sourceSummary, testamentLines, timingsNeeded, type Level
} from '../reference/model';
import { bibleBrainDescription, bibleBrainIds, bibleLine, providerName, readySources, settledLanguage, splitBibles } from '../reference/biblesModel';
import { timingsOffer, bookTimingLine, failReason, jobView, publicationLine, timedBookCount, type JobOutcome } from '../reference/timingsModel';
import { KIND_FILTERS, activeFilterCount, filterGuides, filterOptions, guideItems, guideLine, guideRows, kindFilterLabel, type KindFilter } from '../reference/guidesModel';
import {
  addableHelps, addableLine, coverageFor, coverageNames, coverageRow, coverageShown, guideStudies, helpCards, offeredAmong, ownGuideItem, passageHelps,
  passageLinkSpec, refIcon, templateVersification, visibleNotes, writtenHelps, type CoverFilter
} from '../reference/passagesModel';
import { usePassages } from '../reference/usePassages';
import { useRecommend, useRefItems, useTimingJobs, useTimingPublisher, type TimingJob } from '../reference/useReference';
import { levelOf, publishTimingJob, referenceFailure, requestTimings, versificationHash } from '../reference/referenceActions';
import { teamLanguage } from '../reference/languages';
import { termsInText } from '../recording/workspaceModel';
import { languageLabel } from '../admin/adminModel';
import { HelpCard, PassageTextBar, WordChip } from '../helps/helps';
import { DashedBtn } from '../recording/blocks';
import { useBible } from '../helps/useBible';
import { contractsFor } from '../shell/screenContracts';
import { bibleErrorText } from '../sources/bibleBrain';
import { space, TINT } from '../ui/theme';

const STEP = 25;

/** May this person change recommendations here? The organization's need an organization-wide role; a language's, Manage Reference there. */
function canActAt(ctx: Ctx, level: Level): boolean {
  return level.kind === 'org' ? orgLevelCan(ctx.org.state, ctx.session.actorId, 'manage_reference') : ctx.session.can('manage_reference');
}

function levelName(ctx: Ctx, level: Level): string {
  if (level.kind === 'language') return languageName(ctx.org.state, level.languageId);
  return ctx.org.state?.org?.value.name ?? t('reference.organization');
}

const levelParams = (level: Level): Record<string, string> => (level.kind === 'language' ? { languageId: level.languageId } : {});

function Intro(props: { children: ReactNode }) {
  return <Text style={[txt.smMuted, { paddingHorizontal: space.xs }]}>{props.children}</Text>;
}

/** What a recommendation button does, for help mode: who gets the item, or stops getting it. */
function recHelp(id: ReturnType<typeof recActions>[number]['id'], level: Level, r: ReturnType<typeof recState>): string {
  if (level.kind === 'org') return id === 'stop' ? t('reference.rec.stopOrgHelp') : t('reference.rec.recommendOrgHelp');
  switch (id) {
    case 'recommend': return t('reference.rec.recommendLanguageHelp');
    case 'hide': return t('reference.rec.hideHelp');
    // "Follow organization", or "Stop recommending" what only this language recommends.
    default: return r.language === 'hidden' || r.org ? t('reference.rec.followHelp') : t('reference.rec.stopLanguageHelp');
  }
}

/** Recommend, stop, hide or follow the organization, for one item at this level. */
function RecButtons(props: { ctx: Ctx; level: Level; itemId: string; name: string; rec: ReturnType<typeof useRecommend> }) {
  const r = recState(props.ctx.org.state?.recommendations, props.ctx.language.state, props.level, props.itemId);
  return (
    <View style={styles.actions}>
      {recActions(r, props.level).map((a) => (
        <SmallBtn key={a.id} label={a.label} tone={a.id === 'recommend' ? 'primary' : 'plain'} disabled={props.rec.busy} help={recHelp(a.id, props.level, r)}
          onPress={() => void props.rec.run(props.level, props.itemId, props.name, a.id)} />
      ))}
    </View>
  );
}

// ─── Bibles ──────────────────────────────────────────────────────────────────────────

export function ReferenceBibles(ctx: Ctx) {
  const level = levelOf(ctx);
  const beside = useOpenDetail();
  const { lib, rows, docs } = useRefItems(ctx);
  const canAct = canActAt(ctx, level);
  const rec = useRecommend(ctx);
  const shared = useSharedItems('material', lib.orgId);
  const [adding, setAdding] = useState(false);
  const [n, setN] = useState(STEP);

  // Bible Brain's detail says whether FCBH has timings and what may be kept offline; asked once a session.
  const [, setDetails] = useState(0);
  const bibleIds = bibleBrainIds(rows);
  useEffect(() => {
    if (!bibleIds || !bibleSearchAvailable) return;
    let active = true;
    void Promise.all(bibleIds.split(',').filter((id) => !heldDetail(id)).map((id) => bibleDetail(id).catch((e: unknown) => noteExpected('bible detail', e))))
      .then(() => { if (active) setDetails((x) => x + 1); });
    return () => { active = false; };
  }, [bibleIds]);

  if (!ctx.language.state || !ctx.org.state) return <Screen header={<Header title={t('reference.bibles.title')} onBack={ctx.back} />}><EmptyState title={t('common.loading')} /></Screen>;
  const { loading, on, hidden, off } = splitBibles(rows, ctx.org.state?.recommendations, ctx.language.state, level);

  const card = ({ r }: (typeof on)[number]) => {
    const doc = r.doc as SourceDoc;
    const facts = sourceFacts(doc, docs.get, doc.provider.kind === 'biblebrain' ? heldDetail(doc.provider.bibleId) : null);
    const st = recState(ctx.org.state?.recommendations, ctx.language.state, level, r.it.itemId);
    const label = recLabel(st, level);
    return (
      <Card key={r.it.itemId} current={beside?.screen === 'reference_source' && beside.params['itemId'] === r.it.itemId}
        onPress={() => ctx.go('reference_source', { itemId: r.it.itemId, ...levelParams(level) })} accessibilityLabel={t('reference.itemLabel', { name: r.it.name, state: label })}
        help={t('reference.bibles.cardHelp')}>
        <View style={styles.titleRow}>
          <Text style={[txt.h3, { flex: 1 }]}>{r.it.name}</Text>
          <Badge label={label} tone={recTone(st)} />
        </View>
        <Text style={txt.xs}>{[doc.abbreviation, languageLabel(doc.language), providerName(doc.provider.kind), sourceLine(r.it)].join(' · ')}</Text>
        <Text style={txt.sm}>{sourceSummary(facts)}</Text>
        {canAct ? <RecButtons ctx={ctx} level={level} itemId={r.it.itemId} name={r.it.name} rec={rec} /> : null}
      </Card>
    );
  };

  return (
    <Screen header={<Header title={t('reference.bibles.title')} sub={levelName(ctx, level)} onBack={ctx.back} />}
      // Adding a Bible follows LangQuest's or publishes Bible Brain's in the organization's library (`mayWriteLibrary`).
      footer={lib.canWrite('material') ? <PrimaryBtn label={t('reference.bibles.add')} icon="plus" onPress={() => setAdding(true)} /> : undefined}>
      <Intro>{level.kind === 'org' ? t('reference.bibles.introOrg') : t('reference.bibles.introLanguage')}</Intro>
      <SectionLabel label={t('reference.bibles.recommended', { n: on.length })} />
      {on.length ? on.slice(0, n).map(card) : (
        <Card><Text style={txt.smMuted}>{loading ? t('common.loading') : t('reference.bibles.noneRecommended')}</Text></Card>
      )}
      <ShowMore remaining={on.length - n} step={STEP} onMore={() => setN(n + STEP)} />
      {hidden.length ? (
        <>
          <SectionLabel label={t('reference.bibles.hidden', { n: hidden.length })} />
          {hidden.map(card)}
        </>
      ) : null}
      {off.length ? (
        <>
          <SectionLabel label={t('reference.bibles.notRecommended', { n: off.length })} />
          {off.map(card)}
        </>
      ) : null}
      {adding ? <AddBibleSheet ctx={ctx} level={level} shared={shared} rec={rec} onClose={() => setAdding(false)} /> : null}
    </Screen>
  );
}

/** Add a Bible: one of LangQuest's ready sources (followed, updating itself), or one from Bible Brain (published here). Either is then recommended at this level. */
function AddBibleSheet(props: { ctx: Ctx; level: Level; shared: ReturnType<typeof useSharedItems>; rec: ReturnType<typeof useRecommend>; onClose: () => void }) {
  const { ctx, level, shared, rec } = props;
  const lib = useLibrary(ctx);
  const [tab, setTab] = useState<'ready' | 'biblebrain'>('ready');
  const [busy, setBusy] = useState(false);
  const sharedV = useSharedItems('versification', lib.orgId);
  const readyDocs = useLibraryDocs(lib.orgId, shared.rows.map((s) => s.latest_hash));
  const ready = readySources(shared.rows, readyDocs, lib.items('material'));
  const fallback = teamLanguage(ctx.org.state, ctx.language.state, ctx.language.languageId);
  const [q, setQ] = useState(fallback);
  const [languages, setLanguages] = useState<BibleLanguage[]>([]);
  const [lang, setLang] = useState<string | null>(null);
  const [bibles, setBibles] = useState<BibleSummary[] | null>(null);
  const [picked, setPicked] = useState<BibleDetail | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (tab !== 'biblebrain' || !bibleSearchAvailable) return;
    const needle = q.trim();
    if (needle.length < 2) { setLanguages([]); return; }
    let active = true;
    const t = setTimeout(() => {
      searchLanguages(needle).then((ls) => {
        if (!active) return;
        setLanguages(ls);
        setError('');
        setLang((cur) => settledLanguage(ls, needle, cur));
      }).catch((e: unknown) => { if (active) setError(searchFailure(e)); });
    }, 350);
    return () => { active = false; clearTimeout(t); };
  }, [tab, q]);
  useEffect(() => {
    if (!lang) { setBibles(null); return; }
    let active = true;
    setBibles(null);
    biblesIn(lang).then((bs) => { if (active) setBibles(bs); }).catch((e: unknown) => { if (active) setError(searchFailure(e)); });
    return () => { active = false; };
  }, [lang]);

  async function addReady(s: SharedItem) {
    setBusy(true);
    try {
      const itemId = await lib.subscribe(s, true);
      await rec.run(level, itemId, s.name, 'recommend');
      props.onClose();
    } catch (e) {
      ctx.toast(t('reference.addBible.notAdded', { reason: referenceFailure('add ready source', e) })); // i18n-ignore: 'add ready source' is a log label
    } finally {
      setBusy(false);
    }
  }
  async function pick(b: BibleSummary) {
    setBusy(true);
    try { setPicked(await bibleDetail(b.bibleId)); } catch (e) { ctx.toast(referenceFailure('bible detail', e)); } finally { setBusy(false); } // i18n-ignore: 'bible detail' is a log label
  }
  async function addBibleBrain(d: BibleDetail) {
    setBusy(true);
    try {
      const itemId = biblebrainItemId(d.bibleId);
      if (!lib.item(itemId)?.current) {
        const v11n = await versificationHash(lib, 'eng', sharedV.rows);
        // i18n-ignore: the item's description is stored in the organization's library (its event log)
        await lib.publish({ kind: 'material', itemId, name: d.name, description: bibleBrainDescription(d.languageName), doc: sourceFromBible(d, v11n) });
      }
      await rec.run(level, itemId, d.name, 'recommend');
      props.onClose();
    } catch (e) {
      ctx.toast(t('reference.addBible.notAdded', { reason: referenceFailure('add bible brain source', e) })); // i18n-ignore: 'add bible brain source' is a log label
    } finally {
      setBusy(false);
    }
  }

  const facts = picked ? sourceFacts(sourceFromBible(picked, '0'.repeat(64)), () => null, picked) : null;
  return (
    <Sheet visible title={picked ? picked.name : t('reference.addBible.title')} onClose={props.onClose}
      sub={picked ? [picked.abbreviation, picked.languageName, providerName('biblebrain')].join(' · ') : t('reference.addBible.sub')}
      footer={picked ? (
        <>
          <PrimaryBtn label={t('reference.addBible.addAndRecommend')} onPress={() => void addBibleBrain(picked)} busy={busy} />
          <GhostBtn label={t('reference.addBible.backToList')} help={t('reference.addBible.backToListHelp')} onPress={() => setPicked(null)} />
        </>
      ) : undefined}>
      {picked && facts ? (
        <>
          <Group>
            {testamentLines(facts).map((l, i, all) => <Row key={l.testament} icon="book" label={l.label} sub={l.line} last={i === all.length - 1} />)}
          </Group>
          <Text style={txt.sm}>{offlineLine(facts)}</Text>
          {facts.copyright.map((c) => <Text key={c} style={txt.xs}>{c}</Text>)}
        </>
      ) : (
        <>
          <ChipRow>
            <Chip label={t('reference.addBible.fromLangQuest')} on={tab === 'ready'} help={t('reference.addBible.fromLangQuestHelp')} onPress={() => setTab('ready')} />
            <Chip label={providerName('biblebrain')} icon="search" on={tab === 'biblebrain'} help={t('reference.addBible.bibleBrainHelp')} onPress={() => setTab('biblebrain')} />
          </ChipRow>
          {tab === 'ready' ? (
            !shared.loaded ? <Text style={txt.smMuted}>{t('common.loading')}</Text>
              : ready.length === 0 ? <Text style={txt.smMuted}>{shared.error ? t('reference.addBible.listNotLoaded') : t('reference.addBible.nothingMore')}</Text>
              : (
                <Group>
                  {ready.map((s, i) => {
                    const doc = readyDocs.get(s.latest_hash) as SourceDoc;
                    return <Row key={`${s.org_id}/${s.item_id}`} icon="book" label={s.name} disabled={busy} last={i === ready.length - 1}
                      sub={[s.org_name, languageLabel(doc.language), sourceSummary(sourceFacts(doc, readyDocs.get))].join(' · ')} help={t('reference.addBible.readyHelp')} onPress={() => void addReady(s)} />;
                  })}
                </Group>
              )
          ) : !bibleSearchAvailable ? (
            <Text style={txt.smMuted}>{t('reference.addBible.noServer')}</Text>
          ) : (
            <>
              <SearchField value={q} onChangeText={(v) => { setQ(v); setLang(null); }} placeholder={t('reference.addBible.searchPlaceholder')} help={t('reference.addBible.searchHelp')} />
              {error ? <Text style={txt.error}>{error}</Text> : null}
              {languages.length ? (
                <ChipRow>
                  {languages.slice(0, 8).map((l) => (
                    <Chip key={l.code} label={`${l.name} · ${l.code}`} count={l.bibles} on={l.code === lang} help={t('reference.addBible.languageHelp')} onPress={() => setLang(l.code)} />
                  ))}
                </ChipRow>
              ) : null}
              {lang && bibles === null && !error ? <Text style={txt.smMuted}>{t('common.loading')}</Text> : null}
              {bibles && bibles.length === 0 ? <Text style={txt.smMuted}>{t('reference.addBible.noneInLanguage')}</Text> : null}
              {bibles && bibles.length ? (
                <Group>
                  {bibles.map((b, i) => (
                    <Row key={b.bibleId} icon="book" label={b.name} disabled={busy} last={i === bibles.length - 1}
                      sub={`${b.abbreviation} · ${bibleLine(b)}`} help={t('reference.addBible.bibleHelp')} onPress={() => void pick(b)} />
                  ))}
                </Group>
              ) : null}
            </>
          )}
        </>
      )}
    </Sheet>
  );
}

/** Why a Bible Brain search failed, plainly: a server without the Bible routes answers 404. */
function searchFailure(e: unknown): string {
  if (e instanceof BibleError && e.status === 404) return t('reference.addBible.noSearch');
  // Bible Brain's errors are already in the language showing; anything else is said plainly.
  return e instanceof BibleError ? e.message : bibleErrorText(e);
}

// ─── One Bible ───────────────────────────────────────────────────────────────────────

export function ReferenceSource(ctx: Ctx) {
  const level = levelOf(ctx);
  const itemId = ctx.params['itemId'] ?? '';
  const { lib, rows, docs } = useRefItems(ctx, (it) => it.itemId === itemId);
  const row = rows[0];
  const it = row?.it ?? null;
  const source = row?.doc?.format === 'source@1' ? row.doc : null;
  // This one Bible's books and their timings, to say what each book has (sources load without them).
  const bookDocs = useLibraryDocs(lib.orgId, source?.books.map((b) => b.doc) ?? []);
  const canAct = canActAt(ctx, level);
  const canManage = ctx.session.can('manage_reference');
  const rec = useRecommend(ctx);
  const bibleId = source?.provider.kind === 'biblebrain' ? source.provider.bibleId : null;
  const [detail, setDetail] = useState<BibleDetail | null>(bibleId ? heldDetail(bibleId) : null);
  const [detailError, setDetailError] = useState('');
  const [asking, setAsking] = useState(false);
  const booksOpen = ctx.details(`reference:source:${itemId}:books`);
  useEffect(() => {
    if (!bibleId || detail) return;
    let active = true;
    bibleDetail(bibleId).then((d) => { if (active) setDetail(d); }).catch((e: unknown) => { if (active) setDetailError(referenceFailure('bible detail', e)); }); // i18n-ignore: 'bible detail' is a log label
    return () => { active = false; };
  }, [bibleId, detail]);
  // Asking for timings and publishing them are organization-wide acts (request_timings, the source's next version).
  const canOrg = orgLevelCan(ctx.org.state, ctx.session.actorId, 'manage_reference');
  const timed = !!bibleId && canManage;
  const { jobs, refresh } = useTimingJobs(lib.orgId, it?.itemId ?? null, timed);
  const outcomes = useTimingPublisher(ctx, lib, it, jobs, timed && canOrg);

  if (!it || !source) {
    return <Screen header={<Header title={t('reference.source.title')} onBack={ctx.back} />}><EmptyState icon="book" title={it && !row?.doc ? t('common.loading') : t('reference.source.gone')} /></Screen>;
  }
  const facts = sourceFacts(source, (h) => bookDocs.get(h) ?? docs.get(h), detail);
  const need = timingsNeeded(source, facts, detail);
  const r = recState(ctx.org.state?.recommendations, ctx.language.state, level, it.itemId);
  const label = recLabel(r, level);
  const { followed, viaLangQuest, booksToTime, mayAsk } = timingsOffer(it, need, canOrg, jobs);

  async function ask() {
    if (!it || !source || asking) return;
    setAsking(true);
    try {
      const versification = (docs.get(source.versification) as VersificationDoc | null)?.code ?? 'eng';
      for (const q of need.requests) {
        await requestTimings(lib.orgId, { itemId: it.itemId, bibleId: q.bibleId, audioFileset: q.audioFileset, textFileset: q.textFileset, books: q.books, versification,
          ...(viaLangQuest ? { publishTo: viaLangQuest } : {}) });
      }
      ctx.toast(t('reference.source.asked', { count: booksToTime }));
      await refresh();
    } catch (e) {
      ctx.toast(t('reference.source.notAsked', { reason: referenceFailure('request timings', e) })); // i18n-ignore: 'request timings' is a log label
    } finally {
      setAsking(false);
    }
  }

  const timedBooks = timedBookCount(facts);
  return (
    <Screen header={<Header title={it.name} sub={[source.abbreviation, languageLabel(source.language), providerName(source.provider.kind)].join(' · ')} onBack={ctx.back} />}
      footer={mayAsk ? <PrimaryBtn label={t('reference.source.generate')} icon="clock" help={t('reference.source.generateHelp')} onPress={() => void ask()} busy={asking} /> : undefined}>
      <Card>
        <View style={styles.titleRow}>
          <Text style={[txt.h3, { flex: 1 }]}>{levelName(ctx, level)}</Text>
          <Badge label={label} tone={recTone(r)} />
        </View>
        {canAct ? <RecButtons ctx={ctx} level={level} itemId={it.itemId} name={it.name} rec={rec} /> : null}
      </Card>

      <SectionLabel label={t('reference.source.offers')} />
      <Group>
        {testamentLines(facts).map((l, i, all) => <Row key={l.testament} icon="book" label={l.label} sub={l.line} last={i === all.length - 1} />)}
      </Group>
      <Text style={[txt.sm, { paddingHorizontal: space.xs }]}>{offlineLine(facts)}</Text>
      {detailError && source.provider.kind === 'biblebrain' ? <Text style={[txt.xs, { paddingHorizontal: space.xs }]}>{t('reference.source.detailFailed', { reason: detailError })}</Text> : null}
      {facts.copyright.length ? (
        <Card>
          {facts.copyright.map((c) => <Text key={c} style={txt.xs}>{c}</Text>)}
          {source.provider.kind === 'biblebrain' ? <Text style={txt.xs}>{t('reference.source.fromBibleBrain')}</Text> : null}
        </Card>
      ) : null}
      <Text style={[txt.xs, { paddingHorizontal: space.xs }]}>{sourceLine(it)}</Text>

      <Disclosure icon="clock" title={t('reference.source.timingsByBook')} summary={t('reference.source.booksTimed', { timed: timedBooks, count: facts.books.length })} {...booksOpen}>
        {facts.books.map((b, i) => (
          <Row key={b.book} label={b.name} last={i === facts.books.length - 1} sub={bookTimingLine(facts, b)} />
        ))}
      </Disclosure>

      {source.provider.kind === 'biblebrain' && canManage ? (
        <>
          <SectionLabel label={t('reference.source.generating')} />
          {need.reason ? <Banner icon="lock" tone="amber" title={t('reference.source.cannotGenerate')} body={need.reason} /> : null}
          {followed && need.requests.length && !viaLangQuest ? <Banner icon="link"
            title={it.subscription?.sourceOrgName ? t('reference.source.follows', { org: it.subscription.sourceOrgName }) : t('reference.source.followsAnother')}
            body={t('reference.source.followsBody')} /> : null}
          {viaLangQuest && need.requests.length ? <Text style={[txt.smMuted, { paddingHorizontal: space.xs }]}>{t('reference.source.viaLangQuest')}</Text> : null}
          {!need.reason && need.requests.length === 0 && detail ? <Text style={[txt.smMuted, { paddingHorizontal: space.xs }]}>{t('reference.source.allTimed')}</Text> : null}
          {!detail && !detailError ? <Text style={[txt.smMuted, { paddingHorizontal: space.xs }]}>{t('reference.source.checking')}</Text> : null}
          {mayAsk ? <Text style={[txt.smMuted, { paddingHorizontal: space.xs }]}>{t('reference.source.untimedBooks', { count: booksToTime })}</Text> : null}
          {jobs.map((j) => <JobCard key={j.id} job={j} outcome={outcomes[j.id]} ctx={ctx} onRetry={async () => {
            try { await publishTimingJob(lib, it, j.id); ctx.toast(t('reference.source.published')); } catch (e) { ctx.toast(t('reference.source.notPublished', { reason: referenceFailure('publish timings', e) })); } // i18n-ignore: 'publish timings' is a log label
          }} />)}
        </>
      ) : null}
    </Screen>
  );
}

function JobCard(props: { ctx: Ctx; job: TimingJob; outcome?: JobOutcome; onRetry: () => Promise<void> }) {
  const { job: j, outcome } = props;
  const failedOpen = props.ctx.details(`reference:job:${j.id}:failed`);
  const { what, state, badge, tone, percent } = jobView(j);
  const failed = outcome && 'failed' in outcome ? outcome.failed : [];
  return (
    <Card>
      <View style={styles.titleRow}>
        <Text style={[txt.h3, { flex: 1 }]}>{what}</Text>
        <Badge label={badge} tone={tone} />
      </View>
      <Text style={txt.sm}>{state}</Text>
      {percent !== null ? (
        <ProgressBar value={percent} />
      ) : null}
      {outcome && 'error' in outcome ? (
        <>
          <Text style={txt.error}>{t('reference.job.notPublishedYet', { reason: outcome.error })}</Text>
          <SmallBtn label={t('common.tryAgain')} icon="restart" help={t('reference.job.tryAgainHelp')} onPress={() => void props.onRetry()} />
        </>
      ) : null}
      {outcome && 'placed' in outcome ? (
        <Text style={txt.xs}>{publicationLine(outcome)}</Text>
      ) : null}
      {failed.length ? (
        <Disclosure icon="flag" title={t('reference.job.didNotPass')} summary={t('reference.job.notPublishedChapters', { count: failed.length })} {...failedOpen}
          {...(failedOpen.open ? {} : { help: t('reference.job.didNotPassHelp') })}>
          {failed.map((f, i) => <Row key={`${f.book}.${f.chapter}`} label={`${f.book} ${formatNumber(f.chapter)}`} sub={failReason(f.reason)} last={i === failed.length - 1} />)}
        </Disclosure>
      ) : null}
    </Card>
  );
}

// ─── Guides and notes ────────────────────────────────────────────────────────────────

export function ReferenceGuides(ctx: Ctx) {
  const level = levelOf(ctx);
  const state = ctx.language.state;
  const beside = useOpenDetail();
  const { rows, docs } = useRefItems(ctx);
  const canAct = canActAt(ctx, level);
  const rec = useRecommend(ctx);
  const [filtering, setFiltering] = useState(false);
  const [kind, setKind] = useState<KindFilter>('all');
  const [language, setLanguage] = useState<string | null>(null);
  const [book, setBook] = useState<string | null>(null);
  const [covers, setCovers] = useState(false);
  const [n, setN] = useState(STEP);
  const languageId = level.kind === 'language' ? level.languageId : null;
  const passages = usePassages(ctx, covers && !!languageId);
  const items = guideItems(rows);
  const reach = useMemo(() => {
    if (!covers || !passages || !state) return null;
    const all = new Map<string, RecommendationSource>(items.map((r) => [r.it.itemId, 'organization']));
    return coverageFor(state, passages, all, items, docs.get);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- items changes with rows
  }, [covers, passages, state, rows, docs.get]);
  // Material written in the app belongs to a language: shown at that language's level.
  const inApp = useMemo(() => (state && languageId ? writtenHelps(materialsFor(state)) : []), [state, languageId]);

  if (!state) return <Screen header={<Header title={t('reference.guides.title')} onBack={ctx.back} />}><EmptyState title={t('common.loading')} /></Screen>;
  const { languages, books } = filterOptions(items);
  const shown = filterGuides(items, { kind, language, book, covers }, reach);
  const active = activeFilterCount({ kind, language, book, covers });
  const withRec = guideRows(shown, ctx.org.state?.recommendations, state, level);

  return (
    <Screen header={<Header title={t('reference.guides.title')} sub={levelName(ctx, level)} onBack={ctx.back} />}
      footer={ctx.session.can('manage_reference') ? <PrimaryBtn label={t('reference.guides.newNote')} icon="plus" onPress={() => ctx.go('material_editor', { itemId: 'new', kind: 'note', ...levelParams(level) })} /> : undefined}>
      <Intro>{t('reference.guides.intro')}</Intro>
      {/* Write your own, beside following others' (design principle 12; Get ready promises it). */}
      {ctx.session.can('manage_reference') ? (
        <Group>
          <Row icon="sparkle" label={t('config.reference.writeGuide')} sub={t('config.reference.writeGuideSub')} last
            onPress={() => ctx.go('guide_editor', levelParams(level))} />
        </Group>
      ) : null}
      <ChipRow>
        <Chip label={active ? t('reference.guides.filterCount', { n: active }) : t('common.filter')} icon="filter" on={active > 0} help={t('reference.guides.filterHelp')} onPress={() => setFiltering(true)} />
        {active ? <Chip label={t('reference.guides.clear')} on={false} help={t('reference.guides.clearHelp')} onPress={() => { setKind('all'); setLanguage(null); setBook(null); setCovers(false); }} /> : null}
      </ChipRow>
      <SectionLabel label={t('reference.guides.inLibrary', { n: shown.length })} />
      {covers && !reach ? <Text style={[txt.smMuted, { paddingHorizontal: space.xs }]}>{t('reference.guides.workingOut')}</Text> : null}
      {withRec.length === 0 ? (
        <Card><Text style={txt.smMuted}>{items.length ? t('reference.guides.nothingMatches') : t('reference.guides.empty')}</Text></Card>
      ) : withRec.slice(0, n).map(({ r, st, label }) => (
        <Card key={r.it.itemId} current={beside?.screen === 'material_editor' && beside.params['itemId'] === r.it.itemId}
          onPress={() => (r.doc?.format === 'study@2' && r.it.source !== 'subscription'
            ? ctx.go('guide_editor', { itemId: r.it.itemId, ...levelParams(level) })
            : ctx.go('material_editor', { itemId: r.it.itemId, ...levelParams(level) }))} accessibilityLabel={t('reference.itemLabel', { name: r.it.name, state: label })}
          help={r.doc?.format === 'study@2' && r.it.source !== 'subscription' ? t('reference.guides.editHelp') : t('reference.guides.openHelp')}>
          <View style={styles.titleRow}>
            <Text style={[txt.h3, { flex: 1 }]}>{r.it.name}</Text>
            <Badge label={label} tone={recTone(st)} />
          </View>
          <Text style={txt.xs}>{guideLine(r, reach ? itemReaches(reach, r.it.itemId) : null)}</Text>
          {canAct ? <RecButtons ctx={ctx} level={level} itemId={r.it.itemId} name={r.it.name} rec={rec} /> : null}
        </Card>
      ))}
      <ShowMore remaining={withRec.length - n} step={STEP} onMore={() => setN(n + STEP)} />

      {inApp.length ? (
        <>
          <SectionLabel label={t('reference.writtenInApp', { n: inApp.length })} />
          <Group>
            {inApp.slice(0, STEP).map((m, i) => (
              <Row key={m.materialId} icon="note" label={m.title} last={i === Math.min(inApp.length, STEP) - 1}
                sub={m.scope.unitId ? t('reference.guides.onPassage', { passage: unitTitle(state, m.scope.unitId) }) : t('reference.guides.forTeam')} />
            ))}
          </Group>
          <Intro>{t('reference.guides.inAppNote')}</Intro>
        </>
      ) : null}

      <Sheet visible={filtering} title={t('common.filter')} onClose={() => setFiltering(false)} footer={<PrimaryBtn label={t('reference.guides.showItems', { count: shown.length })} onPress={() => setFiltering(false)} />}>
        <Text style={txt.xsStrong}>{t('reference.guides.whatKind')}</Text>
        <ChipRow>{KIND_FILTERS.map((k) => <Chip key={k} label={kindFilterLabel(k)} on={kind === k} help={k === 'all' ? t('reference.guides.kindAllHelp') : t('reference.guides.kindHelp')} onPress={() => setKind(k)} />)}</ChipRow>
        {languages.length ? (
          <>
            <Text style={txt.xsStrong}>{t('reference.guides.language')}</Text>
            <ChipRow>
              <Chip label={t('reference.guides.any')} on={!language} help={t('reference.guides.anyLanguageHelp')} onPress={() => setLanguage(null)} />
              {languages.map((l) => <Chip key={l} label={languageLabel(l)} on={language === l} help={t('reference.guides.languageHelp')} onPress={() => setLanguage(l)} />)}
            </ChipRow>
          </>
        ) : null}
        {books.length ? (
          <>
            <Text style={txt.xsStrong}>{t('reference.guides.book')}</Text>
            <ChipRow>
              <Chip label={t('reference.guides.any')} on={!book} help={t('reference.guides.anyBookHelp')} onPress={() => setBook(null)} />
              {books.slice(0, 40).map((b) => <Chip key={b} label={b} on={book === b} help={t('reference.guides.bookHelp')} onPress={() => setBook(b)} />)}
            </ChipRow>
          </>
        ) : null}
        {languageId ? (
          <Group>
            <Row label={t('reference.guides.covers')} sub={t('reference.guides.coversSub')} role="switch" checked={covers} onPress={() => setCovers(!covers)} last />
          </Group>
        ) : <Text style={txt.xs}>{t('reference.guides.coversFromLanguage')}</Text>}
      </Sheet>
    </Screen>
  );
}

// ─── Coverage ────────────────────────────────────────────────────────────────────────

export function ReferenceCoverage(ctx: Ctx) {
  const state = ctx.language.state;
  const level = levelOf(ctx);
  // Coverage is read against a language's template: the one in the params, else the open one.
  const languageId = level.kind === 'language' ? level.languageId : ctx.language.languageId || null;
  const beside = useOpenDetail();
  const { rows, docs } = useRefItems(ctx);
  const passages = usePassages(ctx, !!languageId);
  const [filter, setFilter] = useState<CoverFilter>('all');
  const [n, setN] = useState(STEP);
  const offered = useMemo(() => offeredAmong(ctx.org.state?.recommendations, state, rows), [ctx.org.state, state, rows]);
  const map = useMemo(() => (state && passages ? coverageFor(state, passages, offered, rows, docs.get) : null),
    [state, passages, offered, rows, docs.get]);
  const names = useMemo(() => coverageNames(rows), [rows]);

  if (!state) return <Screen header={<Header title={t('reference.coverage.title')} onBack={ctx.back} />}><EmptyState title={t('common.loading')} /></Screen>;
  if (!languageId || !passages) {
    return <Screen header={<Header title={t('reference.coverage.title')} onBack={ctx.back} />}><EmptyState icon="map" title={t('reference.coverage.noLanguage')} sub={t('reference.coverage.noLanguageSub')} /></Screen>;
  }
  const summary = map ? coverageSummary(map) : null;
  const shown = coverageShown(passages.passages, map, filter);
  return (
    <Screen header={<Header title={t('reference.coverage.title')} sub={languageName(ctx.org.state, languageId)} onBack={ctx.back} />}>
      <Intro>{t('reference.coverage.intro')}</Intro>
      {summary ? (
        <Card>
          <Text style={txt.h3}>{t('reference.passages', { count: summary.passages })}</Text>
          <Text style={txt.sm}>{t('reference.coverage.counts', { source: summary.withSource, guide: summary.withGuide, note: summary.withNote })}</Text>
          {summary.bare ? <Text style={[txt.sm, { color: TINT.amberText }]}>{t('reference.coverage.bare', { count: summary.bare })}</Text> : null}
          {offered.size === 0 ? <Text style={txt.xs}>{t('reference.coverage.nothingOffered')}</Text> : null}
        </Card>
      ) : <Card><Text style={txt.smMuted}>{t('reference.coverage.workingOut')}</Text></Card>}
      <ChipRow>
        <Chip label={t('reference.coverage.all')} on={filter === 'all'} help={t('reference.coverage.allHelp')} onPress={() => setFilter('all')} />
        <Chip label={t('reference.coverage.noGuide')} on={filter === 'bare'} count={summary?.bare} help={t('reference.coverage.noGuideHelp')} onPress={() => setFilter('bare')} />
        <Chip label={t('reference.coverage.withNotes')} on={filter === 'notes'} count={summary?.withNote} help={t('reference.coverage.withNotesHelp')} onPress={() => setFilter('notes')} />
      </ChipRow>
      {shown.length === 0 ? <Card><Text style={txt.smMuted}>{t('reference.coverage.noPassages')}</Text></Card> : (
        <Group>
          {shown.slice(0, n).map((p, i) => {
            const { what, bare } = coverageRow(map?.get(p.unitId) ?? [], names);
            return (
              <Row key={p.unitId} label={p.label} last={i === Math.min(n, shown.length) - 1}
                current={beside?.screen === 'passage_reference' && beside.params['unitId'] === p.unitId}
                sub={what.length ? what.join(' · ') : t('reference.coverage.nothingReaches')}
                badge={bare ? t('reference.coverage.noGuideBadge') : undefined} badgeTone={bare ? 'amber' : undefined}
                help={t('reference.coverage.passageHelp')} onPress={() => ctx.go('passage_reference', { unitId: p.unitId, languageId })} />
            );
          })}
        </Group>
      )}
      <ShowMore remaining={shown.length - n} step={STEP} onMore={() => setN(n + STEP)} />
    </Screen>
  );
}

// ─── One passage ─────────────────────────────────────────────────────────────────────

/**
 * What helps on one passage (demo ADR-042 `PassageHelps`, design principle
 * 13): the passage in a Bible the admin chooses is one tap away at the top,
 * with key words and notes marked in it; each help says what it says here
 * (a guide's first step, a note's first words, the key words) above Show
 * here / Hide here; Add a help writes a note for translators first, or
 * places something from the library.
 */
export function PassageReference(ctx: Ctx) {
  const state = ctx.language.state;
  const unitId = ctx.params['unitId'] ?? '';
  const languageId = ctx.params['languageId'] ?? ctx.languageId ?? '';
  const { rows, docs } = useRefItems(ctx);
  const canManage = ctx.session.can('manage_reference');
  const canNote = ctx.session.can('translate') || ctx.session.can('review') || ctx.session.can('fill_reference');
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const text = ctx.details(`reference:passage:${unitId}:text`);
  const passage = useMemo(() => {
    if (!state || !state.units[unitId] || languageId !== ctx.language.languageId) return null;
    return { unitId, label: unitTitle(state, unitId), range: null as ReturnType<typeof libraryUnitRange> };
  }, [state, unitId, languageId, ctx.language.languageId]);
  const bible = useBible(ctx, passage ? unitId : null, languageId, { hidden: !text.open });
  const sel = state?.template?.value;
  const tdocs = useLibraryDocs(ctx.language.orgId, [sel?.docHash]);
  const offered = useMemo(() => offeredAmong(ctx.org.state?.recommendations, state, rows), [ctx.org.state, state, rows]);
  const result = useMemo(() => {
    if (!state || !passage) return null;
    const template = sel?.docHash ? (tdocs.get(sel.docHash) as TemplateDoc | null) : null;
    return passageHelps(state, passage, templateVersification(template, (h) => tdocs.get(h)), offered, rows, docs.get);
  }, [state, passage, sel?.docHash, tdocs, offered, rows, docs.get]);
  const inApp = useMemo(() => (state && passage ? writtenHelps(materialsFor(state, { unitId })) : []), [state, passage, unitId]);
  // Notes translators see on this passage: on a verse, a run of verses, or the whole of it.
  const notes = useMemo(() => (state && passage ? visibleNotes(derivePassage(state, unitId, indexesFor(state)).notes) : []),
    [state, passage, unitId]);
  // The language's key words in these verses, as the recorder finds them.
  const terms = useMemo(() => (state && passage ? keyTermsForUnit(state, unitId) : []), [state, passage, unitId]);
  const verseText = bible.rows?.map((r) => r.text).join(' ') ?? '';
  const termsHere = useMemo(() => (verseText ? termsInText(verseText, terms) : []), [verseText, terms]);
  const reads = teamLanguage(ctx.org.state, state, languageId);
  // With nothing recommended or placed here that has a study, translators get one from the rest of the
  // organization's library (reference/offered.ts): it shows here too, and hiding it here takes it away.
  const ownGuide = useMemo(
    () => (state && result ? ownGuideItem({ org: ctx.org.state, state, helps: result, unitId, rows, get: docs.get, reads }) : null),
    [state, result, ctx.org.state, docs.get, unitId, reads, rows]);
  // Each guide's study for this passage (a collection's entry), to show its first step.
  const guideFor = useMemo(
    () => (result ? guideStudies({ helps: result, ownGuide, unitId, rows, get: docs.get, reads }) : new Map<string, string>()),
    [result, ownGuide, rows, docs.get, unitId, reads]);
  const studies = useLibraryDocs(ctx.language.orgId, [...guideFor.values()]);

  if (!state || !passage || !result) {
    return <Screen header={<Header title={t('passage.else.whatHelps')} onBack={ctx.back} />}><EmptyState icon="book" title={state ? t('reference.passage.gone') : t('common.loading')} /></Screen>;
  }
  const byId = new Map(rows.map((r) => [r.it.itemId, r]));

  async function link(itemId: string, linked: boolean, message: string, undo: boolean | null) {
    if (busy) return;
    setBusy(true);
    const spec = (value: boolean) => passageLinkSpec(Crypto.randomUUID(), unitId, itemId, value);
    try {
      await ctx.act(spec(linked), message, undo === null ? undefined : () => spec(undo));
    } catch {
      // ctx.act has already said "Not saved" and why.
    } finally {
      setBusy(false);
    }
  }

  const cards = helpCards({
    state, unitId, helps: result, ownGuide, canManage, byId, studies, guideFor, verseText, get: docs.get, detail: heldDetail, notes, inApp, termsHere,
    onLink: (itemId, linked, message, undo) => void link(itemId, linked, message, undo)
  });

  const addable = addableHelps(rows, result.here, q);

  return (
    <Screen header={<Header title={t('passage.else.whatHelps')} sub={languageName(ctx.org.state, languageId)} onBack={ctx.back} />}
      footer={<PrimaryBtn label={t('common.done')} icon="check" help={t('help.details.done')} onPress={ctx.back} />}>
      <PassageTextBar ctx={ctx} bible={bible} title={passage.label} open={text.open} onToggle={text.onToggle} terms={termsHere} notes={notes} />
      {cards.length === 0 ? <Card><Text style={txt.smMuted}>{t('reference.passageText.none')}</Text></Card> : null}
      {cards.map((c) => (
        <HelpCard key={c.key} icon={c.icon} name={c.name} sub={c.sub} preview={c.preview} shown={c.shown} busy={busy} {...(c.onSet ? { onSet: c.onSet } : {})}>
          {c.terms ? (
            <View style={styles.words}>
              {c.terms.map((term) => (
                <WordChip key={term.termId} label={term.term} help={t('reference.keyWords.openHelp')}
                  onPress={() => ctx.go('key_term_detail', { termId: term.termId, unitId, languageId })} />
              ))}
            </View>
          ) : null}
        </HelpCard>
      ))}
      {canManage ? <DashedBtn label={t('reference.passageText.addHelp')} icon="plus" hint={t('reference.passageText.addHelpHint')} onPress={() => setAdding(true)} /> : null}
      <Sheet visible={adding} title={t('reference.passageText.addHelp')} sub={passage.label} onClose={() => setAdding(false)}>
        {/* Your own first, set apart from the library (design principle 12). */}
        {canNote ? (
          <Group>
            <Row icon="mic" label={t('reference.passageText.writeNote')} sub={t('reference.passageText.writeNoteSub')} last
              onPress={() => { setAdding(false); ctx.go('material_editor', { unitId, languageId, note: 'new' }); }} />
          </Group>
        ) : null}
        <SectionLabel label={t('reference.passageText.fromLibrary')} />
        <SearchField value={q} onChangeText={setQ} placeholder={t('reference.passage.searchPlaceholder')} />
        {addable.length === 0 ? <Text style={txt.smMuted}>{q ? t('common.nothingMatches', { query: q }) : t('reference.passage.allHere')}</Text> : (
          <Group>
            {addable.slice(0, 50).map((r, i) => (
              <Row key={r.it.itemId} icon={refIcon(r.kind!)} label={r.it.name}
                sub={addableLine(r)} last={i === Math.min(addable.length, 50) - 1} disabled={busy}
                help={t('reference.passage.placeHelp')}
                onPress={() => { setAdding(false); void link(r.it.itemId, true, t('reference.passage.placed', { name: r.it.name }), false); }} />
            ))}
          </Group>
        )}
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.xs },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  words: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }
});

export const contracts = contractsFor('reference_bibles', 'reference_source', 'reference_guides', 'reference_coverage', 'passage_reference');
