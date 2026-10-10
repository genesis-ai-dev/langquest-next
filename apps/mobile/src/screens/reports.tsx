// The Reports section (decision 57): app-only, not in the partner demo.
// Shown on tablets and the web (768 and wider) to people with view_status:
// the organization's figures across every language, from the dashboard's
// server (decision 44), which a phone could not total itself (decision 37).
// Ports the web dashboard's shell and language page (apps/web/src/screens:
// shell, Language); the sections and their parts are in src/reports/.
import { appendConfirmed, ensureDeviceId, NotSavedError, SupabaseTransport } from '@langquest-next/client';
import {
  dayPercents, ORG_STREAM, paceOf, percent, privilegesFor, recencyOf, TARGET_SCOPES,
  type LanguageReport, type LanguageRow, type TargetScope
} from '@langquest-next/core';
import * as Crypto from 'expo-crypto';
import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { Ctx } from '../ctx';
import { t, Trans } from '../i18n';
import { contractsFor } from '../screenContracts';
import { Chip, ChipRow, EmptyState, Field, Header, IconBtn, Screen, SearchField, Sheet, SmallBtn, txt } from '../kit';
import { getStore } from '../store';
import { supabase } from '../supabase';
import { C, measure, space } from '../theme';
import { ActivityChart, DayBars, ProgressLine, WorkBar } from '../reports/charts';
import { countryCodes, countryName } from '../reports/countries';
import { useReports } from '../reports/data';
import { bottleneckText, milestoneText, paceAdvice, paceLabel, PACE_TONE, recencyAdvice, recencyLabel, RECENCY_TONE, scopeLabel, stageName } from '../reports/labels';
import { Activity, Alerts, FieldReport, Geography, Languages, Ledger, openAlerts, Overview, Pace, sectionLabel, SECTIONS, type SectionId, type SectionProps } from '../reports/sections';
import {
  AttentionPanel, Bar, bookOf, canPrint, Columns, CoverageRows, dayYear, exportCsv, fileName, Freshness, HeadlineStats, languageCsv, ListLine, NoReports, Notice, num, Panel,
  pctText, printPage, ProgressPair, shortDate, signed, Stat, Stats, ToneBadge, type Tone
} from '../reports/ui';

const COLUMN = measure.report;

export function ReportsHome(ctx: Ctx) {
  const orgId = ctx.language.orgId;
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
    open: (row) => ctx.go('reports_language', { languageId: row.languageId }),
    show: (to, c) => { setSection(to); if (c !== undefined) setCountry(c); }
  };
  const header = (
    <Header title={sectionLabel(section)} sub={[orgName, t('reports.title')].filter(Boolean).join(' · ')} columnWidth={COLUMN}
      action={<IconBtn name="restart" label={t('reports.home.catchUp')} onPress={reports.refresh} disabled={reports.status === 'ready' && reports.refreshing} />} />
  );
  return (
    <Screen header={header} columnWidth={COLUMN}>
      <ChipRow>
        {SECTIONS.map((s) => (
          <Chip key={s.id} label={sectionLabel(s.id)} on={s.id === section} onPress={() => setSection(s.id)}
            {...(s.id === 'alerts' && alerts > 0 ? { count: alerts, accessibilityLabel: t('reports.home.alertsChip', { count: alerts }) } : {})} />
        ))}
      </ChipRow>
      {spec.filterCountry && countries.length > 1 ? (
        <ChipRow>
          <Chip label={t('reports.home.allCountries')} icon="globe" on={!country} onPress={() => setCountry('')} />
          {countries.map((c) => <Chip key={c || 'none'} label={countryName(c || null)} on={country === c} onPress={() => setCountry(c)} />)}
        </ChipRow>
      ) : null}
      {reports.status === 'loading' ? <EmptyState icon="progress" title={t('reports.home.loading')} /> : null}
      {reports.status === 'error' ? (
        <Notice tone={reports.offline ? 'amber' : 'red'} title={reports.offline ? t('reports.offlineTitle') : t('reports.home.couldNotRead')} body={reports.message}>
          <View style={{ alignSelf: 'flex-start', marginTop: space.sm }}><SmallBtn label={t('common.tryAgain')} icon="restart" onPress={reports.reload} /></View>
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
  const orgId = ctx.language.orgId;
  const orgName = ctx.org.state?.org?.value.name ?? '';
  const reports = useReports(orgId);
  const languageId = ctx.params['languageId'] ?? '';
  const row = reports.status === 'ready' ? reports.rows.find((r) => r.languageId === languageId) : undefined;
  const title = row?.report.name ?? t('reports.language.fallbackTitle');
  const header = (
    <Header title={title} sub={orgName} columnWidth={COLUMN} onBack={ctx.back} crumbs={[{ label: t('reports.title'), onPress: ctx.back }]}
      action={row ? (
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <IconBtn name="download" label={t('reports.language.downloadBooks')} onPress={() => exportCsv(fileName(t('reports.files.books', { name: row.report.name })), languageCsv(row.report))} />
          {canPrint ? <IconBtn name="share" label={t('reports.printOrSave')} onPress={printPage} /> : null}
        </View>
      ) : undefined} />
  );
  return (
    <Screen header={header} columnWidth={COLUMN}>
      {reports.status === 'loading' ? <EmptyState icon="progress" title={t('reports.language.loading')} /> : null}
      {reports.status === 'error' ? <Notice tone={reports.offline ? 'amber' : 'red'} title={reports.offline ? t('reports.offlineTitle') : t('reports.language.couldNotRead')} body={reports.message} /> : null}
      {reports.status === 'ready' && !row ? (
        reports.rows.length === 0 ? <NoReports what="languageReport" /> : (
          <Notice tone="gray" title={t('reports.language.notVisible')} body={t('reports.language.notVisibleBody')} />
        )
      ) : null}
      {row ? <LanguageBody ctx={ctx} row={row} refresh={reports.refresh} /> : null}
    </Screen>
  );
}

const bold = <Text style={{ fontWeight: '700' }} />;

function LanguageBody(props: { ctx: Ctx; row: LanguageRow; refresh: () => void }) {
  const { ctx, row } = props;
  const r = row.report;
  const now = Date.now();
  const recency = recencyOf(r, now);
  const pace = paceOf(r, now);
  const sevenAgo = new Date(now - 6 * 86_400_000).toISOString().slice(0, 10);
  const org = ctx.org.state;
  const mayEdit = !!org && privilegesFor(org, ctx.session.actorId, row.languageId).has('manage_structure');
  const bottleneck = bottleneckText(r);
  return (
    <>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, alignItems: 'center' }}>
        <ToneBadge tone="brand" label={r.code.toUpperCase()} />
        <Text style={txt.sm}>{countryName(r.country)}</Text>
        <Text style={txt.sm}>· <Trans i18nKey="reports.language.reviewFlow" values={{ flow: r.flowName }} components={{ b: bold }} /></Text>
        {bottleneck ? <Text style={txt.sm}>· <Trans i18nKey="reports.language.bottleneck" values={{ bottleneck }} components={{ b: bold }} /></Text> : null}
        <ToneBadge tone={RECENCY_TONE[recency.band]} label={recencyLabel(recency.band)} />
        {pace ? <ToneBadge tone={PACE_TONE[pace.band]} label={paceLabel(pace.band)} /> : null}
      </View>
      <Freshness updatedAt={row.updatedAt} now={now} />
      <HeadlineStats total={r.progress.total} recorded={r.progress.recorded} done={r.progress.done} />
      <Columns>
        <Panel title={t('reports.coverage.title')}>
          <CoverageRows recorded={r.coverage.recorded} done={r.coverage.done} />
          {r.milestones.length ? (
            <>
              <Text style={txt.h3}>{t('reports.milestones')}</Text>
              {[...r.milestones].reverse().map((m) => (
                <ListLine key={`${m.scope}-${m.threshold}`} right={<Text style={txt.xs}>{dayYear(m.at)}</Text>}>
                  <Text style={txt.sm}>{milestoneText({ ...m, row })}</Text>
                </ListLine>
              ))}
            </>
          ) : null}
        </Panel>
        <Panel title={t('reports.language.uploads')} sub={recencyAdvice(recency.band)}>
          <Stats>
            <Stat label={t('reports.recordingsOnServer')} value={num(r.uploads.cards)} />
            <Stat label={t('reports.language.chaptersWithAudio')} value={num(r.uploads.chapters)} />
            <Stat label={t('reports.language.sinceLastUpload')} value={recency.days === null ? '—' : t('reports.daysShort', { count: recency.days })}
              sub={r.uploads.lastAt ? dayYear(r.uploads.lastAt) : undefined} />
          </Stats>
          {r.alerts.stuckCards > 0 ? (
            <Notice tone="red" title={t('reports.language.stuck', { count: r.alerts.stuckCards })}
              body={r.alerts.stuckSince ? t('reports.language.stuckBody', { date: shortDate(r.alerts.stuckSince) }) : t('reports.language.stuckBodyUndated')} />
          ) : null}
          <DayBars days={r.uploads.daily.map((d) => ({ day: d.day, value: d.cards }))} highlightFrom={sevenAgo} label={t('reports.last7Days')} unit="uploads" />
        </Panel>
      </Columns>
      {r.target && pace ? (
        <Panel title={t('reports.sections.pace')} right={<ToneBadge tone={PACE_TONE[pace.band]} label={t('reports.pace.badge', { label: paceLabel(pace.band), gap: signed(pace.gap) })} />}
          sub={t('reports.language.paceSub', { scope: scopeLabel(r.target.scope), from: dayYear(r.target.startDate), to: dayYear(r.target.targetDate), advice: paceAdvice(pace.band) })}>
          <Bar value={pace.actual} tick={pace.expected} tone={PACE_TONE[pace.band]} label={t('reports.pace.bar', { actual: pctText(pace.actual), expected: pctText(pace.expected) })} />
          <Text style={txt.sm}>
            <Trans i18nKey="reports.language.paceLine" values={{ actual: pctText(pace.actual), scope: scopeLabel(r.target.scope), expected: pctText(pace.expected) }} components={{ b: bold }} />
            {pace.projectedFinish && pace.band !== 'complete' ? ` ${t('reports.language.paceFinishes', { date: dayYear(pace.projectedFinish) })}` : ''}
            {!pace.projectedFinish ? ` ${t('reports.language.paceNoProgress')}` : ''}
          </Text>
        </Panel>
      ) : null}
      <AttentionPanel attention={r.attention} />
      <Columns>
        <FlowPanel report={r} />
        <Panel title={t('reports.whereStand.title')} sub={t('reports.whereStand.once')}><WorkBar work={r.work} /></Panel>
      </Columns>
      <Columns>
        <Panel title={t('reports.language.activity')} sub={t('reports.language.byWeek')}><ActivityChart weeks={r.activity.slice(-12)} withCards /></Panel>
        <Panel title={t('reports.language.progressOverTime')} sub={t('reports.language.progressOverTimeSub')}>
          <ProgressLine points={dayPercents(r)} />
        </Panel>
      </Columns>
      <Panel title={t('reports.language.books')}>
        {r.books.length === 0 ? <Text style={txt.smMuted}>{t('reports.charts.noPassages')}</Text> : r.books.map((b) => (
          <ListLine key={b.bookId ?? b.label} right={<Text style={txt.xs}>{t('reports.counts.passages', { count: b.total })}</Text>}>
            <Text style={[txt.sm, { fontWeight: '700' }]}>{bookOf(b)}</Text>
            <ProgressPair total={b.total} recorded={b.recorded} done={b.done} />
          </ListLine>
        ))}
      </Panel>
      {mayEdit ? <SettingsPanel ctx={ctx} row={row} refresh={props.refresh} /> : null}
    </>
  );
}

function FlowPanel(props: { report: LanguageReport }) {
  const r = props.report;
  if (r.stages.length === 0) {
    return <Panel title={t('reports.flow.title')}><Text style={txt.smMuted}>{t('reports.flow.noSteps')}</Text></Panel>;
  }
  return (
    <Panel title={t('reports.flow.title')} sub={t('reports.flow.sub')}>
      {r.stages.map((s, i) => {
        const cleared = r.progress.steps[i]?.cleared ?? 0;
        const name = stageName(s.name);
        return (
          <View key={s.stepId} style={{ gap: 4 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' }}>
              <Text style={[txt.sm, { fontWeight: '700' }]}>{name}</Text>
              {s.checkpoint ? <ToneBadge tone="amber" label={t('reports.flow.checkpoint')} /> : null}
              <Text style={[txt.xs, { marginStart: 'auto' }]}>
                {s.passages > 0 ? t('reports.flow.clearedWaiting', { cleared: num(cleared), waiting: num(s.passages) }) : t('reports.flow.cleared', { cleared: num(cleared) })}
              </Text>
            </View>
            <Bar value={percent(cleared, r.progress.total)} tone="green" label={t('reports.flow.bar', { name, share: pctText(percent(cleared, r.progress.total)) })} />
          </View>
        );
      })}
    </Panel>
  );
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const validDay = (d: string) => DAY.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`));

/** Why a setting was not saved, by the client's reason (its own message is English). */
function notSavedText(e: unknown): string {
  if (!(e instanceof NotSavedError)) return t('reports.settings.notSaved');
  switch (e.reason) {
    case 'offline': return t('reports.settings.offline');
    case 'refused': return t('reports.settings.refused');
    case 'unconfirmed': return t('reports.settings.unconfirmed');
    case 'failed': return t('reports.settings.failed');
  }
}

/**
 * Country and target, for people who manage the organization's structure
 * (decision 41). Saved online straight to the organization's stream on the
 * server, which checks again, so the page can catch up with it at once.
 */
function SettingsPanel(props: { ctx: Ctx; row: LanguageRow; refresh: () => void }) {
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
  const codes = useMemo(() => countryCodes(), []);
  const q = search.trim().toLowerCase();
  const choices = q ? codes.filter((c) => countryName(c).toLowerCase().includes(q) || c.toLowerCase() === q) : codes;

  async function save(what: 'country' | 'target') {
    setBusy(what);
    setStatus(null);
    try {
      const deviceId = await ensureDeviceId(await getStore(), () => Crypto.randomUUID());
      const who = { orgId: row.orgId, streamId: ORG_STREAM, actorId: ctx.session.actorId, deviceId, transport: new SupabaseTransport(supabase) };
      if (what === 'country') await appendConfirmed(who, 'v1.LanguageCountrySet', { languageId: r.languageId, country });
      else await appendConfirmed(who, 'v1.LanguageTargetSet', { languageId: r.languageId, scope, startDate: start, targetDate: end });
      setStatus({ tone: 'green', text: t('reports.settings.saved') });
      props.refresh();
    } catch (e) {
      setStatus({ tone: e instanceof NotSavedError && e.reason === 'offline' ? 'amber' : 'red', text: notSavedText(e) });
    } finally {
      setBusy('');
    }
  }

  return (
    <Panel title={t('reports.settings.title')} sub={t('reports.settings.sub')}>
      <Text style={txt.xsStrong}>{t('reports.settings.country')}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, alignItems: 'center' }}>
        <Pressable onPress={() => setPicking(true)} accessibilityRole="button"
          accessibilityLabel={country ? t('reports.settings.countryButton', { country: countryName(country) }) : t('reports.settings.countryButtonNone')}
          style={({ pressed }) => [{ minHeight: 48, paddingHorizontal: space.md, borderRadius: 12, borderWidth: 1, borderColor: C.border, justifyContent: 'center', backgroundColor: C.card }, pressed && { opacity: 0.6 }]}>
          <Text style={txt.body}>{country ? countryName(country) : t('reports.settings.chooseCountry')}</Text>
        </Pressable>
        <SmallBtn label={busy === 'country' ? t('common.saving') : t('reports.settings.saveCountry')} tone="primary" onPress={() => void save('country')}
          disabled={busy !== '' || !country || country === r.country} />
      </View>
      <Text style={[txt.xsStrong, { marginTop: space.sm }]}>{t('reports.settings.target')}</Text>
      <ChipRow>{TARGET_SCOPES.map((s) => <Chip key={s} label={scopeLabel(s)} on={scope === s} onPress={() => setScope(s)} />)}</ChipRow>
      <Columns min={200}>
        <Field label={t('reports.settings.start')} value={start} onChangeText={setStart} autoCapitalize="none" />
        <Field label={t('reports.settings.finishBy')} value={end} onChangeText={setEnd} autoCapitalize="none" />
      </Columns>
      {!datesOk ? <Text style={txt.error} accessibilityRole="alert">{t('reports.settings.datesInvalid')}</Text> : null}
      <View style={{ alignSelf: 'flex-start' }}>
        <SmallBtn label={busy === 'target' ? t('common.saving') : t('reports.settings.saveTarget')} tone="primary" onPress={() => void save('target')} disabled={busy !== '' || !datesOk} />
      </View>
      {status ? <Notice tone={status.tone} title={status.text} /> : null}
      <Sheet visible={picking} title={t('reports.settings.country')} sub={r.name} onClose={() => setPicking(false)}>
        <SearchField value={search} onChangeText={setSearch} placeholder={t('reports.settings.findCountry')} />
        {choices.slice(0, 60).map((c) => (
          <Pressable key={c} onPress={() => { setCountry(c); setPicking(false); setSearch(''); }} accessibilityRole="button" accessibilityState={{ selected: c === country }}
            style={({ pressed }) => [{ minHeight: 48, justifyContent: 'center', paddingHorizontal: space.sm, borderBottomWidth: 1, borderColor: C.border }, pressed && { opacity: 0.6 }]}>
            <Text style={[txt.body, c === country ? { color: C.primary, fontWeight: '700' } : null]}>{countryName(c)}</Text>
          </Pressable>
        ))}
        {choices.length > 60 ? <Text style={txt.xs}>{t('reports.settings.typeToFind', { count: choices.length - 60 })}</Text> : null}
      </Sheet>
    </Panel>
  );
}

export const contracts = contractsFor('reports_home', 'reports_language');
