// What a diagnostics report points at (docs/diagnostics.md, "Reading a
// report"). Pure, so the thresholds are tested and a human, the CLI and
// Claude all read the same hypotheses off the same numbers.

interface TransferTotals {
  count?: number; bytes?: number; ms?: number; maxMs?: number;
  signMs?: number; fetchMs?: number; verifyMs?: number;
  failOffline?: number; failHttp4xx?: number; failHttp5xx?: number; failHash?: number; failDisk?: number; failOther?: number;
  failAuth?: number; failNotFound?: number; failTooLarge?: number; failBadDigest?: number; failGone?: number;
}

interface SyncTotals {
  count: number; p50Ms: number; p95Ms: number; pushNetMs: number | null; pullNetMs: number | null; applyMs: number | null;
  pages: number | null; pulled: number | null; maxPending: number | null; maxOfflineMs: number | null; outcomes: Record<string, number> | null;
  rejectedBy?: Partial<Record<'notMember' | 'notAllowed' | 'notListed' | 'invalid' | 'clockAhead' | 'other' | 'requeued', number>> | null;
  /** `phase:code` of syncs that ended in an error, with counts. */
  errorCodes?: Record<string, number> | null;
}

/** One `auth` group: an operation, how it ended and its code, with how often and the last record's numbers. */
export interface AuthGroup {
  op: string; outcome: string; code: string | null; action: string | null; count: number; lastAt: string;
  maxMs: number | null; last: Record<string, number> | null;
}

export interface InstallSummary {
  profileId: string;
  context: Record<string, string>;
  lastSeen: string;
  clockAheadS: number | null;
  sync: null | SyncTotals;
  /** The organization stream ('_org') on this phone. */
  orgSync?: null | Pick<SyncTotals, 'count' | 'p95Ms' | 'applyMs' | 'pulled' | 'outcomes' | 'errorCodes'> & { rejected?: number | null; lastAt?: string };
  transfer: null | Partial<Record<'up' | 'down', TransferTotals>>;
  /** Transfers outside the language's own lists, keyed `src:dir` (guide:up, source:down, stream:down). */
  otherTransfer?: null | Record<string, TransferTotals>;
  load: null | {
    count: number; p50Ms: number; p95Ms: number; maxEvents: number;
    readMs?: number | null; foldMs?: number | null; staleCheckpoints?: number; reasons?: Record<string, number> | null;
  };
  checkpoints?: null | { count: number; p95Ms: number; maxKb: number | null; pruned: number | null };
  opens?: null | { at: string; streamId: string; cold?: string; ms?: number; syncs?: number; pulled?: number; snapshotMs?: number; loadMs?: number }[];
  snapshots: null | { at: string; outcome: string; why?: string | null; ms?: number; chunks?: number; resumedChunks?: number; bytes?: number }[];
  /** A big language's first download by fill (decisions.md 147), newest first. */
  fills?: null | FillRecord[];
  device: null | {
    freeDiskMb?: number; totalDiskMb?: number; blobCacheMb?: number; blobsWanted?: number; at: string;
    lostFiles?: number; lostRecordings?: number; journalPending?: number; journalFailed?: number; uploadsWaiting?: number;
    oldestUnsentMin?: number; wantedStuckMin?: number; streams?: number; localEvents?: number; dbMb?: number; diagQueued?: number;
  };
  diagDropped?: number | null;
  errors: null | { name: string; where: string; code?: string | null; count: number; lastErrorId: string; lastAt: string }[];
  expected?: null | { where: string; name: string; code: string | null; count: number; lastAt: string }[];
  audio?: null | Partial<Record<'takes' | 'takeMs' | 'tooShort' | 'micRefused' | 'startFail' | 'stopFail' | 'saveFail' | 'encodeFail' | 'wavKept'
    | 'interrupted' | 'plays' | 'playFail' | 'playNotHere' | 'streamFail', number>>;
  auth?: null | AuthGroup[];
  nearby?: null | NearbySummary;
  releases: null | { updateId: string | null; from: string; to: string; records: number }[];
}

/** One Share nearby room as it stopped (docs/nearby-sync-plan.md section 11): why, its codes and counts, and the way it ran. */
export interface NearbyRoom {
  at: string; stop: string; mode?: string | null; code?: string | null; adv?: string | null; direct?: string | null; hotspot?: string | null;
  ms?: number; levelMs?: number; heard?: number; echoed?: number; alone?: number; maybe?: number; taps?: number; maxUnmatched?: number;
  pipeFails?: number; strangers?: number; busy?: number; noAnswer?: number; sessions?: number; done?: number; greets?: number; maxMeetMs?: number;
  openMin?: number; scanMin?: number; pauseMin?: number; syncMin?: number;
}

/** Library documents a session took from a teammate, and library files it got and served (2026-11-24): sessions and quiet rooms both total these. */
export type NearbyLibraryField = 'docsKept' | 'docsRefused' | 'docsMissing' | 'docsCapped' | 'docsUnreadable' | 'libGot' | 'libServed';

/**
 * A join on Let someone in and any session that moved a starting copy (review of 2026-11-24, item 14): joins granted, those whose
 * link went on to the ordinary steps, and what of a copy this phone took (`copy*` but `copyParts`, `copyNos`) or gave.
 */
export type NearbyCopyField = 'granted' | 'exchanged' | 'copyWhole' | 'copyFilled' | 'copyDocsKept' | 'copyDocsMissing' | 'copyDocsRefused' | 'copyParts' | 'copyNos'
  | 'exchangeOlder' | 'exchangeNoPieces' | 'exchangeLeft' | 'copyDocsCut' | 'copyDocsUnreadable';

/**
 * What held sharing while LangQuest was open over a minute with the app in front (2026-11-25, the app's `openWaitModel`): each
 * gate input's field, in the words a report says it in.
 */
export const OPEN_WAIT_HELD = {
  heldFeatureMs: 'the organization\'s setting not on this phone', heldSwitchMs: 'the switch off', heldAllowMs: 'permission not allowed',
  heldRadiosMs: 'a radio off', heldOfferedMs: 'Share nearby not offered', heldAudioMs: 'audio playing or recording',
  heldRestMs: 'resting', heldReadyMs: 'the language still opening', startingMs: 'starting'
} as const;

/** Why a rest began during such a wait, by its field. */
export const OPEN_WAIT_RESTS = {
  restPieces: 'the room\'s certificate or key missing', restStart: 'a start that failed or ran out of time', restRadio: 'a radio error',
  restUnwelcome: 'a phone turned away', restStopped: 'the room stopping by itself'
} as const;

export type OpenWaitField = keyof typeof OPEN_WAIT_HELD | keyof typeof OPEN_WAIT_RESTS;

/** What an install's Share nearby recorded over the window (`diag.install_summary`'s `nearby`). Counts and codes, never who. */
export interface NearbySummary {
  rooms?: NearbyRoom[] | null;
  roomTotals?: Partial<Record<'ms' | 'heard' | 'echoed' | 'alone' | 'maybe' | 'taps' | 'pipeFails' | 'strangers' | 'busy' | 'noAnswer' | 'sessions' | 'done', number>> | null;
  sessionTotals?: Partial<Record<'count' | 'ms' | 'fallbacks' | 'events' | 'sent' | 'files' | 'served' | 'fileFails' | 'refused' | 'overBudget'
    | 'keyRefused' | 'farAhead' | 'noRoom' | 'cutBackups' | 'older' | 'clockOff' | 'newerApp' | NearbyLibraryField | 'libHeld' | 'libTheirs' | NearbyCopyField, number>> | null;
  /** Rooms while LangQuest was open (15.8): their totals, how many, and how many met anyone. Their finished sessions are summed here, not in `ends`. */
  openTotals?: Partial<Record<'count' | 'met' | 'openMin' | 'scanMin' | 'pauseMin' | 'syncMin' | 'heard' | 'sessions' | 'done' | 'events' | 'sent' | 'files' | 'served'
    | 'fileFails' | 'fallbacks' | 'viaDirect' | 'maxMeetMs' | NearbyLibraryField, number>> | null;
  /** Waits of a minute or more while LangQuest was open (2026-11-25): how many, the longest, what held them and why rests began, summed; `why` counts missing pieces' reasons. */
  openWaits?: Partial<Record<'count' | 'waitMs' | 'maxWaitMs' | OpenWaitField, number>> & { why?: Record<string, number> | null } | null;
  /** `end` or `end:bye`. */
  ends?: Record<string, number> | null;
  /** `mode:refusal`: why this phone turned phones away (window, revoked, org, expired, pass-expired, other). */
  refusals?: Record<string, number> | null;
  /** Delivering teammates' work to the server (section 6). */
  deliver?: Partial<Record<'count' | 'ms' | 'sent' | 'events' | 'refused' | 'farAhead' | 'keyRefused' | 'noAnswer' | 'done', number>> & { stopped?: Record<string, number> | null } | null;
  links?: Record<string, number> | null;
  /** `room:CODE`, `session:CODE`, `find:CODE`. */
  codes?: Record<string, number> | null;
  blocked?: Record<string, number> | null;
  lastAt?: string;
}

export interface FillRecord {
  at: string; event: 'start' | 'done' | 'fallback' | 'restart'; why?: string | null; reason?: string | null; streamId?: string;
  ms?: number; msToMap?: number; headKb?: number; passages?: number; rows?: number;
}

/**
 * What the fill records say about one phone (decisions.md 147): a first
 * download that took the whole snapshot though it could have filled, a
 * fill that started over, one that has run for more than a day by the
 * phone's last word, and how long a finished one took.
 */
export function fillSignals(fills: readonly FillRecord[], lastHeard: string | null): { level: Signal['level']; text: string }[] {
  const out: { level: Signal['level']; text: string }[] = [];
  const fallback = fills.find((f) => f.event === 'fallback');
  if (fallback) {
    const server = ['no_cut', 'no_lines', 'old_lines'].includes(fallback.reason ?? '');
    out.push(server
      ? { level: 'problem', text: `At ${fallback.at} a first download took the whole snapshot: the server had no cut or lines for this language (${fallback.reason}). Check the projection pass on the job host.` }
      : { level: 'watch', text: `At ${fallback.at} a first download took the whole snapshot instead of filling (${fallback.reason ?? '?'}).` });
  }
  const restarts = fills.filter((f) => f.event === 'restart').length;
  if (restarts) out.push({ level: 'watch', text: `A fill started over ${restarts} time${restarts === 1 ? '' : 's'}: the cut it filled from went away (a server rolled back, or a snapshot dropped).` });
  const latest = fills.find((f) => f.event === 'start' || f.event === 'done' || f.event === 'restart');
  if (latest?.event === 'start' && lastHeard) {
    const ms = Date.parse(lastHeard) - Date.parse(latest.at);
    if (ms > 24 * 3600_000) out.push({ level: 'watch', text: `A fill began ${latest.at} and had not finished ${secs(ms)} later (${latest.passages ?? '?'} passages, ${latest.rows ?? '?'} rows): the phone is rarely online long enough. Its lists are exact; passages not reached open as their line offline.` });
  }
  const done = fills.find((f) => f.event === 'done');
  if (done?.ms !== undefined && done.ms > 24 * 3600_000) out.push({ level: 'info', text: `A fill took ${secs(done.ms)} to finish (${done.passages ?? '?'} passages).` });
  return out;
}

export interface LanguageHealth {
  events: { events: number; maxSeq: number; events7d: number; lastEventAt: string | null };
  reducerVersion: number;
  snapshots: { reducerVersion: number; seq: number; createdAt: string; tail: number; bytes: number | null }[];
  blobs: { count: number; bytes: number; maxBytes: number };
  roles: Record<string, number>;
}

export interface Member {
  profile_id: string;
  roles: string;
  devices: string[] | null;
  last_event_at: string | null;
  installs: string[] | null;
  last_diag_at: string | null;
}

export interface RpcStat { rpc: string; calls: number; mean_ms: number; max_ms: number; total_s: number; rows_per_call: number }

/**
 * RPCs only the server's own jobs call (granted to service_role alone, a
 * test holds it): nobody waits on them, and put_snapshot writing a big
 * language's snapshot takes seconds by design.
 */
export const BACKGROUND_RPCS: ReadonlySet<string> = new Set(['put_snapshot', 'stage_snapshot_units', 'put_passage_lines',
  'diag_job_ingest', 'record_notification_pushes', 'refresh_org_notifications']);
/** An RPC called fewer times than this has no average worth an alert yet. */
export const RPC_MIN_CALLS = 20;
/** Mean time past which a person waiting on an RPC notices. */
export const RPC_SLOW_MS = 500;

/** The RPCs people wait on that are slow on average, over enough calls to say so. */
export const slowRpcs = (rpc: readonly RpcStat[]): RpcStat[] =>
  rpc.filter((r) => !BACKGROUND_RPCS.has(r.rpc) && r.calls >= RPC_MIN_CALLS && r.mean_ms > RPC_SLOW_MS);

interface Signal {
  level: 'problem' | 'watch' | 'info';
  /** Install the signal is about, or null for the language or the server. */
  install: string | null;
  text: string;
  /** For a job's signal: its kind and job, the ops dashboard's name for the line (apps/admin/src/alertKinds.ts). */
  key?: 'job-stopped' | 'job-failing' | 'job-failures' | 'job-partial' | 'push-delivery-low';
  job?: string;
}

/** How a report names a transfer source. */
const SOURCE: Record<string, string> = {
  guide: 'guide media', handover: 'hand-over', stream: 'streamed-play', source: 'source audio', help: 'help audio', study: 'study file'
};

/**
 * Which build a phone or browser ran, from its diagnostics context, as
 * support asks it: a phone's store build (number and version, its
 * `appVersion`) and the OTA update it runs, or none when it runs the store
 * build's own code; a browser's commit. Phones from before the store build
 * was sent (2026-11-03) show their runtime instead. The update is cut to the
 * seven characters the app shows under Sync, Details.
 */
export function buildLabel(c: Readonly<Record<string, string | undefined>>): string {
  if (c.os === 'web') return `web build ${c.runtimeVersion ? c.runtimeVersion.slice(0, 12) : '?'}`;
  const store = /^(\S+) \((\S+)\)$/.exec(c.appVersion ?? '');
  const build = store ? `build ${store[2]} (${store[1]})`
    : c.appVersion ? `build ? (${c.appVersion})` : `build ? (runtime ${c.runtimeVersion ? c.runtimeVersion.slice(0, 8) : '?'})`;
  const update = c.embedded === 'yes' ? 'no OTA update' : c.updateId ? `OTA update ${c.updateId.slice(0, 7)}` : 'OTA update ?';
  return `${build} · ${update}${c.channel ? ` (${c.channel})` : ''}`;
}

const KB = 1024;
const MB = 1024 * KB;

/** Bytes per second over the time spent on the network (falls back to whole-transfer time). */
export function throughput(t: TransferTotals | undefined): number | null {
  if (!t?.bytes) return null;
  const ms = t.fetchMs || t.ms;
  return ms ? (t.bytes * 1000) / ms : null;
}

function kbps(bytesPerSecond: number): string {
  return `${(bytesPerSecond / KB).toFixed(1)} KB/s`;
}

function secs(ms: number): string {
  if (ms >= 48 * 3_600_000) return `${Math.round(ms / 86_400_000)} days`;
  if (ms >= 2 * 3_600_000) return `${Math.round(ms / 3_600_000)} h`;
  return ms >= 120_000 ? `${Math.round(ms / 60_000)} min` : `${(ms / 1000).toFixed(1)} s`;
}

const BLOCKED: Record<string, string> = {
  'permission-blocked': 'its permissions were refused for good: they are turned on in the phone\'s settings',
  'permission-approximate': 'location was granted only as approximate, and Wi-Fi Direct needs precise on Android 12',
  'bluetooth-off': 'Bluetooth was off', 'wifi-off': 'Wi-Fi was off', 'location-off': 'Location was off (Android 10 and 11 scan nothing without it)',
  'no-certificate': 'the phone held no certificate or discovery key for this organization and language: it has not reached the server since nearby was turned on, or the language was never opened online',
  'no-key': 'the phone had no nearby key yet', 'android-too-old': 'the phone runs Android 9 or older',
  'no-bluetooth-le': 'the phone has no Bluetooth LE', 'no-wifi-direct': 'the phone has no Wi-Fi Direct', 'not-in-build': 'the build has no nearby module'
};

/** Why this phone turned a phone away as `identity`, other than the quiet mode's window. */
const REFUSED: Record<string, string> = {
  revoked: 'its key was revoked (a lost phone reported, or a member removed)',
  org: 'its certificate is for another organization',
  expired: 'its certificate expired',
  'pass-expired': 'they were let in offline, and their 90 days from being let in, or their inviter\'s pass, ran out',
  other: 'its proof or certificate did not check'
};

/**
 * What Share nearby's records say about one phone (docs/nearby-sync-plan.md section 11): why it
 * could not run, a room that heard nobody or was never echoed, a radio that cannot advertise,
 * connections that failed, strangers' openings, sessions that did not finish and by what, the link
 * the work went over, and the phone short of room; and, from 2026-11-24, what sharing while
 * LangQuest was open did (its rooms read apart, since hearing nobody is no fault there), why this
 * phone turned phones away, what delivery to the server refused, and library documents from a
 * teammate that did not check. Counts and codes only;
 * nothing names the other phone.
 */
export function nearbySignals(x: NearbySummary | null | undefined): { level: Signal['level']; text: string }[] {
  if (!x) return [];
  const out: { level: Signal['level']; text: string }[] = [];
  const add = (level: Signal['level'], text: string) => out.push({ level, text });
  const times = (n: number) => (n === 1 ? 'once' : `${n} times`);
  for (const [why, n] of Object.entries(x.blocked ?? {})) add('problem', `Share nearby could not run ${times(n)}: ${BLOCKED[why] ?? why}.`);
  // Rooms while LangQuest is open hear nobody whenever the phone is open alone, which is no fault: they are read apart.
  const rooms = (x.rooms ?? []).filter((r) => r.mode !== 'open');
  // A bare advert heard alone (an iPhone's) is someone heard too: `heard` counts only full matches (2026-11-19).
  const deaf = rooms.filter((r) => !r.heard && !r.alone);
  if (deaf.length) {
    add('problem', `Share nearby ran ${deaf.length} time${deaf.length === 1 ? '' : 's'} and heard no teammate's phone (stopped ${[...new Set(deaf.map((r) => r.stop))].join(', ')}): nobody else had it open on this language, or this phone's scan hears nothing (Bluetooth, a maker that holds back scan results, the scan limit).`);
  }
  const leftEarly = rooms.filter((r) => (r.alone ?? 0) > 0 && !r.heard && !r.maybe && !r.sessions);
  if (leftEarly.length) {
    add('watch', `Share nearby heard another iPhone by its advert alone in ${leftEarly.length} room${leftEarly.length === 1 ? '' : 's'} but closed before Connect was offered: two iPhones connect only by a tap, offered after a short while (tapAfterAloneMs).`);
  }
  if (rooms.some((r) => r.adv === 'no')) add('problem', `This phone cannot advertise over Bluetooth LE: teammates never hear it, and it meets only phones that can (plan section 11).`);
  const unechoed = rooms.filter((r) => (r.heard ?? 0) > 0 && !r.echoed);
  if (unechoed.length) add('watch', `Teammates were heard but never echoed this phone in ${unechoed.length} room${unechoed.length === 1 ? '' : 's'} (${unechoed.reduce((s, r) => s + (r.maybe ?? 0), 0)} taps offered, ${unechoed.reduce((s, r) => s + (r.taps ?? 0), 0)} taken): one-way hearing, or the other phone cannot advertise.`);
  const t = x.roomTotals ?? {};
  if (t.pipeFails) add('watch', `${t.pipeFails} Bluetooth connection${t.pipeFails === 1 ? '' : 's'} to a teammate would not open${Object.keys(x.codes ?? {}).some((k) => k.startsWith('room:')) ? ` (${Object.entries(x.codes ?? {}).filter(([k]) => k.startsWith('room:')).map(([k, n]) => `${k.slice(5)} ×${n}`).join(', ')})` : ''}.`);
  if (t.strangers) add('info', `${t.strangers} connection${t.strangers === 1 ? '' : 's'} never passed the opening: strangers, a played-back advert, or a teammate on a discovery key this phone does not hold.`);
  const finds = Object.entries(x.codes ?? {}).filter(([k]) => k.startsWith('find:'));
  if (finds.length) add('problem', `Find failed on the phone: ${finds.map(([k, n]) => `${k.slice(5)} ×${n}`).join(', ')}.`);
  const ends = Object.entries(x.ends ?? {});
  // A finished session while LangQuest was open writes no record of its own: its room counts it.
  const total = ends.reduce((sum, [, n]) => sum + n, 0) + (x.openTotals?.done ?? 0);
  const unfinished = ends.filter(([k]) => k !== 'done' && k !== 'heard:done' && k !== 'said:done');
  const bad = unfinished.reduce((sum, [, n]) => sum + n, 0);
  if (bad) {
    const codes = Object.entries(x.codes ?? {}).filter(([k]) => k.startsWith('session:')).map(([k, n]) => `${k.slice(8)} ×${n}`);
    add(bad / total > 0.3 ? 'problem' : 'watch', `${bad} of ${total} nearby sessions did not finish: ${unfinished.map(([k, n]) => `${n} ${k}`).join(', ')}${codes.length ? ` (${codes.join(', ')})` : ''}.`);
  }
  const s = x.sessionTotals ?? {};
  const links = Object.entries(x.links ?? {});
  if (links.length && !links.some(([k]) => k !== 'bluetooth')) add('watch', `Every nearby session that moved work went over Bluetooth (${s.fallbacks ?? 0} fallbacks): Wi-Fi Direct and the hotspot did not come up, so recordings wait.`);
  else if ((x.links?.hotspot ?? 0) > 0) add('info', `${x.links!.hotspot} nearby session${x.links!.hotspot === 1 ? '' : 's'} fell back to the hotspot: Wi-Fi Direct did not come up.`);
  if (s.noRoom) add('problem', `${s.noRoom} nearby session${s.noRoom === 1 ? '' : 's'} found no room for teammates' recordings: the phone cannot carry everything (plan 5.6).`);
  if (s.fileFails) add('watch', `${s.fileFails} recording${s.fileFails === 1 ? '' : 's'} from a teammate's phone failed to arrive or to check.`);
  if (s.newerApp) add('problem', `A teammate's phone runs an app this one shares no protocol with (${times(s.newerApp)}): one of them needs a newer app.`);
  if (s.clockOff) add('watch', `A teammate's clock differed from this phone's by over five minutes in ${s.clockOff} session${s.clockOff === 1 ? '' : 's'}.`);
  if (s.keyRefused) add('watch', `${s.keyRefused} newer discovery key${s.keyRefused === 1 ? '' : 's'} handed on by a teammate did not check.`);
  const o = x.openTotals;
  if (o?.count) {
    add('info', `Shared while LangQuest was open ${times(o.count)} for ${o.openMin ?? 0} min (radios off ${o.pauseMin ?? 0}, scanning ${o.scanMin ?? 0}, syncing ${o.syncMin ?? 0}); met a teammate in ${o.met ?? 0}, ${o.done ?? 0} sessions finished, ${o.events ?? 0} events and ${o.files ?? 0} recordings in.`);
  }
  // What held it with the app in front, the longest first, and why rests began (2026-11-25).
  const w = x.openWaits;
  if (w?.count) {
    const held = (Object.keys(OPEN_WAIT_HELD) as (keyof typeof OPEN_WAIT_HELD)[]).filter((k) => (w[k] ?? 0) > 0)
      .sort((a, b) => (w[b] ?? 0) - (w[a] ?? 0)).map((k) => `${OPEN_WAIT_HELD[k]} ${secs(w[k]!)}`);
    const why = Object.keys(w.why ?? {});
    const rests = (Object.keys(OPEN_WAIT_RESTS) as (keyof typeof OPEN_WAIT_RESTS)[]).filter((k) => (w[k] ?? 0) > 0)
      .map((k) => `${OPEN_WAIT_RESTS[k]} ${times(w[k]!)}${k === 'restPieces' && why.length ? ` (${why.join(', ')})` : ''}`);
    add('watch', `Sharing while LangQuest was open waited over a minute ${times(w.count)} with the app in front (longest ${secs(w.maxWaitMs ?? 0)}): held by ${held.join(', ') || 'nothing recorded'}${rests.length ? `; rests began for: ${rests.join(', ')}` : ''}.`);
  }
  for (const [k, n] of Object.entries(x.refusals ?? {})) {
    const [mode, why] = k.split(':');
    const where = mode === 'open' ? 'while LangQuest was open' : mode === 'join' ? 'on Let someone in' : 'on Share nearby';
    if (why === 'window') add('watch', `${mode === 'open' ? 'While LangQuest was open' : 'On Share nearby'} this phone turned a teammate away ${times(n)} because their certificate and the day they last met here were over two weeks old: they meet on Share nearby to share quietly again (15.8).`);
    else add(why === 'revoked' ? 'problem' : 'watch', `This phone turned away a phone ${where} ${times(n)}: ${REFUSED[why ?? ''] ?? why}.`);
  }
  // A starting copy this phone took (review of 2026-11-24, item 14): one never whole leaves a newcomer short of what its inviter had.
  if ('copyWhole' in s && !s.copyWhole) {
    add('watch', `This phone took part of a starting copy but never a whole one (${s.copyFilled ?? 0} passages filled, ${s.copyDocsMissing ?? 0} documents not given): it finishes from any teammate with Share nearby open, or once online.`);
  }
  if (s.copyDocsRefused) add('watch', `${s.copyDocsRefused} document${s.copyDocsRefused === 1 ? '' : 's'} of a starting copy from a teammate's phone did not check: one of the two may need a newer app.`);
  // Joins whose link never went on to the newest work after the copy, by why (review of 2026-11-24, item 14). Pieces that would
  // not open are this phone's own fault, and the decision of 2026-11-24 on the join's link is reversed if they are common.
  const joins = (n: number) => `${n} join${n === 1 ? '' : 's'} on Let someone in`;
  if (s.exchangeOlder) add('info', `${joins(s.exchangeOlder)} ended with the starting copy, without the newest work after it, because the other phone's app is older: that work comes from the next teammate met, or online.`);
  if (s.exchangeNoPieces) add('watch', `${joins(s.exchangeNoPieces)} came away with a whole starting copy, but this phone could not open its own language for the newest work after it: that work comes from the next teammate met, or online. An expected "join: own language" says why when it failed; if this is common, the decision of 2026-11-24 on the join's link is reversed.`);
  if (s.exchangeLeft) add('info', `${joins(s.exchangeLeft)} ended after a whole starting copy, before the newest work followed, because the person left the screen: that work comes from the next teammate met, or online.`);
  // Library documents a teammate's phone sent that did not check (2026-11-24): not a weak link, a fault on one side.
  const docsRefused = (s.docsRefused ?? 0) + (o?.docsRefused ?? 0);
  if (docsRefused) add('watch', `${docsRefused} library document${docsRefused === 1 ? '' : 's'} from a teammate's phone did not check (its name, form or contents, or a format this build cannot take): one of the two may need a newer app.`);
  // Whole and genuine, in a format a newer build added (review item 28): skipped, not refused, so no fault; this phone needs a newer app to use them.
  const docsUnreadable = (s.docsUnreadable ?? 0) + (o?.docsUnreadable ?? 0) + (s.copyDocsUnreadable ?? 0);
  if (docsUnreadable) add('info', `${docsUnreadable} library document${docsUnreadable === 1 ? '' : 's'} from a teammate's phone came whole in a format this app cannot read, and ${docsUnreadable === 1 ? 'was' : 'were'} skipped: this phone needs a newer app to use ${docsUnreadable === 1 ? 'it' : 'them'}.`);
  // A copy whole before its names and documents, whose link went during them (review item 3): the person was set, and the rest comes later.
  if (s.copyDocsCut) add('info', `${s.copyDocsCut} starting cop${s.copyDocsCut === 1 ? 'y was' : 'ies were'} whole, but the link went during the names or documents after: the rest comes from the next teammate met, or online.`);
  const d = x.deliver;
  if (d?.refused) add('watch', `Delivering teammates' work to the server, ${d.refused} event${d.refused === 1 ? ' was' : 's were'} refused here (${d.farAhead ?? 0} stamped too far ahead, ${d.keyRefused ?? 0} a revoked key's).`);
  return out;
}

/** The `expected` tallies Share nearby writes, with what each means. */
const NEARBY_EXPECTED: Record<string, string> = {
  nearby_attest: 'the Worker could not vouch for pulled work, so teammates get it only from the server',
  'nearby: ready to carry': 'Ready to carry could not read what the phone holds',
  'nearby: history': 'History could not say which rows came from a teammate\'s phone'
};

/**
 * The report's signals, ranked. `health` is the language as a cold phone
 * meets it; null for the organization report, which has no one language.
 */
export function signals(health: LanguageHealth | null, members: Member[], summary: Record<string, InstallSummary>, rpc: RpcStat[]): Signal[] {
  const out: Signal[] = [];
  const add = (level: Signal['level'], install: string | null, text: string) => out.push({ level, install, text });

  function failures(t: TransferTotals, what: string, install: string): void {
    const causes: [string, number | undefined][] = [
      ['link dropped', t.failOffline], ['sign-in refused (401/403)', t.failAuth], ['not on the server (404)', t.failNotFound],
      ['too large to upload (413)', t.failTooLarge], ['server saw a different file (422)', t.failBadDigest], ['refused (4xx)', t.failHttp4xx],
      ['server error (5xx)', t.failHttp5xx], ['hash mismatch', t.failHash], ['gone from the device', t.failGone], ['disk', t.failDisk], ['other', t.failOther]
    ];
    const failed = causes.reduce((sum, [, n]) => sum + (n ?? 0), 0);
    if (!failed) return;
    const parts = causes.filter(([, n]) => n).map(([k, n]) => `${n} ${k}`).join(', ');
    add(failed / (t.count ?? failed) > 0.2 ? 'problem' : 'watch', install, `${failed} of ${t.count} ${what} failed: ${parts}.`);
    if (t.failTooLarge) add('problem', install, `A file is too large for the server to take; it is retried forever and never uploads. Find it by size, not by name.`);
    if (t.failGone) add('problem', install, `${t.failGone} upload${t.failGone === 1 ? '' : 's'} found the recording gone from the device before it reached the server: that work is lost unless recorded again.`);
  }

  function outcomeSignals(x: { outcomes?: Record<string, number> | null; errorCodes?: Record<string, number> | null }, what: string, install: string): void {
    const text: Record<string, string> = {
      refused: 'refused: not a member or not allowed',
      too_old: 'with "app too old" (LQ001)',
      unrenewed: 'unable to renew the sign-in (a rate limit, a server error or a captive portal): the phone looked offline but was not',
      error: 'with an unexpected error'
    };
    for (const bad of ['refused', 'too_old', 'unrenewed', 'error'] as const) {
      const n = x.outcomes?.[bad];
      if (!n) continue;
      const codes = bad === 'error' && x.errorCodes ? ` (${Object.entries(x.errorCodes).sort((a, b) => b[1] - a[1]).map(([k, c]) => `${k} ×${c}`).join(', ')})` : '';
      add('problem', install, `${n} ${what}${n === 1 ? '' : 's'} ended ${text[bad]}${codes}.`);
    }
  }

  function deviceSignals(s: InstallSummary, install: string): void {
    const d = s.device;
    if (d?.lostFiles || d?.lostRecordings) add('problem', install, `The phone lost ${d.lostFiles ?? 0} file${d.lostFiles === 1 ? '' : 's'} behind the app's back, ${d.lostRecordings ?? 0} of them recordings never sent (decisions.md 92): storage cleaned by the system, or a full disk.`);
    if (d?.journalFailed) add('problem', install, `${d.journalFailed} recording${d.journalFailed === 1 ? '' : 's'} could not be recovered after the app stopped mid-save.`);
    if ((d?.oldestUnsentMin ?? 0) > 24 * 60) add('problem', install, `A recording has waited ${secs((d?.oldestUnsentMin ?? 0) * 60_000)} to upload (${d?.uploadsWaiting ?? '?'} waiting).`);
    if ((d?.wantedStuckMin ?? 0) > 24 * 60) add('watch', install, `A download has been wanted for ${secs((d?.wantedStuckMin ?? 0) * 60_000)} (${d?.blobsWanted ?? '?'} still wanted).`);
    if (s.diagDropped) add('info', install, `${s.diagDropped} diagnostics record${s.diagDropped === 1 ? ' was' : 's were'} dropped on the phone to stay under 3000: the history here is incomplete.`);
    else if ((d?.diagQueued ?? 0) > 1000) add('info', install, `${d?.diagQueued} records were still waiting on the phone at the last delivery.`);
  }

  function audioSignals(s: InstallSummary, install: string): void {
    const a = s.audio;
    if (!a) return;
    if (a.micRefused) add('problem', install, `The microphone was refused ${a.micRefused} time${a.micRefused === 1 ? '' : 's'}: permission is off for the app.`);
    const failed = (a.startFail ?? 0) + (a.stopFail ?? 0) + (a.saveFail ?? 0);
    if (failed) add('problem', install, `Recording failed ${failed} time${failed === 1 ? '' : 's'} (${a.startFail ?? 0} start, ${a.stopFail ?? 0} stop, ${a.saveFail ?? 0} save) against ${a.takes ?? 0} takes; the error codes say why.`);
    if (a.encodeFail) add('watch', install, `${a.encodeFail} take${a.encodeFail === 1 ? '' : 's'} could not be compressed; ${a.wavKept ?? 0} kept as WAV, about five times the size to upload.`);
    if (a.takes && (a.tooShort ?? 0) > a.takes * 0.3) add('watch', install, `${a.tooShort} takes were too short to keep against ${a.takes} kept: the button may be released too soon, or voice detection cuts too early.`);
    if (a.interrupted) add('info', install, `Recording was interrupted ${a.interrupted} time${a.interrupted === 1 ? '' : 's'} (a call, or the app sent to the background).`);
    const playFailed = (a.playFail ?? 0) + (a.streamFail ?? 0);
    if (playFailed && playFailed > (a.plays ?? 0) * 0.1) add('watch', install, `Playback failed ${playFailed} time${playFailed === 1 ? '' : 's'} (${a.streamFail ?? 0} could not stream) against ${a.plays ?? 0} plays.`);
    if ((a.playNotHere ?? 0) > 10) add('info', install, `${a.playNotHere} times someone tapped a recording not yet on the phone.`);
  }

  function authSignals(s: InstallSummary, install: string): void {
    for (const g of s.auth ?? []) {
      const code = g.code ? ` (${g.code})` : '';
      const times = g.count === 1 ? 'once' : `${g.count} times`;
      if (g.op === 'ended') add('problem', install, `Signed out by the server${code} ${times}, last ${g.lastAt}, with ${g.last?.pending ?? 0} events not yet sent.`);
      else if (g.op === 'renew' && g.outcome !== 'ok') add('watch', install, `The sign-in could not be renewed (${g.outcome}${g.last?.status ? ` ${g.last.status}` : ''}) ${times}.`);
      else if ((g.op === 'redeem' || g.op === 'join') && !['ok', 'offline', 'needs_name'].includes(g.outcome)) add('problem', install, `Joining by invite ended "${g.outcome}"${code} ${times}${g.last?.attempt ? ` (attempt ${g.last.attempt})` : ''}.`);
      else if (g.op === 'org_list' && g.outcome !== 'ok') add('problem', install, `The list of the person's organizations could not be fetched${code} ${times}: a new phone cannot open their organization.`);
      else if (g.op === 'route' && g.outcome !== 'home') add(g.outcome === 'org_unknown' ? 'problem' : 'info', install, `After signing in the app went to "${g.outcome}" ${times}.`);
      else if (g.op === 'route' && (g.maxMs ?? 0) > 60_000) add('watch', install, `Getting from sign-in to the home screen took up to ${secs(g.maxMs ?? 0)}.`);
      else if (g.op === 'courier' && (g.outcome === 'gone' || g.outcome === 'unreachable')) add('problem', install, `Work left by another person on this shared phone could not be handed over ("${g.outcome}") ${times}: ${g.last?.eventsLeft ?? 0} events and ${g.last?.uploadsLeft ?? 0} uploads waiting.`);
      else if (g.op === 'outbox' && g.outcome === 'failed') add('problem', install, `An account change (${g.action ?? '?'}) was refused for good${code} ${times}.`);
      else if (g.op === 'outbox' && (g.last?.ageH ?? 0) > 24) add('watch', install, `An account change (${g.action ?? '?'}) has been retried for ${Math.round(g.last?.ageH ?? 0)} h${code}.`);
      else if (['sign_in', 'sign_up', 'code', 'v2'].includes(g.op) && ['rate_limited', 'server'].includes(g.outcome)) add('watch', install, `Signing in (${g.op}) ended "${g.outcome}"${code} ${times}.`);
      else if (g.op === 'delete' && g.outcome !== 'ok') add('problem', install, `Deleting the account failed${code} ${times}.`);
    }
  }

  // The language's stream as a cold phone meets it.
  const current = health?.snapshots.find((s) => s.reducerVersion === health.reducerVersion);
  if (health && !current && health.events.events > 2000) {
    add('problem', null, `No snapshot for reducer ${health.reducerVersion}: a new phone folds all ${health.events.events} events from the log. Check the snapshot worker (npm run snapshot).`);
  } else if (current && current.tail > 5000) {
    add('watch', null, `The snapshot is ${current.tail} events behind the log; a new phone pulls and folds those one page at a time.`);
  }
  if (current?.bytes && current.bytes > 20 * MB) add('watch', null, `The snapshot is ${(current.bytes / MB).toFixed(1)} MB of JSON; parsing it can take seconds on a slow phone.`);

  for (const [install, s] of Object.entries(summary)) {
    const down = s.transfer?.down;
    const rate = throughput(down);
    if (down && rate !== null && rate < 20 * KB) add('problem', install, `Downloads ran at ${kbps(rate)} on the network (${down.count} files, ${((down.bytes ?? 0) / MB).toFixed(1)} MB): a slow link.`);
    if (down?.verifyMs && down.fetchMs && down.verifyMs > down.fetchMs) {
      add('problem', install, `Checking downloads on the phone (read + hash) took ${secs(down.verifyMs)} against ${secs(down.fetchMs)} on the network: the phone, not the link, is the bottleneck.`);
    }
    for (const [dir, t] of Object.entries(s.transfer ?? {}) as ['up' | 'down', TransferTotals][]) {
      failures(t, dir === 'down' ? 'downloads' : 'uploads', install);
    }
    for (const [key, t] of Object.entries(s.otherTransfer ?? {})) {
      const [src, dir] = key.split(':');
      failures(t, `${SOURCE[src ?? ''] ?? src} ${dir === 'down' ? 'downloads' : 'uploads'}`, install);
    }
    if (s.sync) {
      const net = (s.sync.pullNetMs ?? 0) + (s.sync.pushNetMs ?? 0);
      if ((s.sync.applyMs ?? 0) > 10_000 && (s.sync.applyMs ?? 0) > 1.5 * net) {
        add('problem', install, `Sync spent ${secs(s.sync.applyMs ?? 0)} folding and writing on the phone against ${secs(net)} waiting on the network: phone-bound.`);
      } else if (net > 60_000 && net > 1.5 * (s.sync.applyMs ?? 0)) {
        add('watch', install, `Sync spent ${secs(net)} waiting on the network over ${s.sync.pages ?? '?'} pages: link-bound.`);
      }
      if (s.sync.p95Ms > 30_000) add('watch', install, `Slowest syncs (p95) take ${secs(s.sync.p95Ms)}.`);
      outcomeSignals(s.sync, 'sync', install);
      const rej = s.sync.rejectedBy ?? {};
      if (rej.invalid) add('problem', install, `${rej.invalid} event${rej.invalid === 1 ? ' was' : 's were'} rejected as invalid: the app wrote something the server's validation refuses (core and SQL disagree, or an old build).`);
      if (rej.notMember || rej.notAllowed) add('watch', install, `Work was refused for membership: ${rej.notMember ?? 0} not a member, ${rej.notAllowed ?? 0} not allowed (${rej.requeued ?? 0} queued again after a role change).`);
      if (rej.clockAhead) add('watch', install, `${rej.clockAhead} event${rej.clockAhead === 1 ? ' was' : 's were'} refused for a clock ahead of the server and stamped again.`);
      if ((s.sync.maxOfflineMs ?? 0) > 24 * 3_600_000) add('info', install, `Longest time offline: ${secs(s.sync.maxOfflineMs ?? 0)}.`);
      if ((s.sync.maxPending ?? 0) > 1000) add('watch', install, `Up to ${s.sync.maxPending} events waited to be pushed.`);
    }
    if (s.load && s.load.p95Ms > 5000) {
      const split = s.load.readMs && s.load.foldMs ? ` (reading the store ${secs(s.load.readMs)}, folding ${secs(s.load.foldMs)} in total)` : '';
      add('watch', install, `Opening the language takes ${secs(s.load.p95Ms)} (p95) to fold up to ${s.load.maxEvents} local events${split}.`);
    }
    if (s.load?.staleCheckpoints) add('info', install, `An update changed the reducer: the phone dropped its checkpoint ${s.load.staleCheckpoints} time${s.load.staleCheckpoints === 1 ? '' : 's'} and fetched the stream again (decisions.md 110). A language that looked empty right after an update is this.`);
    const refolds = Object.entries(s.load?.reasons ?? {}).filter(([k]) => k !== 'open').reduce((sum, [, n]) => sum + n, 0);
    if (refolds > 20) add('watch', install, `The language was folded again ${refolds} times beyond opening it (${Object.entries(s.load?.reasons ?? {}).filter(([k]) => k !== 'open').map(([k, n]) => `${n} ${k}`).join(', ')}): each one is the whole fold on the phone.`);
    if (s.checkpoints && s.checkpoints.p95Ms > 3000) add('watch', install, `Checkpoints take ${secs(s.checkpoints.p95Ms)} (p95) for a state of up to ${s.checkpoints.maxKb ?? '?'} KB; the screen can stall while one is written.`);
    for (const o of s.opens ?? []) {
      if (o.cold === 'yes' && (o.ms ?? 0) > 5 * 60_000) { add('watch', install, `A first open of ${o.streamId} took ${secs(o.ms ?? 0)} to pull everything (${o.syncs ?? '?'} syncs, snapshot ${secs(o.snapshotMs ?? 0)}).`); break; }
    }
    if (s.orgSync) {
      outcomeSignals(s.orgSync, 'organization sync', install);
      if (s.orgSync.p95Ms > 30_000) add('watch', install, `Organization stream syncs take ${secs(s.orgSync.p95Ms)} (p95).`);
    }
    if (!s.sync && !s.load && s.orgSync) add('info', install, `This phone synced the organization (${s.orgSync.count} times, last ${s.orgSync.lastAt ?? '?'}) but recorded nothing about this language in the window: it has not opened it.`);
    for (const snap of s.snapshots ?? []) {
      if (snap.outcome === 'none') { add('problem', install, `At ${snap.at} this phone found no snapshot and folded the log from the start.`); break; }
    }
    const lastHeard = (s.releases ?? []).reduce<string | null>((max, r) => (!max || r.to > max ? r.to : max), null);
    for (const f of fillSignals(s.fills ?? [], lastHeard)) add(f.level, install, f.text);
    const resumed = (s.snapshots ?? []).filter((x) => (x.resumedChunks ?? 0) > 0).length;
    if (resumed) add('info', install, `A snapshot download resumed after a dropped link ${resumed} time${resumed === 1 ? '' : 's'}.`);
    if (s.device?.freeDiskMb !== undefined && s.device.freeDiskMb < 500) add('problem', install, `Only ${s.device.freeDiskMb} MB free on the phone.`);
    deviceSignals(s, install);
    if ((s.clockAheadS ?? 0) > 300) add('watch', install, `The phone's clock runs about ${Math.round((s.clockAheadS ?? 0) / 60)} min ahead of the server.`);
    for (const e of s.errors ?? []) add('problem', install, `${e.count}× ${e.name}${e.code ? ` (${e.code})` : ''} at "${e.where}" (latest ${e.lastErrorId}, ${e.lastAt}).`);
    for (const e of s.expected ?? []) {
      if (e.count >= 10) add('watch', install, `${e.count}× an expected failure at "${e.where}" (${e.name}${e.code ? `, ${e.code}` : ''}), last ${e.lastAt}: shown to the person each time, but this often is a pattern.`);
    }
    audioSignals(s, install);
    authSignals(s, install);
    for (const n of nearbySignals(s.nearby)) add(n.level, install, n.text);
    for (const e of s.expected ?? []) {
      const meaning = NEARBY_EXPECTED[e.where];
      if (!meaning) continue;
      // A mismatch is the Worker signing what this phone does not hold: never expected.
      if (e.where === 'nearby_attest' && e.name === 'mismatch') add('problem', install, `${e.count}× the Worker's attestation did not match this phone's rows (last ${e.lastAt}).`);
      else add('watch', install, `${e.count}× ${meaning} ("${e.where}", ${e.name}${e.code ? `, ${e.code}` : ''}), last ${e.lastAt}.`);
    }
    const updates = new Set((s.releases ?? []).map((r) => r.updateId));
    if (updates.size > 1) add('info', install, `Ran ${updates.size} app updates in the window; compare before and after.`);
  }

  const heard = new Set(Object.values(summary).map((s) => s.profileId));
  for (const m of members) {
    if (heard.has(m.profile_id)) continue;
    if (!m.installs?.length) {
      add('watch', null, `Member ${m.profile_id} (${m.roles}) has never delivered diagnostics: the phone has not synced since installing this build, is on an older build, or has diagnostics off. Last event pushed here: ${m.last_event_at ?? 'never'}.`);
    } else {
      add('info', null, `Member ${m.profile_id} (${m.roles}) delivered diagnostics (${m.last_diag_at}) but none about this language in the window.`);
    }
  }

  for (const r of slowRpcs(rpc)) {
    add('problem', null, `Server: ${r.rpc} averages ${r.mean_ms} ms over ${r.calls} calls (max ${r.max_ms} ms), across all orgs.`);
  }

  const rank = { problem: 0, watch: 1, info: 2 };
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
}

/** One row of `diag.jobs()`: a server job's recent runs (migration 20261016010000_diag_jobs.sql). */
export interface JobStat {
  job: string; every: string | null; runs: number; failures: number; partials: number; streak: number;
  last_at: string | null; last_outcome: string | null; last_error_class: string | null; last_ok_at: string | null;
  p95_ms: number | null; totals: Record<string, number> | null; orgs: number | null; stale: boolean;
}

/**
 * What the server's own jobs point at: one that stopped (its last run that
 * was not an error is older than twice its schedule), one failing run after
 * run, and push delivery that sends little of what it claims.
 */
export function jobSignals(jobs: JobStat[]): Signal[] {
  const out: Signal[] = [];
  for (const j of jobs) {
    const add = (level: Signal['level'], key: NonNullable<Signal['key']>, text: string) => out.push({ level, install: null, text, key, job: j.job });
    const why = j.last_error_class ? ` (${j.last_error_class})` : '';
    if (j.stale) add('problem', 'job-stopped', `Server job ${j.job} has not run successfully since ${j.last_ok_at ?? 'the window began'} (every ${j.every ?? '?'}): it stopped. Last run ${j.last_at ?? 'never'}, ${j.last_outcome ?? '?'}${why}.`);
    else if (j.streak >= 3) add('problem', 'job-failing', `Server job ${j.job} failed its last ${j.streak} runs${why}.`);
    else if (j.failures > 0 && j.failures >= j.runs * 0.2) add('watch', 'job-failures', `Server job ${j.job} failed ${j.failures} of ${j.runs} runs in the window${why}.`);
    else if (j.partials > 0 && j.partials >= j.runs * 0.5) add('watch', 'job-partial', `Server job ${j.job} did only part of its work in ${j.partials} of ${j.runs} runs.`);
    const t = j.totals ?? {};
    if (j.job === 'push_delivery' && (t.claimed ?? 0) >= 10 && (t.sent ?? 0) < (t.claimed ?? 0) * 0.5) {
      add('watch', 'push-delivery-low', `Push delivery sent ${t.sent ?? 0} of ${t.claimed} notifications it claimed (${t.noToken ?? 0} with no push token, ${t.failed ?? 0} failed).`);
    }
  }
  const rank = { problem: 0, watch: 1, info: 2 };
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
}
