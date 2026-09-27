// The multi-note sheet (J-REC-2, J-STUDY-2, J-STUDY-3): the notes already
// left in this place, then a new one, speech first with the written
// fallback. Every note is a `v1.ContextItemAdded` with its home and anchors;
// nothing overwrites an earlier note. Reference copy is the accessibility
// label; the sheet shows icons, the place and what was said.
import { clockOf, type ContextAnchor, type ContextHome, type ContextNote } from '@langquest-next/core';
import * as Crypto from 'expo-crypto';
import { Check, MessageSquare } from 'lucide-react-native';
import { useRef, useState } from 'react';
import { Modal, Pressable, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AudioClip } from './audioClip';
import type { Ctx } from './ctx';
import { Header, Note, Screen } from './pui';
import { HoldToRecord } from './screens/recordings';
import { colors, radius, space, StyleSheet } from './theme';
import { ActionButton, Card, text } from './ui';
import { Byline } from './UserChip';

/** The first moment a note is anchored at, in ms. */
export function noteAtMs(n: ContextNote): number | undefined {
  for (const a of n.anchors) if ('atMs' in a && a.atMs !== undefined) return a.atMs;
  return undefined;
}

/** One saved note: a time chip when it has a moment (tap to seek), the voice, the text, who. */
export function NoteRow(props: { ctx: Ctx; note: ContextNote; onSeek?: (ms: number) => void }) {
  const { note } = props;
  const at = noteAtMs(note);
  return <View style={styles.row}>
    {at !== undefined ? <Pressable accessibilityRole="button" accessibilityLabel={`Play from ${clockOf(at)}`}
      disabled={!props.onSeek} onPress={() => props.onSeek?.(at)} style={styles.time}>
      <Text style={styles.timeText}>{clockOf(at)}</Text>
    </Pressable> : <MessageSquare size={16} color={colors.mutedForeground} />}
    <View style={{ flex: 1, gap: space.xs }}>
      {note.blobHash ? <AudioClip project={props.ctx.project} hashes={[note.blobHash]} label="Hear the note" hideActions /> : null}
      {note.text ? <Text style={text.body}>{note.text}</Text> : null}
      {note.by ? <Byline id={note.by} /> : null}
    </View>
  </View>;
}

export function NoteSheet(props: {
  ctx: Ctx; visible: boolean; onClose: () => void;
  /** Header title (the passage, step or verse). */
  title: string;
  /** Reference copy for where the note goes, read aloud. */
  place: string;
  home: ContextHome;
  anchors: ContextAnchor[];
  aboutTakeId?: string;
  /** Notes already in this place, shown above the new one. */
  notes: ContextNote[];
  /** Toast after saving, e.g. "Note added — it follows this passage". */
  saved: string;
}) {
  const { ctx } = props;
  const [note, setNote] = useState('');
  const [voice, setVoice] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const may = ctx.session.can('fill_reference');
  const ready = may && !busy && (!!note.trim() || !!voice);
  function close() { setNote(''); setVoice(undefined); setError(''); props.onClose(); }
  async function save() {
    if (!ready || lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try {
      await ctx.project.append('v1.ContextItemAdded', {
        itemId: Crypto.randomUUID(), kind: 'note', home: props.home, anchors: props.anchors,
        ...(note.trim() ? { text: note.trim() } : {}),
        ...(voice ? { blobHash: voice } : {}),
        ...(props.aboutTakeId ? { aboutTakeId: props.aboutTakeId } : {})
      });
      ctx.project.triggerUpload();
      ctx.toast(props.saved);
      close();
    } catch (e) { setError((e as Error).message); }
    finally { lock.current = false; setBusy(false); }
  }
  return <Modal visible={props.visible} animationType="slide" onRequestClose={() => { if (!busy) close(); }}>
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <Screen footer={<ActionButton icon={Check} accessibilityLabel="Save note" onPress={() => void save()} disabled={!ready} />}>
        <Header title={props.title} onBack={busy ? undefined : close} />
        {props.notes.length ? <Card>{props.notes.map((n) => <NoteRow key={n.itemId} ctx={ctx} note={n} />)}</Card> : null}
        <View accessible accessibilityLabel={`Add a note. ${props.place}`} style={styles.head}>
          <MessageSquare size={24} color={colors.foreground} />
          <Text style={[text.small, { flex: 1 }]}>{props.place}</Text>
        </View>
        {!may ? <Note>Only people who can fill in reference material can add notes.</Note> : null}
        <HoldToRecord accessibilityLabel="Say it" disabled={busy || !may} onCard={(card) => setVoice(card.ref.hash)} />
        {voice ? <AudioClip project={ctx.project} hashes={[voice]} label="Hear your note" hideActions /> : null}
        <TextInput style={styles.input} accessibilityLabel="Or type it" placeholder="Or type it" value={note}
          onChangeText={setNote} multiline editable={may && !busy} placeholderTextColor={colors.mutedForeground} />
        {error ? <Note>{error}</Note> : null}
      </Screen>
    </SafeAreaView>
  </Modal>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm, paddingVertical: space.xs },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  time: { minHeight: 32, minWidth: 48, paddingHorizontal: space.sm, borderRadius: radius.full, backgroundColor: colors.foreground,
    alignItems: 'center', justifyContent: 'center' },
  timeText: { color: colors.card, fontSize: 13, fontWeight: '700' },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12, minHeight: 100,
    backgroundColor: colors.card, color: colors.foreground }
});
