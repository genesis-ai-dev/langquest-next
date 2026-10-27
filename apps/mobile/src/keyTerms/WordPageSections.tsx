// A key word's own page, its two lists (decision 172; the agreed mocks
// "key-word-page" 1-3): every passage the word is in, with where the team
// stands, filtered by chips; and every note and review about the word.
import { type ReactNode, useState } from 'react';
import { View } from 'react-native';
import { Text } from '../ui/text';
import type { Ctx } from '../shell/ctx';
import { t } from '../i18n';
import { HelpRow } from '../helpMode/helpBadge';
import { Badge, Chip, ChipWrap, Group, Row, SectionLabel, ShowMore } from '../ui/kit';
import { txt } from '../ui/textStyles';
import { C, space } from '../ui/theme';
import { AudioClip } from '../audio/audioClip';
import { checkName } from '../admin/adminModel';
import { deriveKinds } from '../i18n/coreText';
import { bookOf, verseRefs } from '../recording/model';
import { when } from '../passage/passageView';
import { wordPassageCounts, type WordNote, type WordPassage, type WordPassageStatus } from './wordPageModel';

/** Passages show a few at first, then the rest on asking (ADR-009). */
const FIRST = 4;
const STEP = 25;

type Filter = 'all' | WordPassageStatus;

/**
 * Every passage the word is in (mock 1, and 3 for a word the team has not
 * taken): where its Bible says it, or that the list links it there, and
 * where the team stands. A passage with a version opens that version; one
 * with nothing recorded opens the passage.
 */
export function WordPassagesSection(props: {
  ctx: Ctx; passages: readonly WordPassage[]; own: boolean; loading: boolean;
  /** "FIA": the list that links it, for "Linked by FIA". */
  listName: string | null;
  onOpen: (p: WordPassage) => void;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const [n, setN] = useState(FIRST);
  const counts = wordPassageCounts(props.passages);
  const shown = props.passages.filter((p) => filter === 'all' || p.status === filter);
  const chips: { id: Filter; label: string }[] = props.own
    ? [
      { id: 'all', label: t('keyTerms.page.all', { n: counts.all }) },
      { id: 'used', label: t('keyTerms.page.used', { n: counts.used }) },
      { id: 'notMarked', label: t('keyTerms.page.notMarked', { n: counts.notMarked }) },
      { id: 'notRecorded', label: t('keyTerms.page.notRecorded', { n: counts.notRecorded }) }
    ]
    : [
      { id: 'all', label: t('keyTerms.page.all', { n: counts.all }) },
      { id: 'recorded', label: t('keyTerms.page.recorded', { n: counts.recorded }) },
      { id: 'notRecorded', label: t('keyTerms.page.notRecorded', { n: counts.notRecorded }) }
    ];
  // A chip with nothing behind it is left out (All stays).
  const filters = chips.filter((f) => f.id === 'all' || counts[f.id] > 0);
  const linked = props.passages.filter((p) => p.linked).length;
  return (
    <View style={{ gap: space.sm }}>
      <SectionLabel label={t('keyTerms.page.passages', { count: counts.all })}
        {...(props.listName && linked ? { action: <Text style={[txt.xsStrong, { color: C.primary }]}>{t('keyTerms.page.linkedBy', { name: props.listName, count: linked })}</Text> } : {})} />
      {counts.all === 0 ? (
        <Text style={[txt.smMuted, { paddingHorizontal: space.xs }]}>{props.loading ? t('common.loading') : t('keyTerms.page.noPassages')}</Text>
      ) : (
        <>
          <ChipWrap>
            {/* help-each: each chip keeps the passages where the team stands one way */}
            {filters.map((f) => (
              <Chip key={f.id} label={f.label} on={filter === f.id} help={t('keyTerms.page.filterHelp')} onPress={() => { setFilter(f.id); setN(FIRST); }} />
            ))}
          </ChipWrap>
          <Group>
            {shown.slice(0, n).map((p, i, a) => (
              <HelpRow key={p.unitId} of="keyTerms.wordPassage">
                <Row label={p.label} sub={whereLine(p, props.listName)} onPress={() => props.onOpen(p)} last={i === a.length - 1}
                  help={p.takeId ? t('keyTerms.page.openVersionHelp') : t('keyTerms.page.openPassageHelp')}
                  below={<View style={{ flexDirection: 'row' }}><StatusBadge p={p} /></View>} />
              </HelpRow>
            ))}
          </Group>
          <ShowMore remaining={shown.length - n} step={STEP} onMore={() => setN(n + STEP)} />
        </>
      )}
    </View>
  );
}

/** "Luke 13:33–34 · “prophet”, “prophets”", or "Linked by FIA" when its Bible does not say it here. */
function whereLine(p: WordPassage, listName: string | null): string {
  if (p.verses.length) {
    const refs = `${bookOf(p.label)} ${verseRefs(p.verses)}`;
    return p.said.length ? `${refs} · ${p.said.map((s) => `“${s}”`).join(', ')}` : refs;
  }
  return p.linked && listName ? t('keyTerms.page.linkedByOne', { name: listName }) : t('keyTerms.page.markedHere');
}

function StatusBadge(props: { p: WordPassage }) {
  const { p } = props;
  switch (p.status) {
    case 'used': return <Badge label={t('keyTerms.page.versionUsed', { n: p.version ?? 1 })} tone="green" />;
    case 'notMarked': return <Badge label={t('keyTerms.page.versionNotMarked', { n: p.version ?? 1 })} tone="amber" />;
    case 'recorded': return <Badge label={t('keyTerms.page.recordedVersion', { n: p.version ?? 1 })} tone="brand" />;
    case 'notRecorded': return <Badge label={t('keyTerms.page.notRecordedYet')} />;
  }
}

/**
 * Every note and review about the word (mock 2), newest first: who left it,
 * at which check, in which passage and on which version; what it says or a
 * recording of it; and how many replied. A tap opens it where it was left.
 */
export function WordNotesSection(props: { ctx: Ctx; notes: readonly WordNote[]; onOpen: (n: WordNote) => void }) {
  const [n, setN] = useState(3);
  if (!props.notes.length) return null;
  const state = props.ctx.language.state;
  const kinds = state ? deriveKinds(state) : [];
  return (
    <View style={{ gap: space.sm }}>
      <SectionLabel label={t('keyTerms.page.notes', { count: props.notes.length })} />
      <Group>
        {props.notes.slice(0, n).map((w, i, a) => (
          <HelpRow key={w.note.id} of="keyTerms.wordNote">
            <Row label={noteLine(props.ctx, w, kinds)} onPress={() => props.onOpen(w)} last={i === a.length - 1} help={t('keyTerms.page.openNoteHelp')}
              below={<NoteBody ctx={props.ctx} w={w} />} />
          </HelpRow>
        ))}
      </Group>
      <ShowMore remaining={props.notes.length - n} step={STEP} onMore={() => setN(n + STEP)} />
    </View>
  );
}

/** "Rose · Peer check · Luke 4:16–30 · Version 1", or "Peter · note on the word · Luke 13:31–35". */
function noteLine(ctx: Ctx, w: WordNote, kinds: Parameters<typeof checkName>[1]): string {
  const who = ctx.name(w.note.by);
  const at = w.kindId && w.kindId !== 'record' ? checkName(w.kindId, kinds) : t('keyTerms.page.noteOnWord');
  return [who, at, w.label, w.version !== null ? t('keyTerms.page.version', { n: w.version }) : null].filter(Boolean).join(' · ');
}

function NoteBody(props: { ctx: Ctx; w: WordNote }): ReactNode {
  const { note } = props.w;
  const foot = [props.w.review ? t('keyTerms.page.withReview') : when(note.hlc), props.w.replies ? t('keyTerms.page.replies', { count: props.w.replies }) : null].filter(Boolean).join(' · ');
  return (
    <View style={{ gap: space.xs }}>
      {note.text ? <Text style={txt.body}>{note.text}</Text> : null}
      {note.blobHash ? <AudioClip language={props.ctx.language} hashes={[note.blobHash]} label={t('keyTerms.page.playNote')} /> : null}
      <Text style={txt.xs}>{foot}</Text>
    </View>
  );
}
