// The Reports section's pages (decision 57): app-only, not in the partner
// demo. Ported from the web dashboard (apps/web/src/screens: Overview,
// Activity, Languages, Geography, Reports, Ledger, Pace, Alerts), whose figures
// all come from core `portfolio.ts` summed over the rows the dashboard's
// server returned for this person (decision 44).
import {
  activityWindow, alertsFor, attentionCount, combinedActivity, countryCounts, coverageAverage, defaultLedgerMonth, fieldReport,
  isSettled, languagesCsv, ledgerCsv, ledgerFor, ledgerMonths, logByDay, mergedDaily, milestonesSince, milestoneText, orgTotals, paceGroups,
  paceOf, plural, portfolioCounts, portfolioOf, recencyOf, reportText, SCOPE_LABEL, SETTLE_DAYS, sortLanguages, timeAgo, topLanguages, watchList,
  weeklyCards, type AlertLevel, type LanguageRow, type LanguageSortKey, type Portfolio, type ReportWindow, type SortDir
} from '@langquest-next/core';
import { useState, type ReactNode } from 'react';
import { Platform, Pressable, ScrollView, Share, Text, View } from 'react-native';
import { Chip, ChipRow, IconBtn, LinkBtn, SearchField, SmallBtn, txt } from '../kit';
import { C, space } from '../theme';
import { CompareBars, DayBars, GroupedBars, PaceStrip, RecencyStrip, Sparkline, StackBar, WorkBar } from './charts';
import { countryName } from './countries';
// Imported, not lazy: a phone's bundle is one file anyway, and Metro's split
// bundles on the web failed to load it. Its shapes are parsed on first draw.
import WorldMap from './WorldMap';
import { PACE_ADVICE, PACE_LABEL, PACE_TONE, RECENCY_ADVICE, RECENCY_LABEL, RECENCY_TONE } from './labels';
import {
  AttentionPanel, Bar, canPrint, Columns, CoverageMini, CoverageRows, dateTime, Delta, exportCsv, fileName, Freshness, HeadlineStats, ListLine,
  longDay, monthName, monthShort, Notice, num, Panel, pctText, printPage, ProgressPair, RecencyBadge, shortDate, Stat, Stats, ToneBadge, type Tone
} from './ui';

export type SectionId = 'overview' | 'activity' | 'languages' | 'geography' | 'field' | 'ledger' | 'pace' | 'alerts';

export const SECTIONS: { id: SectionId; label: string; filterCountry: boolean }[] = [
  { id: 'overview', label: 'Overview', filterCountry: true },
  { id: 'activity', label: 'Recent activity', filterCountry: true },
  { id: 'languages', label: 'Languages', filterCountry: true },
  { id: 'geography', label: 'Geography', filterCountry: false },
  { id: 'field', label: 'Field report', filterCountry: true },
  { id: 'ledger', label: 'Monthly ledger', filterCountry: true },
  { id: 'pace', label: 'Pace', filterCountry: true },
  { id: 'alerts', label: 'Alerts', filterCountry: false }
];

/** What every section gets. */
export interface SectionProps {
  rows: LanguageRow[];
  all: LanguageRow[];
  now: number;
  asOf: string;
  orgName: string;
  /** Open a language's page. */
  open: (row: LanguageRow) => void;
  /** Switch section, optionally with a country filter. */
  show: (section: SectionId, country?: string) => void;
}

/** A language's name, as a link to its page. */
function LanguageLink(props: { row: LanguageRow; open: (row: LanguageRow) => void; strong?: boolean }) {
  return (
    <Pressable onPress={() => props.open(props.row)} accessibilityRole="link" hitSlop={8} style={({ pressed }) => [{ minHeight: 32, justifyContent: 'center' }, pressed && { opacity: 0.6 }]}>
      <Text style={[txt.sm, { color: C.primary, fontWeight: props.strong === false ? '400' : '700' }]}>{props.row.report.name}</Text>
    </Pressable>
  );
}

/** A thin bar against the longest in a list. */
function RankBar(props: { value: number; max: number }) {
  return <Bar value={(100 * props.value) / Math.max(1, props.max)} label="" height={6} />;
}

// ---- Overview ---------------------------------------------------------------------

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
      <Panel>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: space.md }}>
          <View>
            <Text style={txt.label}>Recordings on the server</Text>
            <Text style={{ fontSize: 40, fontWeight: '800', color: C.dark }}>{num(totalCards)}</Text>
            <Text style={txt.smMuted}>Across {plural(rows.length, 'language')} · {num(recent)} in the last four weeks</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Sparkline values={cumulative} label="Recordings on the server, week by week" />
            <Text style={txt.xs}>Cumulative, last {weeks.length} weeks</Text>
          </View>
        </View>
      </Panel>
      <HeadlineStats languages={totals.languages} total={totals.total} recorded={totals.recorded} done={totals.done} />
      <Columns>
        <Panel title="Scripture coverage" eyebrow="Average across languages">
          <CoverageRows recorded={coverageAverage(rows, 'recorded')} done={coverageAverage(rows, 'done')} />
        </Panel>
        <Panel title="Who is uploading" eyebrow="Portfolio" right={<LinkBtn label="Languages ›" onPress={() => p.show('languages')} />}>
          <StackBar parts={[
            { key: 'active', label: 'Active (last 14 days)', value: portfolio.active, tone: 'green' },
            { key: 'quiet', label: 'Quiet (14–44 days)', value: portfolio.quiet, tone: 'amber' },
            { key: 'inactive', label: 'Inactive (45+ days)', value: portfolio.inactive, tone: 'gray' },
            { key: 'not_started', label: 'No uploads yet', value: portfolio.not_started, tone: 'brand' }
          ]} />
        </Panel>
      </Columns>
      <AttentionPanel attention={totals} />
      <Columns>
        <Panel title="Last 48 hours" eyebrow="Recent activity" right={<LinkBtn label="Recent activity ›" onPress={() => p.show('activity')} />}>
          {lastDays.length === 0 ? <Text style={txt.smMuted}>No new audio in the last two days.</Text> : (
            lastDays.flatMap((d) => d.entries).slice(0, 6).map((e) => (
              <ListLine key={`${e.row.languageId}-${e.day}-${e.unitId}`} label={`${e.row.report.name}, ${e.label}: ${e.cards} recordings, ${shortDate(e.day)}`}
                right={<><Text style={txt.sm}><Text style={{ fontWeight: '700' }}>{num(e.cards)}</Text> rec</Text><Text style={txt.xs}>{shortDate(e.day)}</Text></>}>
                <Text style={txt.sm}><Text style={{ fontWeight: '700' }}>{e.row.report.name}</Text><Text style={{ color: C.muted }}> / {e.label}</Text></Text>
              </ListLine>
            ))
          )}
        </Panel>
        <Panel title="Milestones" eyebrow="Last 30 days">
          {milestones.length === 0 ? <Text style={txt.smMuted}>No coverage milestones in the last 30 days.</Text> : (
            milestones.slice(0, 6).map((m) => (
              <ListLine key={`${m.row.languageId}-${m.scope}-${m.threshold}`}
                right={<><ToneBadge tone={m.threshold === 100 ? 'green' : 'brand'} label={`${m.threshold}%`} /><Text style={txt.xs}>{shortDate(m.at.slice(0, 10))}</Text></>}>
                <Text style={txt.sm}>{milestoneText(m)}</Text>
              </ListLine>
            ))
          )}
        </Panel>
      </Columns>
      <Columns>
        <Panel title="Where passages stand" sub="Every passage in every language, counted once.">
          <WorkBar work={totals.work} />
        </Panel>
        <Panel title="Languages by country" eyebrow="Geography" right={<LinkBtn label="Map ›" onPress={() => p.show('geography')} />}>
          {countries.length === 0 ? <Text style={txt.smMuted}>No language has a country yet. Set one on each language's page.</Text> : (
            <WorldMap values={countries.map((c) => ({ country: c.country!, value: c.languages }))} unit="languages" compact />
          )}
          {countries.length ? <Text style={txt.xs}>{countries.map((c) => `${countryName(c.country)} ${c.languages}`).join(' · ')}</Text> : null}
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
  const maxTop = Math.max(1, ...top.map((t) => t.cards));
  const today = new Date(now).toISOString().slice(0, 10);
  return (
    <>
      <ChipRow>
        {([7, 14] as const).map((d) => <Chip key={d} label={`Last ${d} days`} on={days === d} onPress={() => p.setDays(d)} />)}
      </ChipRow>
      <Panel>
        <Text style={txt.label}>Recordings uploaded · last {days} days</Text>
        <Text style={{ fontSize: 40, fontWeight: '800', color: C.dark }}>{num(w.cards)}</Text>
        <Delta now={w.cards} before={w.previousCards} />
      </Panel>
      <Stats>
        <Stat label="Passages with new audio" value={num(w.passages)} />
        <Stat label="Languages uploading" value={num(w.languages)} sub={`of ${num(rows.length)}`} />
        <Stat label="Books touched" value={num(w.books)} />
        <Stat label="Recordings on the server" value={num(rows.reduce((n, r) => n + r.report.uploads.cards, 0))} sub="all time" />
      </Stats>
      <Panel title="Recordings per day" sub={`Each day of the last ${days} beside the same day of the ${days} before.`}>
        <CompareBars unit="recordings" current={w.daily.map((d) => ({ day: d.day, value: d.cards }))} previous={w.previousDaily.map((d) => ({ day: d.day, value: d.cards }))} />
      </Panel>
      <Columns min={420}>
        <View style={{ gap: space.lg }}>
          {log.length === 0 ? <Panel><Text style={txt.smMuted}>No new audio reached the server in the last {days} days.</Text></Panel> : log.map((d) => (
            <Panel key={d.day} {...(d.day === today ? { eyebrow: 'Today' } : {})} title={longDay(d.day)}
              sub={`${num(d.passages)} passages · ${num(d.languages)} languages · ${num(d.cards)} recordings`}>
              {d.entries.map((e) => (
                <ListLine key={`${e.row.languageId}-${e.unitId}`}
                  right={<><Text style={txt.sm}><Text style={{ fontWeight: '700' }}>{num(e.cards)}</Text> rec</Text><Text style={txt.xs}>{e.verses ? `${num(e.verses)} verses` : '—'}</Text></>}>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: space.xs }}>
                    <Text style={txt.xs}>{e.at.slice(11, 16)} UTC</Text>
                    <LanguageLink row={e.row} open={p.open} />
                    <Text style={txt.smMuted}>/ {e.label}</Text>
                  </View>
                  <Text style={txt.xs}>{e.row.report.country ? countryName(e.row.report.country) : 'No country'}</Text>
                </ListLine>
              ))}
            </Panel>
          ))}
        </View>
        <Panel title="Most active" eyebrow={`Last ${days} days`} sub="By recordings uploaded.">
          {top.length === 0 ? <Text style={txt.smMuted}>Nobody uploaded in this window.</Text> : top.map((t, i) => (
            <ListLine key={t.row.languageId} right={<Text style={[txt.sm, { fontWeight: '700' }]}>{num(t.cards)}</Text>}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                <Text style={[txt.xsStrong, { width: 20 }]}>{i + 1}</Text>
                <LanguageLink row={t.row} open={p.open} />
              </View>
              <RankBar value={t.cards} max={maxTop} />
              <Text style={txt.xs}>
                {t.row.report.country ? countryName(t.row.report.country) : 'No country'}{t.row.report.uploads.lastAt ? ` · last ${shortDate(t.row.report.uploads.lastAt.slice(0, 10))}` : ''}
              </Text>
            </ListLine>
          ))}
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
  return (
    <>
      <View style={{ alignSelf: 'flex-start' }}>
        <SmallBtn label="Download CSV" icon="download" onPress={() => exportCsv(fileName(`${p.orgName} languages`), languagesCsv(rows, now))} />
      </View>
      <Panel eyebrow="Upload activity" title={`${num(counts.active)} of ${num(rows.length)} languages uploaded in the last 14 days`}
        sub="Days since each language's last recording reached the server.">
        <RecencyStrip items={rows.map((r) => ({ name: r.report.name, ...recencyOf(r.report, now) }))} />
      </Panel>
      <Panel eyebrow="Watch list" title={watch.length ? `${watch.length} to contact` : 'Nobody to chase'}
        sub={watch.length ? 'Quiet for two to six weeks, the longest first. After 45 days a language reads as inactive.' : 'Every language with uploads sent one in the last two weeks, or has been inactive for longer than six.'}>
        {watch.map((w) => (
          <ListLine key={w.row.languageId} right={<><ToneBadge tone={RECENCY_TONE[w.band]} label={RECENCY_LABEL[w.band]} /><Text style={txt.xs}>inactive in {w.untilInactive}d</Text></>}>
            <LanguageLink row={w.row} open={p.open} />
            <Text style={txt.xs}>{w.days} days since the last upload{w.row.report.country ? ` · ${countryName(w.row.report.country)}` : ''}</Text>
            <Text style={txt.sm}>{RECENCY_ADVICE[w.band]}</Text>
          </ListLine>
        ))}
      </Panel>
      <Panel title="All languages">
        <ChipRow>
          {([['all', `All ${rows.length}`], ['active', `Active ${counts.active}`], ['quiet', `Quiet ${counts.quiet}`], ['inactive', `Inactive ${counts.inactive}`], ['not_started', `No uploads ${counts.not_started}`]] as const)
            .map(([v, label]) => <Chip key={v} label={label} on={status === v} onPress={() => setStatus(v)} />)}
        </ChipRow>
        <LanguageTable rows={shown} now={now} open={p.open} />
      </Panel>
    </>
  );
}

const COLUMNS: { key: LanguageSortKey | null; label: string; firstDir: SortDir; flex: number }[] = [
  { key: 'name', label: 'Language', firstDir: 'asc', flex: 2 },
  { key: 'upload', label: 'Upload status', firstDir: 'asc', flex: 1.5 },
  { key: 'coverage', label: 'Scripture recorded', firstDir: 'desc', flex: 1.6 },
  { key: 'recorded', label: 'Passages', firstDir: 'desc', flex: 1.6 },
  { key: 'cards', label: 'Recordings', firstDir: 'desc', flex: 0.9 },
  { key: null, label: 'Last 8 weeks', firstDir: 'desc', flex: 1.3 },
  { key: 'attention', label: 'To act on', firstDir: 'desc', flex: 0.8 }
];

function LanguageTable(props: { rows: LanguageRow[]; now: number; open: (row: LanguageRow) => void }) {
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<{ key: LanguageSortKey; dir: SortDir }>({ key: 'name', dir: 'asc' });
  const q = search.trim().toLowerCase();
  const filtered = q ? props.rows.filter(({ report: r }) =>
    r.name.toLowerCase().includes(q) || r.code.toLowerCase().includes(q) || countryName(r.country).toLowerCase().includes(q)) : props.rows;
  // "Upload status" sorts by most recent upload first when ascending.
  const rows = sort.key === 'upload' ? sortLanguages(filtered, 'upload', sort.dir === 'asc' ? 'desc' : 'asc') : sortLanguages(filtered, sort.key, sort.dir);
  const cell = (flex: number, children: ReactNode, right = false) => (
    <View style={{ flex, minWidth: 0, paddingHorizontal: space.xs, alignItems: right ? 'flex-end' : 'stretch' }}>{children}</View>
  );
  return (
    <View style={{ gap: space.sm }}>
      <SearchField value={search} onChangeText={setSearch} placeholder="Search language, code or country" />
      <Text style={txt.xs}>{num(rows.length)} of {num(props.rows.length)} shown</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ minWidth: 960, flexGrow: 1 }}>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderColor: C.border }}>
            {COLUMNS.map((c) => {
              const active = c.key !== null && sort.key === c.key;
              if (!c.key) return <View key={c.label} style={{ flex: c.flex, padding: space.xs }}><Text style={txt.xsStrong}>{c.label}</Text></View>;
              return (
                <Pressable key={c.label} onPress={() => setSort(active ? { key: c.key!, dir: sort.dir === 'asc' ? 'desc' : 'asc' } : { key: c.key!, dir: c.firstDir })}
                  accessibilityRole="button" accessibilityLabel={`Sort by ${c.label}${active ? (sort.dir === 'asc' ? ', ascending' : ', descending') : ''}`}
                  style={({ pressed }) => [{ flex: c.flex, minHeight: 48, justifyContent: 'center', padding: space.xs }, pressed && { opacity: 0.6 }]}>
                  <Text style={[txt.xsStrong, active ? { color: C.primary } : null]}>{c.label}{active ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}</Text>
                </Pressable>
              );
            })}
          </View>
          {rows.map((row) => {
            const r = row.report;
            const weeks = weeklyCards(r);
            const attention = attentionCount(r);
            return (
              <View key={`${row.languageId}/${row.languageId}`} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: space.sm, borderBottomWidth: 1, borderColor: C.border }}>
                {cell(2, <><LanguageLink row={row} open={props.open} /><Text style={txt.xs}>{r.code.toUpperCase()} · {r.country ? countryName(r.country) : 'No country'}</Text></>)}
                {cell(1.5, <><View style={{ alignSelf: 'flex-start' }}><RecencyBadge report={r} now={props.now} /></View>
                  <Text style={txt.xs}>{r.uploads.lastAt ? `${shortDate(r.uploads.lastAt.slice(0, 10))} · ${timeAgo(r.uploads.lastAt, props.now)}` : 'Never'}</Text></>)}
                {cell(1.6, <CoverageMini coverage={r.coverage.recorded} name={r.name} />)}
                {cell(1.6, <ProgressPair total={r.progress.total} recorded={r.progress.recorded} done={r.progress.done} />)}
                {cell(0.9, <Text style={[txt.sm, { fontWeight: '700' }]}>{num(r.uploads.cards)}</Text>, true)}
                {cell(1.3, <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
                  <Sparkline values={weeks} label={`${r.name} recordings per week`} />
                  <Text style={txt.xs}><Text style={{ fontWeight: '700', color: C.dark }}>{num(weeks.at(-1) ?? 0)}</Text>/wk</Text>
                </View>)}
                {cell(0.8, attention > 0 ? <View style={{ alignSelf: 'flex-start' }}><ToneBadge tone="amber" label={String(attention)} /></View> : <Text style={txt.xs}>—</Text>)}
              </View>
            );
          })}
        </View>
      </ScrollView>
    </View>
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
  const values = table.filter((t) => t.country).map((t) => ({
    country: t.country!, value: measure === 'languages' ? t.list.length : measure === 'recent' ? t.recent : t.all
  })).filter((v) => v.value > 0);
  const unset = groups.get('')?.length ?? 0;
  const max = Math.max(1, ...table.map((t) => t.list.length));
  return (
    <>
      <ChipRow>
        {([['languages', 'Languages'], ['recent', 'Recordings, last 7 days'], ['all', 'Recordings, all time']] as const)
          .map(([v, label]) => <Chip key={v} label={label} on={measure === v} onPress={() => setMeasure(v)} />)}
      </ChipRow>
      <Panel title={plural(countryCounts(rows).filter((c) => c.country).length, 'country', 'countries')}
        {...(unset ? { sub: `${plural(unset, 'language')} ${unset === 1 ? 'has' : 'have'} no country yet and ${unset === 1 ? 'is' : 'are'} left off the map; set it on each language's page.` } : {})}>
        {values.length === 0 ? <Text style={txt.smMuted}>Nothing to shade yet.</Text> : (
          <WorldMap values={values} unit={measure === 'languages' ? 'languages' : 'recordings'} />
        )}
      </Panel>
      <Panel title="By country">
        {table.map((t) => (
          <ListLine key={t.country ?? 'none'}
            right={<>
              <Text style={txt.sm}><Text style={{ fontWeight: '700' }}>{num(t.active)}</Text> active</Text>
              <Text style={txt.xs}>{num(t.recent)} rec. in 7 days · {num(t.all)} all time · NT {pctText(t.nt)}</Text>
            </>}>
            {t.country ? <LinkBtn label={countryName(t.country)} onPress={() => p.show('languages', t.country!)} style={{ alignSelf: 'flex-start', minHeight: 32 }} />
              : <Text style={txt.smMuted}>No country set</Text>}
            <RankBar value={t.list.length} max={max} />
            <Text style={txt.xs}>{plural(t.list.length, 'language')}: {t.list.map((r) => r.report.name).join(', ')}</Text>
          </ListLine>
        ))}
      </Panel>
    </>
  );
}

// ---- Field report ----------------------------------------------------------------------

export function FieldReport(p: SectionProps) {
  const { rows, now } = p;
  const [period, setPeriod] = useState<ReportWindow>('week');
  const [copied, setCopied] = useState('');
  const fr = fieldReport(rows, period, now);
  const countryCards = new Map<string, number>();
  for (const x of fr.mostRecorded) if (x.row.report.country) countryCards.set(x.row.report.country, (countryCards.get(x.row.report.country) ?? 0) + x.cards);
  const maxCards = Math.max(1, ...fr.mostRecorded.map((x) => x.cards));
  const copy = () => {
    const text = reportText(fr, p.orgName);
    if (Platform.OS === 'web') {
      void navigator.clipboard.writeText(text).then(
        () => setCopied('Copied. Paste it into an email or a message.'), () => setCopied('Could not copy; select the report and copy it instead.'));
    } else {
      void Share.share({ message: text }).catch(() => undefined);
    }
  };
  const H = (props: { children: string }) => <Text style={[txt.h3, { marginTop: space.md }]} accessibilityRole="header">{props.children}</Text>;
  return (
    <>
      <ChipRow>
        {([['week', 'Weekly'], ['month', 'Monthly'], ['ytd', 'Year to date']] as const).map(([v, label]) => <Chip key={v} label={label} on={period === v} onPress={() => setPeriod(v)} />)}
      </ChipRow>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, alignItems: 'center' }}>
        <SmallBtn label={Platform.OS === 'web' ? 'Copy as text' : 'Share as text'} icon="share" onPress={copy} />
        {canPrint ? <SmallBtn label="Print or save as PDF" icon="download" onPress={printPage} /> : null}
        {copied ? <Text style={txt.smMuted} accessibilityLiveRegion="polite">{copied}</Text> : null}
      </View>
      <Panel>
        <Text style={txt.label}>{p.orgName} · Field report</Text>
        <Text style={{ fontSize: 28, fontWeight: '800', color: C.dark }} accessibilityRole="header">{fr.title}</Text>
        <Text style={txt.smMuted}>{shortDate(fr.from)} – {shortDate(fr.to)}, {fr.to.slice(0, 4)} · as of {dateTime(new Date(now).toISOString())}</Text>
        <Text style={txt.body}>
          <Text style={{ fontWeight: '700' }}>{num(fr.cards)} recordings</Text> reached the server from <Text style={{ fontWeight: '700' }}>{plural(fr.languagesRecording, 'language')}</Text>
          {fr.countries ? ` in ${plural(fr.countries, 'country', 'countries')}` : ''}.
          {fr.milestones.length ? <> <Text style={{ fontWeight: '700' }}>{plural(fr.milestones.length, 'milestone')}</Text> crossed the line.</> : null}
        </Text>

        <H>By the numbers</H>
        <Stats>
          <Stat label="Recordings" value={num(fr.cards)} tone="brand" sub={fr.previousCards !== null ? undefined : `since ${shortDate(fr.from)}`} />
          <Stat label="Languages that recorded" value={num(fr.languagesRecording)} sub={`of ${num(fr.languages)}`} />
          <Stat label="New Testament recorded" value={pctText(fr.ntRecorded)} sub="across all languages, by verse" />
          <Stat label="Passages done" value={num(fr.passagesDone)} sub="through review, all time" />
        </Stats>
        {fr.previousCards !== null ? <Delta now={fr.cards} before={fr.previousCards} unit="recordings" /> : null}

        {countryCards.size ? (
          <>
            <H>Where the work happened</H>
            <WorldMap values={[...countryCards].map(([country, value]) => ({ country, value }))} unit="recordings" compact />
          </>
        ) : null}

        <H>Scripture coverage advanced</H>
        {fr.advanced.length === 0 ? <Text style={txt.smMuted}>No language's coverage moved in this period.</Text> : fr.advanced.map((a) => (
          <View key={a.row.languageId} style={{ gap: 4, paddingVertical: space.xs }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.sm }}>
              <Text style={txt.sm}><Text style={{ fontWeight: '700' }}>{a.row.report.name}</Text><Text style={{ color: C.muted }}> {a.row.report.country ? `${countryName(a.row.report.country)} · ` : ''}{SCOPE_LABEL[a.scope]}</Text></Text>
              <Text style={[txt.sm, { fontWeight: '700', color: C.green }]}>+{(Math.round(10 * (a.after - a.before)) / 10).toFixed(1)} points</Text>
            </View>
            <View style={{ flexDirection: 'row', height: 10, borderRadius: 5, overflow: 'hidden', backgroundColor: C.border }}>
              <View style={{ width: `${a.before}%`, backgroundColor: C.primary }} />
              <View style={{ width: `${a.after - a.before}%`, backgroundColor: C.green }} />
            </View>
            <Text style={txt.xs}>{pctText(a.before)} → {pctText(a.after)} of the {SCOPE_LABEL[a.scope]}</Text>
          </View>
        ))}

        <H>Day by day</H>
        {period === 'ytd' ? (
          <GroupedBars labels={combinedActivity(rows).map((w) => w.weekStart)} format={shortDate} title={(d) => `Week of ${shortDate(d)}`} empty="No recordings this year."
            series={[{ key: 'cards', label: 'Recordings per week', color: C.primary, values: combinedActivity(rows).map((w) => (w.weekStart >= fr.from ? w.cards : 0)) }]} />
        ) : (
          <DayBars days={mergedDaily(rows).map((d) => ({ day: d.day, value: d.cards }))} highlightFrom={fr.from}
            label={period === 'week' ? 'The last 7 days' : 'The last 30 days'} unit="recordings" />
        )}

        <H>Languages that recorded most</H>
        {fr.mostRecorded.length === 0 ? <Text style={txt.smMuted}>No recordings in this period.</Text> : fr.mostRecorded.slice(0, 10).map((x, i) => (
          <ListLine key={x.row.languageId} right={<><ToneBadge tone="green" label={`${pctText(x.row.report.coverage.recorded.nt)} NT`} /><Text style={[txt.sm, { fontWeight: '700' }]}>+{num(x.cards)}</Text></>}>
            <Text style={txt.sm}><Text style={{ fontWeight: '700' }}>{i + 1}. {x.row.report.name}</Text><Text style={{ color: C.muted }}> {x.row.report.country ? countryName(x.row.report.country) : ''}</Text></Text>
            <RankBar value={x.cards} max={maxCards} />
          </ListLine>
        ))}
        {fr.mostRecorded.length > 10 ? <Text style={txt.smMuted}>…and {fr.mostRecorded.length - 10} more languages recorded in this period.</Text> : null}

        <H>{`Where all ${num(fr.languages)} languages stand`}</H>
        <Text style={[txt.sm, { fontWeight: '600' }]}>How recently each language sent new recordings</Text>
        <StackBar parts={[
          { key: 'active', label: 'Active', value: fr.portfolio.active, tone: 'green' },
          { key: 'quiet', label: 'Quiet', value: fr.portfolio.quiet, tone: 'amber' },
          { key: 'inactive', label: 'Inactive', value: fr.portfolio.inactive, tone: 'gray' },
          { key: 'not_started', label: 'No uploads yet', value: fr.portfolio.not_started, tone: 'brand' }
        ]} />
        <Text style={[txt.sm, { fontWeight: '600' }]}>What each language is working on</Text>
        <StackBar parts={[
          { key: 'gospels', label: 'Gospels', value: fr.workingOn.gospels, tone: 'brand' },
          { key: 'nt', label: 'New Testament', value: fr.workingOn.nt, tone: 'green' },
          { key: 'ot', label: 'Old Testament', value: fr.workingOn.ot, tone: 'amber' },
          { key: 'bible', label: 'Whole Bible', value: fr.workingOn.bible, tone: 'red' },
          { key: 'none', label: 'Not yet recording', value: fr.workingOn.none, tone: 'gray' }
        ]} />

        <H>Milestones</H>
        {fr.milestones.length === 0 ? <Text style={txt.smMuted}>No coverage milestones in this period.</Text> : fr.milestones.map((m) => (
          <ListLine key={`${m.row.languageId}-${m.scope}-${m.threshold}`} right={<Text style={txt.xs}>{shortDate(m.at.slice(0, 10))}</Text>}>
            <Text style={txt.sm}>{milestoneText(m)}</Text>
          </ListLine>
        ))}

        <H>Where recording paused or resumed</H>
        {fr.wentQuiet.length === 0 && fr.resumed.length === 0 ? <Text style={txt.smMuted}>No language went quiet or came back in this period.</Text> : (
          <>
            {fr.wentQuiet.map((r) => (
              <ListLine key={`q-${r.languageId}`} right={<ToneBadge tone="amber" label="Quiet" />}>
                <Text style={txt.sm}><Text style={{ fontWeight: '700' }}>{r.report.name}</Text> went quiet: no new recordings in 14+ days.</Text>
              </ListLine>
            ))}
            {fr.resumed.map((r) => (
              <ListLine key={`r-${r.languageId}`} right={<ToneBadge tone="green" label="Resumed" />}>
                <Text style={txt.sm}><Text style={{ fontWeight: '700' }}>{r.report.name}</Text> is recording again after two quiet weeks or more.</Text>
              </ListLine>
            ))}
          </>
        )}
      </Panel>
    </>
  );
}

// ---- Monthly ledger ------------------------------------------------------------------

export function Ledger(p: SectionProps) {
  const { rows, now } = p;
  const months = ledgerMonths(rows);
  const [chosen, setChosen] = useState<string | null>(null);
  const month = chosen && months.includes(chosen) ? chosen : defaultLedgerMonth(months, now);
  if (!month) return <Notice tone="gray" title="No months yet" body="The ledger fills in once audio reaches the server." />;
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
  return (
    <>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm }}>
        <IconBtn name="left" label="Previous month" disabled={i <= 0} onPress={() => setChosen(months[i - 1]!)} />
        <Text style={[txt.h3, { minWidth: 160, textAlign: 'center' }]} accessibilityLiveRegion="polite">{monthName(month)}{settled ? '' : ' (still moving)'}</Text>
        <IconBtn name="right" label="Next month" disabled={i >= months.length - 1} onPress={() => setChosen(months[i + 1]!)} />
        <SmallBtn label={`Export ${monthShort(month)} ledger (CSV)`} icon="download"
          onPress={() => exportCsv(`${p.orgName} ledger ${month}.csv`.replace(/[\\/:*?"<>|]+/g, ' '), ledgerCsv(rows, month, countryName))} />
      </View>
      {!settled ? (
        <Notice tone="amber" title={`${monthName(month)} is still moving`}
          body={`Devices that were offline keep delivering this month's work for a few days after it ends, so these figures settle ${SETTLE_DAYS} days into the next month. Use a settled month for invoices.`} />
      ) : null}
      <Panel eyebrow="Monthly ledger" title={monthName(month)}>
        <Columns>
          <Stats>
            <Stat label="New chapters with audio" value={num(l.chapters)} tone="brand" />
            <Stat label="Books with new audio" value={num(l.books)} />
            <Stat label="Languages" value={num(l.languages)} sub={`of ${num(rows.length)}`} />
          </Stats>
          <GroupedBars labels={months} format={monthShort} title={monthName} empty="No chapters yet." table={false}
            series={[
              { key: 'other', label: 'Other months', color: C.border, values: byMonth.map((v, k) => (k === i ? 0 : v)) },
              { key: 'this', label: monthName(month), color: C.primary, values: byMonth.map((v, k) => (k === i ? v : 0)) }
            ]} />
        </Columns>
        {prev ? <Delta now={l.chapters} before={prev.chapters} unit="chapters" /> : null}
        <Text style={txt.xs}>A chapter counts once, in the month its first recording reached the server.</Text>
      </Panel>
      <Panel title="Pace today" right={<LinkBtn label="Pace ›" onPress={() => p.show('pace')} />}
        {...(noTarget ? { sub: `${plural(noTarget, 'language')} ${noTarget === 1 ? 'has' : 'have'} no target and ${noTarget === 1 ? 'is' : 'are'} left out.` } : {})}>
        <StackBar empty="No language has a target yet." parts={pace.map((g) => ({ key: g.band, label: PACE_LABEL[g.band], value: g.items.length, tone: PACE_TONE[g.band] }))} />
      </Panel>
      <Panel title="Where the work happened" sub={l.lines.length ? `${plural(l.languages, 'language')} got new chapters in ${monthName(month)}.` : `No new chapters in ${monthName(month)}.`}>
        {[...countries].sort((a, b) => b[1].reduce((n, x) => n + x.chapters, 0) - a[1].reduce((n, x) => n + x.chapters, 0)).map(([country, lines]) => (
          <View key={country || 'none'} style={{ gap: space.xs }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.sm, paddingTop: space.sm }}>
              <Text style={[txt.sm, { fontWeight: '700' }]}>{countryName(country || null)}</Text>
              <Text style={txt.xs}>{plural(lines.length, 'language')} · {num(lines.reduce((n, x) => n + x.chapters, 0))} chapters</Text>
            </View>
            {lines.map((line) => {
              const lp = paceOf(line.row.report, now);
              const top = [...line.books].sort((a, b) => b.chapters - a.chapters);
              const summary = top.slice(0, 3).map((b) => `${b.label} ${b.chapters}`).join(' · ') + (top.length > 3 ? ` +${top.length - 3}` : '');
              return (
                <ListLine key={line.row.languageId}
                  right={<>
                    {lp ? <ToneBadge tone={PACE_TONE[lp.band]} label={`${PACE_LABEL[lp.band]} ${lp.gap >= 0 ? '+' : ''}${lp.gap} pts`} /> : null}
                    <Text style={txt.sm}><Text style={{ fontWeight: '700' }}>{num(line.chapters)}</Text> chapters · {plural(line.books.length, 'book')}</Text>
                  </>}>
                  <LanguageLink row={line.row} open={p.open} />
                  <Text style={txt.xs}>{summary}</Text>
                  <RankBar value={line.chapters} max={l.lines[0]!.chapters} />
                </ListLine>
              );
            })}
          </View>
        ))}
      </Panel>
      {idle.length ? (
        <Panel title="No new chapters this month" sub="Languages with nothing counted in this month, and when they last sent audio.">
          {idle.map((r) => {
            const { days } = recencyOf(r.report, now);
            return (
              <ListLine key={r.languageId} right={<Text style={txt.xs}>{r.report.uploads.lastAt ? `Last upload ${shortDate(r.report.uploads.lastAt.slice(0, 10))}, ${days}d ago` : 'No uploads yet'}</Text>}>
                <LanguageLink row={r} open={p.open} strong={false} />
              </ListLine>
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
      <Panel eyebrow="Against plan today" title={`${num(withTarget.length)} of ${num(rows.length)} languages have a target`}
        sub="Each dot is a language's gap to where a straight line from its start to its target date puts it today. The shaded band is on pace.">
        <PaceStrip items={withTarget.map((i) => ({ name: i.row.report.name, gap: i.pace!.gap, band: i.pace!.band }))} />
      </Panel>
      <Stats>
        {(['ahead', 'on_pace', 'behind', 'stalled'] as const).map((b) => {
          const count = groups.find((g) => g.band === b)!.items.length;
          const tone: Tone | undefined = count === 0 ? undefined : b === 'stalled' ? 'red' : b === 'behind' ? 'amber' : b === 'ahead' ? 'green' : 'brand';
          return <Stat key={b} label={PACE_LABEL[b]} value={num(count)} sub={PACE_ADVICE[b]} tone={tone} />;
        })}
      </Stats>
      <Panel title="By pace" sub="Bars show recorded coverage of each target; the tick is where the plan expects the language today.">
        {groups.filter((g) => g.items.length).map((g) => (
          <View key={g.band} style={{ gap: space.xs }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingTop: space.sm }}>
              <ToneBadge tone={PACE_TONE[g.band]} label={PACE_LABEL[g.band]} />
              <Text style={txt.xs}>{g.items.length}</Text>
            </View>
            {g.items.map(({ row, pace }) => {
              const t = row.report.target;
              return (
                <ListLine key={row.languageId}
                  right={pace ? (
                    <>
                      <Text style={[txt.sm, { fontWeight: '700' }]}>{pace.gap >= 0 ? '+' : ''}{pace.gap} pts</Text>
                      <Text style={txt.xs}>{pctText(pace.actual)} of plan's {pctText(pace.expected)}{pace.projectedFinish && pace.band !== 'complete' ? ` · finishes ${shortDate(pace.projectedFinish)} ${pace.projectedFinish.slice(0, 4)}` : ''}</Text>
                    </>
                  ) : <Text style={txt.xs}>Set a target on the language page.</Text>}>
                  <LanguageLink row={row} open={p.open} />
                  <Text style={txt.xs}>
                    {row.report.country ? `${countryName(row.report.country)} · ` : ''}
                    {t ? `${SCOPE_LABEL[t.scope]} · ${shortDate(t.startDate)} ${t.startDate.slice(0, 4)} – ${shortDate(t.targetDate)} ${t.targetDate.slice(0, 4)}` : 'No target set'}
                  </Text>
                  {pace ? <Bar value={pace.actual} tick={pace.expected} tone={PACE_TONE[pace.band]} label={`${row.report.name}: ${pace.actual}% recorded, plan ${pace.expected}%`} /> : null}
                </ListLine>
              );
            })}
          </View>
        ))}
      </Panel>
    </>
  );
}

// ---- Alerts ----------------------------------------------------------------------------

const LEVEL: Record<AlertLevel, { label: string; tone: Tone }> = {
  attention: { label: 'Needs attention', tone: 'red' },
  look: { label: 'Worth a look', tone: 'amber' },
  fyi: { label: 'For your information', tone: 'brand' }
};

/** Alerts that need someone, for the section switcher's count. */
export function openAlerts(rows: LanguageRow[], asOf: string, now: number): number {
  return alertsFor(rows, asOf, now).filter((a) => a.level !== 'fyi').length;
}

export function Alerts(p: SectionProps) {
  const alerts = alertsFor(p.rows, p.asOf, p.now);
  const count = (l: AlertLevel) => alerts.filter((a) => a.level === l).length;
  return (
    <>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        {(['attention', 'look', 'fyi'] as const).map((l) => <ToneBadge key={l} tone={LEVEL[l].tone} label={`${count(l)} ${LEVEL[l].label.toLowerCase()}`} />)}
      </View>
      {alerts.length === 0 ? <Notice tone="green" title="All clear" body="No stuck audio, integrity problems or stale figures." /> : null}
      {alerts.map((a) => (
        <Panel key={a.id} title={a.title} right={<ToneBadge tone={LEVEL[a.level].tone} label={LEVEL[a.level].label} />}>
          <Text style={txt.sm}>{a.body}</Text>
          <Text style={txt.sm}><Text style={{ fontWeight: '700' }}>What to do:</Text> {a.action}</Text>
          {a.rows.map((r) => (
            <ListLine key={r.languageId}>
              <LanguageLink row={r} open={p.open} />
              <Text style={txt.xs}>
                {a.id === 'stuck' ? `${num(r.report.alerts.stuckCards)} recordings in ${num(r.report.alerts.stuckPassages)} passages, oldest from ${r.report.alerts.stuckSince ? shortDate(r.report.alerts.stuckSince.slice(0, 10)) : '?'}` : null}
                {a.id === 'invalid' ? `${num(r.report.alerts.invalidCards)} recordings` : null}
                {a.id === 'stale' ? `refreshed ${dateTime(r.updatedAt)}` : null}
              </Text>
            </ListLine>
          ))}
        </Panel>
      ))}
    </>
  );
}
