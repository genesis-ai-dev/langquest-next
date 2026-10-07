import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { SupabaseClient } from '@supabase/supabase-js';
import { blobKey, MemoryStore, SupabaseTransport, SyncClient, workerBlobs } from '@langquest-next/client';
import {
  applyLanguageEvent, commands, deriveFlow, deriveKinds, derivePassage, encodeHlc, languagePassages, ORG_STREAM, unitPlace,
  type AnyEvent, type EventSpec, type LanguageState
} from '@langquest-next/core';
import { HISTORY_PROFILES, planHistory, seeded, silentWav, uploadedAt } from './sample-history-plan';

/**
 * `npm run sample:org -- --history`: months of recording and review behind
 * each sample language, so every page of the web dashboard has something to
 * show (decisions 41 and 43). Local only, and for one reason: a real upload
 * is confirmed by the Worker at the moment it lands (decisions.md 69), and
 * the dashboard needs uploads from weeks ago. So the script writes each
 * `v1.BlobStored` itself, back-dated, straight into the local database
 * through Docker, then uploads the real (silent) audio through the local
 * Worker (`npm run web:dev`, or API_URL); its record_blob finds the
 * confirmation already there and adds nothing. No hosted database has a
 * way to do that, on purpose.
 *
 * Everything else goes through append_events as the sample admin, each
 * event stamped with when it "happened", so the server validates and
 * authorizes it like a phone's work. A language that already has
 * recordings is left alone: the log is append-only, so a second run adds
 * nothing (reset the local database for a fresh history).
 */

const DAY = 86_400_000;

interface Ctx {
  sb: SupabaseClient;
  service: SupabaseClient;
  orgId: string;
  actorId: string;
  languageIds: string[];
  now?: number;
}

interface Blob { languageId: string; hash: string; bytes: Uint8Array; at: number }

function localDbContainer(): string {
  const toml = readFileSync(new URL('../supabase/config.toml', import.meta.url), 'utf8');
  const id = /^project_id\s*=\s*"([^"]+)"/m.exec(toml)?.[1];
  if (!id) throw new Error('supabase/config.toml has no project_id');
  return `supabase_db_${id}`;
}

function psql(sql: string) {
  const r = spawnSync('docker', ['exec', '-i', localDbContainer(), 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q'], { input: sql, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`psql: ${r.stderr || r.error?.message || 'failed'} (is the local Supabase running? npm run db:start)`);
}

export async function addHistory(c: Ctx): Promise<void> {
  const now = c.now ?? Date.now();
  const transport = new SupabaseTransport(c.sb);
  const blobs: Blob[] = [];

  for (const languageId of c.languageIds) {
    const profile = HISTORY_PROFILES[languageId];
    if (!profile) continue;
    const reader = new SyncClient<LanguageState>({
      orgId: c.orgId, streamId: languageId, actorId: c.actorId, deviceId: 'sample-history', store: new MemoryStore(), transport, newId: () => randomUUID()
    });
    await reader.load();
    for (let page = 0; page < 50; page++) if (!(await reader.sync()).more) break;
    let state = reader.getState();
    if (Object.keys(state.recordings).length > 0) {
      console.log(`${languageId}: already has recordings; history left as it is`);
      continue;
    }
    const all = languagePassages(state);
    const start = state;
    const first = all.findIndex((u) => unitPlace(start, u).bookId === profile.startBook);
    const units = first >= 0 ? all.slice(first) : all;
    const plan = planHistory(profile, units.length, now, `${c.orgId}/${languageId}`);
    const rand = seeded(`${c.orgId}/${languageId}/reviews`);

    // Stamped by hand, not by SyncClient: its clock never goes back (it has just pulled the
    // template's events from today), and history has to. Each language event is folded here so
    // the next command sees it, and every event is sent through append_events like any phone's.
    // The language's country and target go to the organization's stream.
    const outbox: AnyEvent[] = [];
    let counter = 0;
    const flush = async () => {
      while (outbox.length) {
        const batch = outbox.splice(0, 200);
        const refused = (await transport.append(batch)).filter((r) => !r.accepted);
        if (refused.length) throw new Error(`${languageId}: the server refused ${refused.length} events (${refused[0]!.reason})`);
      }
    };
    const append = async (specs: EventSpec[], at: number, streamId = languageId) => {
      for (const s of specs) {
        const event = {
          id: s.id, type: s.type, orgId: c.orgId, streamId, actorId: c.actorId, deviceId: 'sample-history',
          hlc: encodeHlc(Math.floor(at), counter++ % 1_000_000, 'sample-history'), payload: s.payload
        } as AnyEvent;
        if (streamId === languageId) state = applyLanguageEvent(state, event);
        outbox.push(event);
      }
      if (outbox.length >= 200) await flush();
    };

    const setUp = now - profile.fromDaysAgo * DAY - DAY;
    await append([{ id: randomUUID(), type: 'v1.LanguageCountrySet', payload: { languageId, country: profile.country } }], setUp, ORG_STREAM);
    if (profile.target) {
      const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
      await append([{ id: randomUUID(), type: 'v1.LanguageTargetSet', payload: {
        languageId, scope: profile.target.scope, startDate: iso(now - profile.target.startDaysAgo * DAY), targetDate: iso(now + profile.target.targetDaysAhead * DAY)
      } }], setUp, ORG_STREAM);
    }

    let recordings = 0;
    for (const a of plan) {
      const unitId = units[a.unitIndex]!;
      if (a.kind === 'record') {
        const cards = Array.from({ length: a.cards }, (_, k) => silentWav(`${c.orgId}/${languageId}/${a.unitIndex}/${k}`));
        await append([
          { id: randomUUID(), type: 'v1.RecordingAdded', payload: {
            recordingId: randomUUID(), unitId, kind: 'target',
            cards: cards.map((w) => ({ hash: w.hash, durationMs: w.durationMs, format: 'wav' }))
          } } as EventSpec,
          ...commands(state).publishVersion({ commandId: randomUUID(), unitId, cardHashes: cards.map((w) => w.hash), actorId: c.actorId })
        ], a.at);
        if (a.uploaded) cards.forEach((w, k) => blobs.push({ languageId, hash: w.hash, bytes: w.bytes, at: uploadedAt(a.at, k) }));
        recordings += cards.length;
        continue;
      }
      // Reviews of the version: about a third go through the whole flow (checkpoint included, so
      // the passage is done); the rest clear the first step, or the first two.
      const takeId = derivePassage(state, unitId).latest?.takeId;
      if (!takeId) continue;
      const kinds = deriveKinds(state);
      const depth = rand();
      const flowSteps = deriveFlow(state).steps;
      const whole = depth < 0.35;
      const steps = whole ? flowSteps : flowSteps.slice(0, depth < 0.65 ? 2 : 1);
      const specs: EventSpec[] = [];
      for (const step of steps) {
        for (const kindId of step.kindIds) {
          if (step.checkpoint && !whole) continue;
          const cmd = commands(state);
          specs.push(...(kinds.find((k) => k.id === kindId)?.produces
            ? cmd.depart({ commandId: randomUUID(), unitId, type: 'skip', kindId, reason: 'No bilingual speaker for a back translation yet.' })
            : cmd.recordReview({ commandId: randomUUID(), takeIds: [takeId], kindId, outcome: 'looks_good', via: 'app' })));
        }
      }
      if (specs.length) await append(specs, a.at);
    }
    await flush();
    console.log(`${languageId}: ${plan.filter((a) => a.kind === 'record').length} passages, ${recordings} recordings`);
  }

  if (blobs.length) {
    // Back-dated confirmations first, written exactly as _append_event_as writes record_blob's
    // (the same id, with the size, so the Worker's confirmation finds it and adds nothing; the same
    // seq counter and clock shape), only with the time the audio "arrived"…
    const rows = blobs.map((b) => `('blob:${c.orgId}:${b.languageId}:${b.hash}:${b.bytes.byteLength}', '${c.orgId}', '${b.languageId}', ${Math.floor(b.at)}::bigint, '{"hash":"${b.hash}","size":${b.bytes.byteLength}}')`);
    psql(`do $$ declare r record; v_seq bigint; begin
  for r in select * from (values ${rows.join(',\n')}) as t(id, org, stream, ms, payload) loop
    continue when exists (select 1 from public.events e where e.id = r.id);
    v_seq := public._next_seq(r.org, r.stream);
    insert into public.events (id, org_id, stream_id, server_seq, type, actor_id, device_id, hlc, payload)
      values (r.id, r.org, r.stream, v_seq, 'v1.BlobStored', 'service', 'storage',
              lpad(r.ms::text, 15, '0') || ':' || lpad((v_seq % 1000000)::text, 6, '0') || ':storage', r.payload::jsonb);
  end loop;
end $$;`);
    // …then the audio itself, so a phone that opens the sample can play it.
    const token = (await c.sb.auth.getSession()).data.session?.access_token;
    if (!token) throw new Error('the sample admin has no session');
    const files = workerBlobs(process.env['API_URL'] ?? 'http://127.0.0.1:8787', token);
    for (let i = 0; i < blobs.length; i += 8) {
      await Promise.all(blobs.slice(i, i + 8).map((b) => files.put(blobKey(c.orgId, b.languageId, b.hash, 'wav'), b.bytes)));
    }
    const confirmed = await c.service.from('events').select('id', { count: 'exact', head: true }).eq('org_id', c.orgId).eq('type', 'v1.BlobStored');
    // One confirmation per file: a second means record_blob did not recognise ours and stamped "now".
    if ((confirmed.count ?? 0) > blobs.length) {
      throw new Error(`${confirmed.count} upload confirmations for ${blobs.length} files: record_blob's event id has changed; update sample-history.ts to match _append_event_as`);
    }
    console.log(`${blobs.length} recordings uploaded, confirmed as of when they were made`);
  }
}
