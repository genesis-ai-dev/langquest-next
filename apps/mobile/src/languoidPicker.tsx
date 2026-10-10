// Finding a language in the language list (docs/languoids.md), online only:
// phones keep no copy of it. Adding a language offers what matches its name,
// and a language's page links one added unlinked (v1.LanguageCodeSet).
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { t } from './i18n';
import { Banner, Group, LinkBtn, Row, SectionLabel, SmallBtn, txt } from './kit';
import { hitLine, languoidHits, type LanguoidHit, type LanguoidRow } from './languoidModel';
import { supabase } from './supabase';
import { C, space } from './theme';

/** How many matches one search shows, closest first; they scroll in a box of their own. */
export const LANGUOID_RESULTS = 50;

export interface LanguoidSearch {
  status: 'idle' | 'searching' | 'found' | 'none' | 'unreachable';
  hits: LanguoidHit[];
  /** What was typed, trimmed: bold where it appears in each match. */
  query: string;
  retry: () => void;
}

/** Searches the list a moment after someone stops typing; nothing under two letters. */
export function useLanguoidSearch(query: string, enabled = true): LanguoidSearch {
  const q = query.trim();
  const [result, setResult] = useState<Omit<LanguoidSearch, 'retry' | 'query'>>({ status: 'idle', hits: [] });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled || q.length < 2) {
      setResult({ status: 'idle', hits: [] });
      return;
    }
    let live = true;
    // The last matches stay while the next search runs, so the list does not flicker.
    setResult((r) => ({ status: 'searching', hits: r.hits }));
    const unreachable = () => { if (live) setResult({ status: 'unreachable', hits: [] }); };
    const timer = setTimeout(() => {
      supabase.rpc('search_languoids', { search_query: q, result_limit: LANGUOID_RESULTS, levels: ['language', 'dialect'] }).then(({ data, error }) => {
        if (!live) return;
        if (error) return unreachable();
        const hits = languoidHits((data ?? []) as LanguoidRow[]);
        setResult({ status: hits.length ? 'found' : 'none', hits });
      }, unreachable);
    }, 300);
    return () => { live = false; clearTimeout(timer); };
  }, [q, enabled, attempt]);
  return { ...result, query: q, retry: () => setAttempt((n) => n + 1) };
}

/** A languoid's name, read online; null offline or until it comes. */
export function useLanguoidName(id: string | null): string | null {
  const [name, setName] = useState<{ id: string; name: string } | null>(null);
  useEffect(() => {
    if (!id) return;
    let live = true;
    supabase.from('languoid').select('name').eq('id', id).maybeSingle().then(({ data }) => {
      if (live && data?.name) setName({ id, name: data.name as string });
    }, () => undefined);
    return () => { live = false; };
  }, [id]);
  return name && name.id === id ? name.name : null;
}

/**
 * The matches to pick from, or the one picked with a way to change it.
 * `unlisted` says what happens when it is not there, `unreachable` when the
 * list cannot be searched (offline): the two places differ.
 */
export function LanguoidPicker(props: {
  search: LanguoidSearch; picked: LanguoidHit | null; onPick: (hit: LanguoidHit | null) => void;
  unlisted: string; unreachable: string;
}) {
  const { search, picked } = props;
  if (picked) {
    return (
      <View style={{ gap: space.xs }}>
        <SectionLabel label={t('languoid.picker.inList')} />
        <Group>
          <Row icon="globe" label={picked.name} sub={hitLine(picked)} last right={<SmallBtn label={t('languoid.picker.change')} onPress={() => props.onPick(null)} />} />
        </Group>
      </View>
    );
  }
  if (search.status === 'idle') return null;
  if (search.status === 'unreachable') {
    return (
      <View style={{ gap: space.xs }}>
        <Banner icon="cloud" tone="amber" title={t('languoid.picker.cannotSearch')} body={props.unreachable} />
        <LinkBtn label={t('common.tryAgain')} onPress={search.retry} />
      </View>
    );
  }
  if (search.status === 'none') {
    return <Text style={txt.smMuted}>{`${t('languoid.picker.noMatch')} ${props.unlisted}`}</Text>;
  }
  // While a search runs, a card with a spinner leads the list, over the last matches until the new ones come.
  const searching = search.status === 'searching';
  const n = search.hits.length;
  return (
    <View style={{ gap: space.xs }}>
      {n ? <SectionLabel label={t('languoid.picker.oneOfThese')} /> : null}
      <Group>
        <ScrollView style={{ maxHeight: LIST_HEIGHT }} nestedScrollEnabled keyboardShouldPersistTaps="handled">
          {searching ? (
            <Row leading={<View style={spinnerTile}><ActivityIndicator size="small" color={C.primary} /></View>}
              label={t('languoid.picker.searching')} muted last={n === 0} />
          ) : null}
          {search.hits.map((h, i) => (
            <Row key={h.id} icon="globe" label={h.name} sub={hitLine(h)} highlight={search.query} role="radio" selected={false} last={i === n - 1}
              onPress={() => props.onPick(h)} />
          ))}
        </ScrollView>
      </Group>
      {!searching && n >= LANGUOID_RESULTS ? <Text style={txt.smMuted}>{t('languoid.picker.closest', { count: LANGUOID_RESULTS })}</Text> : null}
      {n ? <Text style={txt.smMuted}>{props.unlisted}</Text> : null}
    </View>
  );
}

/** About five matches show at once; the rest scroll. */
const LIST_HEIGHT = 380;
/** The size and look of a Row's icon tile (kit.tsx), with a spinner in it. */
const spinnerTile = { width: 44, height: 44, borderRadius: 14, backgroundColor: C.light, alignItems: 'center', justifyContent: 'center' } as const;
