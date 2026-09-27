// The reference ReasonSheet (ref:shared.tsx:173-210): say why before a
// departure from the flow or before keeping a version after feedback.
// Voice first ("Say why instead"), then quick reasons, then typed text. The
// reference copy is the accessibility label; the sheet shows icons, the
// quick reasons and what was said. Amber in the reference is review teal
// here, and red stays for recording (docs/ux/README.md).
import type { LucideIcon } from 'lucide-react-native';
import { Check, X } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Modal, Text, TextInput, View } from 'react-native';
import { AudioClip } from './audioClip';
import type { Ctx } from './ctx';
import { Row } from './pui';
import { HoldToRecord } from './screens/recordings';
import { colors, radius, space, StyleSheet } from './theme';
import { ActionButton, text } from './ui';

export interface Reason {
  reason?: string;
  reasonBlobHash?: string;
}

export interface ReasonSheetProps {
  ctx: Ctx;
  visible: boolean;
  icon: LucideIcon;
  /** What the sheet is about, shown (a step, kind or reviewer's name). */
  name: string;
  /** Reference title and sub, read aloud as the sheet's label. */
  title: string;
  sub: string;
  quick: { icon: LucideIcon; reason: string }[];
  confirmIcon: LucideIcon;
  /** Reference confirm copy, e.g. "Set aside". */
  confirmLabel: string;
  onConfirm: (why: Reason) => Promise<void>;
  onClose: () => void;
}

export function ReasonSheet(props: ReasonSheetProps) {
  const [typed, setTyped] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const [voice, setVoice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  useEffect(() => {
    if (!props.visible) { setTyped(''); setPicked(null); setVoice(null); setError(''); }
  }, [props.visible]);
  const reason = (typed.trim() || picked || '').trim();
  const ready = !!reason || !!voice;
  const Icon = props.icon;

  async function confirm() {
    if (!ready || lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try {
      await props.onConfirm({ ...(reason ? { reason } : {}), ...(voice ? { reasonBlobHash: voice } : {}) });
    } catch (e) { setError((e as Error).message); }
    finally { lock.current = false; setBusy(false); }
  }

  return (
    <Modal visible={props.visible} transparent animationType="fade" onRequestClose={props.onClose}>
      <View style={styles.scrim}>
        <View style={styles.sheet} accessibilityViewIsModal>
          <View accessible style={styles.row} accessibilityLabel={`${props.title} ${props.sub}`}>
            <Icon size={24} color={colors.review} />
            <Text style={[text.h4, { flex: 1 }]} numberOfLines={2}>{props.name}</Text>
          </View>
          <HoldToRecord accessibilityLabel="Say why instead" disabled={busy} onCard={(c) => setVoice(c.ref.hash)} />
          {voice ? <AudioClip project={props.ctx.project} hashes={[voice]} label="Hear your reason" hideActions /> : null}
          <View>
            {props.quick.map((q, i) => (
              <Row key={q.reason} icon={q.icon} label={q.reason} last={i === props.quick.length - 1}
                right={picked === q.reason && !typed.trim() ? <Check size={18} color={colors.review} /> : undefined}
                onPress={() => { setPicked(q.reason); setTyped(''); }} />
            ))}
          </View>
          <TextInput style={styles.input} accessibilityLabel="Or type the reason" placeholder="Or type the reason"
            value={typed} onChangeText={setTyped} multiline />
          {error ? <Text style={text.muted} accessibilityRole="alert">{error}</Text> : null}
          <View style={styles.row}>
            <ActionButton icon={X} variant="outline" accessibilityLabel="Cancel" onPress={props.onClose} />
            <View style={{ flex: 1 }} />
            <ActionButton icon={props.confirmIcon} accessibilityLabel={props.confirmLabel} disabled={!ready || busy} onPress={() => void confirm()} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.background, padding: space.lg, gap: space.md, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: space.md, minHeight: 64, color: colors.foreground, textAlignVertical: 'top' }
});
