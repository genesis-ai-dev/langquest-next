// The Reports section's pages (decision 57): app-only, not in the partner
// demo. Ported from the old web dashboard (apps/web/src/screens: Overview,
// Activity, Languages, Geography, Reports, Ledger, Pace, Alerts), whose figures
// all come from core `portfolio.ts` summed over the rows the app's
// Worker returned for this person (decision 44).
import {
  activityWindow, alertsFor, attentionCount, combinedActivity, countryCounts, coverageAverage, defaultLedgerMonth, fieldReport,
  isSettled, ledgerFor, ledgerMonths, logByDay, mergedDaily, milestonesSince, orgTotals, paceGroups,
  paceOf, portfolioCounts, portfolioOf, recencyOf, SETTLE_DAYS, sortLanguages, topLanguages, watchList,
  weeklyCards, type AlertLevel, type ClusterInfo, type LanguageRow, type LanguageSortKey, type Portfolio, type ReportWindow, type SortDir
} from '@langquest-next/core';
import { useState, type ReactNode } from 'react';
import { Platform, Pressable, ScrollView, Share, View } from 'react-native';
import { Text } from '../ui/text';
import { t, Trans } from '../i18n';
import { formatNumber } from '../i18n/format';
import { HelpBadge, HelpRow } from '../helpMode/helpBadge';
import { useHelpSpot } from '../helpMode/useHelpMode';
import { Chip, ChipRow, HelpInfo, IconBtn, LinkBtn, SearchField, SmallBtn } from '../ui/kit';
import { txt } from '../ui/textStyles';
import { C, space } from '../ui/theme';
import { CompareBars, DayBars, GroupedBars, PaceStrip, RecencyStrip, Sparkline, StackBar, WorkBar } from './charts';
import { countryName } from './countries';
// Imported, not lazy: a phone's bundle is one file anyway, and Metro's split
// bundles on the web failed to load it. Its shapes are parsed on first draw.
import WorldMap from './WorldMap';
import {
  LEVEL_TONE, levelCount, levelLabel, milestoneText, paceAdvice, paceLabel, PACE_TONE, recencyAdvice, recencyLabel, RECENCY_TONE, scopeLabel
} from './labels';
import { AttentionPanel, Bar, Columns, CoverageMini, CoverageRows, Delta, Freshness, HeadlineStats, ListLine, Notice, Panel, ProgressPair, RecencyBadge, Stat, Stats, ToneBadge } from './ui';
import { ago, bookOf, dateTime, dayYear, longDay, monthName, monthShort, num, pctText, shortDate, signed, utcTime, type Tone } from './format';
import { languagesCsv, ledgerCsv } from './csvModel';
import { canPrint, exportCsv, fileName, printPage, safeName } from './exportFiles';
import { alertText, fieldReportText, fieldTitle, sectionLabel, type SectionId } from './sectionsModel';

/** What every section gets. */
export interface SectionProps {
  rows: LanguageRow[];
  all: LanguageRow[];
  now: number;
  asOf: string;
  orgName: string;
  /** Open a language's page. */
  open: (row: LanguageRow) => void;
  /** Open a language's page at its settings (its country and target), for whoever may set them. */
  openSettings: (row: LanguageRow) => void;
  /** Whether this person may set a language's country and target (decision 41). */
  maySet: (languageId: string) => boolean;
  /** How many alerts need attention or are worth a look. */
  alerts: number;
  /** Switch section, optionally with a country filter. */
  show: (section: SectionId, country?: string) => void;
  /** The clusters among these languages, when none is picked yet (decision 108); empty otherwise. */
  clusters: ClusterInfo[];
  /** The names of the clusters a language is in. */
  clustersOf: (languageId: string) => string[];
  /** Show one cluster's languages. */
  pickCluster: (clusterId: string) => void;
}

const bold = <Text style={{ fontWeight: '700' }} />;

/** A language's name, as a link to its page. */
function LanguageLink(props: { row: LanguageRow; open: (row: LanguageRow) => void; strong?: boolean }) {
  const spot = useHelpSpot(props.row.report.name, t('reports.openLanguageHelp'), () => props.open(props.row));
  return (
    <Pressable onPress={spot.onPress} accessibilityRole="link" hitSlop={8} style={({ pressed }) => [{ minHeight: 32, justifyContent: 'center' }, pressed && { opacity: 0.6 }]}>
      <Text style={[txt.sm, { color: C.primary, fontWeight: props.strong === false ? '400' : '700' }]}>{props.row.report.name}</Text>
      <HelpBadge spot={spot} />
    </Pressable>
  );
}

/** A cluster's name, as a link that shows only its languages. */
function ClusterLink(props: { name: string; onPick: () => void }) {
  const spot = useHelpSpot(props.name, t('reports.clusters.pickHelp'), props.onPick);
  return (
    <Pressable onPress={spot.onPress} accessibilityRole="link" hitSlop={8}
      style={({ pressed }) => [{ minHeight: 32, justifyContent: 'center' }, pressed && { opacity: 0.6 }]}>
      <Text style={[txt.sm, { color: C.primary, fontWeight: '700' }]}>{props.name}</Text>
      <HelpBadge spot={spot} />
    </Pressable>
  );
}

/** A thin bar against the longest in a list. */
function RankBar(props: { value: number; max: number }) {
  return <Bar value={(100 * props.value) / Math.max(1, props.max)} label="" height={6} />;
}

/** "12 rec", the count bold. */
function Rec(props: { count: number }) {
  return <Text style={txt.sm}><Trans i18nKey="reports.recCount" count={props.count} values={{ value: num(props.count) }} components={{ b: bold }} /></Text>;
}

// ---- Overview ---------------------------------------------------------------------

/** Each cluster's languages together (decision 108): passages recorded and done; its name shows only that cluster. */
function ClusterPanel(p: SectionProps) {
  const byId = new Map(p.rows.map((r) => [r.languageId, r]));
  return (
    <Panel title={t('reports.clusters.title')} sub={t('reports.clusters.sub')}>
      {p.clusters.map((c) => {
        const totals = orgTotals(c.languageIds.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : [])));
        return (
          <HelpRow key={c.clusterId} of="reports.cluster">
            <ListLine right={<Text style={txt.xs}>{t('reports.clusters.languages', { count: c.languageIds.length })}</Text>}>
              <ClusterLink name={c.name} onPick={() => p.pickCluster(c.clusterId)} />
              <ProgressPair total={totals.total} recorded={totals.recorded} done={totals.done} />
            </ListLine>
          </HelpRow>
        );
      })}
    </Panel>
  );
}

export function Overview(p: SectionProps) {
  const { rows, now } = p;
  const totals = orgTotals(rows);
  const weeks = combinedActivity(rows);
  let running = 0;
  const cumulative = weeks.map((w) => (running += w.cards));
  const totalCards = rows.reduce((n, r) => n + r.report.uploads.cards, 0);
  const recent = weeks.slice(-4).reduce((n, w) => n + w.cards, 0);
  const portfolio = portfolioCounts(rows, now);
  const lastDays = logByDay(rows, 2, now);
  const milestones = milestonesSince(rows, new Date(now - 30 * 86_400_000).toISOString());
  const countries = countryCounts(rows).filter((c) => c.country);
  return (
    <>
      <Freshness updatedAt={totals.oldestUpdate} now={now} />
      {/* The open alerts' count on the first page too, not only on the Alerts chip (UI audit, finding 71). */}
      {p.alerts > 0 ? (
        <Notice tone="amber" title={t('reports.home.alertsChip', { count: p.alerts })}>
          <View style={{ alignSelf: 'flex-start', marginTop: space.sm }}>
            <SmallBtn label={sectionLabel('alerts')} icon="flag" help={t('reports.overview.openAlertsHelp')} onPress={() => p.show('alerts')} />
          </View>
        </Notice>
      ) : null}
      <Panel>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: space.md }}>
          <View>
            <Text style={txt.label}>{t('reports.recordingsOnServer')}</Text>
            <Text style={{ fontSize: 40, fontWeight: '800', color: C.dark }}>{num(totalCards)}</Text>
            <Text style={txt.smMuted}>{t('reports.overview.across', { count: rows.length, recent: num(recent) })}</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Sparkline values={cumulative} label={t('reports.overview.cumulativeSpoken')} />
            <Text style={txt.xs}>{t('reports.overview.cumulative', { count: weeks.length })}</Text>
          </View>
        </View>
      </Panel>
      <HeadlineStats languages={totals.languages} total={totals.total} recorded={totals.recorded} done={totals.done} />
      {p.clusters.length ? <ClusterPanel {...p} /> : null}
      <Columns>
        <Panel title={t('reports.coverage.title')} eyebrow={t('reports.overview.averageAcross')}>
          <CoverageRows recorded={coverageAverage(rows, 'recorded')} done={coverageAverage(rows, 'done')} />
        </Panel>
        <Panel title={t('reports.overview.whoIsUploading')} eyebrow={t('reports.overview.portfolio')} right={<LinkBtn label={t('reports.overview.toLanguages')} help={t('reports.overview.toLanguagesHelp')} onPress={() => p.show('languages')} />}>
          <StackBar parts={[
            { key: 'active', label: t('reports.portfolio.activeDays'), value: portfolio.active, tone: 'green' },
            { key: 'quiet', label: t('reports.portfolio.quietDays'), value: portfolio.quiet, tone: 'amber' },
            { key: 'inactive', label: t('reports.portfolio.inactiveDays'), value: portfolio.inactive, tone: 'gray' },
            { key: 'not_started', label: recencyLabel('not_started'), value: portfolio.not_started, tone: 'brand' }
          ]} />
        </Panel>
      </Columns>
      <AttentionPanel attention={totals} />
      <Columns>
        <Panel title={t('reports.overview.last48Hours')} eyebrow={sectionLabel('activity')} right={<LinkBtn label={t('reports.overview.toActivity')} help={t('reports.overview.toActivityHelp')} onPress={() => p.show('activity')} />}>
          {lastDays.length === 0 ? <Text style={txt.smMuted}>{t('reports.overview.noNewAudio')}</Text> : (
            lastDays.flatMap((d) => d.entries).slice(0, 6).map((e) => (
              <ListLine key={`${e.row.languageId}-${e.day}-${e.unitId}`}
                label={t('reports.overview.entrySpoken', { name: e.row.report.name, passage: e.label, count: e.cards, date: shortDate(e.day) })}
                right={<><Rec count={e.cards} /><Text style={txt.xs}>{shortDate(e.day)}</Text></>}>
                <Text style={txt.sm}><Text style={{ fontWeight: '700' }}>{e.row.report.name}</Text><Text style={{ color: C.muted }}> / {e.label}</Text></Text>
              </ListLine>
            ))
          )}
        </Panel>
        <Panel title={t('reports.milestones')} eyebrow={t('reports.overview.last30Days')}>
          {milestones.length === 0 ? <Text style={txt.smMuted}>{t('reports.overview.noMilestones')}</Text> : (
            milestones.slice(0, 6).map((m) => (
              <ListLine key={`${m.row.languageId}-${m.scope}-${m.threshold}`}
                right={<><ToneBadge tone={m.threshold === 100 ? 'green' : 'brand'} label={pctText(m.threshold)} /><Text style={txt.xs}>{shortDate(m.at)}</Text></>}>
                <Text style={txt.sm}>{milestoneText(m)}</Text>
              </ListLine>
            ))
          )}
        </Panel>
      </Columns>
      <Columns>
        <Panel title={t('reports.whereStand.title')} sub={t('reports.whereStand.everyLanguage')}>
          <WorkBar work={totals.work} />
        </Panel>
        <Panel title={t('reports.overview.byCountry')} eyebrow={sectionLabel('geography')} right={<LinkBtn label={t('reports.overview.toMap')} help={t('reports.overview.toMapHelp')} onPress={() => p.show('geography')} />}>
          {countries.length === 0 ? <Text style={txt.smMuted}>{t('reports.overview.noCountries')}</Text> : (
            <WorldMap values={countries.map((c) => ({ country: c.country!, value: c.languages }))} unit="languages" compact />
          )}
          {countries.length ? <Text style={txt.xs}>{countries.map((c) => `${countryName(c.country)} ${num(c.languages)}`).join(' · ')}</Text> : null}
        </Panel>
      </Columns>
    </>
  );
}

// ---- Recent activity ----------------------------------------------------------------

export function Activity(p: SectionProps & { days: 7 | 14; setDays: (d: 7 | 14) => void }) {
  const { rows, now, days } = p;
  const w = activityWindow(rows, days, now);
  const log = logByDay(rows, days, now);
  const top = topLanguages(rows, days, now).slice(0, 8);
  const maxTop = Math.max(1, ...top.map((x) => x.cards));
  const today = new Date(now).toISOString().slice(0, 10);
  return (
    <>
      <ChipRow>
        {/* help-each: each chip counts over a different number of days */}
        {([7, 14] as const).map((d) => <Chip key={d} label={t('reports.lastDays', { count: d })} help={t('reports.activity.daysHelp')} on={days === d} onPress={() => p.setDays(d)} />)}
      </ChipRow>
      <Panel>
        <Text style={txt.label}>{t('reports.activity.uploadedLastDays', { count: days })}</Text>
        <Text style={{ fontSize: 40, fontWeight: '800', color: C.dark }}>{num(w.cards)}</Text>
        <Delta now={w.cards} before={w.previousCards} />
      </Panel>
      <Stats>
        <Stat label={t('reports.activity.passagesWithAudio')} value={num(w.passages)} />
        <Stat label={t('reports.activity.languagesUploading')} value={num(w.languages)} sub={t('reports.ofTotal', { total: num(rows.length) })} />
        <Stat label={t('reports.activity.booksTouched')} value={num(w.books)} />
        <Stat label={t('reports.recordingsOnServer')} value={num(rows.reduce((n, r) => n + r.report.uploads.cards, 0))} sub={t('reports.allTime')} />
      </Stats>
      <Panel title={t('reports.activity.perDay')} sub={t('reports.activity.perDaySub', { count: days })}>
        <CompareBars current={w.daily.map((d) => ({ day: d.day, value: d.cards }))} previous={w.previousDaily.map((d) => ({ day: d.day, value: d.cards }))} />
      </Panel>
      <Columns min={420}>
        <View style={{ gap: space.lg }}>
          {log.length === 0 ? <Panel><Text style={txt.smMuted}>{t('reports.activity.noAudio', { count: days })}</Text></Panel> : log.map((d) => (
            <Panel key={d.day} {...(d.day === today ? { eyebrow: t('reports.activity.today') } : {})} title={longDay(d.day)}
              sub={[t('reports.counts.passages', { count: d.passages }), t('reports.counts.languages', { count: d.languages }), t('reports.counts.recordings', { count: d.cards })].join(' · ')}>
              {d.entries.map((e) => (
                <HelpRow key={`${e.row.languageId}-${e.unitId}`} of="reports.activityEntry">
                  <ListLine right={<><Rec count={e.cards} /><Text style={txt.xs}>{e.verses ? t('reports.counts.verses', { count: e.verses }) : '—'}</Text></>}>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: space.xs }}>
                      <Text style={txt.xs}>{utcTime(e.at)}</Text>
                      <LanguageLink row={e.row} open={p.open} />
                      <Text style={txt.smMuted}>/ {e.label}</Text>
                    </View>
                    <Text style={txt.xs}>{e.row.report.country ? countryName(e.row.report.country) : t('reports.noCountry')}</Text>
                  </ListLine>
                </HelpRow>
              ))}
            </Panel>
          ))}
        </View>
        <Panel title={t('reports.activity.mostActive')} eyebrow={t('reports.lastDays', { count: days })} sub={t('reports.activity.byRecordings')}>
          {top.length === 0 ? <Text style={txt.smMuted}>{t('reports.activity.nobodyUploaded')}</Text> : top.map((x, i) => {
            const place = x.row.report.country ? countryName(x.row.report.country) : t('reports.noCountry');
            return (
              <HelpRow key={x.row.languageId} of="reports.topLanguage">
                <ListLine right={<Text style={[txt.sm, { fontWeight: '700' }]}>{num(x.cards)}</Text>}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                    <Text style={[txt.xsStrong, { width: 20 }]}>{num(i + 1)}</Text>
                    <LanguageLink row={x.row} open={p.open} />
                  </View>
                  <RankBar value={x.cards} max={maxTop} />
                  <Text style={txt.xs}>
                    {x.row.report.uploads.lastAt ? t('reports.activity.placeLast', { place, date: shortDate(x.row.report.uploads.lastAt) }) : place}
                  </Text>
                </ListLine>
              </HelpRow>
            );
          })}
        </Panel>
      </Columns>
    </>
  );
}

// ---- Languages ------------------------------------------------------------------------

export function Languages(p: SectionProps) {
  const { rows, now } = p;
  const [status, setStatus] = useState<Portfolio | 'all'>('all');
  const counts = portfolioCounts(rows, now);
  const watch = watchList(rows, now);
  const shown = status === 'all' ? rows : rows.filter((r) => portfolioOf(recencyOf(r.report, now).band) === status);
  const filters: [Portfolio | 'all', string][] = [
    ['all', t('reports.languages.filterAll', { value: num(rows.length) })],
    ['active', t('reports.languages.filterActive', { value: num(counts.active) })],
    ['quiet', t('reports.languages.filterQuiet', { value: num(counts.quiet) })],
    ['inactive', t('reports.languages.filterInactive', { value: num(counts.inactive) })],
    ['not_started', t('reports.languages.filterNotStarted', { value: num(counts.not_started) })]
  ];
  return (
    <>
      <View style={{ alignSelf: 'flex-start' }}>
        <SmallBtn label={t('reports.downloadCsv')} icon="download" help={t('reports.languages.downloadHelp')} onPress={() => exportCsv(fileName(t('reports.files.languages', { org: p.orgName })), languagesCsv(rows, now, p.clustersOf))} />
      </View>
      <Panel eyebrow={t('reports.languages.uploadActivity')} title={t('reports.languages.uploadedTitle', { active: num(counts.active), count: rows.length })}
        sub={t('reports.languages.uploadedSub')}>
        <RecencyStrip items={rows.map((r) => ({ name: r.report.name, ...recencyOf(r.report, now) }))} />
      </Panel>
      <Panel eyebrow={t('reports.languages.watchList')} title={watch.length ? t('reports.languages.toContact', { count: watch.length }) : t('reports.languages.nobodyToChase')}
        sub={watch.length ? t('reports.languages.watchSub') : t('reports.languages.watchEmptySub')}>
        {watch.map((w) => (
          <HelpRow key={w.row.languageId} of="reports.watch">
            <ListLine right={<><ToneBadge tone={RECENCY_TONE[w.band]} label={recencyLabel(w.band)} /><Text style={txt.xs}>{t('reports.languages.inactiveIn', { count: w.untilInactive })}</Text></>}>
              <LanguageLink row={w.row} open={p.open} />
              <Text style={txt.xs}>{t('reports.languages.daysSince', { count: w.days })}{w.row.report.country ? ` · ${countryName(w.row.report.country)}` : ''}</Text>
              <Text style={txt.sm}>{recencyAdvice(w.band)}</Text>
            </ListLine>
          </HelpRow>
        ))}
      </Panel>
      <Panel title={t('reports.languages.all')}>
        <ChipRow>
          {/* help-each: each filter shows different languages */}
          {filters.map(([v, label]) => <Chip key={v} label={label} help={v === 'all' ? t('reports.languages.filterAllHelp') : t('reports.languages.filterHelp')} on={status === v} onPress={() => setStatus(v)} />)}
        </ChipRow>
        <LanguageTable rows={shown} now={now} open={p.open} clustersOf={p.clustersOf} />
      </Panel>
    </>
  );
}

type ColumnId = 'name' | 'upload' | 'coverage' | 'recorded' | 'cards' | 'weeks' | 'attention';

const COLUMNS: { id: ColumnId; key: LanguageSortKey | null; firstDir: SortDir; flex: number }[] = [
  { id: 'name', key: 'name', firstDir: 'asc', flex: 2 },
  { id: 'upload', key: 'upload', firstDir: 'asc', flex: 1.5 },
  { id: 'coverage', key: 'coverage', firstDir: 'desc', flex: 1.6 },
  { id: 'recorded', key: 'recorded', firstDir: 'desc', flex: 1.6 },
  { id: 'cards', key: 'cards', firstDir: 'desc', flex: 0.9 },
  { id: 'weeks', key: null, firstDir: 'desc', flex: 1.3 },
  { id: 'attention', key: 'attention', firstDir: 'desc', flex: 0.8 }
];

function columnLabel(id: ColumnId): string {
  switch (id) {
    case 'name': return t('reports.languages.columns.name');
    case 'upload': return t('reports.languages.columns.upload');
    case 'coverage': return t('reports.languages.columns.coverage');
    case 'recorded': return t('reports.languages.columns.recorded');
    case 'cards': return t('reports.languages.columns.cards');
    case 'weeks': return t('reports.languages.columns.weeks');
    case 'attention': return t('reports.languages.columns.attention');
  }
}

function LanguageTable(props: { rows: LanguageRow[]; now: number; open: (row: LanguageRow) => void; clustersOf: (languageId: string) => string[] }) {
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<{ key: LanguageSortKey; dir: SortDir }>({ key: 'name', dir: 'asc' });
  const q = search.trim().toLowerCase();
  const filtered = q ? props.rows.filter(({ languageId, report: r }) =>
    r.name.toLowerCase().includes(q) || r.code.toLowerCase().includes(q) || countryName(r.country).toLowerCase().includes(q) ||
    props.clustersOf(languageId).some((c) => c.toLowerCase().includes(q))) : props.rows;
  // "Upload status" sorts by most recent upload first when ascending.
  const rows = sort.key === 'upload' ? sortLanguages(filtered, 'upload', sort.dir === 'asc' ? 'desc' : 'asc') : sortLanguages(filtered, sort.key, sort.dir);
  const cell = (flex: number, children: ReactNode, right = false) => (
    <View style={{ flex, minWidth: 0, paddingHorizontal: space.xs, alignItems: right ? 'flex-end' : 'stretch' }}>{children}</View>
  );
  return (
    <View style={{ gap: space.sm }}>
      <SearchField value={search} onChangeText={setSearch} placeholder={t('reports.languages.search')} />
      <Text style={txt.xs}>{t('reports.languages.shown', { part: num(rows.length), total: num(props.rows.length) })}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ minWidth: 960, flexGrow: 1 }}>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderColor: C.border }}>
            {COLUMNS.map((c) => {
              const active = c.key !== null && sort.key === c.key;
              const label = columnLabel(c.id);
              if (!c.key) return <HelpRow key={c.id} of="reports.column"><View style={{ flex: c.flex, padding: space.xs }}><Text style={txt.xsStrong}>{label}</Text></View></HelpRow>;
              return (
                <HelpRow key={c.id} of="reports.column">
                  <SortHeader label={label} flex={c.flex} dir={active ? sort.dir : null}
                    onPress={() => setSort(active ? { key: c.key!, dir: sort.dir === 'asc' ? 'desc' : 'asc' } : { key: c.key!, dir: c.firstDir })} />
                </HelpRow>
              );
            })}
          </View>
          {rows.map((row) => {
            const r = row.report;
            const weeks = weeklyCards(r);
            const attention = attentionCount(r);
            return (
              <HelpRow key={`${row.languageId}/${row.languageId}`} of="reports.languageRow">
                <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: space.sm, borderBottomWidth: 1, borderColor: C.border }}>
                  {cell(2, <><LanguageLink row={row} open={props.open} /><Text style={txt.xs}>
                    {[r.code.toUpperCase(), r.country ? countryName(r.country) : t('reports.noCountry'), ...props.clustersOf(row.languageId)].join(' · ')}</Text></>)}
                  {cell(1.5, <><View style={{ alignSelf: 'flex-start' }}><RecencyBadge report={r} now={props.now} /></View>
                    <Text style={txt.xs}>{r.uploads.lastAt ? `${shortDate(r.uploads.lastAt)} · ${ago(r.uploads.lastAt, props.now)}` : t('reports.languages.never')}</Text></>)}
                  {cell(1.6, <CoverageMini coverage={r.coverage.recorded} name={r.name} />)}
                  {cell(1.6, <ProgressPair total={r.progress.total} recorded={r.progress.recorded} done={r.progress.done} />)}
                  {cell(0.9, <Text style={[txt.sm, { fontWeight: '700' }]}>{num(r.uploads.cards)}</Text>, true)}
                  {cell(1.3, <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
                    <Sparkline values={weeks} label={t('reports.languages.perWeekSpoken', { name: r.name })} />
                    <Text style={txt.xs}>
                      <Trans i18nKey="reports.languages.perWeek" values={{ value: num(weeks.at(-1) ?? 0) }} components={{ b: <Text style={{ fontWeight: '700', color: C.dark }} /> }} />
                    </Text>
                  </View>)}
                  {cell(0.8, attention > 0 ? <View style={{ alignSelf: 'flex-start' }}><ToneBadge tone="amber" label={num(attention)} /></View> : <Text style={txt.xs}>—</Text>)}
                </View>
              </HelpRow>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

/** A column's heading that sorts the table by it; `dir` while it is the one sorting. */
function SortHeader(props: { label: string; flex: number; dir: SortDir | null; onPress: () => void }) {
  const { label, dir } = props;
  const spoken = !dir ? t('reports.languages.sortBy', { column: label })
    : dir === 'asc' ? t('reports.languages.sortedAscending', { column: label }) : t('reports.languages.sortedDescending', { column: label });
  const spot = useHelpSpot(label, dir ? t('reports.languages.sortedHelp') : t('reports.languages.sortHelp'), props.onPress);
  return (
    <Pressable onPress={spot.onPress} accessibilityRole="button" accessibilityLabel={spoken}
      style={({ pressed }) => [{ flex: props.flex, minHeight: 48, justifyContent: 'center', padding: space.xs }, pressed && { opacity: 0.6 }]}>
      <Text style={[txt.xsStrong, dir ? { color: C.primary } : null]}>{label}{dir ? (dir === 'asc' ? ' ▲' : ' ▼') : ''}</Text>
      <HelpBadge spot={spot} inset />
    </Pressable>
  );
}

// ---- Geography ------------------------------------------------------------------------

type Measure = 'languages' | 'recent' | 'all';

export function Geography(p: SectionProps) {
  const { rows, now } = p;
  const [measure, setMeasure] = useState<Measure>('languages');
  const groups = new Map<string, LanguageRow[]>();
  for (const r of rows) {
    const k = r.report.country ?? '';
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const table = [...groups].map(([country, list]) => ({
    country: country || null,
    list,
    recent: activityWindow(list, 7, now).cards,
    all: list.reduce((n, r) => n + r.report.uploads.cards, 0),
    active: portfolioCounts(list, now).active,
    nt: coverageAverage(list, 'recorded').nt
  })).sort((a, b) => b.list.length - a.list.length || countryName(a.country).localeCompare(countryName(b.country)));
  const values = table.filter((x) => x.country).map((x) => ({
    country: x.country!, value: measure === 'languages' ? x.list.length : measure === 'recent' ? x.recent : x.all
  })).filter((v) => v.value > 0);
  const unset = groups.get('')?.length ?? 0;
  const max = Math.max(1, ...table.map((x) => x.list.length));
  const measures: [Measure, string][] = [
    ['languages', t('reports.geography.measureLanguages')], ['recent', t('reports.geography.measureRecent')], ['all', t('reports.geography.measureAll')]
  ];
  return (
    <>
      <ChipRow>
        {/* help-each: each measure shades the map by something different */}
        {measures.map(([v, label]) => <Chip key={v} label={label} help={t('reports.geography.measureHelp')} on={measure === v} onPress={() => setMeasure(v)} />)}
      </ChipRow>
      <Panel title={t('reports.counts.countries', { count: countryCounts(rows).filter((c) => c.country).length })}
        {...(unset ? { sub: t('reports.geography.unset', { count: unset }) } : {})}>
        {values.length === 0 ? <Text style={txt.smMuted}>{t('reports.geography.nothingToShade')}</Text> : (
          <WorldMap values={values} unit={measure === 'languages' ? 'languages' : 'recordings'} />
        )}
      </Panel>
      <Panel title={t('reports.geography.byCountry')}>
        {table.map((x) => (
          <HelpRow key={x.country ?? 'none'} of="reports.country">
            <ListLine
              right={<>
                <Text style={txt.sm}><Trans i18nKey="reports.geography.active" values={{ value: num(x.active) }} components={{ b: bold }} /></Text>
                <Text style={txt.xs}>{t('reports.geography.figures', { recent: num(x.recent), all: num(x.all), nt: pctText(x.nt) })}</Text>
              </>}>
              {x.country ? <LinkBtn label={countryName(x.country)} help={t('reports.geography.countryHelp')} onPress={() => p.show('languages', x.country!)} style={{ alignSelf: 'flex-start', minHeight: 32 }} />
                : <Text style={txt.smMuted}>{countryName(null)}</Text>}
              <RankBar value={x.list.length} max={max} />
              <Text style={txt.xs}>{t('reports.geography.languageList', { count: x.list.length, names: x.list.map((r) => r.report.name).join(', ') })}</Text>
            </ListLine>
          </HelpRow>
        ))}
      </Panel>
    </>
  );
}

// ---- Field report ----------------------------------------------------------------------

/** The field report's view, for Print. */
const PRINT_FIELD = 'print-field';

export function FieldReport(p: SectionProps) {
  const { rows, now } = p;
  const [period, setPeriod] = useState<ReportWindow>('week');
  const [copied, setCopied] = useState('');
  const fr = fieldReport(rows, period, now);
  const countryCards = new Map<string, number>();
  for (const x of fr.mostRecorded) if (x.row.report.country) countryCards.set(x.row.report.country, (countryCards.get(x.row.report.country) ?? 0) + x.cards);
  const maxCards = Math.max(1, ...fr.mostRecorded.map((x) => x.cards));
  const copy = () => {
    const text = fieldReportText(fr, p.orgName);
    if (Platform.OS === 'web') {
      void navigator.clipboard.writeText(text).then(
        () => setCopied(t('reports.field.copied')), () => setCopied(t('reports.field.copyFailed')));
    } else {
      void Share.share({ message: text }).catch(() => undefined);
    }
  };
  const H = (props: { children: string }) => <Text style={[txt.h3, { marginTop: space.md }]} accessibilityRole="header">{props.children}</Text>;
  const periods: [ReportWindow, string][] = [['week', t('reports.field.weekly')], ['month', t('reports.field.monthly')], ['ytd', t('reports.field.yearToDate')]];
  const summary = {
    recordings: t('reports.counts.recordings', { count: fr.cards }),
    languages: t('reports.counts.languages', { count: fr.languagesRecording }),
    countries: t('reports.counts.countries', { count: fr.countries })
  };
  return (
    <>
      <ChipRow>
        {/* help-each: each period reports on different days */}
        {periods.map(([v, label]) => <Chip key={v} label={label} help={t('reports.field.periodHelp')} on={period === v} onPress={() => setPeriod(v)} />)}
      </ChipRow>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, alignItems: 'center' }}>
        {/* One look per action: copy copies, share opens the share sheet, print prints (UI audit, finding 75). */}
        <SmallBtn label={Platform.OS === 'web' ? t('reports.field.copyText') : t('reports.field.shareText')} icon={Platform.OS === 'web' ? 'copy' : 'share'}
          help={Platform.OS === 'web' ? t('reports.field.copyTextHelp') : t('reports.field.shareTextHelp')} onPress={copy} />
        {canPrint ? <SmallBtn label={t('reports.printOrSave')} icon="print" help={t('reports.printOrSaveHelp')} onPress={() => printPage(PRINT_FIELD)} /> : null}
        {copied ? <Text style={txt.smMuted} accessibilityLiveRegion="polite">{copied}</Text> : null}
      </View>
      {/* What Print copies: the report itself (exportFiles.ts). */}
      <View nativeID={PRINT_FIELD}><Panel>
        <Text style={txt.label}>{t('reports.field.eyebrow', { org: p.orgName })}</Text>
        <Text style={{ fontSize: 28, fontWeight: '800', color: C.dark }} accessibilityRole="header">{fieldTitle(fr)}</Text>
        <Text style={txt.smMuted}>{t('reports.field.range', { from: shortDate(fr.from), to: shortDate(fr.to), year: fr.to.slice(0, 4), asOf: dateTime(new Date(now).toISOString()) })}</Text>
        <Text style={txt.body}>
          <Trans i18nKey={fr.countries ? 'reports.field.summaryCountries' : 'reports.field.summary'} values={summary} components={{ b: bold }} />
          {fr.milestones.length ? <> <Trans i18nKey="reports.field.milestonesCrossed" values={{ milestones: t('reports.counts.milestones', { count: fr.milestones.length }) }} components={{ b: bold }} /></> : null}
        </Text>

        <H>{t('reports.field.byTheNumbers')}</H>
        <Stats>
          <Stat label={t('reports.field.recordings')} value={num(fr.cards)} tone="brand" sub={fr.previousCards !== null ? undefined : t('reports.field.since', { date: shortDate(fr.from) })} />
          <Stat label={t('reports.field.languagesRecorded')} value={num(fr.languagesRecording)} sub={t('reports.ofTotal', { total: num(fr.languages) })} />
          <Stat label={t('reports.field.ntRecorded')} value={pctText(fr.ntRecorded)} sub={t('reports.field.ntRecordedSub')} />
          <Stat label={t('reports.field.passagesDone')} value={num(fr.passagesDone)} sub={t('reports.field.passagesDoneSub')} />
        </Stats>
        {fr.previousCards !== null ? <Delta now={fr.cards} before={fr.previousCards} unit="recordings" /> : null}

        {countryCards.size ? (
          <>
            <H>{t('reports.whereWorkHappened')}</H>
            <WorldMap values={[...countryCards].map(([country, value]) => ({ country, value }))} unit="recordings" compact />
          </>
        ) : null}

        <H>{t('reports.field.coverageAdvanced')}</H>
        {fr.advanced.length === 0 ? <Text style={txt.smMuted}>{t('reports.field.noCoverageMoved')}</Text> : fr.advanced.map((a) => (
          <HelpRow key={a.row.languageId} of="reports.advanced">
            <View style={{ gap: 4, paddingVertical: space.xs }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.sm }}>
                <Text style={txt.sm}><Text style={{ fontWeight: '700' }}>{a.row.report.name}</Text><Text style={{ color: C.muted }}> {a.row.report.country ? `${countryName(a.row.report.country)} · ` : ''}{scopeLabel(a.scope)}</Text></Text>
                <Text style={[txt.sm, { fontWeight: '700', color: C.green }]}>
                  {t('reports.field.pointsGained', { gain: formatNumber(Math.round(10 * (a.after - a.before)) / 10, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) })}
                </Text>
              </View>
              <HelpInfo label={t('reports.field.advancedFromTo', { before: pctText(a.before), after: pctText(a.after), scope: scopeLabel(a.scope) })}
                detail={t('reports.field.advancedBarHelp')}>
                <View style={{ flexDirection: 'row', height: 10, borderRadius: 5, overflow: 'hidden', backgroundColor: C.border }}>
                  <View style={{ width: `${a.before}%`, backgroundColor: C.primary }} />
                  <View style={{ width: `${a.after - a.before}%`, backgroundColor: C.green }} />
                </View>
              </HelpInfo>
              <Text style={txt.xs}>{t('reports.field.advancedFromTo', { before: pctText(a.before), after: pctText(a.after), scope: scopeLabel(a.scope) })}</Text>
            </View>
          </HelpRow>
        ))}

        <H>{t('reports.field.dayByDay')}</H>
        {period === 'ytd' ? (
          <GroupedBars labels={combinedActivity(rows).map((w) => w.weekStart)} format={shortDate} title={(d) => t('reports.charts.weekOf', { date: shortDate(d) })}
            empty={t('reports.field.noRecordingsThisYear')}
            series={[{ key: 'cards', label: t('reports.field.perWeek'), color: C.primary, values: combinedActivity(rows).map((w) => (w.weekStart >= fr.from ? w.cards : 0)) }]} />
        ) : (
          <DayBars days={mergedDaily(rows).map((d) => ({ day: d.day, value: d.cards }))} highlightFrom={fr.from}
            label={period === 'week' ? t('reports.last7Days') : t('reports.field.last30Days')} unit="recordings" />
        )}

        <H>{t('reports.field.recordedMost')}</H>
        {fr.mostRecorded.length === 0 ? <Text style={txt.smMuted}>{t('reports.charts.noRecordingsInPeriod')}</Text> : fr.mostRecorded.slice(0, 10).map((x, i) => (
          <ListLine key={x.row.languageId} right={<><ToneBadge tone="green" label={t('reports.field.ntShare', { share: pctText(x.row.report.coverage.recorded.nt) })} /><Text style={[txt.sm, { fontWeight: '700' }]}>+{num(x.cards)}</Text></>}>
            <Text style={txt.sm}><Text style={{ fontWeight: '700' }}>{num(i + 1)}. {x.row.report.name}</Text><Text style={{ color: C.muted }}> {x.row.report.country ? countryName(x.row.report.country) : ''}</Text></Text>
            <RankBar value={x.cards} max={maxCards} />
          </ListLine>
        ))}
        {fr.mostRecorded.length > 10 ? <Text style={txt.smMuted}>{t('reports.field.moreLanguages', { count: fr.mostRecorded.length - 10 })}</Text> : null}

        <H>{t('reports.field.whereAllStand', { count: fr.languages })}</H>
        <Text style={[txt.sm, { fontWeight: '600' }]}>{t('reports.field.howRecently')}</Text>
        <StackBar parts={[
          { key: 'active', label: recencyLabel('active'), value: fr.portfolio.active, tone: 'green' },
          { key: 'quiet', label: t('reports.portfolio.quiet'), value: fr.portfolio.quiet, tone: 'amber' },
          { key: 'inactive', label: recencyLabel('inactive'), value: fr.portfolio.inactive, tone: 'gray' },
          { key: 'not_started', label: recencyLabel('not_started'), value: fr.portfolio.not_started, tone: 'brand' }
        ]} />
        <Text style={[txt.sm, { fontWeight: '600' }]}>{t('reports.field.workingOn')}</Text>
        <StackBar parts={[
          { key: 'gospels', label: scopeLabel('gospels'), value: fr.workingOn.gospels, tone: 'brand' },
          { key: 'nt', label: scopeLabel('nt'), value: fr.workingOn.nt, tone: 'green' },
          { key: 'ot', label: scopeLabel('ot'), value: fr.workingOn.ot, tone: 'amber' },
          { key: 'bible', label: scopeLabel('bible'), value: fr.workingOn.bible, tone: 'red' },
          { key: 'none', label: t('reports.field.notYetRecording'), value: fr.workingOn.none, tone: 'gray' }
        ]} />

        <H>{t('reports.milestones')}</H>
        {fr.milestones.length === 0 ? <Text style={txt.smMuted}>{t('reports.field.noMilestones')}</Text> : fr.milestones.map((m) => (
          <ListLine key={`${m.row.languageId}-${m.scope}-${m.threshold}`} right={<Text style={txt.xs}>{shortDate(m.at)}</Text>}>
            <Text style={txt.sm}>{milestoneText(m)}</Text>
          </ListLine>
        ))}

        <H>{t('reports.field.pausedOrResumed')}</H>
        {fr.wentQuiet.length === 0 && fr.resumed.length === 0 ? <Text style={txt.smMuted}>{t('reports.field.noneQuietOrBack')}</Text> : (
          <>
            {fr.wentQuiet.map((r) => (
              <ListLine key={`q-${r.languageId}`} right={<ToneBadge tone="amber" label={t('reports.portfolio.quiet')} />}>
                <Text style={txt.sm}><Trans i18nKey="reports.field.wentQuiet" values={{ name: r.report.name }} components={{ b: bold }} /></Text>
              </ListLine>
            ))}
            {fr.resumed.map((r) => (
              <ListLine key={`r-${r.languageId}`} right={<ToneBadge tone="green" label={t('reports.field.resumedBadge')} />}>
                <Text style={txt.sm}><Trans i18nKey="reports.field.resumed" values={{ name: r.report.name }} components={{ b: bold }} /></Text>
              </ListLine>
            ))}
          </>
        )}
      </Panel></View>
    </>
  );
}

// ---- Monthly ledger ------------------------------------------------------------------

export function Ledger(p: SectionProps) {
  const { rows, now } = p;
  const months = ledgerMonths(rows);
  const [chosen, setChosen] = useState<string | null>(null);
  const month = chosen && months.includes(chosen) ? chosen : defaultLedgerMonth(months, now);
  if (!month) return <Notice tone="gray" title={t('reports.ledger.noMonths')} body={t('reports.ledger.noMonthsBody')} />;
  const i = months.indexOf(month);
  const l = ledgerFor(rows, month);
  const prev = i > 0 ? ledgerFor(rows, months[i - 1]!) : null;
  const settled = isSettled(month, now);
  const byMonth = months.map((m) => ledgerFor(rows, m).chapters);
  const groups = paceGroups(rows, now);
  const pace = groups.filter((g) => g.band !== 'no_target');
  const noTarget = groups.find((g) => g.band === 'no_target')!.items.length;
  const idle = rows.filter((r) => !l.lines.some((x) => x.row.languageId === r.languageId && x.row.languageId === r.languageId));
  const countries = new Map<string, typeof l.lines>();
  for (const line of l.lines) {
    const k = line.row.report.country ?? '';
    countries.set(k, [...(countries.get(k) ?? []), line]);
  }
  const name = monthName(month);
  return (
    <>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm }}>
        <IconBtn name="left" label={t('reports.ledger.previousMonth')} help={t('reports.ledger.previousMonthHelp')} disabled={i <= 0} onPress={() => setChosen(months[i - 1]!)} />
        <Text style={[txt.h3, { minWidth: 160, textAlign: 'center' }]} accessibilityLiveRegion="polite">{settled ? name : t('reports.ledger.monthMoving', { month: name })}</Text>
        <IconBtn name="right" label={t('reports.ledger.nextMonth')} help={t('reports.ledger.nextMonthHelp')} disabled={i >= months.length - 1} onPress={() => setChosen(months[i + 1]!)} />
        <SmallBtn label={t('reports.ledger.export', { month: monthShort(month) })} icon="download" help={t('reports.ledger.exportHelp')}
          onPress={() => exportCsv(`${safeName(t('reports.files.ledger', { org: p.orgName, month }))}.csv`, ledgerCsv(rows, month))} />
      </View>
      {!settled ? (
        <Notice tone="amber" title={t('reports.ledger.stillMoving', { month: name })} body={t('reports.ledger.stillMovingBody', { count: SETTLE_DAYS })} />
      ) : null}
      <Panel eyebrow={sectionLabel('ledger')} title={name}>
        <Columns>
          <Stats>
            <Stat label={t('reports.ledger.newChapters')} value={num(l.chapters)} tone="brand" />
            <Stat label={t('reports.ledger.booksWithAudio')} value={num(l.books)} />
            <Stat label={t('reports.headline.languages')} value={num(l.languages)} sub={t('reports.ofTotal', { total: num(rows.length) })} />
          </Stats>
          <GroupedBars labels={months} format={monthShort} title={monthName} empty={t('reports.ledger.noChapters')} table={false}
            series={[
              { key: 'other', label: t('reports.ledger.otherMonths'), color: C.border, values: byMonth.map((v, k) => (k === i ? 0 : v)) },
              { key: 'this', label: name, color: C.primary, values: byMonth.map((v, k) => (k === i ? v : 0)) }
            ]} />
        </Columns>
        {prev ? <Delta now={l.chapters} before={prev.chapters} unit="chapters" /> : null}
        <Text style={txt.xs}>{t('reports.ledger.countsOnce')}</Text>
      </Panel>
      <Panel title={t('reports.ledger.paceToday')} right={<LinkBtn label={t('reports.ledger.toPace')} help={t('reports.ledger.toPaceHelp')} onPress={() => p.show('pace')} />}
        {...(noTarget ? { sub: t('reports.ledger.noTargetLeftOut', { count: noTarget }) } : {})}>
        <StackBar empty={t('reports.charts.noTargetYet')} parts={pace.map((g) => ({ key: g.band, label: paceLabel(g.band), value: g.items.length, tone: PACE_TONE[g.band] }))} />
      </Panel>
      <Panel title={t('reports.whereWorkHappened')}
        sub={l.lines.length ? t('reports.ledger.gotChapters', { count: l.languages, month: name }) : t('reports.ledger.noNewChapters', { month: name })}>
        {[...countries].sort((a, b) => b[1].reduce((n, x) => n + x.chapters, 0) - a[1].reduce((n, x) => n + x.chapters, 0)).map(([country, lines]) => (
          <View key={country || 'none'} style={{ gap: space.xs }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.sm, paddingTop: space.sm }}>
              <Text style={[txt.sm, { fontWeight: '700' }]}>{countryName(country || null)}</Text>
              <Text style={txt.xs}>
                {t('reports.counts.languages', { count: lines.length })} · {t('reports.counts.chapters', { count: lines.reduce((n, x) => n + x.chapters, 0) })}
              </Text>
            </View>
            {lines.map((line) => {
              const lp = paceOf(line.row.report, now);
              const top = [...line.books].sort((a, b) => b.chapters - a.chapters);
              const summary = top.slice(0, 3).map((b) => `${bookOf(b)} ${num(b.chapters)}`).join(' · ') + (top.length > 3 ? ` +${num(top.length - 3)}` : '');
              return (
                <HelpRow key={line.row.languageId} of="reports.ledgerLine">
                  <ListLine
                    right={<>
                      {lp ? <ToneBadge tone={PACE_TONE[lp.band]} label={t('reports.pace.badge', { label: paceLabel(lp.band), gap: signed(lp.gap) })} /> : null}
                      <Text style={txt.sm}>
                        <Trans i18nKey="reports.ledger.lineFigures" count={line.chapters}
                          values={{ chapters: num(line.chapters), books: t('reports.counts.books', { count: line.books.length }) }} components={{ b: bold }} />
                      </Text>
                    </>}>
                    <LanguageLink row={line.row} open={p.open} />
                    <Text style={txt.xs}>{summary}</Text>
                    <RankBar value={line.chapters} max={l.lines[0]!.chapters} />
                  </ListLine>
                </HelpRow>
              );
            })}
          </View>
        ))}
      </Panel>
      {idle.length ? (
        <Panel title={t('reports.ledger.idleTitle')} sub={t('reports.ledger.idleSub')}>
          {idle.map((r) => {
            const { days } = recencyOf(r.report, now);
            return (
              <HelpRow key={r.languageId} of="reports.idle">
                <ListLine
                  right={<Text style={txt.xs}>{r.report.uploads.lastAt ? t('reports.ledger.lastUpload', { date: shortDate(r.report.uploads.lastAt), count: days ?? 0 }) : recencyLabel('not_started')}</Text>}>
                  <LanguageLink row={r} open={p.open} strong={false} />
                </ListLine>
              </HelpRow>
            );
          })}
        </Panel>
      ) : null}
    </>
  );
}

// ---- Pace ------------------------------------------------------------------------------

export function Pace(p: SectionProps) {
  const { rows, now } = p;
  const groups = paceGroups(rows, now);
  const withTarget = groups.flatMap((g) => g.items).filter((i) => i.pace);
  return (
    <>
      <Panel eyebrow={t('reports.pace.againstPlan')} title={t('reports.pace.withTarget', { part: num(withTarget.length), count: rows.length })}
        sub={t('reports.pace.stripSub')}>
        <PaceStrip items={withTarget.map((i) => ({ name: i.row.report.name, gap: i.pace!.gap, band: i.pace!.band }))} />
      </Panel>
      <Stats>
        {/* help-each: each stat counts a different pace */}
        {(['ahead', 'on_pace', 'behind', 'stalled'] as const).map((b) => {
          const count = groups.find((g) => g.band === b)!.items.length;
          const tone: Tone | undefined = count === 0 ? undefined : b === 'stalled' ? 'red' : b === 'behind' ? 'amber' : b === 'ahead' ? 'green' : 'brand';
          return <Stat key={b} label={paceLabel(b)} value={num(count)} sub={paceAdvice(b)} tone={tone} />;
        })}
      </Stats>
      <Panel title={t('reports.pace.byPace')} sub={t('reports.pace.byPaceSub')}>
        {groups.filter((g) => g.items.length).map((g) => (
          <View key={g.band} style={{ gap: space.xs }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingTop: space.sm }}>
              <ToneBadge tone={PACE_TONE[g.band]} label={paceLabel(g.band)} />
              <Text style={txt.xs}>{num(g.items.length)}</Text>
            </View>
            {g.items.map(({ row, pace }) => {
              const target = row.report.target;
              const finish = pace?.projectedFinish && pace.band !== 'complete' ? pace.projectedFinish : null;
              return (
                <HelpRow key={row.languageId} of="reports.paceLine">
                  <ListLine
                    right={pace ? (
                      <>
                        <Text style={[txt.sm, { fontWeight: '700' }]}>{t('reports.pace.points', { gap: signed(pace.gap) })}</Text>
                        <Text style={txt.xs}>
                          {finish ? t('reports.pace.ofPlanFinishes', { actual: pctText(pace.actual), expected: pctText(pace.expected), date: dayYear(finish) })
                            : t('reports.pace.ofPlan', { actual: pctText(pace.actual), expected: pctText(pace.expected) })}
                        </Text>
                      </>
                    ) : <Text style={txt.xs}>{p.maySet(row.languageId) ? t('reports.pace.setTarget') : t('reports.pace.adminSets')}</Text>}>
                    <LanguageLink row={row} open={!pace && p.maySet(row.languageId) ? p.openSettings : p.open} />
                    <Text style={txt.xs}>
                      {row.report.country ? `${countryName(row.report.country)} · ` : ''}
                      {target ? t('reports.pace.targetRange', { scope: scopeLabel(target.scope), from: dayYear(target.startDate), to: dayYear(target.targetDate) }) : paceLabel('no_target')}
                    </Text>
                    {pace ? <Bar value={pace.actual} tick={pace.expected} tone={PACE_TONE[pace.band]}
                      label={t('reports.pace.barNamed', { name: row.report.name, actual: pctText(pace.actual), expected: pctText(pace.expected) })} /> : null}
                  </ListLine>
                </HelpRow>
              );
            })}
          </View>
        ))}
      </Panel>
    </>
  );
}

// ---- Alerts ----------------------------------------------------------------------------

export function Alerts(p: SectionProps) {
  const alerts = alertsFor(p.rows, p.asOf, p.now);
  const count = (l: AlertLevel) => alerts.filter((a) => a.level === l).length;
  return (
    <>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        {(['attention', 'look', 'fyi'] as const).map((l) => <ToneBadge key={l} tone={LEVEL_TONE[l]} label={levelCount(l, count(l))} />)}
      </View>
      {alerts.length === 0 ? <Notice tone="green" title={t('reports.alerts.allClear')} body={t('reports.alerts.allClearBody')} /> : null}
      {alerts.map((a) => {
        // Setting a country or a target is an admin's: the advice says who, and an admin's link opens the settings (finding 77).
        const setting = a.id === 'country' || a.id === 'target';
        const words = alertText(a, p.asOf, p.now, !setting || a.rows.some((r) => p.maySet(r.languageId)));
        return (
          <Panel key={a.id} title={words.title} right={<ToneBadge tone={LEVEL_TONE[a.level]} label={levelLabel(a.level)} />}>
            <Text style={txt.sm}>{words.body}</Text>
            <Text style={txt.sm}><Trans i18nKey="reports.alerts.whatToDo" values={{ action: words.action }} components={{ b: bold }} /></Text>
            {a.rows.map((r) => (
              <HelpRow key={r.languageId} of="reports.alertLanguage">
                <ListLine>
                  <LanguageLink row={r} open={setting && p.maySet(r.languageId) ? p.openSettings : p.open} />
                  <Text style={txt.xs}>
                    {a.id === 'stuck' ? t('reports.alerts.stuckRow', {
                      recordings: t('reports.counts.recordings', { count: r.report.alerts.stuckCards }),
                      passages: t('reports.counts.passages', { count: r.report.alerts.stuckPassages }),
                      date: r.report.alerts.stuckSince ? shortDate(r.report.alerts.stuckSince) : '?'
                    }) : null}
                    {a.id === 'invalid' ? t('reports.counts.recordings', { count: r.report.alerts.invalidCards }) : null}
                    {a.id === 'stale' ? t('reports.alerts.refreshed', { when: dateTime(r.updatedAt) }) : null}
                  </Text>
                </ListLine>
              </HelpRow>
            ))}
          </Panel>
        );
      })}
    </>
  );
}
