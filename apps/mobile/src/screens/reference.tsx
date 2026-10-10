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
//   Reference     one passage: what translators get and why; Add and Hide here (manage_reference)
// One main action per screen, the rest one labelled tap away (decision 56).
// Pure reading lives in src/reference/ (model.ts, coverage.ts, timings.ts, offered.ts).
import {
  languageInfo, languageName, languagePassages, libraryUnitRange, linkedTo, materialsFor, passageLink, recommendedFor, testamentOf, unitTitle, versesInChapter,
  type LibraryDoc, type LanguageState, type RecommendationSource, type SourceDoc, type TemplateDoc, type VersificationDoc
} from '@langquest-next/core';
import * as Crypto from 'expo-crypto';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '../text';
import type { Ctx } from '../ctx';
import { t } from '../i18n';
import { formatNumber } from '../i18n/format';
import { indexesFor } from '../indexes';
import {
  Badge, Banner, Card, Chip, ChipRow, Disclosure, EmptyState, GhostBtn, Group, Header, PrimaryBtn, ProgressBar, Row, Screen, SearchField,
  SectionLabel, Sheet, ShowMore, SmallBtn, txt, useOpenDetail
} from '../kit';
import { sourceLine, type SharedItem } from '../library/model';
import { useLibrary, useLibraryDocs, useSharedItems } from '../library/useLibrary';
import { noteExpected } from '../report';
import { BibleError, bibleDetail, biblesIn, bibleSearchAvailable, heldDetail, searchLanguages, type BibleDetail, type BibleLanguage, type BibleSummary } from '../bibleBrain';
import { coverage, coverageSummary, itemReaches, type Reach, type ReachWhy } from '../reference/coverage';
import {
  biblebrainItemId, booksOf, offlineLine, orgLevelCan, recActions, recLabel, recOn, recState, recTone, refKindLabel,
  sourceFacts, sourceFromBible, sourceSummary, testamentLines, timingsNeeded, type Level, type RefKind
} from '../reference/model';
import {
  levelOf, publishTimingJob, referenceFailure, requestTimings, useRecommend, useRefItems, useTimingJobs, useTimingPublisher,
  versificationHash, type RefItem, type TimingJob
} from '../reference/useReference';
import { docLanguage, languagesLine } from '../reference/languages';
import { languageLabel } from '../simple/adminModel';
import { contractsFor } from '../screenContracts';
import { bibleErrorText } from '../sources/bibleBrain';
import { space, TINT } from '../theme';

const STEP = 25;

/** A list of short things ("GEN, EXO"), with the language's separator. */
const list = (items: string[]) => items.join(t('reference.listSeparator'));

/** Where a source comes from, for its line: Bible Brain or the library. */
const providerName = (kind: 'library' | 'biblebrain') => (kind === 'biblebrain' ? t('reference.provider.bibleBrain') : t('reference.provider.library'));

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

/** Recommend, stop, hide or follow the organization, for one item at this level. */
function RecButtons(props: { ctx: Ctx; level: Level; itemId: string; name: string; rec: ReturnType<typeof useRecommend> }) {
  const r = recState(props.ctx.org.state?.recommendations, props.ctx.language.state, props.level, props.itemId);
  return (
    <View style={styles.actions}>
      {recActions(r, props.level).map((a) => (
        <SmallBtn key={a.id} label={a.label} tone={a.id === 'recommend' ? 'primary' : 'plain'} disabled={props.rec.busy}
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
  const bibleIds = rows.flatMap((r) => (r.doc?.format === 'source@1' && r.doc.provider.kind === 'biblebrain' ? [r.doc.provider.bibleId] : [])).sort().join(',');
  useEffect(() => {
    if (!bibleIds || !bibleSearchAvailable) return;
    let active = true;
    void Promise.all(bibleIds.split(',').filter((id) => !heldDetail(id)).map((id) => bibleDetail(id).catch((e: unknown) => noteExpected('bible detail', e))))
      .then(() => { if (active) setDetails((x) => x + 1); });
    return () => { active = false; };
  }, [bibleIds]);

  if (!ctx.language.state || !ctx.org.state) return <Screen header={<Header title={t('reference.bibles.title')} onBack={ctx.back} />}><EmptyState title={t('common.loading')} /></Screen>;
  const sources = rows.filter((r) => r.kind === 'source' && !r.it.archived);
  const loading = rows.some((r) => r.doc === null);
  const withRec = sources.map((r) => ({ r, s: recState(ctx.org.state?.recommendations, ctx.language.state, level, r.it.itemId) }));
  const on = withRec.filter((x) => x.s.effective);
  const hidden = withRec.filter((x) => !x.s.effective && x.s.language === 'hidden');
  const off = withRec.filter((x) => !x.s.effective && x.s.language !== 'hidden');

  const card = ({ r }: (typeof withRec)[number]) => {
    const doc = r.doc as SourceDoc;
    const facts = sourceFacts(doc, docs.get, doc.provider.kind === 'biblebrain' ? heldDetail(doc.provider.bibleId) : null);
    const st = recState(ctx.org.state?.recommendations, ctx.language.state, level, r.it.itemId);
    const label = recLabel(st, level);
    return (
      <Card key={r.it.itemId} current={beside?.screen === 'reference_source' && beside.params['itemId'] === r.it.itemId}
        onPress={() => ctx.go('reference_source', { itemId: r.it.itemId, ...levelParams(level) })} accessibilityLabel={t('reference.itemLabel', { name: r.it.name, state: label })}>
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
      footer={canAct || ctx.session.can('manage_reference') ? <PrimaryBtn label={t('reference.bibles.add')} icon="plus" onPress={() => setAdding(true)} /> : undefined}>
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
  const ready = shared.rows.filter((s) => readyDocs.get(s.latest_hash)?.format === 'source@1')
    .filter((s) => !lib.items('material').some((it) => it.subscription?.sourceItemId === s.item_id && it.subscription.sourceOrgId === s.org_id && it.subscription.active));
  const fallback = languageInfo(ctx.org.state, ctx.language.languageId)?.sourceCode ?? 'eng';
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
        const exact = ls.find((l) => l.code === needle.toLowerCase()) ?? ls[0];
        setLang((cur) => (cur && ls.some((l) => l.code === cur) ? cur : exact?.code ?? null));
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
        await lib.publish({ kind: 'material', itemId, name: d.name, description: `Bible Brain · ${d.languageName}`, doc: sourceFromBible(d, v11n) });
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
          <GhostBtn label={t('reference.addBible.backToList')} onPress={() => setPicked(null)} />
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
            <Chip label={t('reference.addBible.fromLangQuest')} on={tab === 'ready'} onPress={() => setTab('ready')} />
            <Chip label={providerName('biblebrain')} icon="search" on={tab === 'biblebrain'} onPress={() => setTab('biblebrain')} />
          </ChipRow>
          {tab === 'ready' ? (
            !shared.loaded ? <Text style={txt.smMuted}>{t('common.loading')}</Text>
              : ready.length === 0 ? <Text style={txt.smMuted}>{shared.error ? t('reference.addBible.listNotLoaded') : t('reference.addBible.nothingMore')}</Text>
              : (
                <Group>
                  {ready.map((s, i) => {
                    const doc = readyDocs.get(s.latest_hash) as SourceDoc;
                    return <Row key={`${s.org_id}/${s.item_id}`} icon="book" label={s.name} disabled={busy} last={i === ready.length - 1}
                      sub={[s.org_name, languageLabel(doc.language), sourceSummary(sourceFacts(doc, readyDocs.get))].join(' · ')} onPress={() => void addReady(s)} />;
                  })}
                </Group>
              )
          ) : !bibleSearchAvailable ? (
            <Text style={txt.smMuted}>{t('reference.addBible.noServer')}</Text>
          ) : (
            <>
              <SearchField value={q} onChangeText={(v) => { setQ(v); setLang(null); }} placeholder={t('reference.addBible.searchPlaceholder')} />
              {error ? <Text style={txt.error}>{error}</Text> : null}
              {languages.length ? (
                <ChipRow>
                  {languages.slice(0, 8).map((l) => (
                    <Chip key={l.code} label={`${l.name} · ${l.code}`} count={l.bibles} on={l.code === lang} onPress={() => setLang(l.code)} />
                  ))}
                </ChipRow>
              ) : null}
              {lang && bibles === null && !error ? <Text style={txt.smMuted}>{t('common.loading')}</Text> : null}
              {bibles && bibles.length === 0 ? <Text style={txt.smMuted}>{t('reference.addBible.noneInLanguage')}</Text> : null}
              {bibles && bibles.length ? (
                <Group>
                  {bibles.map((b, i) => (
                    <Row key={b.bibleId} icon="book" label={b.name} disabled={busy} last={i === bibles.length - 1}
                      sub={`${b.abbreviation} · ${bibleLine(b)}`} onPress={() => void pick(b)} />
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

/** "Text OT NT · audio NT · FCBH timings" for a search result. */
function bibleLine(b: BibleSummary): string {
  const text = b.text.OT && b.text.NT ? t('reference.media.textOTNT') : b.text.OT ? t('reference.media.textOT') : b.text.NT ? t('reference.media.textNT') : t('reference.media.noText');
  const hasAudio = !!(b.audio.OT || b.audio.NT);
  const audio = b.audio.OT && b.audio.NT ? t('reference.media.audioOTNT') : b.audio.OT ? t('reference.media.audioOT') : b.audio.NT ? t('reference.media.audioNT') : t('reference.media.noAudio');
  const timed = (b.timestamps.OT && b.audio.OT) || (b.timestamps.NT && b.audio.NT);
  return [text, audio, hasAudio ? (timed ? t('reference.media.fcbhTimings') : t('reference.media.noTimings')) : ''].filter(Boolean).join(' · ');
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
  const booksToTime = need.requests.reduce((n, q) => n + q.books.length, 0);
  const open = jobs.filter((j) => !j.finished_at);
  const followed = it.source === 'subscription';
  // Following LangQuest's own source: the timings go to LangQuest's copy, for everyone who follows it.
  const viaLangQuest = followed && it.subscription?.sourceOrgId === 'langquest' ? { org: 'langquest', item: it.subscription.sourceItemId } : null;
  const mayAsk = canOrg && need.allowed && need.requests.length > 0 && (!followed || !!viaLangQuest) && open.length === 0;

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

  const timedBooks = facts.books.filter((b) => b.timed > 0).length;
  return (
    <Screen header={<Header title={it.name} sub={[source.abbreviation, languageLabel(source.language), providerName(source.provider.kind)].join(' · ')} onBack={ctx.back} />}
      footer={mayAsk ? <PrimaryBtn label={t('reference.source.generate')} icon="clock" onPress={() => void ask()} busy={asking} /> : undefined}>
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
          <Row key={b.book} label={b.name} last={i === facts.books.length - 1}
            sub={facts.timings[testamentOf(b.book)] === 'fcbh' ? t('reference.source.bookFcbh')
              : b.timed === 0 ? (!facts.audio[testamentOf(b.book)] ? t('reference.source.bookNoAudio') : facts.timings[testamentOf(b.book)] === 'unknown' ? t('reference.source.bookUnknown') : t('reference.source.bookNoTimings'))
              : [
                b.chapters ? t('reference.source.chaptersTimedOf', { timed: b.timed, count: b.chapters }) : t('reference.source.chaptersTimed', { count: b.timed }),
                list(b.sources.map((s) => (s === 'generated' ? t('reference.source.timingGenerated') : s === 'fcbh' ? t('reference.source.timingFcbh') : t('reference.source.timingCorrected'))))
              ].join(' · ')} />
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

function JobCard(props: { ctx: Ctx; job: TimingJob; outcome?: Awaited<ReturnType<typeof publishTimingJob>> | { error: string }; onRetry: () => Promise<void> }) {
  const { job: j, outcome } = props;
  const failedOpen = props.ctx.details(`reference:job:${j.id}:failed`);
  const what = t('reference.job.what', { count: j.books.length, fileset: j.audio_fileset });
  // The timing service writes its error and progress note itself, in English.
  const working = j.total ? t('reference.job.working', { done: j.done, count: j.total }) : t('reference.job.workingUnknown', { done: j.done });
  const state = j.error ? t('reference.job.stopped', { reason: j.error })
    : j.finished_at ? t('reference.job.finished', { passed: j.results - j.failed, count: j.results })
    : j.claimed_at ? (j.note ? [working, j.note].join(' · ') : working)
    : t('reference.job.waitingForService');
  const failed = outcome && 'failed' in outcome ? outcome.failed : [];
  return (
    <Card>
      <View style={styles.titleRow}>
        <Text style={[txt.h3, { flex: 1 }]}>{what}</Text>
        <Badge label={j.error ? t('reference.job.badgeStopped') : j.finished_at ? t('reference.job.badgeDone') : j.claimed_at ? t('reference.job.badgeWorking') : t('reference.job.badgeWaiting')}
          tone={j.error ? 'red' : j.finished_at ? 'green' : 'amber'} />
      </View>
      <Text style={txt.sm}>{state}</Text>
      {!j.finished_at && j.total > 0 ? (
        <ProgressBar value={Math.round((100 * j.done) / j.total)} />
      ) : null}
      {outcome && 'error' in outcome ? (
        <>
          <Text style={txt.error}>{t('reference.job.notPublishedYet', { reason: outcome.error })}</Text>
          <SmallBtn label={t('common.tryAgain')} icon="restart" onPress={() => void props.onRetry()} />
        </>
      ) : null}
      {outcome && 'placed' in outcome ? (
        <Text style={txt.xs}>{[
          outcome.placed.length ? t('reference.job.publishedChapters', { count: outcome.placed.length }) : t('reference.job.alreadyPublished'),
          outcome.kept.length ? t('reference.job.keptTimings', { count: outcome.kept.length }) : null,
          outcome.skipped.length ? t('reference.job.fcbhLive', { count: outcome.skipped.length }) : null
        ].filter(Boolean).join(' ')}</Text>
      ) : null}
      {failed.length ? (
        <Disclosure icon="flag" title={t('reference.job.didNotPass')} summary={t('reference.job.notPublishedChapters', { count: failed.length })} {...failedOpen}>
          {failed.map((f, i) => <Row key={`${f.book}.${f.chapter}`} label={`${f.book} ${formatNumber(f.chapter)}`} sub={failReason(f.reason)} last={i === failed.length - 1} />)}
        </Disclosure>
      ) : null}
    </Card>
  );
}

/**
 * Why a chapter did not pass, in the language showing. Core's
 * `timingPublication` words these in English; the aligner's own reason
 * after "Verse 3:" is its own and stays as it wrote it.
 */
function failReason(reason: string): string {
  switch (reason) {
    case 'Not a timing document': return t('reference.job.reason.notTiming');
    case 'This Bible does not have that book': return t('reference.job.reason.noSuchBook');
    case 'The result names another chapter': return t('reference.job.reason.otherChapter');
    case "This Bible's book is not loaded yet. Try again when connected.": return t('reference.job.reason.bookNotLoaded');
    case 'Did not pass the check': return t('reference.job.reason.failedCheck');
  }
  let m = /^Numbered in a versification this organization does not have \((.*)\)$/.exec(reason);
  if (m) return t('reference.job.reason.unknownVersification', { code: m[1] });
  m = /^Not a valid timing: (.*)$/.exec(reason);
  if (m) return t('reference.job.reason.invalid', { detail: m[1] });
  m = /^Did not pass the check \(off by up to (\d+) ms\)$/.exec(reason);
  if (m) return t('reference.job.reason.offBy', { ms: formatNumber(Number(m[1])) });
  m = /^Verse (.+?): (.*?)(?: \(and (\d+) more\))?$/.exec(reason);
  if (m) {
    const flag = m[2] === 'flagged' ? t('reference.job.reason.flagged') : m[2]!;
    return m[3] ? t('reference.job.reason.verseMore', { verse: m[1], reason: flag, count: Number(m[3]) }) : t('reference.job.reason.verse', { verse: m[1], reason: flag });
  }
  return reason;
}

// ─── Guides and notes ────────────────────────────────────────────────────────────────

type KindFilter = 'all' | 'guide' | 'note' | 'other';
const KIND_FILTERS: KindFilter[] = ['all', 'guide', 'note', 'other'];
function kindFilterLabel(k: KindFilter): string {
  switch (k) {
    case 'all': return t('reference.guides.kindAll');
    case 'guide': return t('reference.guides.kindGuides');
    case 'note': return t('reference.guides.kindNotes');
    case 'other': return t('reference.guides.kindOther');
  }
}

/** The open language's passages with their verses, in its template's numbering; null when `enabled` is false or no language is open. */
function usePassages(ctx: Ctx, enabled: boolean) {
  const state = ctx.language.state;
  const open = enabled && !!ctx.language.languageId;
  const sel = open ? state?.template?.value : undefined;
  const tdocs = useLibraryDocs(ctx.language.orgId, [sel?.docHash]);
  return useMemo(() => {
    if (!state || !open) return null;
    const template = sel?.docHash ? (tdocs.get(sel.docHash) as TemplateDoc | null) : null;
    const v11n = template?.bible ? (tdocs.get(template.bible.versification) as VersificationDoc | null) : null;
    const versesIn = v11n ? (b: string, c: number) => versesInChapter(v11n, b, c) : undefined;
    const passages = languagePassages(state, indexesFor(state)).map((unitId) => ({ unitId, label: unitTitle(state, unitId), range: libraryUnitRange(unitId, versesIn) }));
    return { passages, versification: v11n };
  }, [state, open, sel?.docHash, tdocs]);
}

/** Coverage of a language's passages by these items, with the language's links and hides. */
function coverageFor(state: LanguageState, passages: NonNullable<ReturnType<typeof usePassages>>, offered: Map<string, RecommendationSource>, rows: RefItem[], get: (h: string | null | undefined) => LibraryDoc | null, honourHides = true) {
  const parents = (unitId: string) => {
    const out: string[] = [];
    let at = state.units[unitId]?.parentUnitId ?? null;
    while (at && out.length < 20) { out.push(at); at = state.units[at]?.parentUnitId ?? null; }
    return out;
  };
  return coverage({
    passages: passages.passages, versification: passages.versification, offered,
    docs: new Map(rows.map((r) => [r.it.itemId, r.doc])), get,
    link: (u, i) => (honourHides ? passageLink(state, u, i) : passageLink(state, u, i) === true ? true : undefined),
    linkedHere: (u) => linkedTo(state, u),
    ancestors: parents
  });
}

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
  const items = rows.filter((r) => r.kind === 'guide' || r.kind === 'note' || r.kind === 'other').filter((r) => !r.it.archived);
  const reach = useMemo(() => {
    if (!covers || !passages || !state) return null;
    const all = new Map<string, RecommendationSource>(items.map((r) => [r.it.itemId, 'organization']));
    return coverageFor(state, passages, all, items, docs.get);
    // items changes with rows
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [covers, passages, state, rows, docs.get]);
  // Material written in the app belongs to a language: shown at that language's level.
  const inApp = useMemo(() => (state && languageId ? materialsFor(state).filter((m) => m.kind !== 'questions' && m.kind !== 'key_terms') : []), [state, languageId]);

  if (!state) return <Screen header={<Header title={t('reference.guides.title')} onBack={ctx.back} />}><EmptyState title={t('common.loading')} /></Screen>;
  const languages = [...new Set(items.map((r) => docLanguage(r.doc)).filter((l): l is string => !!l))].sort();
  const books = [...new Set(items.flatMap((r) => booksOf(r.doc)))];
  const shown = items.filter((r) => (kind === 'all' || r.kind === kind)
    && (!language || docLanguage(r.doc) === language)
    && (!book || booksOf(r.doc).includes(book))
    && (!reach || itemReaches(reach, r.it.itemId) > 0));
  const active = [kind !== 'all', !!language, !!book, covers].filter(Boolean).length;
  const withRec = shown.map((r) => {
    const st = recState(ctx.org.state?.recommendations, state, level, r.it.itemId);
    return { r, st, label: recLabel(st, level) };
  }).sort((a, b) => Number(!recOn(a.st)) - Number(!recOn(b.st)) || a.r.it.name.localeCompare(b.r.it.name));

  return (
    <Screen header={<Header title={t('reference.guides.title')} sub={levelName(ctx, level)} onBack={ctx.back} />}
      footer={ctx.session.can('manage_reference') ? <PrimaryBtn label={t('reference.guides.newNote')} icon="plus" onPress={() => ctx.go('material_editor', { itemId: 'new', kind: 'note', ...levelParams(level) })} /> : undefined}>
      <Intro>{t('reference.guides.intro')}</Intro>
      <ChipRow>
        <Chip label={active ? t('reference.guides.filterCount', { n: active }) : t('common.filter')} icon="filter" on={active > 0} onPress={() => setFiltering(true)} />
        {active ? <Chip label={t('reference.guides.clear')} on={false} onPress={() => { setKind('all'); setLanguage(null); setBook(null); setCovers(false); }} /> : null}
      </ChipRow>
      <SectionLabel label={t('reference.guides.inLibrary', { n: shown.length })} />
      {covers && !reach ? <Text style={[txt.smMuted, { paddingHorizontal: space.xs }]}>{t('reference.guides.workingOut')}</Text> : null}
      {withRec.length === 0 ? (
        <Card><Text style={txt.smMuted}>{items.length ? t('reference.guides.nothingMatches') : t('reference.guides.empty')}</Text></Card>
      ) : withRec.slice(0, n).map(({ r, st, label }) => (
        <Card key={r.it.itemId} current={beside?.screen === 'material_editor' && beside.params['itemId'] === r.it.itemId}
          onPress={() => (r.doc?.format === 'study@2' && r.it.source !== 'subscription'
            ? ctx.go('guide_editor', { itemId: r.it.itemId, ...levelParams(level) })
            : ctx.go('material_editor', { itemId: r.it.itemId, ...levelParams(level) }))} accessibilityLabel={t('reference.itemLabel', { name: r.it.name, state: label })}>
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
        <ChipRow>{KIND_FILTERS.map((k) => <Chip key={k} label={kindFilterLabel(k)} on={kind === k} onPress={() => setKind(k)} />)}</ChipRow>
        {languages.length ? (
          <>
            <Text style={txt.xsStrong}>{t('reference.guides.language')}</Text>
            <ChipRow>
              <Chip label={t('reference.guides.any')} on={!language} onPress={() => setLanguage(null)} />
              {languages.map((l) => <Chip key={l} label={languageLabel(l)} on={language === l} onPress={() => setLanguage(l)} />)}
            </ChipRow>
          </>
        ) : null}
        {books.length ? (
          <>
            <Text style={txt.xsStrong}>{t('reference.guides.book')}</Text>
            <ChipRow>
              <Chip label={t('reference.guides.any')} on={!book} onPress={() => setBook(null)} />
              {books.slice(0, 40).map((b) => <Chip key={b} label={b} on={book === b} onPress={() => setBook(b)} />)}
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

function guideLine(r: RefItem, reaches: number | null): string {
  const doc = r.doc;
  // Every item says its language, or that it gives none, so whoever chooses knows whether the team can read it (decision 84).
  const parts: string[] = [refKindLabel(r.kind ?? 'other'), languagesLine([docLanguage(doc)])];
  if (doc?.format === 'collection@1') parts.push(t('reference.passages', { count: doc.entries.length }));
  else {
    const books = booksOf(doc);
    if (books.length) parts.push(books.length > 3 ? t('reference.guides.booksMore', { books: list(books.slice(0, 3)), more: formatNumber(books.length - 3) }) : list(books));
    if (doc && 'links' in doc && doc.links?.some((l) => 'node' in l)) parts.push(t('reference.guides.templateParts'));
  }
  if (reaches !== null) parts.push(t('reference.guides.reaches', { count: reaches }));
  parts.push(sourceLine(r.it));
  return parts.join(' · ');
}

// ─── Coverage ────────────────────────────────────────────────────────────────────────

type CoverFilter = 'all' | 'bare' | 'notes';

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
  const offered = useMemo(() => {
    const have = new Set(rows.map((r) => r.it.itemId));
    return new Map([...recommendedFor(ctx.org.state?.recommendations, state)].filter(([id]) => have.has(id)));
  }, [ctx.org.state, state, rows]);
  const map = useMemo(() => (state && passages ? coverageFor(state, passages, offered, rows, docs.get) : null),
    [state, passages, offered, rows, docs.get]);
  const names = useMemo(() => new Map(rows.map((r) => [r.it.itemId, r.doc?.format === 'source@1' ? r.doc.abbreviation : r.it.name])), [rows]);

  if (!state) return <Screen header={<Header title={t('reference.coverage.title')} onBack={ctx.back} />}><EmptyState title={t('common.loading')} /></Screen>;
  if (!languageId || !passages) {
    return <Screen header={<Header title={t('reference.coverage.title')} onBack={ctx.back} />}><EmptyState icon="map" title={t('reference.coverage.noLanguage')} sub={t('reference.coverage.noLanguageSub')} /></Screen>;
  }
  const summary = map ? coverageSummary(map) : null;
  const shown = passages.passages.filter((p) => {
    const reach = map?.get(p.unitId) ?? [];
    if (filter === 'bare') return !reach.some((r) => r.kind === 'guide' || r.kind === 'note');
    if (filter === 'notes') return reach.some((r) => r.kind === 'note');
    return true;
  });
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
        <Chip label={t('reference.coverage.all')} on={filter === 'all'} onPress={() => setFilter('all')} />
        <Chip label={t('reference.coverage.noGuide')} on={filter === 'bare'} count={summary?.bare} onPress={() => setFilter('bare')} />
        <Chip label={t('reference.coverage.withNotes')} on={filter === 'notes'} count={summary?.withNote} onPress={() => setFilter('notes')} />
      </ChipRow>
      {shown.length === 0 ? <Card><Text style={txt.smMuted}>{t('reference.coverage.noPassages')}</Text></Card> : (
        <Group>
          {shown.slice(0, n).map((p, i) => {
            const reach = map?.get(p.unitId) ?? [];
            const bare = !reach.some((r) => r.kind === 'guide' || r.kind === 'note');
            const order: Record<RefKind, number> = { source: 0, guide: 1, note: 2, other: 3, questions: 4 };
            const what = [...reach].sort((a, b) => order[a.kind] - order[b.kind]).map((r) => names.get(r.itemId) ?? r.itemId);
            return (
              <Row key={p.unitId} label={p.label} last={i === Math.min(n, shown.length) - 1}
                current={beside?.screen === 'passage_reference' && beside.params['unitId'] === p.unitId}
                sub={what.length ? what.join(' · ') : t('reference.coverage.nothingReaches')}
                badge={bare ? t('reference.coverage.noGuideBadge') : undefined} badgeTone={bare ? 'amber' : undefined}
                onPress={() => ctx.go('passage_reference', { unitId: p.unitId, languageId })} />
            );
          })}
        </Group>
      )}
      <ShowMore remaining={shown.length - n} step={STEP} onMore={() => setN(n + STEP)} />
    </Screen>
  );
}

// ─── One passage ─────────────────────────────────────────────────────────────────────

function whyLabel(why: ReachWhy): string {
  switch (why) {
    case 'organization': return t('reference.rec.byOrganization');
    case 'language': return t('reference.rec.forLanguage');
    case 'linked': return t('reference.passage.placedByHand');
  }
}
const GROUPS: RefKind[] = ['source', 'guide', 'note', 'other'];
function groupLabel(kind: RefKind): string {
  switch (kind) {
    case 'source': return t('reference.bibles.title');
    case 'guide': return t('reference.passage.studyGuides');
    case 'note': return t('reference.passage.notes');
    case 'other': case 'questions': return t('reference.passage.other');
  }
}

export function PassageReference(ctx: Ctx) {
  const state = ctx.language.state;
  const unitId = ctx.params['unitId'] ?? '';
  const languageId = ctx.params['languageId'] ?? ctx.languageId ?? '';
  const { rows, docs } = useRefItems(ctx);
  const canManage = ctx.session.can('manage_reference');
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const passage = useMemo(() => {
    if (!state || !state.units[unitId] || languageId !== ctx.language.languageId) return null;
    return { unitId, label: unitTitle(state, unitId), range: null as ReturnType<typeof libraryUnitRange> };
  }, [state, unitId, languageId, ctx.language.languageId]);
  const sel = state?.template?.value;
  const tdocs = useLibraryDocs(ctx.language.orgId, [sel?.docHash]);
  const offered = useMemo(() => {
    const have = new Set(rows.map((r) => r.it.itemId));
    return new Map([...recommendedFor(ctx.org.state?.recommendations, state)].filter(([id]) => have.has(id)));
  }, [ctx.org.state, state, rows]);
  const result = useMemo(() => {
    if (!state || !passage) return null;
    const template = sel?.docHash ? (tdocs.get(sel.docHash) as TemplateDoc | null) : null;
    const v11n = template?.bible ? (tdocs.get(template.bible.versification) as VersificationDoc | null) : null;
    const range = libraryUnitRange(unitId, v11n ? (b, c) => versesInChapter(v11n, b, c) : undefined);
    const ps = { passages: [{ ...passage, range }], versification: v11n };
    const here = coverageFor(state, ps, offered, rows, docs.get).get(unitId) ?? [];
    const all = coverageFor(state, ps, offered, rows, docs.get, false).get(unitId) ?? [];
    const hidden = all.filter((r) => !here.some((h) => h.itemId === r.itemId));
    return { here, hidden };
  }, [state, passage, sel?.docHash, tdocs, unitId, offered, rows, docs.get]);
  const inApp = useMemo(() => (state && passage ? materialsFor(state, { unitId }).filter((m) => m.kind !== 'questions' && m.kind !== 'key_terms') : []), [state, passage, unitId]);

  if (!state || !passage || !result) {
    return <Screen header={<Header title={t('reference.passage.title')} onBack={ctx.back} />}><EmptyState icon="book" title={state ? t('reference.passage.gone') : t('common.loading')} /></Screen>;
  }
  const byId = new Map(rows.map((r) => [r.it.itemId, r]));

  async function link(itemId: string, linked: boolean, message: string, undo: boolean | null) {
    if (busy) return;
    setBusy(true);
    const spec = (value: boolean) => [{ id: Crypto.randomUUID(), type: 'v1.PassageReferenceLinked' as const, payload: { unitId, itemId, linked: value } }];
    try {
      await ctx.act(spec(linked), message, undo === null ? undefined : () => spec(undo));
    } catch {
      // ctx.act has already said "Not saved" and why.
    } finally {
      setBusy(false);
    }
  }

  const reachRow = (r: Reach, last: boolean, hidden: boolean) => {
    const item = byId.get(r.itemId);
    const name = item?.it.name ?? r.itemId;
    const facts = item?.doc?.format === 'source@1' ? sourceSummary(sourceFacts(item.doc, docs.get, item.doc.provider.kind === 'biblebrain' ? heldDetail(item.doc.provider.bibleId) : null)) : null;
    const prior = passageLink(state, unitId, r.itemId);
    return (
      <Row key={r.itemId} icon={r.kind === 'source' ? 'book' : r.kind === 'guide' ? 'sparkle' : 'note'} label={name} last={last} muted={hidden}
        sub={hidden ? t('reference.passage.hiddenHere') : [whyLabel(r.why), languagesLine([docLanguage(item?.doc)]), facts].filter(Boolean).join(' · ')}
        right={canManage ? (hidden
          ? <SmallBtn label={t('reference.passage.showHere')} disabled={busy} onPress={() => void link(r.itemId, true, t('reference.passage.shownAgain', { name }), false)} />
          : <SmallBtn label={t('reference.passage.hideHere')} disabled={busy} onPress={() => void link(r.itemId, false, t('reference.passage.hidden', { name }), prior ?? true)} />) : undefined} />
    );
  };
  const addable = rows.filter((r) => r.kind && r.kind !== 'questions' && !r.it.archived && !result.here.some((h) => h.itemId === r.it.itemId))
    .filter((r) => !q.trim() || r.it.name.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <Screen header={<Header title={t('reference.passage.title')} sub={`${passage.label} · ${languageName(ctx.org.state, languageId)}`} onBack={ctx.back} />}
      footer={canManage ? <PrimaryBtn label={t('reference.passage.add')} icon="plus" onPress={() => setAdding(true)} /> : undefined}>
      <Intro>{t('reference.passage.intro')}</Intro>
      {GROUPS.map((kind) => {
        const here = result.here.filter((r) => r.kind === kind);
        if (here.length === 0 && kind !== 'source') return null;
        return (
          <View key={kind} style={{ gap: space.sm }}>
            <SectionLabel label={t('reference.passage.group', { group: groupLabel(kind), n: here.length })} />
            {here.length ? <Group>{here.map((r, i) => reachRow(r, i === here.length - 1, false))}</Group>
              : <Card><Text style={txt.smMuted}>{t('reference.passage.noBible')}</Text></Card>}
          </View>
        );
      })}
      {inApp.length ? (
        <>
          <SectionLabel label={t('reference.writtenInApp', { n: inApp.length })} />
          <Group>{inApp.map((m, i) => <Row key={m.materialId} icon="note" label={m.title} sub={t('reference.passage.placedInApp')} last={i === inApp.length - 1} />)}</Group>
        </>
      ) : null}
      {canManage && result.hidden.length ? (
        <>
          <SectionLabel label={t('reference.passage.hiddenSection', { n: result.hidden.length })} />
          <Group>{result.hidden.map((r, i) => reachRow(r, i === result.hidden.length - 1, true))}</Group>
        </>
      ) : null}
      <Sheet visible={adding} title={t('reference.passage.addTitle')} sub={t('reference.passage.addSub')} onClose={() => setAdding(false)}>
        <SearchField value={q} onChangeText={setQ} placeholder={t('reference.passage.searchPlaceholder')} />
        {addable.length === 0 ? <Text style={txt.smMuted}>{q ? t('common.nothingMatches', { query: q }) : t('reference.passage.allHere')}</Text> : (
          <Group>
            {addable.slice(0, 50).map((r, i) => (
              <Row key={r.it.itemId} icon={r.kind === 'source' ? 'book' : r.kind === 'guide' ? 'sparkle' : 'note'} label={r.it.name}
                sub={[refKindLabel(r.kind!), languagesLine([docLanguage(r.doc)])].join(' · ')} last={i === Math.min(addable.length, 50) - 1} disabled={busy}
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
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm }
});

export const contracts = contractsFor('reference_bibles', 'reference_source', 'reference_guides', 'reference_coverage', 'passage_reference');
