// The Reports section (decision 57): app-only, not in the partner demo.
// Shown on tablets and the web (768 and wider) to people with view_status:
// the organization's figures across every language, from the dashboard's
// server (decision 44), which a phone could not total itself (decision 37).
// Ports the web dashboard's shell and language page (apps/web/src/screens:
// shell, Language); the sections and their parts are in src/reports/.
import { appendConfirmed, ensureDeviceId, NotSavedError, SupabaseTransport } from '@langquest-next/client';
import {
  dayPercents, laneCsv, milestoneText, paceOf, percent, privilegesFor, recencyOf, SCOPE_LABEL, TARGET_SCOPES,
  type LaneReport, type LaneRow, type TargetScope
} from '@langquest-next/core';
import * as Crypto from 'expo-crypto';
import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { Ctx } from '../ctx';
import { contractsFor } from '../screenContracts';
import { Chip, ChipRow, EmptyState, Field, Header, IconBtn, Screen, SearchField, Sheet, SmallBtn, txt } from '../kit';
import { getStore } from '../store';
import { supabase } from '../supabase';
import { C, measure, space } from '../theme';
import { ActivityChart, DayBars, ProgressLine, WorkBar } from '../reports/charts';
import { COUNTRY_CODES, countryName } from '../reports/countries';
import { useReports } from '../reports/data';
import { PACE_ADVICE, PACE_LABEL, PACE_TONE, RECENCY_ADVICE, RECENCY_LABEL, RECENCY_TONE } from '../reports/labels';
import { Activity, Alerts, FieldReport, Geography, Languages, Ledger, openAlerts, Overview, Pace, SECTIONS, type SectionId, type SectionProps } from '../reports/sections';
import {
  AttentionPanel, Bar, canPrint, Columns, CoverageRows, exportCsv, fileName, Freshness, HeadlineStats, ListLine, NoReports, Notice, num, Panel,
  pctText, printPage, ProgressPair, shortDate, Stat, Stats, ToneBadge, type Tone
} from '../reports/ui';

const COLUMN = measure.report;

export function ReportsHome(ctx: Ctx) {
  const orgId = ctx.partition.orgId;
  const orgName = ctx.org.state?.org?.value.name ?? '';
  const reports = useReports(orgId);
  const [section, setSection] = useState<SectionId>(SECTIONS.some((s) => s.id === ctx.params['section']) ? ctx.params['section'] as SectionId : 'overview');
  const [country, setCountry] = useState(ctx.params['country'] ?? '');
  const [days, setDays] = useState<7 | 14>(7);
  const now = Date.now();
  const spec = SECTIONS.find((s) => s.id === section)!;
  const all = reports.status === 'ready' ? reports.rows : [];
  const rows = spec.filterCountry && country ? all.filter((r) => (r.report.country ?? '') === country) : all;
  const countries = useMemo(() => [...new Set(all.map((r) => r.report.country ?? ''))]
    .sort((a, b) => countryName(a || null).localeCompare(countryName(b || null))), [all]);
  const alerts = reports.status === 'ready' ? openAlerts(all, reports.asOf, now) : 0;
  const props: SectionProps = {
    rows, all, now, orgName, asOf: reports.status === 'ready' ? reports.asOf : new Date(now).toISOString(),
    open: (row) => ctx.go('reports_language', { partitionId: row.partitionId, laneId: row.laneId }),
    show: (to, c) => { setSection(to); if (c !== undefined) setCountry(c); }
  };
  const header = (
    <Header title={spec.label} sub={[orgName, 'Reports'].filter(Boolean).join(' · ')} columnWidth={COLUMN}
      action={<IconBtn name="restart" label="Catch up with the server" onPress={reports.refresh} disabled={reports.status === 'ready' && reports.refreshing} />} />
  );
  return (
    <Screen header={header} columnWidth={COLUMN}>
      <ChipRow>
        {SECTIONS.map((s) => (
          <Chip key={s.id} label={s.label} on={s.id === section} onPress={() => setSection(s.id)}
            {...(s.id === 'alerts' && alerts > 0 ? { count: alerts, accessibilityLabel: `Alerts, ${alerts} need someone` } : {})} />
        ))}
      </ChipRow>
      {spec.filterCountry && countries.length > 1 ? (
        <ChipRow>
          <Chip label="All countries" icon="globe" on={!country} onPress={() => setCountry('')} />
          {countries.map((c) => <Chip key={c || 'none'} label={countryName(c || null)} on={country === c} onPress={() => setCountry(c)} />)}
        </ChipRow>
      ) : null}
      {reports.status === 'loading' ? <EmptyState icon="progress" title="Loading reports…" /> : null}
      {reports.status === 'error' ? (
        <Notice tone={reports.offline ? 'amber' : 'red'} title={reports.offline ? 'You are offline' : 'The reports could not be read'} body={reports.message}>
          <View style={{ alignSelf: 'flex-start', marginTop: space.sm }}><SmallBtn label="Try again" icon="restart" onPress={reports.reload} /></View>
        </Notice>
      ) : null}
      {reports.status === 'ready' && all.length === 0 ? <NoReports what="languages" /> : null}
      {all.length > 0 ? (
        section === 'overview' ? <Overview {...props} />
          : section === 'activity' ? <Activity {...props} days={days} setDays={setDays} />
          : section === 'languages' ? <Languages {...props} />
          : section === 'geography' ? <Geography {...props} />
          : section === 'field' ? <FieldReport {...props} />
          : section === 'ledger' ? <Ledger {...props} />
          : section === 'pace' ? <Pace {...props} />
          : <Alerts {...props} />
      ) : null}
    </Screen>
  );
}

/** One language's report: coverage, uploads, pace, its flow, books, and its settings for admins. */
export function ReportsLanguage(ctx: Ctx) {
  const orgId = ctx.partition.orgId;
  const orgName = ctx.org.state?.org?.value.name ?? '';
  const reports = useReports(orgId);
  const partitionId = ctx.params['partitionId'] ?? '';
  const laneId = ctx.params['laneId'] ?? '';
  const row = reports.status === 'ready' ? reports.rows.find((r) => r.partitionId === partitionId && r.laneId === laneId) : undefined;
  const title = row?.report.name ?? 'Language';
  const header = (
    <Header title={title} sub={orgName} columnWidth={COLUMN} onBack={ctx.back} crumbs={[{ label: 'Reports', onPress: ctx.back }]}
      action={row ? (
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <IconBtn name="download" label="Download the books as CSV" onPress={() => exportCsv(fileName(`${row.report.name} books`), laneCsv(row.report))} />
          {canPrint ? <IconBtn name="share" label="Print or save as PDF" onPress={printPage} /> : null}
        </View>
      ) : undefined} />
  );
  return (
    <Screen header={header} columnWidth={COLUMN}>
      {reports.status === 'loading' ? <EmptyState icon="progress" title="Loading the report…" /> : null}
      {reports.status === 'error' ? <Notice tone={reports.offline ? 'amber' : 'red'} title={reports.offline ? 'You are offline' : 'The report could not be read'} body={reports.message} /> : null}
      {reports.status === 'ready' && !row ? (
        reports.rows.length === 0 ? <NoReports what="report for this language" /> : (
          <Notice tone="gray" title="This language has no report you can see"
            body="Your role may not include this language, or it was added after the reports loaded (catch up from Reports to check)." />
        )
      ) : null}
      {row ? <LanguageBody ctx={ctx} row={row} refresh={reports.refresh} /> : null}
    </Screen>
  );
}

function LanguageBody(props: { ctx: Ctx; row: LaneRow; refresh: () => void }) {
  const { ctx, row } = props;
  const r = row.report;
  const now = Date.now();
  const recency = recencyOf(r, now);
  const pace = paceOf(r, now);
  const sevenAgo = new Date(now - 6 * 86_400_000).toISOString().slice(0, 10);
  const org = ctx.org.state;
  const mayEdit = !!org && privilegesFor(org, ctx.session.actorId, { partitionId: row.partitionId, laneId: row.laneId }).has('manage_structure');
  return (
    <>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, alignItems: 'center' }}>
        <ToneBadge tone="brand" label={r.languoidId.toUpperCase()} />
        <Text style={txt.sm}>{r.country ? countryName(r.country) : 'No country set'}</Text>
        <Text style={txt.sm}>· Review flow: <Text style={{ fontWeight: '700' }}>{r.flowName}</Text></Text>
        {r.bottleneck ? <Text style={txt.sm}>· Bottleneck: <Text style={{ fontWeight: '700' }}>{r.bottleneck}</Text></Text> : null}
        <ToneBadge tone={RECENCY_TONE[recency.band]} label={RECENCY_LABEL[recency.band]} />
        {pace ? <ToneBadge tone={PACE_TONE[pace.band]} label={PACE_LABEL[pace.band]} /> : null}
      </View>
      <Freshness updatedAt={row.updatedAt} now={now} />
      <HeadlineStats total={r.progress.total} recorded={r.progress.recorded} done={r.progress.done} />
      <Columns>
        <Panel title="Scripture coverage">
          <CoverageRows recorded={r.coverage.recorded} done={r.coverage.done} />
          {r.milestones.length ? (
            <>
              <Text style={txt.h3}>Milestones</Text>
              {[...r.milestones].reverse().map((m) => (
                <ListLine key={`${m.scope}-${m.threshold}`} right={<Text style={txt.xs}>{shortDate(m.at.slice(0, 10))} {m.at.slice(0, 4)}</Text>}>
                  <Text style={txt.sm}>{milestoneText({ ...m, row })}</Text>
                </ListLine>
              ))}
            </>
          ) : null}
        </Panel>
        <Panel title="Uploads" sub={RECENCY_ADVICE[recency.band]}>
          <Stats>
            <Stat label="Recordings on the server" value={num(r.uploads.cards)} />
            <Stat label="Chapters with audio" value={num(r.uploads.chapters)} />
            <Stat label="Since the last upload" value={recency.days === null ? '—' : `${recency.days}d`}
              sub={r.uploads.lastAt ? `${shortDate(r.uploads.lastAt.slice(0, 10))} ${r.uploads.lastAt.slice(0, 4)}` : undefined} />
          </Stats>
          {r.alerts.stuckCards > 0 ? (
            <Notice tone="red" title={`${num(r.alerts.stuckCards)} recordings stuck on phones`}
              body={`Recorded more than two weeks ago (the oldest ${r.alerts.stuckSince ? shortDate(r.alerts.stuckSince.slice(0, 10)) : ''}) and not yet on the server. Until they upload, the phone holds the only copy.`} />
          ) : null}
          <DayBars days={r.uploads.daily.map((d) => ({ day: d.day, value: d.cards }))} highlightFrom={sevenAgo} label="The last 7 days" unit="uploads" />
        </Panel>
      </Columns>
      {r.target && pace ? (
        <Panel title="Pace" right={<ToneBadge tone={PACE_TONE[pace.band]} label={`${PACE_LABEL[pace.band]} ${pace.gap >= 0 ? '+' : ''}${pace.gap} pts`} />}
          sub={`${SCOPE_LABEL[r.target.scope]} from ${shortDate(r.target.startDate)} ${r.target.startDate.slice(0, 4)} to ${shortDate(r.target.targetDate)} ${r.target.targetDate.slice(0, 4)}. ${PACE_ADVICE[pace.band]}`}>
          <Bar value={pace.actual} tick={pace.expected} tone={PACE_TONE[pace.band]} label={`${pace.actual}% recorded, plan ${pace.expected}%`} />
          <Text style={txt.sm}>
            <Text style={{ fontWeight: '700' }}>{pctText(pace.actual)}</Text> of the {SCOPE_LABEL[r.target.scope]} recorded; a straight line to the target puts it at {pctText(pace.expected)} today (the tick).
            {pace.projectedFinish && pace.band !== 'complete' ? ` At the last eight weeks' rate it finishes around ${shortDate(pace.projectedFinish)} ${pace.projectedFinish.slice(0, 4)}.` : ''}
            {!pace.projectedFinish ? ' No progress in the last eight weeks.' : ''}
          </Text>
        </Panel>
      ) : null}
      <AttentionPanel attention={r.attention} />
      <Columns>
        <FlowPanel report={r} />
        <Panel title="Where passages stand" sub="Each passage counted once."><WorkBar work={r.work} /></Panel>
      </Columns>
      <Columns>
        <Panel title="Activity" sub="By week."><ActivityChart weeks={r.activity.slice(-12)} withCards /></Panel>
        <Panel title="Progress over time" sub="Share of passages recorded and done, one point per day for the last 90 days.">
          <ProgressLine points={dayPercents(r)} />
        </Panel>
      </Columns>
      <Panel title="Books">
        {r.books.length === 0 ? <Text style={txt.smMuted}>No passages yet.</Text> : r.books.map((b) => (
          <ListLine key={b.bookId ?? b.label} right={<Text style={txt.xs}>{num(b.total)} passages</Text>}>
            <Text style={[txt.sm, { fontWeight: '700' }]}>{b.label}</Text>
            <ProgressPair total={b.total} recorded={b.recorded} done={b.done} />
          </ListLine>
        ))}
      </Panel>
      {mayEdit ? <SettingsPanel ctx={ctx} row={row} refresh={props.refresh} /> : null}
    </>
  );
}

function FlowPanel(props: { report: LaneReport }) {
  const r = props.report;
  if (r.stages.length === 0) {
    return <Panel title="Review flow"><Text style={txt.smMuted}>This language's flow has no review steps, so a recorded passage is done.</Text></Panel>;
  }
  return (
    <Panel title="Review flow" sub="How many recorded passages have cleared each step, and how many wait at it.">
      {r.stages.map((s, i) => {
        const cleared = r.progress.steps[i]?.cleared ?? 0;
        return (
          <View key={s.stepId} style={{ gap: 4 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' }}>
              <Text style={[txt.sm, { fontWeight: '700' }]}>{s.name}</Text>
              {s.checkpoint ? <ToneBadge tone="amber" label="Checkpoint" /> : null}
              <Text style={[txt.xs, { marginLeft: 'auto' }]}>{num(cleared)} cleared{s.passages > 0 ? ` · ${num(s.passages)} waiting` : ''}</Text>
            </View>
            <Bar value={percent(cleared, r.progress.total)} tone="green" label={`${s.name}: ${percent(cleared, r.progress.total)}% cleared`} />
          </View>
        );
      })}
    </Panel>
  );
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const validDay = (d: string) => DAY.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`));

/**
 * Country and target, for people who manage the organization's structure
 * (decision 41). Saved online straight to the server, which checks again:
 * the language's partition need not be on this device.
 */
function SettingsPanel(props: { ctx: Ctx; row: LaneRow; refresh: () => void }) {
  const { ctx, row } = props;
  const r = row.report;
  const now = Date.now();
  const [country, setCountry] = useState(r.country ?? '');
  const [picking, setPicking] = useState(false);
  const [search, setSearch] = useState('');
  const [scope, setScope] = useState<TargetScope>(r.target?.scope ?? 'nt');
  const [start, setStart] = useState(r.target?.startDate ?? new Date(now).toISOString().slice(0, 10));
  const [end, setEnd] = useState(r.target?.targetDate ?? new Date(now + 548 * 86_400_000).toISOString().slice(0, 10));
  const [busy, setBusy] = useState<'' | 'country' | 'target'>('');
  const [status, setStatus] = useState<{ tone: Tone; text: string } | null>(null);
  const datesOk = validDay(start) && validDay(end) && end > start;
  const q = search.trim().toLowerCase();
  const choices = q ? COUNTRY_CODES.filter((c) => countryName(c).toLowerCase().includes(q) || c.toLowerCase() === q) : COUNTRY_CODES;

  async function save(what: 'country' | 'target') {
    setBusy(what);
    setStatus(null);
    try {
      const deviceId = await ensureDeviceId(await getStore(), () => Crypto.randomUUID());
      const who = { orgId: row.orgId, partitionId: row.partitionId, actorId: ctx.session.actorId, deviceId, transport: new SupabaseTransport(supabase) };
      if (what === 'country') await appendConfirmed(who, 'v1.LaneCountrySet', { laneId: r.laneId, country });
      else await appendConfirmed(who, 'v1.LaneTargetSet', { laneId: r.laneId, scope, startDate: start, targetDate: end });
      setStatus({ tone: 'green', text: 'Saved.' });
      props.refresh();
    } catch (e) {
      setStatus({ tone: e instanceof NotSavedError && e.reason === 'offline' ? 'amber' : 'red', text: e instanceof Error ? e.message : 'Not saved.' });
    } finally {
      setBusy('');
    }
  }

  return (
    <Panel title="Language settings" sub="Where this language's work happens, and what it aims to record by when. Only people who manage the organization's structure see this.">
      <Text style={txt.xsStrong}>Country</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, alignItems: 'center' }}>
        <Pressable onPress={() => setPicking(true)} accessibilityRole="button" accessibilityLabel={`Country: ${country ? countryName(country) : 'not chosen'}. Change it.`}
          style={({ pressed }) => [{ minHeight: 48, paddingHorizontal: space.md, borderRadius: 12, borderWidth: 1, borderColor: C.border, justifyContent: 'center', backgroundColor: C.card }, pressed && { opacity: 0.6 }]}>
          <Text style={txt.body}>{country ? countryName(country) : 'Choose a country'}</Text>
        </Pressable>
        <SmallBtn label={busy === 'country' ? 'Saving…' : 'Save country'} tone="primary" onPress={() => void save('country')}
          disabled={busy !== '' || !country || country === r.country} />
      </View>
      <Text style={[txt.xsStrong, { marginTop: space.sm }]}>Target</Text>
      <ChipRow>{TARGET_SCOPES.map((s) => <Chip key={s} label={SCOPE_LABEL[s]} on={scope === s} onPress={() => setScope(s)} />)}</ChipRow>
      <Columns min={200}>
        <Field label="Start (YYYY-MM-DD)" value={start} onChangeText={setStart} autoCapitalize="none" />
        <Field label="Finish by (YYYY-MM-DD)" value={end} onChangeText={setEnd} autoCapitalize="none" />
      </Columns>
      {!datesOk ? <Text style={txt.error} accessibilityRole="alert">Write both dates as YYYY-MM-DD, with the finish after the start.</Text> : null}
      <View style={{ alignSelf: 'flex-start' }}>
        <SmallBtn label={busy === 'target' ? 'Saving…' : 'Save target'} tone="primary" onPress={() => void save('target')} disabled={busy !== '' || !datesOk} />
      </View>
      {status ? <Notice tone={status.tone} title={status.text} /> : null}
      <Sheet visible={picking} title="Country" sub={r.name} onClose={() => setPicking(false)}>
        <SearchField value={search} onChangeText={setSearch} placeholder="Find a country" />
        {choices.slice(0, 60).map((c) => (
          <Pressable key={c} onPress={() => { setCountry(c); setPicking(false); setSearch(''); }} accessibilityRole="button" accessibilityState={{ selected: c === country }}
            style={({ pressed }) => [{ minHeight: 48, justifyContent: 'center', paddingHorizontal: space.sm, borderBottomWidth: 1, borderColor: C.border }, pressed && { opacity: 0.6 }]}>
            <Text style={[txt.body, c === country ? { color: C.primary, fontWeight: '700' } : null]}>{countryName(c)}</Text>
          </Pressable>
        ))}
        {choices.length > 60 ? <Text style={txt.xs}>Type to find the other {choices.length - 60}.</Text> : null}
      </Sheet>
    </Panel>
  );
}

export const contracts = contractsFor('reports_home', 'reports_language');
