// More Bibles (`bible_explore`): app-only, not in the partner demo
// (docs/reference-material.md; the drift log in test/specParity.test.ts
// names its edges). Translators choose for themselves: from the source
// reader beside a passage, they search Bible Brain by language (the
// language's source language first), read and listen to any chapter, and
// add a Bible to My Bibles, which is kept on this phone for this language.
// Sources in the organization's library that nobody recommended can be
// added the same way. Every Bible says whether it has audio and whether it
// can be kept offline.
import { languageInfo, libraryItems, testamentOf, type SourceDoc, type VerseRange } from '@langquest-next/core';
import { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Ctx } from '../ctx';
import { TITLES } from '../flow';
import {
  Badge, Card, Chip, EmptyState, Group, Header, LinkBtn, PrimaryBtn, Row, Screen, SearchField, SectionLabel, txt
} from '../kit';
import { useLibraryDocs } from '../library/useLibrary';
import { contractsFor } from '../screenContracts';
import { bibleErrorText, type BibleDetail, type BibleLanguage, type BibleSummary } from '../sources/bibleBrain';
import { offersFor, offlineAllowed, refText, type SourceOption } from '../sources/model';
import { SourceView } from '../sources/SourceReader';
import { bibleBrain, useMyBibles } from '../sources/store';
import { C, space } from '../theme';

/** "Audio: New Testament only", "Text and audio", "Text only". */
function mediaLine(b: Pick<BibleSummary, 'text' | 'audio'>): string {
  const t = [b.text.OT && 'OT', b.text.NT && 'NT'].filter(Boolean);
  const a = [b.audio.OT && 'OT', b.audio.NT && 'NT'].filter(Boolean);
  const span = (x: unknown[]) => (x.length === 2 ? 'whole Bible' : x[0] === 'OT' ? 'Old Testament only' : 'New Testament only');
  if (a.length === 0) return t.length ? `Text only · ${span(t)}` : 'Nothing to read or hear yet';
  if (t.length === 0) return `Audio only · ${span(a)}`;
  return a.length === t.length && a.join() === t.join() ? `Text and audio · ${span(a)}` : `Text · ${span(t)}. Audio · ${span(a)}`;
}

/** The language most of these Bibles name ("English" from "English: USA", "English: Aboriginal"). */
function languageOf(bibles: BibleSummary[] | null): string {
  const counts = new Map<string, number>();
  for (const b of bibles ?? []) { const n = b.languageName.split(':')[0]!.trim(); counts.set(n, (counts.get(n) ?? 0) + 1); }
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
}

type Picked = { kind: 'biblebrain'; bibleId: string } | { kind: 'library'; itemId: string };

export function BibleExplore(ctx: Ctx) {
  const state = ctx.language.state;
  const languageId = ctx.params['languageId'] ?? ctx.languageId ?? null;
  const unitId = ctx.params['unitId'];
  const mine = useMyBibles(ctx.session.actorId, ctx.language.orgId, languageId);
  const sourceLanguage = (languageId ? languageInfo(ctx.org.state, languageId)?.sourceCode : undefined) ?? 'eng';
  const [lang, setLang] = useState<{ code: string; name: string }>({ code: ctx.params['lang'] ?? sourceLanguage, name: '' });
  const [query, setQuery] = useState('');
  const [languages, setLanguages] = useState<BibleLanguage[] | null>(null);
  const [bibles, setBibles] = useState<BibleSummary[] | null>(null);
  const [problem, setProblem] = useState('');
  const [picked, setPicked] = useState<Picked | null>(null);

  // Bibles in the chosen language.
  useEffect(() => {
    if (!bibleBrain) return;
    let live = true;
    setBibles(null);
    setProblem('');
    bibleBrain.bibles(lang.code).then((b) => { if (live) setBibles(b); }).catch((e: unknown) => { if (live) { setBibles([]); setProblem(bibleErrorText(e)); } });
    return () => { live = false; };
  }, [lang.code]);

  // Languages matching what is typed, after a pause.
  useEffect(() => {
    if (!bibleBrain || query.trim().length < 2) { setLanguages(null); return; }
    let live = true;
    const timer = setTimeout(() => {
      bibleBrain!.languages(query.trim()).then((l) => { if (live) setLanguages(l); }).catch((e: unknown) => { if (live) { setLanguages([]); setProblem(bibleErrorText(e)); } });
    }, 350);
    return () => { live = false; clearTimeout(timer); };
  }, [query]);

  // Sources in this organization's library, to choose one nobody recommended.
  const libraryItemsList = useMemo(() => libraryItems(ctx.org.state?.library ?? {}, 'material').filter((i) => i.current && !i.archived), [ctx.org.state?.library]);
  const docs = useLibraryDocs(ctx.language.orgId, libraryItemsList.map((i) => i.current));
  const librarySources = libraryItemsList.flatMap((i) => {
    const doc = docs.get<SourceDoc>(i.current);
    return doc && doc.format === 'source@1' ? [{ itemId: i.itemId, doc, hash: i.current! }] : [];
  });

  const passageLabel = unitId && state?.units[unitId] ? state.units[unitId]!.label : undefined;
  const back = () => (picked ? setPicked(null) : ctx.back());
  const header = <Header title={TITLES.bible_explore} sub={passageLabel ? `For ${passageLabel}` : 'Find a Bible to read and hear'} onBack={back} />;

  if (picked) {
    const lib = picked.kind === 'library' ? librarySources.find((s) => s.itemId === picked.itemId) : undefined;
    return <BibleDetailView ctx={ctx} picked={picked} lib={lib} languageId={languageId} unitId={unitId} mine={mine} header={header} />;
  }

  return (
    <Screen header={header}>
      {!bibleBrain ? (
        <EmptyState icon="globe" title="Bible Brain isn't set up on this phone" sub="Your organization's library still works. Ask whoever runs LangQuest for your team to connect the server." />
      ) : (
        <>
          <SearchField value={query} onChangeText={setQuery} placeholder="Search for a language" />
          {languages ? (
            <Group>
              {languages.length === 0 ? <Row label="No languages found" sub={problem || 'Try the name in English, or its three-letter code.'} last /> : null}
              {languages.slice(0, 30).map((l, i, all) => (
                <Row key={l.code} label={l.autonym && l.autonym !== l.name ? `${l.name} · ${l.autonym}` : l.name} sub={`${l.code} · ${l.bibles} Bible${l.bibles === 1 ? '' : 's'}`}
                  onPress={() => { setLang({ code: l.code, name: l.name }); setQuery(''); }} last={i === all.length - 1} />
              ))}
            </Group>
          ) : null}
          <SectionLabel label={`Bibles in ${lang.name || languageOf(bibles) || lang.code}`} />
          {bibles === null ? <Text style={txt.smMuted}>Loading…</Text> : bibles.length === 0 ? (
            <Card><Text style={txt.smMuted}>{problem || 'No Bibles in this language on Bible Brain.'}</Text></Card>
          ) : (
            <Group>
              {bibles.map((b, i) => (
                <Row key={b.bibleId} label={`${b.abbreviation} · ${b.name}`} sub={mediaLine(b)}
                  {...(mine.has(`biblebrain.${b.bibleId}`) ? { badge: 'My Bible', badgeTone: 'brand' as const } : {})}
                  onPress={() => setPicked({ kind: 'biblebrain', bibleId: b.bibleId })} last={i === bibles.length - 1} />
              ))}
            </Group>
          )}
        </>
      )}
      {librarySources.length > 0 ? (
        <>
          <SectionLabel label="In your organization's library" />
          <Group>
            {librarySources.map((s, i) => (
              <Row key={s.itemId} label={`${s.doc.abbreviation} · ${s.doc.name}`} sub={s.doc.offline === 'allowed' ? 'Can be kept offline' : 'Streams only: needs a connection'}
                {...(mine.has(s.itemId) ? { badge: 'My Bible', badgeTone: 'brand' as const } : {})}
                onPress={() => setPicked({ kind: 'library', itemId: s.itemId })} last={i === librarySources.length - 1} />
            ))}
          </Group>
        </>
      ) : null}
      <Text style={[txt.xs, { paddingHorizontal: space.xs }]}>
        Bibles you add are yours, on this phone, for this language. Your team's recommended Bibles always come first.
      </Text>
    </Screen>
  );
}

/** One Bible: what it has, any chapter to read and hear, and Add to My Bibles. */
function BibleDetailView(props: {
  ctx: Ctx; picked: Picked; lib: { itemId: string; doc: SourceDoc; hash: string } | undefined; languageId: string | null; unitId: string | undefined;
  mine: ReturnType<typeof useMyBibles>; header: React.ReactNode;
}) {
  const { ctx, picked, lib, mine } = props;
  const [bible, setBible] = useState<BibleDetail | null>(null);
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const bibleId = picked.kind === 'biblebrain' ? picked.bibleId : lib?.doc.provider.kind === 'biblebrain' ? lib.doc.provider.bibleId : null;
  useEffect(() => {
    if (!bibleId || !bibleBrain) return;
    let live = true;
    bibleBrain.bible(bibleId).then((b) => { if (live) setBible(b); }).catch((e: unknown) => { if (live) setProblem(bibleErrorText(e)); });
    return () => { live = false; };
  }, [bibleId]);

  const option: SourceOption | undefined = picked.kind === 'library'
    ? (lib ? { itemId: lib.itemId, kind: 'library', from: 'mine', name: lib.doc.name, abbreviation: lib.doc.abbreviation, language: lib.doc.language, doc: lib.doc, docHash: lib.hash, ...(bible ? { bible } : {}) } : undefined)
    : (bible ? { itemId: `biblebrain.${bible.bibleId}`, kind: 'biblebrain', from: 'mine', name: bible.name, abbreviation: bible.abbreviation, language: bible.language, bible } : undefined);

  // Which chapter to show: the passage's own when this Bible has it, else its first.
  const passageBook = props.unitId ? /\/([A-Z0-9]{3})/.exec(props.unitId)?.[1] : undefined;
  const books = useMemo(() => {
    if (picked.kind === 'library') return (lib?.doc.books ?? []).map((b) => ({ book: b.book, name: b.name, chapters: 0 }));
    return (bible?.books ?? []).map((b) => ({ book: b.book, name: b.name, chapters: b.chapters }));
  }, [picked.kind, lib, bible]);
  const [book, setBook] = useState<string | null>(null);
  const [chapter, setChapter] = useState(1);
  const current = book ?? (books.find((b) => b.book === passageBook)?.book ?? books[0]?.book ?? null);
  const chapters = books.find((b) => b.book === current)?.chapters ?? 0;
  const range: VerseRange | null = current ? { book: current, start: { chapter, verse: 1 }, end: { chapter, verse: 999 } } : null;
  const { get } = useLibraryDocs(ctx.language.orgId, []);
  const passage = { range, ref: range ? refText(range) : '', versification: null, options: option ? [option] : [], loading: !option, get };

  const has = option ? mine.has(option.itemId) : false;
  const offers = option && current ? offersFor(option, current) : null;
  async function add() {
    if (!option || !props.languageId) return;
    setBusy(true);
    try {
      await mine.add({
        itemId: option.itemId, kind: option.kind === 'library' ? 'library' : 'biblebrain', name: option.name, abbreviation: option.abbreviation,
        language: option.language, ...(option.kind === 'biblebrain' && bible ? { bibleId: bible.bibleId } : {})
      });
      ctx.toast(`${option.abbreviation} added to My Bibles`, () => mine.remove(option.itemId));
      ctx.back();
    } catch {
      ctx.toast('Not added. Try again.');
    } finally { setBusy(false); }
  }

  const footer = option && props.languageId ? (
    has ? <PrimaryBtn label="In My Bibles" icon="check" disabled onPress={() => undefined} />
      : <PrimaryBtn label="Add to My Bibles" icon="plus" busy={busy} onPress={() => void add()} />
  ) : undefined;

  return (
    <Screen fixed header={props.header} footer={footer}>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {!option ? (
          <EmptyState icon="book" title={problem || 'Loading…'} />
        ) : (
          <>
            <Card>
              <Text style={txt.title}>{option.name}</Text>
              <Text style={txt.xs}>{option.abbreviation} · {bible?.languageName ?? option.language}</Text>
              <View style={styles.badges}>
                <Badge label={offlineAllowed(option) ? 'Can be kept offline' : 'Streams only'} tone={offlineAllowed(option) ? 'green' : 'default'} />
                {bible ? <Badge label={mediaLine(bible)} /> : null}
                {offers && !offers.audio && current ? <Badge label={`No audio for ${testamentOf(current) === 'OT' ? 'the Old' : 'the New'} Testament`} tone="amber" /> : null}
              </View>
              {has ? <LinkBtn label="Remove from My Bibles" color={C.muted} style={{ alignSelf: 'flex-start' }} onPress={() => void mine.remove(option.itemId)} /> : null}
            </Card>
            {books.length > 1 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
                {books.map((b) => <Chip key={b.book} label={b.name} on={b.book === current} onPress={() => { setBook(b.book); setChapter(1); }} />)}
              </ScrollView>
            ) : null}
            {chapters > 1 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
                {Array.from({ length: chapters }, (_, i) => i + 1).map((c) => (
                  <Chip key={c} label={String(c)} on={c === chapter} accessibilityLabel={`Chapter ${c}`} onPress={() => setChapter(c)} />
                ))}
              </ScrollView>
            ) : picked.kind === 'library' ? (
              <View style={styles.chapterStep}>
                <LinkBtn label="Previous chapter" onPress={() => setChapter((c) => Math.max(1, c - 1))} />
                <Text style={txt.sm}>Chapter {chapter}</Text>
                <LinkBtn label="Next chapter" onPress={() => setChapter((c) => c + 1)} />
              </View>
            ) : null}
            <SourceView ctx={ctx} unitId={props.unitId ?? ''} languageId={props.languageId ?? ''} passage={passage} option={option} chips={false} />
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { padding: space.lg, gap: space.md, paddingBottom: space.xxl },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chips: { gap: space.sm, paddingVertical: 2 },
  chapterStep: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }
});

export const contracts = contractsFor('bible_explore');
