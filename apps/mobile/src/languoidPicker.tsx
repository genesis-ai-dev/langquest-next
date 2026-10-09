// Finding a language in the language list (docs/languoids.md), online only:
// phones keep no copy of it. Adding a language offers what matches its name,
// and a language's page links one added unlinked (v1.LanguageCodeSet).
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { Banner, Group, LinkBtn, Row, SectionLabel, SmallBtn, txt } from './kit';
import { hitLine, languoidHits, type LanguoidHit, type LanguoidRow } from './languoidModel';
import { supabase } from './supabase';
import { space } from './theme';

export interface LanguoidSearch {
  status: 'idle' | 'searching' | 'found' | 'none' | 'unreachable';
  hits: LanguoidHit[];
  retry: () => void;
}

/** Searches the list a moment after someone stops typing; nothing under two letters. */
export function useLanguoidSearch(query: string, enabled = true): LanguoidSearch {
  const q = query.trim();
  const [result, setResult] = useState<Omit<LanguoidSearch, 'retry'>>({ status: 'idle', hits: [] });
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
      supabase.rpc('search_languoids', { search_query: q, result_limit: 8, levels: ['language', 'dialect'] }).then(({ data, error }) => {
        if (!live) return;
        if (error) return unreachable();
        const hits = languoidHits((data ?? []) as LanguoidRow[]);
        setResult({ status: hits.length ? 'found' : 'none', hits });
      }, unreachable);
    }, 300);
    return () => { live = false; clearTimeout(timer); };
  }, [q, enabled, attempt]);
  return { ...result, retry: () => setAttempt((n) => n + 1) };
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
        <SectionLabel label="In the language list" />
        <Group>
          <Row icon="globe" label={picked.name} sub={hitLine(picked)} last right={<SmallBtn label="Change" onPress={() => props.onPick(null)} />} />
        </Group>
      </View>
    );
  }
  if (search.status === 'idle') return null;
  if (search.status === 'unreachable') {
    return (
      <View style={{ gap: space.xs }}>
        <Banner icon="cloud" tone="amber" title="Can't search the language list" body={props.unreachable} />
        <LinkBtn label="Try again" onPress={search.retry} />
      </View>
    );
  }
  if (search.status === 'none') {
    return <Text style={txt.smMuted}>Nothing in the language list goes by that name. {props.unlisted}</Text>;
  }
  return (
    <View style={{ gap: space.xs }}>
      <SectionLabel label={search.status === 'searching' && search.hits.length === 0 ? 'Looking in the language list…' : 'Is it one of these?'} />
      {search.hits.length ? (
        <Group>
          {search.hits.map((h, i) => (
            <Row key={h.id} icon="globe" label={h.name} sub={hitLine(h)} role="radio" selected={false} last={i === search.hits.length - 1}
              onPress={() => props.onPick(h)} />
          ))}
        </Group>
      ) : null}
      {search.hits.length ? <Text style={txt.smMuted}>{props.unlisted}</Text> : null}
    </View>
  );
}
