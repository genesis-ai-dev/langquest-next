// Clean up's work while its sheet is open (decision 178): each part cleaned
// on this phone, one after another, by the microphone module; a mix to hear
// at the slider's place; and the chosen mix kept as a recording's file when
// the person picks. Nothing is kept until then: closing the sheet forgets
// every part, and the module's files go with it.
import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import * as Crypto from 'expo-crypto';
import MicrophoneEnergy from '../../modules/microphone-energy';
import { audioFormat } from '../audio/audioFormat';
import { rememberBars } from '../audio/barsStore';
import { failureMessage, noteExpected } from '../diagnostics/report';
import { t } from '../i18n';
import type { LanguageHandle } from '../sync/useLanguage';
import { cleanSums, limitAt, mixBars, SLIDER_START, type CleanSums } from './cleanUpModel';

export type CleanStatus =
  | { at: 'waiting' }
  | { at: 'cleaning'; done: number }
  | { at: 'ready'; sums: CleanSums }
  | { at: 'failed'; error: string };

export interface CleanUp {
  status: Readonly<Record<string, CleanStatus>>;
  /** The slider's place, as it is dragged (the bars follow it). */
  place: number;
  /** The most Clean up takes out at the place the slider was let go (null: no limit). */
  limitDb: number | null;
  setPlace: (place: number, letGo: boolean) => void;
  /** Each ready part's sound at `limitDb`, to hear. */
  preview: Readonly<Record<string, string>>;
  /** The parts' sounds at `limitDb` kept as recordings' files, by the part each was made from. */
  keep: (hashes: readonly string[]) => Promise<Map<string, { hash: string; format: 'wav' | 'm4a' }>>;
}

/** How long a browser may take to read a part from its store before Clean up gives up on it. */
const WEB_READ_MS = 10_000;

/** Runs Clean up over `hashes` while they are given; null forgets everything. */
export function useCleanUp(language: LanguageHandle, hashes: readonly string[] | null): CleanUp {
  const [status, setStatus] = useState<Record<string, CleanStatus>>({});
  const [place, setPlaceNow] = useState(SLIDER_START);
  const [limitDb, setLimit] = useState<number | null>(limitAt(SLIDER_START));
  const [preview, setPreview] = useState<Record<string, string>>({});
  const run = useRef<{ ids: Map<string, string>; sums: Map<string, CleanSums> } | null>(null);
  const live = useRef(language);
  live.current = language;
  const key = hashes?.join(':') ?? '';

  useEffect(() => {
    if (!hashes || hashes.length === 0) return;
    const nonce = Crypto.randomUUID().slice(0, 8);
    const mine = { ids: new Map<string, string>(hashes.map((h) => [h, `${nonce}-${h.slice(0, 16)}`])), sums: new Map<string, CleanSums>() };
    run.current = mine;
    const byId = new Map([...mine.ids].map(([h, id]) => [id, h] as const));
    const set = (hash: string, s: CleanStatus) => { if (run.current === mine) setStatus((was) => ({ ...was, [hash]: s })); };
    setStatus(Object.fromEntries(hashes.map((h) => [h, { at: 'waiting' } as CleanStatus])));
    setPreview({});
    setPlaceNow(SLIDER_START);
    setLimit(limitAt(SLIDER_START));
    // Progress can arrive after the part is ready: it never takes a part back to cleaning.
    const progress = MicrophoneEnergy.addListener('onCleanUpProgress', (e) => {
      const hash = byId.get(e.id);
      if (hash && run.current === mine) setStatus((was) => (was[hash]?.at === 'cleaning' ? { ...was, [hash]: { at: 'cleaning', done: e.done } } : was));
    });
    void (async () => {
      for (const hash of hashes) {
        if (run.current !== mine) return;
        set(hash, { at: 'cleaning', done: 0 });
        try {
          const uri = await fileOf(live.current, hash);
          const part = await MicrophoneEnergy.cleanUp(mine.ids.get(hash)!, uri);
          const sums = cleanSums(part.sums);
          if (!sums) throw new Error('Clean up measured nothing');
          mine.sums.set(hash, sums);
          set(hash, { at: 'ready', sums });
        } catch (e) {
          if (run.current !== mine) return;
          set(hash, { at: 'failed', error: e instanceof NotHere ? e.message : failureMessage('clean up', e) });
        }
      }
    })();
    return () => {
      run.current = null;
      progress.remove();
      for (const id of mine.ids.values()) MicrophoneEnergy.cleanUpForget(id).catch((e: unknown) => noteExpected('clean up: forget', e));
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps -- the parts are read by their joined hashes

  // Each ready part is mixed at the slider's place to be heard, one after another; a later place overtakes.
  const ready = Object.entries(status).filter(([, s]) => s.at === 'ready').map(([h]) => h).join(':');
  useEffect(() => {
    const mine = run.current;
    if (!mine || !ready) return;
    let stale = false;
    void (async () => {
      for (const hash of ready.split(':')) {
        if (stale || run.current !== mine) return;
        try {
          const mix = await MicrophoneEnergy.cleanUpMix(mine.ids.get(hash)!, limitDb, false);
          if (!stale && run.current === mine) setPreview((was) => ({ ...was, [hash]: mix.uri }));
        } catch (e) { noteExpected('clean up: mix', e); }
      }
    })();
    return () => { stale = true; };
  }, [ready, limitDb]);

  const setPlace = (p: number, letGo: boolean) => {
    setPlaceNow(p);
    if (letGo) setLimit(limitAt(p));
  };

  async function keep(chosen: readonly string[]) {
    const mine = run.current;
    const store = live.current.blobs.store;
    if (!mine || !store) throw new Error('Clean up is not ready');
    const out = new Map<string, { hash: string; format: 'wav' | 'm4a' }>();
    for (const hash of chosen) {
      const sums = mine.sums.get(hash);
      if (!sums) throw new Error('That part is not cleaned yet');
      const mix = await MicrophoneEnergy.cleanUpMix(mine.ids.get(hash)!, limitDb, true);
      const { ref } = await store.ingest(mix.uri, mix.format);
      rememberBars(ref.hash, mixBars(sums, limitDb));
      out.set(hash, { hash: ref.hash, format: mix.format });
    }
    return out;
  }

  return { status, place, limitDb, setPlace, preview, keep };
}

/** A part not on this device: said as it is, not reported as a fault. */
class NotHere extends Error {}

/** Where the part's file is on this device; a browser may first have to read it from its store. */
async function fileOf(language: LanguageHandle, hash: string): Promise<string> {
  const state = language.state;
  const ref = state ? { hash, format: audioFormat(state, hash) } : null;
  const now = ref && language.blobs.uriFor(ref);
  if (now) return now;
  const store = language.blobs.store;
  if (ref && store && Platform.OS === 'web') {
    const uri = await new Promise<string | null>((resolve) => {
      const timer = setTimeout(() => { stop(); resolve(null); }, WEB_READ_MS);
      const stop = store.onUrlReady(() => {
        const url = language.blobs.uriFor(ref);
        if (url) { clearTimeout(timer); stop(); resolve(url); }
      });
    });
    if (uri) return uri;
  }
  throw new NotHere(t('recording.player.notOnDeviceYet'));
}
