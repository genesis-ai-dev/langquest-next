/**
 * What a phone downloads before its Map opens, with the server's cut
 * (decisions.md 145) and without it (decision 143): the head (what the
 * whole language shares, which passages have rows, every passage's line)
 * against the whole snapshot, and what the fill moves after it, as JSON and
 * gzipped, and how long each takes on a slow link. Read-only.
 *
 *   npx tsx scripts/bench/fill.ts --koro                  a synthetic language of Koro Miyan's shape
 *   npx tsx scripts/bench/fill.ts --state=<file.json>     a language state saved as JSON
 *   BENCH_SUPABASE_URL=https://<ref>.supabase.co BENCH_SERVICE_ROLE_KEY=... \
 *     npx tsx scripts/bench/fill.ts --org=<orgId> --language=<languageId>
 *                                                         the newest snapshot of a hosted language
 *
 * `--bytesPerSecond=2048` sets the link (the fleet's slow link, decision 88).
 * A hosted snapshot is real user data: this keeps it in memory only and
 * prints sizes, never content.
 */
import { gzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { emptyLanguageState, encodeHlc, foldLanguage, REDUCER_VERSION, type AnyEvent, type LanguageState } from '@langquest-next/core';
import { cutLanguage, languageLinesOf, NO_UNIT } from '../../packages/sync/src/serverCut';
import { fetchSnapshot } from '../../packages/sync/src/snapshotFetch';
import { SupabaseTransport } from '../../packages/sync/src/supabaseTransport';

const args = new Map(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k!, v ?? 'true'] as const; }));
const rate = Number(args.get('bytesPerSecond') ?? 2048);

/**
 * A language of Koro Miyan's shape (decisions.md 143): 570 passages, 37,000
 * recordings, 541 versions, each reviewed, and a stored file per card.
 */
function koroShaped(): LanguageState {
  const events: AnyEvent[] = [];
  let seq = 0;
  const push = (type: string, payload: unknown, actorId = 't1') => {
    seq += 1;
    events.push({ id: `e${seq}`, type, payload, orgId: 'o', streamId: 'l', actorId, deviceId: 'd', hlc: encodeHlc(1_790_000_000_000 + seq * 1000, 0, 'd'), serverSeq: seq } as AnyEvent);
  };
  const passages = 570;
  const perPassage = Math.round(37_000 / passages);
  let files = 0;
  for (let p = 0; p < passages; p++) {
    const unitId = `MAT ${Math.floor(p / 20) + 1}:${(p % 20) * 3 + 1}-${(p % 20) * 3 + 3}`;
    push('v1.UnitAdded', { unitId, parentUnitId: null, kind: 'passage', label: unitId, order: `a${String(p).padStart(4, '0')}` }, 'lead');
    const hashes: string[] = [];
    for (let r = 0; r < perPassage; r++) {
      const hash = (files++).toString(16).padStart(64, '0');
      hashes.push(hash);
      push('v1.RecordingAdded', { recordingId: `r${p}-${r}`, unitId, kind: 'target', cards: [{ hash, durationMs: 4200, format: 'm4a' }] }, `t${r % 4}`);
      push('v1.BlobStored', { hash, size: 60_000 }, 'service');
    }
    if (p < 541) {
      push('v1.TakeComposed', { takeId: `v${p}`, unitId, cardHashes: hashes.slice(0, 40), parentTakeId: null });
      push('v1.TakeSubmitted', { takeId: `v${p}` });
      push('v1.ReviewRecorded', { reviewId: `rv${p}`, takeId: `v${p}`, kindId: 'peer', outcome: 'looks_good', via: 'app' }, 'r1');
    }
  }
  const state = foldLanguage(events, emptyLanguageState());
  state.appliedEventIds = {};
  return state;
}

async function hosted(orgId: string, languageId: string): Promise<LanguageState> {
  const url = process.env['BENCH_SUPABASE_URL'];
  const key = process.env['BENCH_SERVICE_ROLE_KEY'];
  if (!url || !key) throw new Error('BENCH_SUPABASE_URL and BENCH_SERVICE_ROLE_KEY are needed for a hosted language');
  const snap = await fetchSnapshot(new SupabaseTransport(createClient(url, key, { auth: { persistSession: false } })), orgId, languageId, REDUCER_VERSION, { inFlight: 4 });
  if (!snap) throw new Error(`no snapshot of ${orgId}/${languageId} at reducer ${REDUCER_VERSION}`);
  return snap.state;
}

const state = args.has('koro') ? koroShaped()
  : args.has('state') ? (JSON.parse(readFileSync(args.get('state')!, 'utf8')) as LanguageState)
    : args.has('org') && args.has('language') ? await hosted(args.get('org')!, args.get('language')!)
      : (() => { throw new Error('give --koro, --state=<file> or --org=<id> --language=<id>'); })();

const snapshot = JSON.stringify(state);
const cut = cutLanguage(state);
const lines = languageLinesOf(state);
const units = new Map<string, number>();
for (const r of cut.rows) units.set(r.unitId, (units.get(r.unitId) ?? 0) + 1);
// What get_snapshot_head answers, and the rows as get_snapshot_rows sends them.
const head = JSON.stringify({ server_seq: 1, shared: cut.shared, units: [...units].map(([u, n]) => [u, n]), lines: { seq: 1, lines } });
const rows = JSON.stringify(cut.rows.map((r) => [r.kind, r.id, r.unitId, r.ref, JSON.parse(r.json)]));
const mb = (n: number) => Math.round(n / 1e4) / 100;
const gz = (s: string) => gzipSync(s).length;
const time = (bytes: number) => {
  const s = bytes / rate;
  return s < 120 ? `${Math.round(s)} s` : s < 7200 ? `${Math.round(s / 60)} min` : `${Math.round(s / 360) / 10} h`;
};
const report = {
  passages: Object.keys(state.units).length,
  passagesWithRows: [...units.keys()].filter((u) => u !== NO_UNIT).length,
  rows: cut.rows.length,
  mb: {
    snapshot: mb(snapshot.length), shared: mb(JSON.stringify(cut.shared).length), lines: mb(JSON.stringify(lines).length),
    head: mb(head.length), rows: mb(rows.length),
    gzip: { snapshot: mb(gz(snapshot)), head: mb(gz(head)), rows: mb(gz(rows)) }
  },
  [`toFirstMapAt${rate}BytesPerSecond`]: {
    wholeSnapshot: time(snapshot.length), head: time(head.length),
    gzip: { wholeSnapshot: time(gz(snapshot)), head: time(gz(head)) }
  }
};
console.log(JSON.stringify(report, null, 2));
