import {
  bibleBooks, bibleBrainBookId, bibleRangeFromUnit, passageAudioBounds,
  sourceChapters, verseAddress, type VerseTiming
} from '@langquest-next/core';
import { useEffect, useRef, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { supabase } from './supabase';
import type { Ctx } from './ctx';
import { ActionButton, Card, text } from './ui';
import { Note, Row } from './pui';
import { AudioClip } from './audioClip';
import { colors, space } from './theme';

async function request<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('bible-brain', { body });
  if (error) {
    const context = (error as { context?: Response }).context;
    let message = 'Bible Brain could not load. BSB audio remains available.';
    if (context instanceof Response) {
      try { const response = await context.json(); message = response.error ?? message; } catch { /* Keep the safe fallback. */ }
    }
    throw new Error(message);
  }
  if (data?.error) throw new Error(data.error);
  return data as T;
}
type Fileset = { id: string; bibleId: string; name: string; type: string; size: string };
export function BibleBrainPicker({ onSelect }: { onSelect: (id: string) => void }) {
  const [language, setLanguage] = useState('eng');
  const [items, setItems] = useState<Fileset[]>([]);
  const [page, setPage] = useState(0);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  async function search(next = 1) {
    const run = ++generation.current;
    setBusy(true); setError('');
    try {
      const result = await request<{ filesets: Fileset[]; more: boolean }>({
        action: 'catalog', language: language.trim().toLowerCase(), page: next
      });
      if (run !== generation.current) return;
      setItems(prior => next === 1 ? result.filesets : [...prior, ...result.filesets]);
      setMore(result.more); setPage(next);
    } catch (e) { if (run === generation.current) setError((e as Error).message); }
    finally { if (run === generation.current) setBusy(false); }
  }
  useEffect(() => () => { generation.current++; }, []);
  return <View style={{ gap: space.sm }}>
    <TextInput accessibilityLabel="Bible Brain language ISO code" value={language}
      autoCapitalize="none" maxLength={3} onChangeText={value => {
        generation.current++; setLanguage(value); setItems([]); setPage(0); setMore(false); setBusy(false);
      }} style={{ borderWidth: 1, borderColor: colors.border, padding: space.md }} />
    <ActionButton label="Find audio Bibles" accessibilityLabel="Find audio Bibles"
      variant="outline" disabled={busy} onPress={() => void search()} />
    {items.map(item => <Row key={item.id} label={item.name}
      sub={`${item.id} · ${item.size} · ${item.type}`}
      onPress={() => onSelect(item.id)} />)}
    {page > 0 && !items.length ? <Note>No audio filesets found for this language.</Note> : null}
    {more ? <ActionButton label="More audio Bibles" accessibilityLabel="More audio Bibles"
      variant="outline" disabled={busy} onPress={() => void search(page + 1)} /> : null}
    {error ? <Note>{error}</Note> : null}
  </View>;
}

type Chapter = { uri: string; duration: number; timings: VerseTiming[]; copyright: string };
function BibleBrainChapter({ ctx, filesetId, book, chapter, first, last, disabled }: {
  ctx: Ctx; filesetId: string; book: string; chapter: number;
  first: number; last: number; disabled: boolean;
}) {
  const [audio, setAudio] = useState<Chapter | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setAudio(null); setError('');
    void request<Chapter>({ action: 'chapter', filesetId, book: bibleBrainBookId(book), chapter })
      .then(value => { if (active) setAudio(value); })
      .catch(e => { if (active) setError((e as Error).message); });
    return () => { active = false; };
  }, [filesetId, book, chapter, attempt]);
  const bounds = audio ? passageAudioBounds(audio.timings, first, last,
    last === bibleBooks.find(b => b.itemId === book)?.verses[chapter - 1]
      ? audio.duration : undefined) : null;
  return <Card>
    <Text style={text.small}>{filesetId} · {bounds ? 'Passage audio' : 'Full chapter'}</Text>
    {audio ? <>
      <AudioClip project={ctx.project} hashes={[]} uri={audio.uri}
        {...(bounds ?? {})} disabled={disabled} seekControls
        label={`Play Bible Brain audio, chapter ${chapter}`} />
      <Text style={text.small}>{audio.copyright}</Text>
    </> : null}
    {error ? <Note>{error}</Note> : null}
    <ActionButton label="Refresh audio link" accessibilityLabel="Refresh Bible Brain audio link"
      variant="outline" disabled={disabled} onPress={() => setAttempt(v => v + 1)} />
  </Card>;
}
export function BibleBrainAudio({ ctx, unitId, filesetId, disabled }: {
  ctx: Ctx; unitId: string; filesetId: string; disabled: boolean;
}) {
  const range = bibleRangeFromUnit(unitId);
  if (!range) return null;
  const start = verseAddress(range.book, range.start)!;
  const end = verseAddress(range.book, range.end)!;
  const book = bibleBooks.find(b => b.itemId === range.book)!;
  return <>{sourceChapters(unitId).map(c => <BibleBrainChapter
    key={`${filesetId}:${c.chapter}`} ctx={ctx} filesetId={filesetId}
    book={range.book} chapter={c.chapter}
    first={c.chapter === start.chapter ? start.verse : 1}
    last={c.chapter === end.chapter ? end.verse : book.verses[c.chapter - 1]!}
    disabled={disabled} />)}</>;
}
