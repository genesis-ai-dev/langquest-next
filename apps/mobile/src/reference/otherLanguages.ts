// The key terms of the organization's other languages, as this phone holds
// them (design principle 14, "show what others usually do"; demo ADR-042).
// A phone pulls only the languages it opens (decisions.md 37, 63), so this
// reads the phone's own log of each other language it has opened, folded
// as the language's own client would fold it (its checkpoint and the
// events after it), and fetches nothing. A language never opened here is
// simply not shown. Each fold is kept until that language's log changes.
// A word's recording plays from this phone, or streams from its language's
// files when the server lets this person have them (helps.tsx).
import { SupabaseTransport, SyncClient, ensureDeviceId } from '@langquest-next/sync';
import { keyTermsFor, type KeyTermView } from '@langquest-next/core';
import * as Crypto from 'expo-crypto';
import { useEffect, useState } from 'react';
import { audioFormat } from '../audioClip';
import type { Ctx } from '../ctx';
import { noteExpected } from '../report';
import type { LanguageTerms } from '../simple/helpsModel';
import { getStore } from '../store';
import { supabase } from '../supabase';

interface Held { terms: KeyTermView[]; formats: Record<string, string> }
const held = new Map<string, { mark: string } & Held>();

/** One other language's key terms from this phone's log, or null when the phone has never held that language. */
async function termsOnPhone(c: { orgId: string; languageId: string; actorId: string }): Promise<Held | null> {
  const store = await getStore();
  const [count, checkpoint] = await Promise.all([
    store.count(c.orgId, c.languageId),
    store.meta(`snapshotSeq:${c.orgId}/${c.languageId}`)
  ]);
  if (!count && !checkpoint) return null;
  const key = `${c.orgId}/${c.languageId}`;
  const mark = `${count}:${checkpoint ?? ''}`;
  const hit = held.get(key);
  if (hit && hit.mark === mark) return hit;
  const deviceId = await ensureDeviceId(store, () => Crypto.randomUUID());
  // Loading reads the log on this phone; the transport is never asked for anything.
  const client = new SyncClient({ orgId: c.orgId, streamId: c.languageId, actorId: c.actorId, deviceId, store, transport: new SupabaseTransport(supabase) });
  const state = await client.load();
  const terms = keyTermsFor(state);
  // How each recording of a word was saved (decisions.md 77), to play it from that language's files.
  const formats: Record<string, string> = {};
  for (const term of terms) for (const a of term.adjustments) if (a.blobHash) formats[a.blobHash] = audioFormat(state, a.blobHash);
  held.set(key, { mark, terms, formats });
  return { terms, formats };
}

/**
 * The other languages of the organization this phone holds, each with its
 * key terms; `loading` until every one has been read. Off until `enabled`.
 */
export function useOtherLanguageTerms(ctx: Ctx, enabled: boolean): { loading: boolean; languages: LanguageTerms[] } {
  const orgId = ctx.language.orgId;
  const open = ctx.language.languageId;
  const actorId = ctx.session.actorId;
  // As a string, so the effect runs again only when the list itself changes.
  const others = JSON.stringify(ctx.languages.filter((l) => l.languageId !== open).map((l) => [l.languageId, l.name]));
  const [result, setResult] = useState<{ key: string; languages: LanguageTerms[] } | null>(null);
  const key = `${orgId}|${actorId}|${others}`;
  useEffect(() => {
    if (!enabled || !orgId) return;
    let live = true;
    void (async () => {
      const out: LanguageTerms[] = [];
      for (const [languageId, name] of JSON.parse(others) as [string, string][]) {
        try {
          const got = await termsOnPhone({ orgId, languageId, actorId });
          if (got?.terms.length) out.push({ languageId, name, ...got });
        } catch (e) {
          noteExpected('other language key terms', e);
        }
      }
      if (live) setResult({ key, languages: out });
    })();
    return () => { live = false; };
  }, [enabled, key]); // eslint-disable-line react-hooks/exhaustive-deps
  const ready = result?.key === key ? result : null;
  return { loading: enabled && !ready, languages: ready?.languages ?? [] };
}
