// More Bibles (`bible_explore`): app-only, not in the partner demo
// (docs/reference-material.md; the drift log in test/specParity.test.ts
// names its edges). Translators choose for themselves: from the source
// reader beside a passage, they search Bible Brain by language (the
// language's source language first), read and listen to any chapter, and
// add a Bible to My Bibles, which is kept on this phone for this language.
// Sources in the organization's library that nobody recommended can be
// added the same way. Every Bible says whether it has audio and whether it
// can be kept offline.
import { chaptersInBook, libraryItems, testamentOf, type SourceDoc, type VersificationDoc, type VerseRange } from '@langquest-next/core';
import { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../ui/text';
import type { Ctx } from '../shell/ctx';
import { teamLanguage } from '../reference/languages';
import { screenTitle } from '../shell/flow';
import { HelpRow } from '../helpMode/helpBadge';
import { t } from '../i18n';
import { formatNumber } from '../i18n/format';
import { Badge, Card, Chip, EmptyState, Group, Header, LinkBtn, PrimaryBtn, Row, Screen, SearchField, SectionLabel } from '../ui/kit';
import { txt } from '../ui/textStyles';
import { useLibraryDocs } from '../library/useLibrary';
import { contractsFor } from '../shell/screenContracts';
import { bibleErrorText, type BibleDetail, type BibleLanguage, type BibleSummary } from '../sources/bibleBrain';
import { offersFor, offlineAllowed, refText, type SourceOption } from '../sources/model';
import { SourceView } from '../sources/SourceReader';
import { bibleBrain, type MyBible } from '../sources/store';
import { useMyBibles } from '../sources/useMyBibles';
import { C, space } from '../ui/theme';

/** "Audio: New Testament only", "Text and audio", "Text only". */
function mediaLine(b: Pick<BibleSummary, 'text' | 'audio'>): string {
  const text = [b.text.OT && 'OT', b.text.NT && 'NT'].filter(Boolean);
  const audio = [b.audio.OT && 'OT', b.audio.NT && 'NT'].filter(Boolean);
  const span = (x: unknown[]) => (x.length === 2 ? t('sources.media.wholeBible') : x[0] === 'OT' ? t('sources.media.otOnly') : t('sources.media.ntOnly'));
  if (audio.length === 0) return text.length ? t('sources.media.textOnly', { span: span(text) }) : t('sources.media.nothing');
  if (text.length === 0) return t('sources.media.audioOnly', { span: span(audio) });
  return audio.length === text.length && audio.join() === text.join() ? t('sources.media.both', { span: span(audio) }) : t('sources.media.mixed', { text: span(text), audio: span(audio) });
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
  // Bibles are explored first in the team's reference language (decision 84).
  const sourceLanguage = teamLanguage(ctx.org.state, languageId === ctx.language.languageId ? state : null, languageId);
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
  const libraryItemsList = useMemo(() => libraryItems(ctx.org.state?.library ?? {}, 'material').filter((i) => i.current && !i.archived), [ctx.org.state]);
  const docs = useLibraryDocs(ctx.language.orgId, libraryItemsList.map((i) => i.current));
  const librarySources = libraryItemsList.flatMap((i) => {
    const doc = docs.get<SourceDoc>(i.current);
    return doc && doc.format === 'source@1' ? [{ itemId: i.itemId, doc, hash: i.current! }] : [];
  });

  const passageLabel = unitId && state?.units[unitId] ? state.units[unitId]!.label : undefined;
  const back = () => (picked ? setPicked(null) : ctx.back());
  const header = <Header title={screenTitle('bible_explore')} sub={passageLabel ? t('sources.explore.forPassage', { passage: passageLabel }) : t('sources.explore.sub')} onBack={back} />;

  if (picked) {
    const lib = picked.kind === 'library' ? librarySources.find((s) => s.itemId === picked.itemId) : undefined;
    return <BibleDetailView ctx={ctx} picked={picked} lib={lib} languageId={languageId} unitId={unitId} mine={mine} header={header} />;
  }

  return (
    <Screen header={header}>
      {!bibleBrain ? (
        <EmptyState icon="globe" title={t('sources.explore.notSetUp')} sub={t('sources.explore.notSetUpSub')} />
      ) : (
        <>
          <SearchField value={query} onChangeText={setQuery} placeholder={t('sources.explore.searchPlaceholder')} help={t('sources.explore.searchHelp')} />
          {languages ? (
            <Group>
              {languages.length === 0 ? <Row label={t('sources.explore.noLanguages')} sub={problem || t('sources.explore.noLanguagesSub')} last /> : null}
              {languages.slice(0, 30).map((l, i, all) => (
                <HelpRow key={l.code} of="sources.language">
                  <Row label={l.autonym && l.autonym !== l.name ? `${l.name} · ${l.autonym}` : l.name} sub={t('sources.explore.languageBibles', { code: l.code, count: l.bibles })}
                    help={t('sources.explore.languageHelp')} onPress={() => { setLang({ code: l.code, name: l.name }); setQuery(''); }} last={i === all.length - 1} />
                </HelpRow>
              ))}
            </Group>
          ) : null}
          <SectionLabel label={t('sources.explore.biblesIn', { language: lang.name || languageOf(bibles) || lang.code })} />
          {bibles === null ? <Text style={txt.smMuted}>{t('common.loading')}</Text> : bibles.length === 0 ? (
            <Card><Text style={txt.smMuted}>{problem || t('sources.explore.noBibles')}</Text></Card>
          ) : (
            <Group>
              {bibles.map((b, i) => (
                <HelpRow key={b.bibleId} of="sources.bible">
                  <Row label={`${b.abbreviation} · ${b.name}`} sub={mediaLine(b)} help={t('sources.explore.bibleHelp')}
                    {...(mine.has(`biblebrain.${b.bibleId}`) ? { badge: t('sources.explore.myBible'), badgeTone: 'brand' as const } : {})}
                    onPress={() => setPicked({ kind: 'biblebrain', bibleId: b.bibleId })} last={i === bibles.length - 1} />
                </HelpRow>
              ))}
            </Group>
          )}
        </>
      )}
      {librarySources.length > 0 ? (
        <>
          <SectionLabel label={t('sources.explore.inLibrary')} />
          <Group>
            {librarySources.map((s, i) => (
              <HelpRow key={s.itemId} of="sources.bible">
                <Row label={`${s.doc.abbreviation} · ${s.doc.name}`} sub={s.doc.offline === 'allowed' ? t('sources.explore.keptOffline') : t('sources.explore.streamsOnlyLine')}
                  help={t('sources.explore.bibleHelp')}
                  {...(mine.has(s.itemId) ? { badge: t('sources.explore.myBible'), badgeTone: 'brand' as const } : {})}
                  onPress={() => setPicked({ kind: 'library', itemId: s.itemId })} last={i === librarySources.length - 1} />
              </HelpRow>
            ))}
          </Group>
        </>
      ) : null}
      <Text style={[txt.xs, { paddingHorizontal: space.xs }]}>{t('sources.explore.footnote')}</Text>
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
  const { get } = useLibraryDocs(ctx.language.orgId, picked.kind === 'library' ? [lib?.doc.versification] : []);
  // A library Bible's last chapter of the book, from its numbering; unknown until that document is here.
  const v11n = picked.kind === 'library' && lib ? get<VersificationDoc>(lib.doc.versification) : null;
  const lastChapter = v11n && current ? chaptersInBook(v11n, current) || null : null;
  const passage = { range, ref: range ? refText(range) : '', versification: null, options: option ? [option] : [], loading: !option, notOnDevice: false, get };

  const has = option ? mine.has(option.itemId) : false;
  const offers = option && current ? offersFor(option, current) : null;
  const entry = (o: SourceOption): MyBible => ({
    itemId: o.itemId, kind: o.kind === 'library' ? 'library' : 'biblebrain', name: o.name, abbreviation: o.abbreviation,
    language: o.language, ...(o.kind === 'biblebrain' && bible ? { bibleId: bible.bibleId } : {})
  });
  async function add() {
    if (!option || !props.languageId) return;
    setBusy(true);
    try {
      await mine.add(entry(option));
      ctx.toast(t('sources.explore.added', { abbr: option.abbreviation }));
      ctx.back();
    } catch {
      ctx.toast(t('sources.explore.notAdded'));
    } finally { setBusy(false); }
  }
  // Removing says so; the footer then offers Add to My Bibles again (STUDY-032).
  async function remove() {
    if (!option) return;
    try {
      await mine.remove(option.itemId);
      ctx.toast(t('sources.explore.removed', { abbr: option.abbreviation }));
    } catch {
      ctx.toast(t('sources.explore.notRemoved'));
    }
  }

  const footer = option && props.languageId ? (
    has ? <PrimaryBtn label={t('sources.explore.inMyBibles')} icon="check" disabled onPress={() => undefined} />
      : <PrimaryBtn label={t('sources.explore.addToMyBibles')} icon="plus" busy={busy} help={t('sources.explore.addHelp')} onPress={() => void add()} />
  ) : undefined;

  return (
    <Screen fixed header={props.header} footer={footer}>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {!option ? (
          <EmptyState icon="book" title={problem || t('common.loading')} />
        ) : (
          <>
            <Card>
              <Text style={txt.title}>{option.name}</Text>
              <Text style={txt.xs}>{option.abbreviation} · {bible?.languageName ?? option.language}</Text>
              <View style={styles.badges}>
                <Badge label={offlineAllowed(option) ? t('sources.explore.keptOffline') : t('sources.explore.streamsOnly')} tone={offlineAllowed(option) ? 'green' : 'default'} />
                {bible ? <Badge label={mediaLine(bible)} /> : null}
                {offers && !offers.audio && current ? <Badge label={testamentOf(current) === 'OT' ? t('sources.explore.noAudioOT') : t('sources.explore.noAudioNT')} tone="amber" /> : null}
              </View>
              {has ? <LinkBtn label={t('sources.explore.remove')} color={C.muted} style={{ alignSelf: 'flex-start' }} help={t('sources.explore.removeHelp')} onPress={() => void remove()} /> : null}
            </Card>
            {books.length > 1 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
                {books.map((b) => (
                  <HelpRow key={b.book} of="sources.book">
                    <Chip label={b.name} on={b.book === current} help={t('sources.explore.bookHelp')} onPress={() => { setBook(b.book); setChapter(1); }} />
                  </HelpRow>
                ))}
              </ScrollView>
            ) : null}
            {chapters > 1 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
                {Array.from({ length: chapters }, (_, i) => i + 1).map((c) => (
                  <HelpRow key={c} of="sources.chapter">
                    <Chip label={formatNumber(c)} on={c === chapter} accessibilityLabel={t('sources.explore.chapter', { n: c })} help={t('sources.explore.chapterHelp', { n: c })} onPress={() => setChapter(c)} />
                  </HelpRow>
                ))}
              </ScrollView>
            ) : picked.kind === 'library' ? (
              <View style={styles.chapterStep}>
                <LinkBtn label={t('sources.explore.previousChapter')} help={t('sources.explore.previousChapterHelp')} onPress={() => setChapter((c) => Math.max(1, c - 1))} />
                <Text style={txt.sm}>{t('sources.explore.chapter', { n: chapter })}</Text>
                {/* Stops at the book's last chapter (STUDY-034). */}
                {lastChapter === null || chapter < lastChapter
                  ? <LinkBtn label={t('sources.explore.nextChapter')} help={t('sources.explore.nextChapterHelp')} onPress={() => setChapter((c) => (lastChapter === null ? c + 1 : Math.min(lastChapter, c + 1)))} />
                  : <View />}
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
