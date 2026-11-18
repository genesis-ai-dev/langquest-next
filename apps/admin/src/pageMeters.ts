/**
 * Meters and shares (docs/ops-dashboard-plan.md 5c4): a bar against a limit
 * for each thing that has one (the database disk and the plan, Google's
 * lines, the rate limits, connections), and one bar split by share for
 * what grows with people (syncs, requests by time, accounts, updates in the
 * field). Both draw from the data each part already read, and both are rows
 * of the fixed lists (pageLists.ts), so a tap, the arrow keys and the detail
 * panel work the same.
 */
import { BACKGROUND_RPCS, RPC_MIN_CALLS, RPC_SLOW_MS } from '../../../scripts/diagSignals';
import { ANR_LINE, CRASH_LINE } from './sources/googleplay';
import { CRASH_ROLLBACK_SHARE, DEAD_ROWS_MIN, DEAD_ROWS_SHARE, LONG_QUERY_S, LONG_XACT_S, REPORT_DUE_HOURS } from './sources/ops';
import { DB_FULL_SHARE } from './sources/storage';
import { SERVER_ERROR_LINE } from './sources/supabase';

/** Pure helpers, no page state: apps/admin/test/meters.test.ts runs them with new Function. */
export const METERS_LOGIC = String.raw`
const RPC_SLOW = { ms: ${RPC_SLOW_MS}, calls: ${RPC_MIN_CALLS}, background: ${JSON.stringify([...BACKGROUND_RPCS])} };
/** The lines the alerts use (sources/*.ts), so a bar turns red or amber when its alert does; meters.test.ts holds the rate limits to securityAlerts. */
const PLAY_LINE = { crash: ${CRASH_LINE}, anr: ${ANR_LINE} };
const LIMIT_LINE = { deviceRefused: 100, linksRefused: 300, v2SignInFailures24h: 100 };
const CRASH_ROLLBACK = ${CRASH_ROLLBACK_SHARE}, REPORT_DUE_H = ${REPORT_DUE_HOURS}, DB_FULL = ${DB_FULL_SHARE};
/** The Database lines' own limits (sources/ops.ts dbDetailAlerts, sources/supabase.ts supabaseAlerts), so each line has a bar that shows it. */
const DB_LINE = { xactS: ${LONG_XACT_S}, queryS: ${LONG_QUERY_S}, deadShare: ${DEAD_ROWS_SHARE}, deadRows: ${DEAD_ROWS_MIN} };
const SERVER_ERRORS = ${JSON.stringify(SERVER_ERROR_LINE)};
const lastsOf = (s) => s === null || s === undefined ? 'none now' : s >= 3600 ? (s / 3600).toFixed(1) + ' h' : s >= 60 ? Math.round(s / 60) + ' min' : Math.round(s) + ' s';
/** The largest few of a list, and after them each one past them that has a line: a line's bar never falls off the picture. */
const withLined = (xs, n, lined) => xs.slice(0, n).concat(xs.slice(n).filter(lined));
const nOf = (n) => n === null || n === undefined ? '–' : Number(n).toLocaleString('en');
const sizeOf = (b) => { if (b === null || b === undefined) return '–'; const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0, v = Number(b); while (v >= 1024 && i < u.length - 1) { v /= 1024; i += 1; } return v.toFixed(v >= 10 || i === 0 ? 0 : 1) + ' ' + u[i]; };
const pctOf = (x, d) => x === null || x === undefined || !isFinite(x) ? '–' : (x * 100).toFixed(d === undefined ? (x < 0.1 ? 1 : 0) : d) + '%';
/** A bar against a limit: v of max; value is what the bar says on its right. */
const meterItem = (name, v, max, s, value, fields, extra) => Object.assign({ s, name, at: null, v: Number(v) || 0, max: Number(max) || 1, value, fields: fields.filter((p) => p[1] !== null && p[1] !== undefined && p[1] !== '') }, extra || {});

function meterRows(part, d) {
  if (!d) return null;
  if (part === 'capacity') {
    const items = [];
    if (d.now && d.limitBytes) {
      const used = d.now.dbBytes / d.limitBytes;
      items.push(meterItem('Database disk', d.now.dbBytes, d.limitBytes,
        used >= DB_FULL || (d.weeksLeft !== null && d.weeksLeft < 4) ? 'fail' : d.weeksLeft !== null && d.weeksLeft < 12 ? 'part' : 'ok',
        sizeOf(d.now.dbBytes) + ' of ' + sizeOf(d.limitBytes),
        [['Used', sizeOf(d.now.dbBytes)], ['Disk', sizeOf(d.limitBytes)], ['Share', pctOf(used)], ['Growth a week', d.dbGrowthPerDay === null ? 'needs a week of nightly sizes' : sizeOf(d.dbGrowthPerDay * 7)],
          ['Weeks left at that rate', d.weeksLeft === null ? null : Math.round(d.weeksLeft)], ['Event log', sizeOf(d.now.eventsBytes)]]));
    }
    const u = d.usage;
    if (u && !u.error && u.allowance) {
      const price = u.price || {};
      for (const [key, name] of [['workersRequests', 'Workers requests'], ['doRequests', 'Durable Object requests'], ['r2ClassA', 'R2 class A operations'], ['r2ClassB', 'R2 class B operations']]) {
        const used = Number(u[key]) || 0, inc = Number(u.allowance[key]) || 0;
        const extra = used > inc && price[key] ? (used - inc) * price[key] : 0;
        items.push(meterItem(name, used, inc, used > inc ? 'part' : 'ok', pctOf(inc ? used / inc : null),
          [['Used this month', nOf(used)], ['The plan includes', nOf(inc)], ['Share', pctOf(inc ? used / inc : null)], ['Extra cost so far', extra ? '$' + extra.toFixed(2) : null], ['Counted since', u.since || null]]));
      }
    }
    if (d.r2 && !d.r2.error && u && u.allowance && u.allowance.r2Bytes) {
      items.push(meterItem('R2 storage', d.r2.bytes, u.allowance.r2Bytes, d.r2.bytes > u.allowance.r2Bytes ? 'part' : 'ok', sizeOf(d.r2.bytes),
        [['Stored', sizeOf(d.r2.bytes)], ['The plan includes', sizeOf(u.allowance.r2Bytes)], ['Growth a week', d.r2.growthPerDay === null || d.r2.growthPerDay === undefined ? null : sizeOf(d.r2.growthPerDay * 7)]]));
    }
    return items.length ? [{ label: 'Against the plan', draw: 'meter', items }] : [];
  }
  if (part === 'database') {
    const rows = [];
    if (d.maxConnections) {
      rows.push({ label: 'Connections', draw: 'meter', items: [meterItem('Connections in use', d.connections, d.maxConnections, d.connections >= d.maxConnections * 0.8 ? 'part' : 'ok',
        nOf(d.connections) + ' of ' + nOf(d.maxConnections), [['In use', nOf(d.connections)], ['Most the database takes', nOf(d.maxConnections)], ['Cache hits', d.stats ? pctOf(d.stats.hitRatio, 1) : null], ['Deadlocks', d.stats ? nOf(d.stats.deadlocks) : null]])] });
    }
    const isSlow = (r) => !RPC_SLOW.background.includes(r.rpc) && r.calls >= RPC_SLOW.calls && r.mean_ms > RPC_SLOW.ms;
    const rpc = withLined(d.rpc || [], 8, isSlow);
    const most = Math.max.apply(null, [1].concat(rpc.map((r) => Number(r.total_s) || 0)));
    if (rpc.length) rows.push({ label: 'Calls by total time', draw: 'meter', items: rpc.map((r) => {
      const slow = isSlow(r);
      return meterItem(r.rpc, r.total_s, most, slow ? 'fail' : 'ok', nOf(r.total_s) + ' s',
        [['Calls', nOf(r.calls)], ['Mean', nOf(r.mean_ms) + ' ms'], ['Longest', nOf(r.max_ms) + ' ms'], ['Total', nOf(r.total_s) + ' s'], ['Counted since', d.rpcSince || 'the last reset']], { mono: true });
    }) });
    return rows;
  }
  if (part === 'dbdetail') {
    const who = (a) => a ? [a.role || '?', a.client].filter(Boolean).join(' · ') : null;
    // The longest query and the oldest transaction, each against the time from which it is a line.
    const now = (name, secs, line, a, extra) => meterItem(name, secs || 0, line * 1.5, Number(secs) > line ? 'part' : 'ok', lastsOf(secs),
      [['Lasts', lastsOf(secs)], ['A line from', lastsOf(line)], ['Whose', who(a)]].concat(extra), { line });
    const q = d.longestQuery, x = d.oldestXact;
    const rows = [{ label: 'Running now', draw: 'meter', items: [
      now('Longest query', d.longestQueryS, DB_LINE.queryS, q, [['Waits on', q ? q.waitingOn || null : null]]),
      now('Oldest transaction', d.oldestXactS, DB_LINE.xactS, x, [['State', x ? x.state || null : null]])] }];
    const dead = (t) => Number(t.deadRatio) >= DB_LINE.deadShare && t.rows >= DB_LINE.deadRows;
    const t = withLined(d.tables || [], 8, dead);
    const most = Math.max.apply(null, [1].concat(t.map((y) => Number(y.bytes) || 0)));
    if (t.length) rows.push({ label: 'Largest tables', draw: 'meter', items: t.map((y) => meterItem(y.name, y.bytes, most,
      dead(y) ? 'part' : 'ok', sizeOf(y.bytes) + (dead(y) ? ' · ' + pctOf(Number(y.deadRatio), 0) + ' dead rows' : ''),
      [['Size', sizeOf(y.bytes)], ['Rows', nOf(y.rows)], ['Dead rows', y.deadRatio === null || y.deadRatio === undefined ? null : pctOf(Number(y.deadRatio), 0)]], { mono: true })) });
    return rows;
  }
  if (part === 'googleplay') {
    const rate = (m, line, name) => m ? meterItem(name, m.userPerceived, line * 1.5, m.userPerceived >= line ? 'fail' : m.userPerceived >= line / 2 ? 'part' : 'ok', pctOf(m.userPerceived, 2),
      [['Users who met it', pctOf(m.userPerceived, 2)], ["Google's line", pctOf(line, 2)], ['Days', '7'], ['Through', d.freshThrough || null]], { line, half: true }) : null;
    const items = [rate(d.crash, PLAY_LINE.crash, 'Crash rate, 7 days'), rate(d.anr, PLAY_LINE.anr, 'ANR rate, 7 days')].filter(Boolean);
    return items.length ? [{ label: "Against Google's line", draw: 'meter', items }] : [];
  }
  if (part === 'security') {
    const l = d.limits;
    if (!l) return [];
    const lim = (key, name) => meterItem(name, l[key], LIMIT_LINE[key], l[key] >= LIMIT_LINE[key] ? 'part' : 'ok', nOf(l[key]) + ' of ' + nOf(LIMIT_LINE[key]),
      [['Last 24 h', nOf(l[key])], ['An alert from', nOf(LIMIT_LINE[key])]]);
    return [{ label: 'Limits hit, against the alert', draw: 'meter', items: [lim('deviceRefused', 'Device codes refused, 24 h'), lim('linksRefused', 'Review links refused, 24 h'),
      lim('v2SignInFailures24h', 'Failed v2 sign-ins, 24 h'),
      meterItem('Installs at the diagnostics cap', l.installsAtDiagCap, 1, l.installsAtDiagCap > 0 ? 'part' : 'ok', nOf(l.installsAtDiagCap), [['Today', nOf(l.installsAtDiagCap)], ['An alert from', '1']])] }];
  }
  if (part === 'support') {
    const r = d.reports || {};
    const h = r.oldestAt ? (Date.now() - Date.parse(r.oldestAt)) / 3600000 : 0;
    return [{ label: 'Oldest open report', draw: 'meter', items: [meterItem('Waits, of 24 hours', r.open ? h : 0, 24, r.open && h >= REPORT_DUE_H ? 'fail' : r.staffOnly ? 'part' : 'ok',
      r.open ? Math.round(h) + ' h' : 'none open', [['Open reports', nOf(r.open)], ['Oldest', r.oldestAt || null], ['Only staff can act on', nOf(r.staffOnly)], ['The Terms promise', 'action within 24 hours']])] }];
  }
  if (part === 'cloudflare') {
    const w = d.workers || [];
    const most = Math.max.apply(null, [1].concat(w.map((x) => Number(x.requests) || 0)));
    return w.length ? [{ label: 'Requests, last 24 h', draw: 'meter', items: w.map((x) => {
      const b = x.lastBuild || {}, broke = b.outcome === 'fail' || b.outcome === 'failure';
      return meterItem(x.name, x.requests, most, broke ? 'fail' : x.errors ? 'part' : 'ok', nOf(x.requests),
        [['Requests', nOf(x.requests)], ['Errors', nOf(x.errors) + (x.errorRate === null || x.errorRate === undefined ? '' : ' (' + pctOf(x.errorRate, 2) + ')')],
          ['CPU p99', x.cpuP99 === null || x.cpuP99 === undefined ? null : (x.cpuP99 / 1000).toFixed(1) + ' ms'], ['Last build', x.lastBuild ? (b.outcome || b.status || '?') : null], ['Built', b.at || null], ['Commit', b.commit || null]], { mono: true });
    }) }] : [];
  }
  if (part === 'supabase') {
    const rows = [];
    for (const p of d.projects || []) {
      const health = (p.health || []).map((s) => ({ s: s.healthy ? 'ok' : 'fail', name: s.name, at: null,
        fields: [['Service', s.name], ['State', s.healthy ? 'healthy' : s.status || 'unhealthy'], ['Project', p.ref]] }));
      // An Edge Function that is throttled is a line of its own: a square beside the services.
      const throttled = (p.functions || []).filter((f) => f.status === 'THROTTLED').map((f) => ({ s: 'part', name: 'Edge Function ' + f.slug, at: f.updatedAt || null,
        fields: [['Edge Function', f.slug], ['State', 'throttled'], ['Project', p.ref]] }));
      if (health.length + throttled.length) rows.push({ label: p.name, items: health.concat(throttled) });
      // Server errors in the last day, each against the count from which it is a line.
      const l = p.logs;
      if (l) rows.push({ label: 'Server errors, last day', draw: 'meter', count: false, items: [['gateway5xx', 'API'], ['function5xx', 'Edge Functions'], ['authErrors', 'Auth']].map(([k, name]) =>
        meterItem(name, l[k], SERVER_ERRORS[k] * 1.5, l[k] >= SERVER_ERRORS[k] ? 'part' : 'ok', nOf(l[k]),
          [['Server errors, last day', nOf(l[k])], ['A line from', nOf(SERVER_ERRORS[k])], ['All API requests', k === 'gateway5xx' ? nOf(l.gatewayTotal) : null], ['Project', p.ref]], { line: SERVER_ERRORS[k] })) });
    }
    return rows;
  }
  if (part === 'worker') {
    const B = [['lt100ms', 'Under 100 ms', 'ok'], ['lt1s', 'Under 1 s', 'run'], ['lt10s', 'Under 10 s', 'part'], ['over10s', '10 s or more', 'fail']];
    return (d.routes || []).filter((r) => r.requests > 0).sort((a, b) => b.requests - a.requests).map((r) => {
      const timed = B.reduce((a, b) => a + (Number(r[b[0]]) || 0), 0);
      return { label: r.route, draw: 'share', mono: true, items: B.filter((b) => r[b[0]] > 0).map((b) => ({ s: b[2], name: b[1], at: null, v: Number(r[b[0]]),
        fields: [['Route', r.route], ['Time', b[1]], ['Requests', nOf(r[b[0]])], ['Share of the route', pctOf(timed ? r[b[0]] / timed : null, 1)], ['All requests', nOf(r.requests)], ['Server errors (5xx)', nOf(r.s5xx)], ['Refused, too many (429)', nOf(r.s429)]] })) };
    }).filter((r) => r.items.length);
  }
  if (part === 'clients') {
    const sync = d.sync || {};
    const st = (k) => k === 'ok' ? 'ok' : k === 'offline' ? 'off' : k === 'error' ? 'fail' : 'part';
    const all = Object.values(sync).reduce((a, x) => a + (Number(x.records) || 0), 0);
    const items = Object.entries(sync).filter((e) => e[1].records > 0).sort((a, b) => rankOf(st(a[0])) - rankOf(st(b[0])) || b[1].records - a[1].records)
      .map(([k, x]) => ({ s: st(k), name: k === 'ok' ? 'OK' : k.charAt(0).toUpperCase() + k.slice(1).replace(/_/g, ' '), at: null, v: Number(x.records), fields: [['Outcome', k], ['Syncs', nOf(x.records)], ['Share', pctOf(all ? x.records / all : null, 1)], ['Installs', nOf(x.installs)]] }));
    return items.length ? [{ label: 'Syncs, last day', draw: 'share', items }] : [];
  }
  if (part === 'fleet') {
    const ups = d.updates || [];
    const newest = (ups.find((u) => u.channel !== 'web') || {}).update;
    const items = ups.filter((u) => u.installs > 0).map((u) => {
      const share = u.installs ? u.crashed / u.installs : 0;
      return { s: share >= CRASH_ROLLBACK && u.installs >= 20 ? 'fail' : u.crashed ? 'part' : u.update === newest ? 'ok' : 'off', name: String(u.update).slice(0, 8), at: u.firstSeen, v: Number(u.installs),
        fields: [['Update', u.update], ['Channel', u.channel || '–'], ['Runtime', u.runtime || '–'], ['Installs', nOf(u.installs)], ['Crashed', nOf(u.crashed)], ['Crash-free', pctOf(1 - share, 1)], ['First seen', u.firstSeen], ['Last seen', u.lastSeen || null]].filter((p) => p[1] !== null) };
    });
    return items.length ? [{ label: 'Updates, 14 days', draw: 'share', items }] : [];
  }
  if (part === 'people') {
    const a = d.accounts || {}, p = d.activeProfiles || {};
    const total = Number(a.total) || 0, day = Number(p.day) || 0, week = Math.max(day, Number(p.week) || 0);
    const items = [['ok', 'Active today', day], ['run', 'Active this week, not today', week - day], ['off', 'Not active this week', Math.max(0, total - week)]]
      .filter((x) => x[2] > 0).map(([s, name, v]) => ({ s, name, at: null, v, fields: [['Accounts', nOf(v)], ['Share', pctOf(total ? v / total : null, 1)], ['All accounts', nOf(total)], ['Suspended', nOf(a.suspended)], ['Looked after', nOf(a.managed)]] }));
    return items.length ? [{ label: 'Accounts', draw: 'share', items }] : [];
  }
  return null;
}
`;

/** Drawing the meters and the shares; the tap, the keys and the detail are the lists' (pageLists.ts). */
export const METERS_SCRIPT = String.raw`
// ---- meters and shares (plan 5c4) -------------------------------------------------------------
Object.assign(LIST_SAID, {
  capacity: { one: 'limit', many: 'limits', pic: 'a bar for each limit, filled as far as it is used', fail: 'Full soon', part: 'Past the plan, or fills in 12 weeks', ok: 'Room left' },
  database: { one: 'bar', many: 'bars', pic: 'connections in use, and the calls that take the most time', fail: 'Slow: people wait', part: 'Near the limit', ok: 'Normal' },
  dbdetail: { one: 'bar', many: 'bars', pic: 'the longest query, the oldest transaction, and the largest tables', part: 'Past its line, or many dead rows', ok: 'Normal' },
  googleplay: { one: 'rate', many: 'rates', pic: "crashes and ANRs against Google's line", fail: "Past Google's line", part: 'Past half the line', ok: 'Under half the line' },
  security: { one: 'limit', many: 'limits', pic: 'a bar for each limit, full at its alert', part: 'At the alert', ok: 'Under the alert' },
  support: { one: 'report', many: 'reports', pic: 'how long the oldest open report waits, of 24 hours', fail: 'Act now', part: 'Only staff can act', ok: 'In time' },
  cloudflare: { one: 'Worker', many: 'Workers', pic: 'a bar for each Worker, its requests in 24 hours', fail: 'Last build failed', part: 'Errors', ok: 'No errors' },
  supabase: { one: 'service', many: 'services', pic: 'a square for each service, and server errors against their line', fail: 'Not healthy', part: 'Throttled, or at its line', ok: 'Healthy' },
  worker: { one: 'request', many: 'requests', pic: 'a bar for each route, split by how long its requests took', sum: true, ok: 'Under 100 ms', run: 'Under 1 s', part: 'Under 10 s', fail: '10 s or more' },
  clients: { one: 'sync', many: 'syncs', pic: 'one bar split by how each sync ended', sum: true, fail: 'Error', part: 'Refused or too old', ok: 'OK', off: 'Offline' },
  fleet: { one: 'install', many: 'installs', pic: 'one bar split by the update each install runs', sum: true, fail: 'Crashed on 2% or more', part: 'Crashed', ok: 'Newest update', off: 'Older update' },
  people: { one: 'account', many: 'accounts', pic: 'one bar split by when each account was last active', sum: true, ok: 'Active today', run: 'Active this week', off: 'Not this week' }
});

/** A bar for each item against its limit: its name and value above, filled as far as it is used; a line where a store or an alert draws one. */
function meterSvg(part, at, r, mini) {
  const n = r.items.length, w = mini ? 210 : 320, LH = 30, h = n * LH, L = 2, R = w - 2;
  let body = '';
  r.items.forEach((x, i) => {
    const y = i * LH, share = Math.min(1, x.v / x.max), end = L + share * (R - L);
    body += '<text class="tx' + (r.mono || x.mono ? ' mono' : '') + '" x="' + L + '" y="' + (y + 11) + '">' + esc(String(x.name).slice(0, mini ? 26 : 40)) + '</text>' +
      '<text class="tx b" x="' + R + '" y="' + (y + 11) + '" text-anchor="end">' + esc(x.value) + '</text>' +
      '<rect class="mt" x="' + L + '" y="' + (y + 16) + '" width="' + (R - L) + '" height="8" rx="4"/>' +
      '<rect class="q ' + x.s + '" x="' + L + '" y="' + (y + 16) + '" width="' + Math.max(8, end - L).toFixed(1) + '" height="8" rx="4"/>' +
      (x.s === 'fail' || x.s === 'part' || x.s === 'run' ? '<circle class="q ' + x.s + '" cx="' + Math.max(L + 5, end - 1).toFixed(1) + '" cy="' + (y + 20) + '" r="5.5"/>' + markAt(x.s, Number(Math.max(L + 5, end - 1).toFixed(1)), y + 20, 0.8) : '');
    if (x.line) {
      const lx = L + (x.line / x.max) * (R - L);
      body += (x.half ? '<path class="hl" d="M' + (L + (x.line / 2 / x.max) * (R - L)).toFixed(1) + ' ' + (y + 17) + 'v6"/>' : '') + '<path class="ml" d="M' + lx.toFixed(1) + ' ' + (y + 13) + 'v14"/>';
    }
    // The tap covers the whole line, on top of what it draws.
    body += '<rect class="hit" data-i="' + i + '" x="0" y="' + y + '" width="' + w + '" height="' + LH + '"><title>' + esc(x.name + ': ' + x.value) + '</title></rect>';
  });
  return rowSvg(part, at, r, w, h, n, 1, body, 'a bar for each', mini ? 1 : 0);
}

/** One bar split by share: each part as wide as its count, at least 3 units so a small one stays a tap of its own; names under the wide parts. */
function shareSvg(part, at, r, mini) {
  const n = r.items.length, w = mini ? 210 : 320, h = 30, L = 2, R = w - 2, gap = 1.5;
  const total = r.items.reduce((a, x) => a + x.v, 0) || 1;
  const room = R - L - gap * (n - 1) - 3 * n;
  let x0 = L, body = '';
  r.items.forEach((x, i) => {
    const wd = 3 + (x.v / total) * Math.max(0, room);
    body += '<rect class="q ' + x.s + '" data-i="' + i + '" x="' + x0.toFixed(1) + '" y="2" width="' + wd.toFixed(1) + '" height="14" rx="2"><title>' +
      esc(itemName(x) + ': ' + Number(x.v).toLocaleString('en') + ' (' + ((x.v / total) * 100).toFixed(1) + '%)') + '</title></rect>' +
      (wd >= 12 ? markAt(x.s, Number((x0 + wd / 2).toFixed(1)), 9, 1) : '') +
      (wd >= 44 ? '<text class="tx" x="' + (x0 + 1).toFixed(1) + '" y="28">' + esc(String(itemName(x)).slice(0, Math.floor(wd / 5.5))) + '</text>' : '');
    x0 += wd + gap;
  });
  return rowSvg(part, at, r, w, h, n, n, body, 'one bar split by share', mini ? 1 : 0);
}
`;

export const METERS_CSS = String.raw`
svg.sq .mt { fill: var(--bg); stroke: var(--line); stroke-width: 1; } .pic svg.sq .mt { fill: var(--card); }
svg.sq .ml { stroke: var(--red); stroke-width: 2; } svg.sq .hl { stroke: var(--ink); stroke-width: 2; stroke-linecap: round; }
svg.sq .tx.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 8.5px; }
`;
