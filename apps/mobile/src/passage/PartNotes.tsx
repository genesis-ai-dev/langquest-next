// Notes on the parts, where they are recorded (decisions.md 149): a part a
// check left notes on has an amber mark with how many, and the mark opens
// them, each saying which check and where in the part, with Reply. The
// recording workspace provides this around itself; a part row shows the
// mark (PartNotesMark) only where it is provided and its part has notes.
import { partNotesFor, notePart, type PassageNote } from '@langquest-next/core';
import { useMemo, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../ui/text';
import type { Ctx } from '../shell/ctx';
import { useHelpSpot } from '../helpMode/useHelpMode';
import { HelpBadge } from '../helpMode/helpBadge';
import { t } from '../i18n';
import { formatNumber } from '../i18n/format';
import { Ico, Sheet } from '../ui/kit';
import { checkName } from '../admin/adminModel';
import { summaryLine } from '../reviewing/capture';
import { replyNoting } from '../reviewing/notesModel';
import { NotesUnder, NotingSheet, type Noting } from '../reviewing/notesOn';
import type { PassageView } from './passageView';
import { PartNotesContext, type PartNotesValue } from './partNotesContext';
import { usePartNotes } from './usePartNotes';
import { radius, space, target, TINT } from '../ui/theme';

export function PartNotesProvider(props: { ctx: Ctx; v: PassageView; children: ReactNode }) {
  const { ctx, v } = props;
  const [open, setOpen] = useState<{ hash: string; label: string } | null>(null);
  const [noting, setNoting] = useState<Noting | null>(null);
  const p = v.p;
  const value = useMemo<PartNotesValue>(() => ({ notes: (hash) => partNotesFor(p, hash), open: (hash, label) => setOpen({ hash, label }) }), [p]);
  // Which check said it, and where in the part.
  const label = (n: PassageNote) => summaryLine([n.kindId ? checkName(n.kindId, v.kinds) : null, notePart(n.anchor)?.at]) || undefined;
  return (
    <PartNotesContext.Provider value={value}>
      {props.children}
      {open ? (
        <Sheet visible title={t('passage.partNotes.title', { part: open.label })} onClose={() => setOpen(null)}>
          <NotesUnder ctx={ctx} p={p} notes={partNotesFor(p, open.hash)} label={label}
            onReply={(n) => setNoting(replyNoting(n, ctx.name(n.by), [v.title, open.label]))} />
        </Sheet>
      ) : null}
      <NotingSheet ctx={ctx} v={v} noting={noting} onClose={() => setNoting(null)} />
    </PartNotesContext.Provider>
  );
}

/** On a part's row: an amber bubble with how many notes the checks left on it, opening them. */
export function PartNotesMark(props: { hash: string; label: string }) {
  const pn = usePartNotes();
  const count = pn ? pn.notes(props.hash).length : 0;
  const label = t('passage.partNotes.mark', { count, part: props.label });
  const spot = useHelpSpot(label, t('passage.partNotes.markHelp'), () => pn?.open(props.hash, props.label));
  if (!pn || count === 0) return null;
  return (
    <Pressable onPress={spot.onPress} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => [styles.tap, pressed && { opacity: 0.6 }]}>
      <View style={styles.pill}>
        <Ico name="chat" size={14} color={TINT.amberText} />
        <Text style={styles.count}>{formatNumber(count)}</Text>
      </View>
      <HelpBadge spot={spot} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tap: { minWidth: target.min, height: target.min, alignSelf: 'center', alignItems: 'center', justifyContent: 'center' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: space.sm, paddingVertical: 4, borderRadius: radius.full, backgroundColor: TINT.amber },
  count: { fontSize: 13, fontWeight: '800', color: TINT.amberText }
});
