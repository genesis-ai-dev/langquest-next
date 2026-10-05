// The sources a passage gets, and one source's text and audio for it
// (docs/reference-material.md). Three levels decide what is offered: what
// the language recommends (core `recommendedFor`: the organization's
// recommendations, narrowed or added to by the language), what an admin
// placed on this passage, and what the translator chose for themselves on
// this phone (My Bibles). When the language recommends nothing at all, the
// shared sources in the language's source language stand in (as shared
// study guides do), and when nothing at all has this passage's text, the
// text the app carries is the last resort, labelled as built in.
import {
  bookIdOf, libraryItemView, linkedTo, passageLink, recommendedFor, sourceAudioUrl, SOURCE_BIBLES, subscriptionItemId, versesInChapter,
  type LibraryDoc, type SourceBookDoc, type SourceDoc, type TemplateDoc, type TimingDoc, type VerseRange, type VersificationDoc
} from '@langquest-next/core';
import { useEffect, useMemo, useState } from 'react';
import type { Ctx } from '../ctx';
import { useLibraryDocs, useSharedItems } from '../library/useLibrary';
import { readingsForRange } from '../scripture';
import { bibleErrorText, type BibleDetail } from './bibleBrain';
import {
  bookOffers, catalogVerses, chaptersOf, chipMarks, filesetsFor, inSourceNumbering, offersFor, offlineAllowed, orderOptions, passageRows, playPlan,
  refText, resolveTiming, unitCoordinates, type PlayPlan, type SourceFrom, type SourceOption, type Timing, type TimingSource, type VerseRow
} from './model';
import { audioFormatOf, bbKey, ensureIndex, keptAudio, onSourceFiles, playableUri } from './offline';
import { bibleBrain, textKept, useKeptRevision, useMyBibles } from './store';

type Get = <T extends LibraryDoc = LibraryDoc>(hash: string | null | undefined) => T | null;

export interface PassageSources {
  /** The passage in its template's numbering; null when the unit names no verses. */
  range: VerseRange | null;
  /** "GEN 1:1-2:3" for the record. */
  ref: string;
  /** The template's versification, to map into each source's own. */
  versification: VersificationDoc | null;
  options: SourceOption[];
  /** Still gathering documents or the person's own picks. */
  loading: boolean;
  get: Get;
}

/** Bible Brain Bibles chosen on this phone, by id: the detail the Worker last gave. */
function useBibleDetails(ids: string[]): Record<string, BibleDetail> {
  const [details, setDetails] = useState<Record<string, BibleDetail>>({});
  const key = ids.join(',');
  useEffect(() => {
    if (!bibleBrain || !key) return;
    let live = true;
    for (const id of key.split(',')) {
      void (async () => {
        const kept = await bibleBrain!.keptBible(id);
        if (kept && live) setDetails((d) => ({ ...d, [id]: kept }));
        try {
          const fresh = await bibleBrain!.bible(id);
          if (live) setDetails((d) => ({ ...d, [id]: fresh }));
        } catch { /* offline or not set up: the kept detail stands */ }
      })();
    }
    return () => { live = false; };
  }, [key]);
  return details;
}

/** The sources for one passage of one language, recommended first. */
export function useSources(ctx: Ctx, unitId: string | null | undefined, laneId: string | null | undefined): PassageSources {
  const state = ctx.project.state;
  const orgId = ctx.project.orgId;
  const library = ctx.org.state?.library;
  const mine = useMyBibles(ctx.session.actorId, orgId, laneId);

  const recs = useMemo(() => {
    const out = new Map<string, SourceFrom>();
    if (!state || !laneId) return out;
    for (const [id, from] of recommendedFor(ctx.org.state?.recommendations, state, laneId)) out.set(id, from);
    if (unitId) {
      for (const id of linkedTo(state, laneId, unitId)) if (!out.has(id)) out.set(id, 'passage');
      for (const id of [...out.keys()]) if (passageLink(state, laneId, unitId, id) === false) out.delete(id);
    }
    return out;
  }, [state, laneId, unitId, ctx.org.state?.recommendations]);

  // Nothing recommended: other organizations' shared sources stand in (LangQuest's, once seeded).
  const shared = useSharedItems('material', orgId, !!unitId && recs.size === 0);
  const template = laneId && state ? state.laneTemplates[laneId]?.value?.docHash : undefined;
  const itemHashes = useMemo(() => {
    const ids = [...recs.keys(), ...mine.list.filter((m) => m.kind === 'library').map((m) => m.itemId)];
    return ids.map((id) => libraryItemView(library ?? {}, id)?.current);
  }, [recs, mine.list, library]);
  const sharedHashes = recs.size === 0 ? shared.rows.map((r) => r.latest_hash) : [];
  const { get, error } = useLibraryDocs(orgId, [...itemHashes, ...sharedHashes, template]);
  const templateDoc = get<TemplateDoc>(template);
  const versification = templateDoc?.bible ? get<VersificationDoc>(templateDoc.bible.versification) : null;
  const bibleIds = useMemo(() => mine.list.filter((m) => m.kind === 'biblebrain' && m.bibleId).map((m) => m.bibleId!).sort(), [mine.list]);
  const details = useBibleDetails(bibleIds);

  const range = useMemo(() => {
    if (!unitId) return null;
    return unitCoordinates(unitId, versification ? (b, c) => versesInChapter(versification, b, c) ?? catalogVerses(b, c) : catalogVerses);
  }, [unitId, versification]);

  const options = useMemo(() => {
    const out: SourceOption[] = [];
    const sourceLanguage = state?.project?.value.sourceLanguoidId ?? 'eng';
    const fromLibrary = (itemId: string, from: SourceFrom) => {
      const hash = libraryItemView(library ?? {}, itemId)?.current;
      const doc = get<SourceDoc>(hash);
      if (!hash || !doc || doc.format !== 'source@1') return;
      const bible = doc.provider.kind === 'biblebrain' ? details[doc.provider.bibleId] : undefined;
      out.push({ itemId, kind: 'library', from, name: doc.name, abbreviation: doc.abbreviation, language: doc.language, doc, docHash: hash, ...(bible ? { bible } : {}) });
    };
    for (const [id, from] of recs) fromLibrary(id, from);
    for (const m of mine.list) {
      if (m.kind === 'library') fromLibrary(m.itemId, 'mine');
      else {
        const bible = m.bibleId ? details[m.bibleId] : undefined;
        out.push({ itemId: m.itemId, kind: 'biblebrain', from: 'mine', name: m.name, abbreviation: m.abbreviation, language: m.language, ...(bible ? { bible } : {}) });
      }
    }
    if (recs.size === 0) {
      for (const r of shared.rows) {
        const doc = get<SourceDoc>(r.latest_hash);
        if (!doc || doc.format !== 'source@1' || doc.language !== sourceLanguage) continue;
        out.push({ itemId: subscriptionItemId(r.org_id, r.item_id), kind: 'library', from: 'shared', name: doc.name, abbreviation: doc.abbreviation, language: doc.language, doc, docHash: r.latest_hash, sharedBy: r.org_name });
      }
    }
    // The last resort: when nothing offered has this passage's text, the text the app carries.
    if (range && !out.some((o) => offersFor(o, range.book).text)) {
      for (const r of builtinReadings(range)) {
        out.push({ itemId: `builtin.${r.code}`, kind: 'builtin', from: 'builtin', name: r.translation, abbreviation: r.code, language: 'eng' });
      }
    }
    return orderOptions(out);
  }, [recs, mine.list, shared.rows, get, details, library, range, state?.project]);

  // Offline, a document not on the phone stops waiting: what is here is shown.
  const loading = !mine.loaded || (!error && itemHashes.some((h) => h && !get(h)));
  return { range, ref: range ? refText(range) : '', versification, options, loading, get };
}

/** The bundled readings for a range (scripture.ts), keyed by the app's older book ids. */
function builtinReadings(range: VerseRange) {
  return readingsForRange({ book: bookIdOf(range.book), start: range.start, end: range.end });
}

// ---- one source for one passage ---------------------------------------------------------------------

export interface AudioChapter {
  chapter: number;
  timing: Timing | null;
  timingSource: TimingSource;
  /** The file is on this phone. */
  local: boolean;
  /** Where to play it from: the kept file, or a link to stream (asked for at play time). */
  resolve: () => Promise<string>;
}

export interface PassageSource {
  loading: boolean;
  /** The passage in the source's own numbering. */
  range: VerseRange;
  rows: VerseRow[] | null;
  /** Why there is no text, when there is none. */
  textProblem: string | null;
  /** Null when this source has no audio for the passage. */
  plan: PlayPlan | null;
  chapters: AudioChapter[];
  /** Bible Brain filesets read, for the record. */
  filesets: string[];
  copyright: { text?: string; audio?: string };
  /** Bible Brain's terms apply (DBP). */
  bibleBrain: boolean;
}

const audioLinks = new Map<string, { url: string; expires: number }>();

/** A Bible Brain chapter's audio: the kept file, or a fresh link (links are reused until they expire). */
async function bibleBrainAudio(store: ReturnType<typeof storeOf>, fileset: string, book: string, chapter: number): Promise<string> {
  const kept = keptAudio(store, bbKey(fileset, book, chapter));
  if (kept && store) {
    const uri = await playableUri(store, kept);
    if (uri) return uri;
  }
  if (!bibleBrain) throw new Error("Bible Brain isn't set up on this phone.");
  const key = `${fileset}:${book}:${chapter}`;
  const held = audioLinks.get(key);
  if (held && held.expires > Date.now() + 60_000) return held.url;
  try {
    const link = await bibleBrain.audio(fileset, book, chapter);
    audioLinks.set(key, { url: link.url, expires: Date.parse(link.expiresAt) || Date.now() + 10 * 60_000 });
    return link.url;
  } catch (e) {
    throw new Error(bibleErrorText(e));
  }
}

const storeOf = (ctx: Ctx) => ctx.project.blobs.store;

/** A source's text, audio and timings for a passage, loaded as it is chosen. */
export function usePassageSource(ctx: Ctx, option: SourceOption | undefined, passage: PassageSources): PassageSource | null {
  const { get } = passage;
  const store = storeOf(ctx);
  const sourceV11n = option?.doc ? get<VersificationDoc>(option.doc.versification) : null;
  const range = useMemo(() => (passage.range ? inSourceNumbering(passage.range, passage.versification, sourceV11n) : null), [passage.range, passage.versification, sourceV11n]);
  const bookHash = option?.doc && range ? option.doc.books.find((b) => b.book === range.book)?.doc : undefined;
  const books = useLibraryDocs(ctx.project.orgId, [bookHash]);
  const book = books.get<SourceBookDoc>(bookHash);
  const [bb, setBb] = useState<{ key: string; verses: Map<number, [number, number, string][]>; stamps: Map<number, { verse: number; seconds: number }[] | null>; problem: string | null; done: boolean } | null>(null);
  const [files, setFiles] = useState(0);
  const keptTick = useKeptRevision();
  useEffect(() => { void ensureIndex().then(() => setFiles((n) => n + 1)); return onSourceFiles(() => setFiles((n) => n + 1)); }, []);
  useEffect(() => store?.onChange(() => setFiles((n) => n + 1)), [store]);

  const filesets = useMemo(() => (option && range ? filesetsFor(option, range.book) : { text: null, audio: null }), [option, range]);
  const bbKeyNow = option && range && (filesets.text || filesets.audio) ? `${option.itemId}:${refText(range)}:${filesets.text}:${filesets.audio}` : '';

  // Bible Brain text and FCBH timestamps, chapter by chapter (kept on the phone once seen).
  useEffect(() => {
    if (!bbKeyNow || !range) return;
    let live = true;
    const verses = new Map<number, [number, number, string][]>();
    const stamps = new Map<number, { verse: number; seconds: number }[] | null>();
    setBb({ key: bbKeyNow, verses, stamps, problem: null, done: false });
    void (async () => {
      let problem: string | null = null;
      if (!bibleBrain) problem = "Bible Brain isn't set up on this phone.";
      else {
        for (const c of chaptersOf(range)) {
          if (filesets.text) {
            try { verses.set(c, await bibleBrain.text(filesets.text, range.book, c)); } catch (e) { problem ??= bibleErrorText(e); }
          }
          // FCBH's timings only matter when the source book has none of its own.
          const own = book?.chapters.find((x) => x.chapter === c)?.timing;
          if (filesets.audio && !own) {
            try { stamps.set(c, await bibleBrain.timestamps(filesets.audio, range.book, c)); } catch { stamps.set(c, null); }
          }
          if (!live) return;
          setBb({ key: bbKeyNow, verses: new Map(verses), stamps: new Map(stamps), problem, done: false });
        }
      }
      if (live) setBb({ key: bbKeyNow, verses: new Map(verses), stamps: new Map(stamps), problem, done: true });
    })();
    return () => { live = false; };
    // `book` only decides whether FCBH is asked; its arrival re-runs through bbKeyNow's inputs.
  }, [bbKeyNow, book]);

  return useMemo(() => {
    if (!option || !range) return null;
    const chapters = chaptersOf(range);
    const copyright = { ...(option.doc?.copyright ?? option.bible?.copyright ?? {}) };
    if (option.kind === 'builtin') {
      const reading = builtinReadings(range).find((r) => `builtin.${r.code}` === option.itemId);
      const rows = reading ? passageRows(range, new Map(chapters.map((c) => [c, reading.verses.filter((v) => v.chapter === c).map((v) => [v.verse, v.verse, v.text] as [number, number, string])]))) : null;
      const audio: AudioChapter[] = option.itemId === 'builtin.BSB'
        ? chapters.map((c) => ({ chapter: c, timing: null, timingSource: 'none' as const, local: false, resolve: async () => sourceAudioUrl(SOURCE_BIBLES[0], { book: bookIdOf(range.book), chapter: c, label: '' }) }))
        : [];
      return {
        loading: false, range, rows, textProblem: rows ? null : 'No text for this passage.', plan: audio.length ? playPlan(range, audio) : null, chapters: audio,
        filesets: [], copyright: option.itemId === 'builtin.BSB' ? { text: 'Public domain', audio: 'Public domain · OpenBible.com, read by Frederick Surrey' } : { text: 'Public domain' }, bibleBrain: false
      };
    }
    // Library text and audio from the source's book document.
    if (option.doc?.provider.kind === 'library') {
      const loading = !!bookHash && !book;
      const rows = book ? passageRows(range, new Map(chapters.map((c) => [c, book.chapters.find((x) => x.chapter === c)?.verses ?? []]))) : null;
      const audio: AudioChapter[] = [];
      for (const c of chapters) {
        const ch = book?.chapters.find((x) => x.chapter === c);
        const a = ch?.audio;
        if (!a) continue;
        const { timing, source } = resolveTiming({ bookTiming: get<TimingDoc>(ch.timing), audioHash: a.hash ?? null, durationMs: a.durationMs ?? null });
        const ref = a.hash ? { hash: a.hash, format: audioFormatOf(a.format) } : null;
        const local = !!ref && !!store?.has(ref.hash);
        audio.push({
          chapter: c, timing, timingSource: source, local,
          resolve: async () => {
            if (ref && store?.has(ref.hash)) { const uri = await playableUri(store, ref); if (uri) return uri; }
            if (a.url) return a.url;
            throw new Error("This recording isn't on the phone yet.");
          }
        });
      }
      return {
        loading, range, rows, textProblem: loading ? null : rows ? null : bookHash ? 'No text for this passage in this source.' : 'This source has no text for this book.',
        plan: audio.length ? playPlan(range, audio) : null, chapters: audio, filesets: [], copyright, bibleBrain: false
      };
    }
    // Bible Brain, as a library source or one explored outside the library.
    const ready = bb && bb.key === bbKeyNow ? bb : null;
    const rows = ready && filesets.text ? passageRows(range, ready.verses) : null;
    const audio: AudioChapter[] = filesets.audio ? chapters.map((c) => {
      const ownTiming = get<TimingDoc>(book?.chapters.find((x) => x.chapter === c)?.timing);
      const { timing, source } = resolveTiming({ bookTiming: ownTiming, fcbhRows: ready?.stamps.get(c) ?? null });
      return {
        chapter: c, timing, timingSource: source, local: !!keptAudio(store, bbKey(filesets.audio!, range.book, c)),
        resolve: () => bibleBrainAudio(store, filesets.audio!, range.book, c)
      };
    }) : [];
    const loading = !!bbKeyNow && !ready?.done && !rows;
    return {
      loading, range, rows,
      textProblem: loading ? null : !filesets.text ? 'No text for this book in this Bible.' : rows ? null : ready?.problem ?? 'No text for this passage.',
      plan: audio.length ? playPlan(range, audio) : null, chapters: audio,
      filesets: [filesets.text, filesets.audio].filter((x): x is string => !!x), copyright, bibleBrain: true
    };
    // `setFiles` revisions re-run this through the store and index reads.
  }, [option, range, book, bookHash, bb, bbKeyNow, filesets, get, store, keptTick, files]);
}

/** The marks on each version chip for this passage. */
export function useChipMarks(ctx: Ctx, passage: PassageSources): Record<string, string[]> {
  const store = storeOf(ctx);
  const tick = useKeptRevision();
  const [files, setFiles] = useState(0);
  useEffect(() => { void ensureIndex().then(() => setFiles((n) => n + 1)); return onSourceFiles(() => setFiles((n) => n + 1)); }, []);
  // Book documents of library sources, to tell text and audio apart per chapter.
  const bookHashes = useMemo(() => passage.range
    ? passage.options.map((o) => o.doc?.provider.kind === 'library' ? o.doc.books.find((b) => b.book === passage.range!.book)?.doc : undefined)
    : [], [passage.options, passage.range]);
  const books = useLibraryDocs(ctx.project.orgId, bookHashes);
  return useMemo(() => {
    const out: Record<string, string[]> = {};
    const range = passage.range;
    if (!range) return out;
    const chapters = chaptersOf(range);
    for (const o of passage.options) {
      const offers = offersFor(o, range.book, o.kind === 'builtin');
      if (o.kind === 'builtin') {
        out[o.itemId] = [...chipMarks({ text: true, audio: offers.audio, offlineAllowed: false, textOnPhone: true, audioOnPhone: false }), 'built in'];
        continue;
      }
      if (o.doc?.provider.kind === 'library') {
        const hash = o.doc.books.find((b) => b.book === range.book)?.doc;
        const book = books.get<SourceBookDoc>(hash);
        const exact = book ? bookOffers(book, chapters) : offers;
        const audioOnPhone = !!book && chapters.every((c) => {
          const h = book.chapters.find((x) => x.chapter === c)?.audio?.hash;
          return !!h && !!store?.has(h);
        });
        out[o.itemId] = chipMarks({ text: exact.text, audio: exact.audio, offlineAllowed: offlineAllowed(o), textOnPhone: !!book, audioOnPhone });
        continue;
      }
      const f = filesetsFor(o, range.book);
      out[o.itemId] = chipMarks({
        text: !!f.text, audio: !!f.audio, offlineAllowed: offlineAllowed(o),
        textOnPhone: !!f.text && chapters.every((c) => textKept(f.text!, range.book, c)),
        audioOnPhone: !!f.audio && chapters.every((c) => !!keptAudio(store, bbKey(f.audio!, range.book, c)))
      });
    }
    return out;
    // tick and files: kept text and files changed.
  }, [passage.options, passage.range, books.get, store, tick, files]);
}
