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
  laneLeafUnits, laneName, libraryUnitRange, linkedTo, materialsFor, passageLink, recommendedFor, testamentOf, unitTitle, versesInChapter,
  type LibraryDoc, type ProjectState, type RecommendationSource, type SourceDoc, type TemplateDoc, type VersificationDoc
} from '@langquest-next/core';
import * as Crypto from 'expo-crypto';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { Ctx } from '../ctx';
import { indexesFor } from '../indexes';
import {
  Badge, Banner, Card, Chip, ChipRow, Disclosure, EmptyState, GhostBtn, Group, Header, PrimaryBtn, ProgressBar, Row, Screen, SearchField,
  SectionLabel, Sheet, ShowMore, SmallBtn, txt, useOpenDetail
} from '../kit';
import { sourceLine, type SharedItem } from '../library/model';
import { useLibrary, useLibraryDocs, useSharedItems } from '../library/useLibrary';
import { noteExpected } from '../report';
import { BibleError, bibleDetail, biblesIn, bibleSearchAvailable, heldDetail, searchLanguages, type BibleDetail, type BibleLanguage, type BibleSummary } from '../reference/bibleBrain';
import { coverage, coverageSummary, itemReaches, type Reach, type ReachWhy } from '../reference/coverage';
import {
  biblebrainItemId, booksOf, languageOf, legacyMigration, offlineLine, orgLevelCan, recActions, recLabel, recState, REF_KIND_LABEL,
  sourceFacts, sourceFromBible, sourceSummary, testamentLines, timingsNeeded, type Level, type RefKind
} from '../reference/model';
import {
  levelOf, publishTimingJob, referenceFailure, requestTimings, useRecommend, useRefItems, useTimingJobs, useTimingPublisher,
  versificationHash, type RefItem, type TimingJob
} from '../reference/useReference';
import { contractsFor } from '../screenContracts';
import { space, TINT } from '../theme';

const STEP = 25;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** May this person change recommendations here? The organization's need an organization-wide role; a language's, Manage Reference there. */
function canActAt(ctx: Ctx, level: Level): boolean {
  return level.kind === 'org' ? orgLevelCan(ctx.org.state, ctx.session.actorId, 'manage_reference') : ctx.session.can('manage_reference');
}

function levelName(ctx: Ctx, level: Level): string {
  if (level.kind === 'lane' && ctx.project.state) return laneName(ctx.project.state, level.laneId);
  return ctx.org.state?.org?.value.name ?? 'Organization';
}

const laneParams = (level: Level): Record<string, string> => (level.kind === 'lane' ? { laneId: level.laneId } : {});

function Intro(props: { children: ReactNode }) {
  return <Text style={[txt.smMuted, { paddingHorizontal: space.xs }]}>{props.children}</Text>;
}

const recTone = (label: string) => (label.startsWith('Recommended') ? 'green' : label.startsWith('Hidden') ? 'amber' : 'default') as 'green' | 'amber' | 'default';

/** Recommend, stop, hide or follow the organization, for one item at this level. */
function RecButtons(props: { ctx: Ctx; level: Level; itemId: string; name: string; rec: ReturnType<typeof useRecommend> }) {
  const r = recState(props.ctx.org.state?.recommendations, props.ctx.project.state, props.level, props.itemId);
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
  const canOrg = orgLevelCan(ctx.org.state, ctx.session.actorId, 'manage_reference');
  const rec = useRecommend(ctx);
  const shared = useSharedItems('material', lib.orgId);
  const [adding, setAdding] = useState(false);
  const [n, setN] = useState(STEP);

  // The old Source Bibles toggles, once: BSB or MSB on means LangQuest's BSB recommended (reference/model.ts).
  const migrating = useRef(false);
  useEffect(() => {
    const org = ctx.org.state;
    if (migrating.current || !canOrg || !org || !shared.loaded) return;
    const plan = legacyMigration(org, org.library, shared.rows);
    if (!plan) return;
    migrating.current = true;
    void (async () => {
      try {
        if (plan.follow) await lib.subscribe(plan.follow, true);
        const name = plan.follow?.name ?? lib.item(plan.itemId)?.name ?? 'Berean Standard Bible';
        if (await rec.run({ kind: 'org' }, plan.itemId, name, 'recommend', true)) {
          ctx.toast(`${name} is recommended to every language, in place of the old Source Bibles setting.`);
        }
      } catch (e) {
        noteExpected('source bibles migration', e);
      }
    })();
  }, [ctx, canOrg, shared.loaded, shared.rows, lib, rec]);

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

  if (!ctx.project.state || !ctx.org.state) return <Screen header={<Header title="Bibles" onBack={ctx.back} />}><EmptyState title="Loading…" /></Screen>;
  const sources = rows.filter((r) => r.kind === 'source' && !r.it.archived);
  const loading = rows.some((r) => r.doc === null);
  const withRec = sources.map((r) => ({ r, s: recState(ctx.org.state?.recommendations, ctx.project.state, level, r.it.itemId) }));
  const on = withRec.filter((x) => x.s.effective);
  const hidden = withRec.filter((x) => !x.s.effective && x.s.lane === 'hidden');
  const off = withRec.filter((x) => !x.s.effective && x.s.lane !== 'hidden');

  const card = ({ r }: (typeof withRec)[number]) => {
    const doc = r.doc as SourceDoc;
    const facts = sourceFacts(doc, docs.get, doc.provider.kind === 'biblebrain' ? heldDetail(doc.provider.bibleId) : null);
    const label = recLabel(recState(ctx.org.state?.recommendations, ctx.project.state, level, r.it.itemId), level);
    return (
      <Card key={r.it.itemId} current={beside?.screen === 'reference_source' && beside.params['itemId'] === r.it.itemId}
        onPress={() => ctx.go('reference_source', { itemId: r.it.itemId, ...laneParams(level) })} accessibilityLabel={`${r.it.name}. ${label}`}>
        <View style={styles.titleRow}>
          <Text style={[txt.h3, { flex: 1 }]}>{r.it.name}</Text>
          <Badge label={label} tone={recTone(label)} />
        </View>
        <Text style={txt.xs}>{`${doc.abbreviation} · ${doc.language.toUpperCase()} · ${doc.provider.kind === 'biblebrain' ? 'Bible Brain' : 'LangQuest library'} · ${sourceLine(r.it)}`}</Text>
        <Text style={txt.sm}>{sourceSummary(facts)}</Text>
        {canAct ? <RecButtons ctx={ctx} level={level} itemId={r.it.itemId} name={r.it.name} rec={rec} /> : null}
      </Card>
    );
  };

  return (
    <Screen header={<Header title="Bibles" sub={levelName(ctx, level)} onBack={ctx.back} />}
      footer={canAct || ctx.session.can('manage_reference') ? <PrimaryBtn label="Add a Bible" icon="plus" onPress={() => setAdding(true)} /> : undefined}>
      <Intro>
        {level.kind === 'org'
          ? 'What the organization recommends to every language. Language admins can add or hide some for their team, and translators can still explore any Bible online.'
          : 'What this language’s team is offered: the organization’s recommendations, with what you add or hide here. Translators can still explore any Bible online.'}
      </Intro>
      <SectionLabel label={`Recommended · ${on.length}`} />
      {on.length ? on.slice(0, n).map(card) : (
        <Card><Text style={txt.smMuted}>{loading ? 'Loading…' : 'No Bible is recommended here yet. Add one, or recommend one below.'}</Text></Card>
      )}
      <ShowMore remaining={on.length - n} step={STEP} onMore={() => setN(n + STEP)} />
      {hidden.length ? (
        <>
          <SectionLabel label={`Hidden for this language · ${hidden.length}`} />
          {hidden.map(card)}
        </>
      ) : null}
      {off.length ? (
        <>
          <SectionLabel label={`In your library, not recommended · ${off.length}`} />
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
  const fallback = ctx.project.state?.project?.value.sourceLanguoidId ?? 'eng';
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
      ctx.toast(`Not added. ${referenceFailure('add ready source', e)}`);
    } finally {
      setBusy(false);
    }
  }
  async function pick(b: BibleSummary) {
    setBusy(true);
    try { setPicked(await bibleDetail(b.bibleId)); } catch (e) { ctx.toast(referenceFailure('bible detail', e)); } finally { setBusy(false); }
  }
  async function addBibleBrain(d: BibleDetail) {
    setBusy(true);
    try {
      const itemId = biblebrainItemId(d.bibleId);
      if (!lib.item(itemId)?.current) {
        const v11n = await versificationHash(lib, 'eng', sharedV.rows);
        await lib.publish({ kind: 'material', itemId, name: d.name, description: `Bible Brain · ${d.languageName}`, doc: sourceFromBible(d, v11n) });
      }
      await rec.run(level, itemId, d.name, 'recommend');
      props.onClose();
    } catch (e) {
      ctx.toast(`Not added. ${referenceFailure('add bible brain source', e)}`);
    } finally {
      setBusy(false);
    }
  }

  const facts = picked ? sourceFacts(sourceFromBible(picked, '0'.repeat(64)), () => null, picked) : null;
  return (
    <Sheet visible title={picked ? picked.name : 'Add a Bible'} onClose={props.onClose}
      sub={picked ? `${picked.abbreviation} · ${picked.languageName} · Bible Brain` : 'It is recommended here once added. Translators see whether it has audio and whether it can be kept offline.'}
      footer={picked ? (
        <>
          <PrimaryBtn label="Add and recommend" onPress={() => void addBibleBrain(picked)} busy={busy} />
          <GhostBtn label="Back to the list" onPress={() => setPicked(null)} />
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
            <Chip label="From LangQuest" on={tab === 'ready'} onPress={() => setTab('ready')} />
            <Chip label="Bible Brain" icon="search" on={tab === 'biblebrain'} onPress={() => setTab('biblebrain')} />
          </ChipRow>
          {tab === 'ready' ? (
            !shared.loaded ? <Text style={txt.smMuted}>Loading…</Text>
              : ready.length === 0 ? <Text style={txt.smMuted}>{shared.error ? 'Could not load the list. Try again when you are online.' : 'Nothing more to add from LangQuest.'}</Text>
              : (
                <Group>
                  {ready.map((s, i) => {
                    const doc = readyDocs.get(s.latest_hash) as SourceDoc;
                    return <Row key={`${s.org_id}/${s.item_id}`} icon="book" label={s.name} disabled={busy} last={i === ready.length - 1}
                      sub={`${s.org_name} · ${sourceSummary(sourceFacts(doc, readyDocs.get))}`} onPress={() => void addReady(s)} />;
                  })}
                </Group>
              )
          ) : !bibleSearchAvailable ? (
            <Text style={txt.smMuted}>Bible Brain is reached through the LangQuest server, which this build does not name.</Text>
          ) : (
            <>
              <SearchField value={q} onChangeText={(v) => { setQ(v); setLang(null); }} placeholder="Language name or code" />
              {error ? <Text style={txt.error}>{error}</Text> : null}
              {languages.length ? (
                <ChipRow>
                  {languages.slice(0, 8).map((l) => (
                    <Chip key={l.code} label={`${l.name} · ${l.code}`} count={l.bibles} on={l.code === lang} onPress={() => setLang(l.code)} />
                  ))}
                </ChipRow>
              ) : null}
              {lang && bibles === null && !error ? <Text style={txt.smMuted}>Loading…</Text> : null}
              {bibles && bibles.length === 0 ? <Text style={txt.smMuted}>Bible Brain has no Bible in this language.</Text> : null}
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
  if (e instanceof BibleError && e.status === 404) return 'This server does not offer Bible Brain search yet.';
  return e instanceof Error ? e.message : 'Not connected.';
}

/** "Text OT NT · audio NT · FCBH timings" for a search result. */
function bibleLine(b: BibleSummary): string {
  const t = (x: { OT?: string; NT?: string }) => [x.OT ? 'OT' : '', x.NT ? 'NT' : ''].filter(Boolean).join(' ');
  const text = t(b.text), audio = t(b.audio);
  const timed = (b.timestamps.OT && b.audio.OT) || (b.timestamps.NT && b.audio.NT);
  return [text ? `Text ${text}` : 'No text', audio ? `audio ${audio}` : 'no audio', audio ? (timed ? 'FCBH timings' : 'no timings') : ''].filter(Boolean).join(' · ');
}

// ─── One Bible ───────────────────────────────────────────────────────────────────────

export function ReferenceSource(ctx: Ctx) {
  const level = levelOf(ctx);
  const itemId = ctx.params['itemId'] ?? '';
  const { lib, rows, docs } = useRefItems(ctx, (it) => it.itemId === itemId);
  const row = rows[0];
  const it = row?.it ?? null;
  const source = row?.doc?.format === 'source@1' ? row.doc : null;
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
    bibleDetail(bibleId).then((d) => { if (active) setDetail(d); }).catch((e: unknown) => { if (active) setDetailError(referenceFailure('bible detail', e)); });
    return () => { active = false; };
  }, [bibleId, detail]);
  // Asking for timings and publishing them are organization-wide acts (request_timings, the source's next version).
  const canOrg = orgLevelCan(ctx.org.state, ctx.session.actorId, 'manage_reference');
  const timed = !!bibleId && canManage;
  const { jobs, refresh } = useTimingJobs(lib.orgId, it?.itemId ?? null, timed);
  const outcomes = useTimingPublisher(ctx, lib, it, jobs, timed && canOrg);

  if (!it || !source) {
    return <Screen header={<Header title="Bible" onBack={ctx.back} />}><EmptyState icon="book" title={it && !row?.doc ? 'Loading…' : 'This Bible is not here any more'} /></Screen>;
  }
  const facts = sourceFacts(source, docs.get, detail);
  const need = timingsNeeded(source, facts, detail);
  const r = recState(ctx.org.state?.recommendations, ctx.project.state, level, it.itemId);
  const label = recLabel(r, level);
  const open = jobs.filter((j) => !j.finished_at);
  const followed = it.source === 'subscription';
  const mayAsk = canOrg && need.allowed && need.requests.length > 0 && !followed && open.length === 0;

  async function ask() {
    if (!it || !source || asking) return;
    setAsking(true);
    try {
      const versification = (docs.get(source.versification) as VersificationDoc | null)?.code ?? 'eng';
      for (const q of need.requests) {
        await requestTimings(lib.orgId, { itemId: it.itemId, bibleId: q.bibleId, audioFileset: q.audioFileset, textFileset: q.textFileset, books: q.books, versification });
      }
      ctx.toast(`Asked for verse timings for ${plural(need.requests.reduce((n, q) => n + q.books.length, 0), 'book')}. Progress shows here.`);
      await refresh();
    } catch (e) {
      ctx.toast(`Not asked. ${referenceFailure('request timings', e)}`);
    } finally {
      setAsking(false);
    }
  }

  const timedBooks = facts.books.filter((b) => b.timed > 0).length;
  return (
    <Screen header={<Header title={it.name} sub={`${source.abbreviation} · ${source.language.toUpperCase()} · ${source.provider.kind === 'biblebrain' ? 'Bible Brain' : 'LangQuest library'}`} onBack={ctx.back} />}
      footer={mayAsk ? <PrimaryBtn label="Generate verse timings" icon="clock" onPress={() => void ask()} busy={asking} /> : undefined}>
      <Card>
        <View style={styles.titleRow}>
          <Text style={[txt.h3, { flex: 1 }]}>{levelName(ctx, level)}</Text>
          <Badge label={label} tone={recTone(label)} />
        </View>
        {canAct ? <RecButtons ctx={ctx} level={level} itemId={it.itemId} name={it.name} rec={rec} /> : null}
      </Card>

      <SectionLabel label="What it offers" />
      <Group>
        {testamentLines(facts).map((l, i, all) => <Row key={l.testament} icon="book" label={l.label} sub={l.line} last={i === all.length - 1} />)}
      </Group>
      <Text style={[txt.sm, { paddingHorizontal: space.xs }]}>{offlineLine(facts)}</Text>
      {detailError && source.provider.kind === 'biblebrain' ? <Text style={[txt.xs, { paddingHorizontal: space.xs }]}>{`Could not ask Bible Brain for the latest: ${detailError}`}</Text> : null}
      {facts.copyright.length ? (
        <Card>
          {facts.copyright.map((c) => <Text key={c} style={txt.xs}>{c}</Text>)}
          {source.provider.kind === 'biblebrain' ? <Text style={txt.xs}>Text and audio from Bible Brain (Faith Comes By Hearing), under its terms.</Text> : null}
        </Card>
      ) : null}
      <Text style={[txt.xs, { paddingHorizontal: space.xs }]}>{sourceLine(it)}</Text>

      <Disclosure icon="clock" title="Verse timings by book" summary={`${timedBooks} of ${plural(facts.books.length, 'book')} timed here`} {...booksOpen}>
        {facts.books.map((b, i) => (
          <Row key={b.book} label={b.name} last={i === facts.books.length - 1}
            sub={facts.timings[testamentOf(b.book)] === 'fcbh' ? 'Timings by FCBH'
              : b.timed === 0 ? (!facts.audio[testamentOf(b.book)] ? 'No audio' : facts.timings[testamentOf(b.book)] === 'unknown' ? 'Not known until Bible Brain answers' : 'No timings')
              : `${b.timed}${b.chapters ? ` of ${b.chapters}` : ''} chapters timed · ${b.sources.map((s) => (s === 'generated' ? 'generated' : s === 'fcbh' ? 'FCBH' : 'corrected')).join(', ')}`} />
        ))}
      </Disclosure>

      {source.provider.kind === 'biblebrain' && canManage ? (
        <>
          <SectionLabel label="Generating timings" />
          {need.reason ? <Banner icon="lock" tone="amber" title="These timings can't be generated" body={need.reason} /> : null}
          {followed && need.requests.length ? <Banner icon="link" title={`Follows ${it.subscription?.sourceOrgName ?? 'another organization'}`} body="Timings are added by whoever publishes it. Copy it to add your own." /> : null}
          {!need.reason && need.requests.length === 0 && detail ? <Text style={[txt.smMuted, { paddingHorizontal: space.xs }]}>Every book with audio has verse timings.</Text> : null}
          {!detail && !detailError ? <Text style={[txt.smMuted, { paddingHorizontal: space.xs }]}>Checking Bible Brain…</Text> : null}
          {mayAsk ? <Text style={[txt.smMuted, { paddingHorizontal: space.xs }]}>{`${plural(need.requests.reduce((n, q) => n + q.books.length, 0), 'book')} of audio without timings. Timings let translators hear one verse at a time.`}</Text> : null}
          {jobs.map((j) => <JobCard key={j.id} job={j} outcome={outcomes[j.id]} ctx={ctx} onRetry={async () => {
            try { await publishTimingJob(lib, it, j.id); ctx.toast('Timings published.'); } catch (e) { ctx.toast(`Not published. ${referenceFailure('publish timings', e)}`); }
          }} />)}
        </>
      ) : null}
    </Screen>
  );
}

function JobCard(props: { ctx: Ctx; job: TimingJob; outcome?: Awaited<ReturnType<typeof publishTimingJob>> | { error: string }; onRetry: () => Promise<void> }) {
  const { job: j, outcome } = props;
  const failedOpen = props.ctx.details(`reference:job:${j.id}:failed`);
  const what = `${plural(j.books.length, 'book')} · ${j.audio_fileset}`;
  const state = j.error ? `Stopped: ${j.error}`
    : j.finished_at ? `Finished · ${j.results - j.failed} of ${plural(j.results, 'chapter')} passed`
    : j.claimed_at ? `Working · ${j.done} of ${j.total || '?'} chapters${j.note ? ` · ${j.note}` : ''}`
    : 'Waiting for the timing service';
  const failed = outcome && 'failed' in outcome ? outcome.failed : [];
  return (
    <Card>
      <View style={styles.titleRow}>
        <Text style={[txt.h3, { flex: 1 }]}>{what}</Text>
        <Badge label={j.error ? 'Stopped' : j.finished_at ? 'Done' : j.claimed_at ? 'Working' : 'Waiting'} tone={j.error ? 'red' : j.finished_at ? 'green' : 'amber'} />
      </View>
      <Text style={txt.sm}>{state}</Text>
      {!j.finished_at && j.total > 0 ? (
        <ProgressBar value={Math.round((100 * j.done) / j.total)} />
      ) : null}
      {outcome && 'error' in outcome ? (
        <>
          <Text style={txt.error}>{`Not published yet. ${outcome.error}`}</Text>
          <SmallBtn label="Try again" icon="restart" onPress={() => void props.onRetry()} />
        </>
      ) : null}
      {outcome && 'placed' in outcome ? (
        <Text style={txt.xs}>{outcome.placed.length ? `Published: ${plural(outcome.placed.length, 'chapter')}.` : 'Already published.'}{outcome.kept.length ? ` ${plural(outcome.kept.length, 'chapter')} kept the timings they had.` : ''}{outcome.skipped.length ? ` ${plural(outcome.skipped.length, 'chapter')} use FCBH's timings live.` : ''}</Text>
      ) : null}
      {failed.length ? (
        <Disclosure icon="flag" title="Did not pass" summary={`${plural(failed.length, 'chapter')}, not published`} {...failedOpen}>
          {failed.map((f, i) => <Row key={`${f.book}.${f.chapter}`} label={`${f.book} ${f.chapter}`} sub={f.reason} last={i === failed.length - 1} />)}
        </Disclosure>
      ) : null}
    </Card>
  );
}

// ─── Guides and notes ────────────────────────────────────────────────────────────────

type KindFilter = 'all' | 'guide' | 'note' | 'other';
const KIND_FILTERS: { id: KindFilter; label: string }[] = [
  { id: 'all', label: 'All' }, { id: 'guide', label: 'Guides' }, { id: 'note', label: 'Notes' }, { id: 'other', label: 'Other' }
];

/** A language's passages with their verses, in its template's numbering. */
function usePassages(ctx: Ctx, laneId: string | null) {
  const state = ctx.project.state;
  const sel = laneId && state ? state.laneTemplates[laneId]?.value : undefined;
  const tdocs = useLibraryDocs(ctx.project.orgId, [sel?.docHash]);
  return useMemo(() => {
    if (!state || !laneId || !state.lanes[laneId]) return null;
    const template = sel?.docHash ? (tdocs.get(sel.docHash) as TemplateDoc | null) : null;
    const v11n = template?.bible ? (tdocs.get(template.bible.versification) as VersificationDoc | null) : null;
    const versesIn = v11n ? (b: string, c: number) => versesInChapter(v11n, b, c) : undefined;
    const passages = laneLeafUnits(state, indexesFor(state), laneId).map((unitId) => ({ unitId, label: unitTitle(state, unitId), range: libraryUnitRange(unitId, versesIn) }));
    return { passages, versification: v11n };
  }, [state, laneId, sel?.docHash, tdocs]);
}

/** Coverage of a language's passages by these items, with the language's links and hides. */
function coverageFor(state: ProjectState, laneId: string, passages: NonNullable<ReturnType<typeof usePassages>>, offered: Map<string, RecommendationSource>, rows: RefItem[], get: (h: string | null | undefined) => LibraryDoc | null, honourHides = true) {
  const parents = (unitId: string) => {
    const out: string[] = [];
    let at = state.units[unitId]?.parentUnitId ?? null;
    while (at && out.length < 20) { out.push(at); at = state.units[at]?.parentUnitId ?? null; }
    return out;
  };
  return coverage({
    passages: passages.passages, versification: passages.versification, offered,
    docs: new Map(rows.map((r) => [r.it.itemId, r.doc])), get,
    link: (u, i) => (honourHides ? passageLink(state, laneId, u, i) : passageLink(state, laneId, u, i) === true ? true : undefined),
    linkedHere: (u) => linkedTo(state, laneId, u),
    ancestors: parents
  });
}

export function ReferenceGuides(ctx: Ctx) {
  const level = levelOf(ctx);
  const state = ctx.project.state;
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
  const laneId = level.kind === 'lane' ? level.laneId : null;
  const passages = usePassages(ctx, covers ? laneId : null);
  const items = rows.filter((r) => r.kind === 'guide' || r.kind === 'note' || r.kind === 'other').filter((r) => !r.it.archived);
  const reach = useMemo(() => {
    if (!covers || !passages || !state || !laneId) return null;
    const all = new Map<string, RecommendationSource>(items.map((r) => [r.it.itemId, 'organization']));
    return coverageFor(state, laneId, passages, all, items, docs.get);
    // items changes with rows
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [covers, passages, state, laneId, rows, docs.get]);
  const inApp = useMemo(() => (state ? materialsFor(state, laneId ? { laneId } : {}).filter((m) => m.kind !== 'questions' && m.kind !== 'key_terms') : []), [state, laneId]);

  if (!state) return <Screen header={<Header title="Guides and Notes" onBack={ctx.back} />}><EmptyState title="Loading…" /></Screen>;
  const languages = [...new Set(items.map((r) => languageOf(r.doc)).filter((l): l is string => !!l))].sort();
  const books = [...new Set(items.flatMap((r) => booksOf(r.doc)))];
  const shown = items.filter((r) => (kind === 'all' || r.kind === kind)
    && (!language || languageOf(r.doc) === language)
    && (!book || booksOf(r.doc).includes(book))
    && (!reach || itemReaches(reach, r.it.itemId) > 0));
  const active = [kind !== 'all', !!language, !!book, covers].filter(Boolean).length;
  const withRec = shown.map((r) => ({ r, label: recLabel(recState(ctx.org.state?.recommendations, state, level, r.it.itemId), level) }))
    .sort((a, b) => Number(!a.label.startsWith('Recommended')) - Number(!b.label.startsWith('Recommended')) || a.r.it.name.localeCompare(b.r.it.name));

  return (
    <Screen header={<Header title="Guides and Notes" sub={levelName(ctx, level)} onBack={ctx.back} />}
      footer={ctx.session.can('manage_reference') ? <PrimaryBtn label="New note for translators" icon="plus" onPress={() => ctx.go('material_editor', { itemId: 'new', kind: 'note', ...laneParams(level) })} /> : undefined}>
      <Intro>Study guides and notes reach the passages they are placed on, by verses or by a part of a content template. Recommended ones come first for translators.</Intro>
      <ChipRow>
        <Chip label={active ? `Filter · ${active}` : 'Filter'} icon="filter" on={active > 0} onPress={() => setFiltering(true)} />
        {active ? <Chip label="Clear" on={false} onPress={() => { setKind('all'); setLanguage(null); setBook(null); setCovers(false); }} /> : null}
      </ChipRow>
      <SectionLabel label={`In your library · ${shown.length}`} />
      {covers && !reach ? <Text style={[txt.smMuted, { paddingHorizontal: space.xs }]}>Working out coverage…</Text> : null}
      {withRec.length === 0 ? (
        <Card><Text style={txt.smMuted}>{items.length ? 'Nothing matches the filter.' : 'No guides or notes in your library yet. Follow or copy what other organizations share under Reference Material, or write a note.'}</Text></Card>
      ) : withRec.slice(0, n).map(({ r, label }) => (
        <Card key={r.it.itemId} current={beside?.screen === 'material_editor' && beside.params['itemId'] === r.it.itemId}
          onPress={() => (r.doc?.format === 'study@2' && r.it.source !== 'subscription'
            ? ctx.go('guide_editor', { itemId: r.it.itemId, ...laneParams(level) })
            : ctx.go('material_editor', { itemId: r.it.itemId, ...laneParams(level) }))} accessibilityLabel={`${r.it.name}. ${label}`}>
          <View style={styles.titleRow}>
            <Text style={[txt.h3, { flex: 1 }]}>{r.it.name}</Text>
            <Badge label={label} tone={recTone(label)} />
          </View>
          <Text style={txt.xs}>{guideLine(r, reach ? itemReaches(reach, r.it.itemId) : null)}</Text>
          {canAct ? <RecButtons ctx={ctx} level={level} itemId={r.it.itemId} name={r.it.name} rec={rec} /> : null}
        </Card>
      ))}
      <ShowMore remaining={withRec.length - n} step={STEP} onMore={() => setN(n + STEP)} />

      {inApp.length ? (
        <>
          <SectionLabel label={`Written in the app · ${inApp.length}`} />
          <Group>
            {inApp.slice(0, STEP).map((m, i) => (
              <Row key={m.materialId} icon="note" label={m.title} last={i === Math.min(inApp.length, STEP) - 1}
                sub={m.scope.unitId ? `On ${unitTitle(state, m.scope.unitId)}` : m.scope.laneId ? `For the ${laneName(state, m.scope.laneId)} team` : 'For every language'} />
            ))}
          </Group>
          <Intro>These are offered wherever they are placed; edit them under Reference Material.</Intro>
        </>
      ) : null}

      <Sheet visible={filtering} title="Filter" onClose={() => setFiltering(false)} footer={<PrimaryBtn label={`Show ${plural(shown.length, 'item')}`} onPress={() => setFiltering(false)} />}>
        <Text style={txt.xsStrong}>What kind</Text>
        <ChipRow>{KIND_FILTERS.map((k) => <Chip key={k.id} label={k.label} on={kind === k.id} onPress={() => setKind(k.id)} />)}</ChipRow>
        {languages.length ? (
          <>
            <Text style={txt.xsStrong}>Language</Text>
            <ChipRow>
              <Chip label="Any" on={!language} onPress={() => setLanguage(null)} />
              {languages.map((l) => <Chip key={l} label={l.toUpperCase()} on={language === l} onPress={() => setLanguage(l)} />)}
            </ChipRow>
          </>
        ) : null}
        {books.length ? (
          <>
            <Text style={txt.xsStrong}>Book</Text>
            <ChipRow>
              <Chip label="Any" on={!book} onPress={() => setBook(null)} />
              {books.slice(0, 40).map((b) => <Chip key={b} label={b} on={book === b} onPress={() => setBook(b)} />)}
            </ChipRow>
          </>
        ) : null}
        {laneId ? (
          <Group>
            <Row label="Covers this language’s passages" sub="Only what reaches at least one passage of its content template." role="switch" checked={covers} onPress={() => setCovers(!covers)} last />
          </Group>
        ) : <Text style={txt.xs}>Open this from a language to filter by what covers its passages.</Text>}
      </Sheet>
    </Screen>
  );
}

function guideLine(r: RefItem, reaches: number | null): string {
  const doc = r.doc;
  const parts: string[] = [REF_KIND_LABEL[r.kind ?? 'other']];
  const lang = languageOf(doc);
  if (lang) parts.push(lang.toUpperCase());
  if (doc?.format === 'collection@1') parts.push(plural(doc.entries.length, 'passage'));
  else {
    const books = booksOf(doc);
    if (books.length) parts.push(books.slice(0, 3).join(', ') + (books.length > 3 ? ` +${books.length - 3}` : ''));
    if (doc && 'links' in doc && doc.links?.some((l) => 'node' in l)) parts.push('template parts');
  }
  if (reaches !== null) parts.push(`reaches ${plural(reaches, 'passage')}`);
  parts.push(sourceLine(r.it));
  return parts.join(' · ');
}

// ─── Coverage ────────────────────────────────────────────────────────────────────────

type CoverFilter = 'all' | 'bare' | 'notes';

export function ReferenceCoverage(ctx: Ctx) {
  const state = ctx.project.state;
  const level = levelOf(ctx);
  const laneId = level.kind === 'lane' ? level.laneId : ctx.laneId && state?.lanes[ctx.laneId] ? ctx.laneId : Object.keys(state?.lanes ?? {})[0] ?? null;
  const beside = useOpenDetail();
  const { rows, docs } = useRefItems(ctx);
  const passages = usePassages(ctx, laneId);
  const [filter, setFilter] = useState<CoverFilter>('all');
  const [n, setN] = useState(STEP);
  const offered = useMemo(() => {
    const have = new Set(rows.map((r) => r.it.itemId));
    return new Map([...recommendedFor(ctx.org.state?.recommendations, state, laneId)].filter(([id]) => have.has(id)));
  }, [ctx.org.state, state, laneId, rows]);
  const map = useMemo(() => (state && laneId && passages ? coverageFor(state, laneId, passages, offered, rows, docs.get) : null),
    [state, laneId, passages, offered, rows, docs.get]);
  const names = useMemo(() => new Map(rows.map((r) => [r.it.itemId, r.doc?.format === 'source@1' ? r.doc.abbreviation : r.it.name])), [rows]);

  if (!state) return <Screen header={<Header title="Coverage" onBack={ctx.back} />}><EmptyState title="Loading…" /></Screen>;
  if (!laneId || !passages) {
    return <Screen header={<Header title="Coverage" onBack={ctx.back} />}><EmptyState icon="map" title="No language open" sub="Open a language first: coverage is read against its content template." /></Screen>;
  }
  const summary = map ? coverageSummary(map) : null;
  const list = passages.passages.filter((p) => {
    const reach = map?.get(p.unitId) ?? [];
    if (filter === 'bare') return !reach.some((r) => r.kind === 'guide' || r.kind === 'note');
    if (filter === 'notes') return reach.some((r) => r.kind === 'note');
    return true;
  });
  return (
    <Screen header={<Header title="Coverage" sub={laneName(state, laneId)} onBack={ctx.back} />}>
      <Intro>What reaches each passage: recommended Bibles by book, guides and notes by verses or template part, and anything placed by hand.</Intro>
      {summary ? (
        <Card>
          <Text style={txt.h3}>{`${plural(summary.passages, 'passage')}`}</Text>
          <Text style={txt.sm}>{`${summary.withSource} with a Bible · ${summary.withGuide} with a guide · ${summary.withNote} with a note`}</Text>
          {summary.bare ? <Text style={[txt.sm, { color: TINT.amberText }]}>{`${plural(summary.bare, 'passage')} without a guide or note`}</Text> : null}
          {offered.size === 0 ? <Text style={txt.xs}>Nothing is recommended to this language yet.</Text> : null}
        </Card>
      ) : <Card><Text style={txt.smMuted}>Working it out…</Text></Card>}
      <ChipRow>
        <Chip label="All" on={filter === 'all'} onPress={() => setFilter('all')} />
        <Chip label="No guide or note" on={filter === 'bare'} count={summary?.bare} onPress={() => setFilter('bare')} />
        <Chip label="With notes" on={filter === 'notes'} count={summary?.withNote} onPress={() => setFilter('notes')} />
      </ChipRow>
      {list.length === 0 ? <Card><Text style={txt.smMuted}>No passages here.</Text></Card> : (
        <Group>
          {list.slice(0, n).map((p, i) => {
            const reach = map?.get(p.unitId) ?? [];
            const bare = !reach.some((r) => r.kind === 'guide' || r.kind === 'note');
            const order: Record<RefKind, number> = { source: 0, guide: 1, note: 2, other: 3, questions: 4 };
            const what = [...reach].sort((a, b) => order[a.kind] - order[b.kind]).map((r) => names.get(r.itemId) ?? r.itemId);
            return (
              <Row key={p.unitId} label={p.label} last={i === Math.min(n, list.length) - 1}
                current={beside?.screen === 'passage_reference' && beside.params['unitId'] === p.unitId}
                sub={what.length ? what.join(' · ') : 'Nothing recommended reaches it'}
                badge={bare ? 'No guide' : undefined} badgeTone={bare ? 'amber' : undefined}
                onPress={() => ctx.go('passage_reference', { unitId: p.unitId, laneId })} />
            );
          })}
        </Group>
      )}
      <ShowMore remaining={list.length - n} step={STEP} onMore={() => setN(n + STEP)} />
    </Screen>
  );
}

// ─── One passage ─────────────────────────────────────────────────────────────────────

const WHY: Record<ReachWhy, string> = {
  organization: 'Recommended by the organization',
  language: 'Recommended for this language',
  linked: 'Placed here by hand'
};
const GROUPS: { kind: RefKind; label: string }[] = [
  { kind: 'source', label: 'Bibles' }, { kind: 'guide', label: 'Study guides' }, { kind: 'note', label: 'Notes for translators' }, { kind: 'other', label: 'Other material' }
];

export function PassageReference(ctx: Ctx) {
  const state = ctx.project.state;
  const unitId = ctx.params['unitId'] ?? '';
  const laneId = ctx.params['laneId'] ?? ctx.laneId ?? '';
  const { rows, docs } = useRefItems(ctx);
  const canManage = ctx.session.can('manage_reference');
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const passage = useMemo(() => {
    if (!state || !state.units[unitId] || !state.lanes[laneId]) return null;
    return { unitId, label: unitTitle(state, unitId), range: null as ReturnType<typeof libraryUnitRange> };
  }, [state, unitId, laneId]);
  const sel = state && laneId ? state.laneTemplates[laneId]?.value : undefined;
  const tdocs = useLibraryDocs(ctx.project.orgId, [sel?.docHash]);
  const offered = useMemo(() => {
    const have = new Set(rows.map((r) => r.it.itemId));
    return new Map([...recommendedFor(ctx.org.state?.recommendations, state, laneId)].filter(([id]) => have.has(id)));
  }, [ctx.org.state, state, laneId, rows]);
  const result = useMemo(() => {
    if (!state || !passage) return null;
    const template = sel?.docHash ? (tdocs.get(sel.docHash) as TemplateDoc | null) : null;
    const v11n = template?.bible ? (tdocs.get(template.bible.versification) as VersificationDoc | null) : null;
    const range = libraryUnitRange(unitId, v11n ? (b, c) => versesInChapter(v11n, b, c) : undefined);
    const ps = { passages: [{ ...passage, range }], versification: v11n };
    const here = coverageFor(state, laneId, ps, offered, rows, docs.get).get(unitId) ?? [];
    const all = coverageFor(state, laneId, ps, offered, rows, docs.get, false).get(unitId) ?? [];
    const hidden = all.filter((r) => !here.some((h) => h.itemId === r.itemId));
    return { here, hidden };
  }, [state, passage, sel?.docHash, tdocs, unitId, laneId, offered, rows, docs.get]);
  const inApp = useMemo(() => (state && passage ? materialsFor(state, { unitId }).filter((m) => m.kind !== 'questions' && m.kind !== 'key_terms' && (!m.scope.laneId || m.scope.laneId === laneId)) : []), [state, passage, unitId, laneId]);

  if (!state || !passage || !result) {
    return <Screen header={<Header title="Reference" onBack={ctx.back} />}><EmptyState icon="book" title={state ? 'This passage is not here' : 'Loading…'} /></Screen>;
  }
  const byId = new Map(rows.map((r) => [r.it.itemId, r]));

  async function link(itemId: string, linked: boolean, message: string, undo: boolean | null) {
    if (busy) return;
    setBusy(true);
    const spec = (value: boolean) => [{ id: Crypto.randomUUID(), type: 'v1.PassageReferenceLinked' as const, payload: { laneId, unitId, itemId, linked: value } }];
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
    const prior = passageLink(state, laneId, unitId, r.itemId);
    return (
      <Row key={r.itemId} icon={r.kind === 'source' ? 'book' : r.kind === 'guide' ? 'sparkle' : 'note'} label={name} last={last} muted={hidden}
        sub={hidden ? 'Hidden here' : [WHY[r.why], facts].filter(Boolean).join(' · ')}
        right={canManage ? (hidden
          ? <SmallBtn label="Show here" disabled={busy} onPress={() => void link(r.itemId, true, `${name} shows on this passage again.`, false)} />
          : <SmallBtn label="Hide here" disabled={busy} onPress={() => void link(r.itemId, false, `${name} is hidden on this passage.`, prior ?? true)} />) : undefined} />
    );
  };
  const addable = rows.filter((r) => r.kind && r.kind !== 'questions' && !r.it.archived && !result.here.some((h) => h.itemId === r.it.itemId))
    .filter((r) => !q.trim() || r.it.name.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <Screen header={<Header title="Reference" sub={`${passage.label} · ${laneName(state, laneId)}`} onBack={ctx.back} />}
      footer={canManage ? <PrimaryBtn label="Add" icon="plus" onPress={() => setAdding(true)} /> : undefined}>
      <Intro>What translators are offered on this passage, and why. They can still explore any Bible online and choose for themselves.</Intro>
      {GROUPS.map((g) => {
        const list = result.here.filter((r) => r.kind === g.kind);
        if (list.length === 0 && g.kind !== 'source') return null;
        return (
          <View key={g.kind} style={{ gap: space.sm }}>
            <SectionLabel label={`${g.label} · ${list.length}`} />
            {list.length ? <Group>{list.map((r, i) => reachRow(r, i === list.length - 1, false))}</Group>
              : <Card><Text style={txt.smMuted}>No Bible is recommended for this passage. Translators can still explore one.</Text></Card>}
          </View>
        );
      })}
      {inApp.length ? (
        <>
          <SectionLabel label={`Written in the app · ${inApp.length}`} />
          <Group>{inApp.map((m, i) => <Row key={m.materialId} icon="note" label={m.title} sub="Placed here in the app" last={i === inApp.length - 1} />)}</Group>
        </>
      ) : null}
      {canManage && result.hidden.length ? (
        <>
          <SectionLabel label={`Hidden here · ${result.hidden.length}`} />
          <Group>{result.hidden.map((r, i) => reachRow(r, i === result.hidden.length - 1, true))}</Group>
        </>
      ) : null}
      <Sheet visible={adding} title="Add to this passage" sub="Placed here by hand, whatever its coordinates say." onClose={() => setAdding(false)}>
        <SearchField value={q} onChangeText={setQ} placeholder="Search your library" />
        {addable.length === 0 ? <Text style={txt.smMuted}>{q ? `Nothing matches “${q}”.` : 'Everything in your library is here already.'}</Text> : (
          <Group>
            {addable.slice(0, 50).map((r, i) => (
              <Row key={r.it.itemId} icon={r.kind === 'source' ? 'book' : r.kind === 'guide' ? 'sparkle' : 'note'} label={r.it.name}
                sub={REF_KIND_LABEL[r.kind!]} last={i === Math.min(addable.length, 50) - 1} disabled={busy}
                onPress={() => { setAdding(false); void link(r.it.itemId, true, `${r.it.name} is placed on this passage.`, false); }} />
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
