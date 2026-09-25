// Avatar U. Books → passage choices → one selected passage.
import {
  bibleBooks, bibleRangeFromUnit, bibleRangeLabel, bibleRankedTerms,
  bibleSettings, bibleText, bibleUnitId, derivePieces, isObtLane,
  nextBiblePassages, termsAtDensity, type BibleRange
} from '@langquest-next/core';
import { AlertTriangle, ArrowRight, BookOpen, Check, Circle, Mic } from 'lucide-react-native';
import { useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import type { Ctx } from '../ctx';
import { Header, Note, Row, Screen, Section } from '../pui';
import { ActionButton, Card, text } from '../ui';
import { PassageSourceAudio } from '../passageSourceAudio';
import { colors, space } from '../theme';
import { contractsFor } from '../screenContracts';

export function DynamicBible(ctx: Ctx) {
  const state = ctx.project.state;
  const laneId = ctx.params['laneId'] ?? Object.keys(state?.lanes ?? {})[0] ?? '';
  const [bookId, setBookId] = useState('');
  const [selected, setSelected] = useState<BibleRange | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const ranges = useMemo(() => Object.keys(state?.units ?? {})
    .map(bibleRangeFromUnit).filter((r): r is BibleRange & { laneId: string } =>
      !!r && r.laneId === laneId), [state, laneId]);
  const pieces = useMemo(() => state ? derivePieces(state, laneId) : [], [state, laneId]);
  if (!state || state.obt.workspace || !laneId) return null;
  const canSelect = ctx.session.can('translate') &&
    state.laneTemplates[laneId]?.value.templateId === 'dynamic';
  const book = bibleBooks.find(b => b.itemId === bookId);
  const options = nextBiblePassages(bookId, ranges);
  const existing = ranges.filter(r => r.book === bookId).sort((a, b) => a.start - b.start || a.end - b.end);
  const density = bibleSettings(state, laneId).density;
  const terms = selected ? termsAtDensity(bibleRankedTerms(selected), density) : [];
  async function openPassage() {
    if (!selected || !canSelect || lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try {
      const unitId = bibleUnitId(laneId, selected);
      await ctx.project.append('v1.BiblePassageSelected', { ...selected, laneId });
      ctx.go(isObtLane(state!, laneId) ? 'obt_passage' : 'translate_passage', {
        unitId, laneId, taskId: `translate:${unitId}:${laneId}`
      });
    } catch (e) { setError((e as Error).message); }
    finally { lock.current = false; setBusy(false); }
  }
  return <Screen footer={selected ? <ActionButton icon={ArrowRight}
    accessibilityLabel={`Translate ${bibleRangeLabel(selected)}`}
    disabled={!canSelect || busy} onPress={() => void openPassage()} /> : undefined}>
    <Header title={selected ? bibleRangeLabel(selected) : book?.label ?? 'Bible'}
      onBack={selected ? () => setSelected(null) : book ? () => setBookId('') : ctx.back} />
    {!book ? <Section label="">
      {bibleBooks.map(b => <Row key={b.itemId} bookId={b.itemId} label={b.label}
        onPress={() => setBookId(b.itemId)} />)}
    </Section> : selected ? <>
      <PassageSourceAudio ctx={ctx} unitId={bibleUnitId(laneId, selected)}
        laneId={laneId} disabled={busy} />
      <Card><Text style={text.small}>Berean Standard Bible</Text>
        <Text style={text.body}>{bibleText(selected).join('\n\n')}</Text></Card>
      <Card><Text style={text.small}>{terms.length} key terms</Text>
        <Text style={text.body}>{terms.map(t => t.term).join(' · ')}</Text></Card>
    </> : <View style={{ gap: space.lg }}>
      <Section label="">
        {options.map(option => <Row key={option.end} icon={Circle}
          label={bibleRangeLabel(option)} onPress={() => setSelected(option)} />)}
        {!options.length ? <Check size={28} color={colors.done}
          accessibilityLabel="All passages selected" /> : null}
      </Section>
      {existing.length ? <Section label="">
        {existing.map(range => {
          const unitId = bibleUnitId(laneId, range);
          const piece = pieces.find(p => p.unitId === unitId);
          const completed = piece?.status === 'done';
          const overlaps = existing.some(other => other !== range &&
            other.start <= range.end && other.end >= range.start);
          return <Row key={unitId} icon={overlaps ? AlertTriangle : completed ? Check : Mic}
            label={bibleRangeLabel(range)} onPress={() => setSelected(range)} />;
        })}
      </Section> : null}
    </View>}
    {error ? <Note>{error}</Note> : null}
  </Screen>;
}

export const contracts = contractsFor('dynamic_bible');
