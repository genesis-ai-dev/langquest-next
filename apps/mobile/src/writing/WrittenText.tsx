// Reading writing, and hearing a recording verse by verse (decisions.md 124;
// demo branch caleb-written-translations wCheck, wMadeRead, wConsult): each
// verse as a grey tile and its words, with a play button for the same verse
// of a recording when there is one, so whoever reads hears it too.
import type { LanguageState } from '@langquest-next/core';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '../ui/text';
import type { Ctx } from '../shell/ctx';
import { t } from '../i18n';
import { txt } from '../ui/textStyles';
import { PlayBtn } from '../recording/blocks';
import { useClip } from '../audio/useClip';
import { verseName } from '../recording/verseModel';
import { C, radius, space, TINT } from '../ui/theme';
import { heardByVerse, isPartKey, writtenByVerse } from './model';

/** A verse of a recording: its grey tile, a play button, and a line for how long. */
export function VersePlayRow({ ctx, hashes, label, lit }: { ctx: Ctx; hashes: string[]; label: string; lit?: boolean }) {
  const clip = useClip(ctx.language, hashes);
  return (
    <View style={[styles.row, lit && styles.rowLit]}>
      <Tile label={label} />
      <PlayBtn playing={clip.playing} available={clip.available} size={40} label={t('writing.playVerse', { verse: label })} onPress={clip.toggle} />
      <View style={styles.wave} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {Array.from({ length: 18 }, (_, i) => (
          <View key={i} style={[styles.bar, { height: 6 + ((i * 7 + label.length * 5) % 16), backgroundColor: clip.playing && i < 8 ? C.primary : C.faint }]} />
        ))}
      </View>
      <Text style={txt.xs}>{t('writing.parts', { count: hashes.length })}</Text>
    </View>
  );
}

/**
 * Written parts verse by verse, read. With `heard`, each verse also plays
 * from that recording (the version something was written down from).
 */
export function WrittenReader({ ctx, state, unitId, parts, verseKeys, heard, highlight }: {
  ctx: Ctx; state: LanguageState; unitId: string; parts: string[]; verseKeys: string[];
  /** A recording's parts, to play each verse from. */
  heard?: string[];
  /** Words to mark, as someone noted them. */
  highlight?: (verseKey: string) => boolean;
}) {
  const words = useMemo(() => writtenByVerse(state, unitId, parts, verseKeys), [state, unitId, parts, verseKeys]);
  const byVerse = useMemo(() => (heard ? new Map(heardByVerse(state, unitId, heard, verseKeys).map((h) => [h.key, h.hashes])) : null), [heard, state, unitId, verseKeys]);
  return (
    <View style={styles.card}>
      {words.map((w, i) => {
        const label = isPartKey(w.key) ? String(i + 1) : verseName(verseKeys, verseKeys.indexOf(w.key));
        const hashes = byVerse?.get(w.key);
        return (
          <View key={w.key} style={[styles.readRow, highlight?.(w.key) && styles.rowLit]}>
            <Tile label={label} />
            <Text style={[txt.body, { flex: 1 }]}>{w.text}</Text>
            {hashes ? <VersePlay ctx={ctx} hashes={hashes} label={label} /> : null}
          </View>
        );
      })}
      {words.length === 0 ? <Text style={txt.smMuted}>{t('writing.notHereYet')}</Text> : null}
    </View>
  );
}

function VersePlay({ ctx, hashes, label }: { ctx: Ctx; hashes: string[]; label: string }) {
  const clip = useClip(ctx.language, hashes);
  return <PlayBtn playing={clip.playing} available={clip.available} size={36} label={t('writing.playVerse', { verse: label })} onPress={clip.toggle} />;
}

function Tile({ label }: { label: string }) {
  return (
    <View style={styles.tile} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Text style={styles.tileText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 52, paddingHorizontal: space.sm, borderRadius: radius.md, borderWidth: 1, borderColor: C.border, backgroundColor: C.card },
  rowLit: { backgroundColor: C.light, borderColor: C.primary },
  wave: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 2, height: 24 },
  bar: { width: 3, borderRadius: 2 },
  card: { backgroundColor: C.card, borderRadius: radius.lg, borderWidth: 1, borderColor: C.border, padding: space.md, gap: space.md },
  readRow: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start', borderRadius: radius.md, padding: 2 },
  tile: { minWidth: 34, height: 34, paddingHorizontal: 6, borderRadius: radius.sm + 1, backgroundColor: TINT.gray, alignItems: 'center', justifyContent: 'center' },
  tileText: { fontSize: 15, fontWeight: '800', color: C.dark }
});
