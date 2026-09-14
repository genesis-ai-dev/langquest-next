// Dev-only sheet: switch persona (a real sign-in), seed the demo team, jump to any screen.
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ensurePersonaAccount, PERSONAS, switchToPersona, type Persona } from './dev';
import { SCREEN_IDS, TITLES, type ScreenId } from './flow';
import type { ProjectHandle } from './useProject';
import { colors, radius, space } from './theme';
import { text } from './ui';

export function DevMenu(props: {
  open: boolean;
  onClose: () => void;
  project: ProjectHandle;
  currentEmail: string | null;
  isOwner: boolean;
  jump: (s: ScreenId) => void;
}) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setError('');
    try {
      await fn();
      props.onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }

  /** Owner-only: create every persona account and add it to the open project. */
  async function seed() {
    const { state, append } = props.project;
    if (!state) return;
    const laneId = Object.keys(state.lanes)[0];
    const units = Object.entries(state.units).filter(([, u]) => u.parentUnitId !== null).map(([id]) => id);
    for (const p of PERSONAS) {
      if (!p.role) continue;
      const id = await ensurePersonaAccount(p);
      if (state.members[id] && !state.members[id]!.removed.value) continue;
      await append('v1.MemberAdded', { profileId: id, role: p.role });
      if (laneId && p.role === 'translator') for (const unitId of units) await append('v1.AssignmentMade', { unitId, laneId, profileId: id, role: 'translator', dueDate: 'Sep 30' });
      if (laneId && p.role === 'reviewer') for (const unitId of units) await append('v1.AssignmentMade', { unitId, laneId, profileId: id, role: 'reviewer' });
    }
    await props.project.sync();
  }

  return (
    <Modal visible={props.open} animationType="slide" transparent onRequestClose={props.onClose}>
      <Pressable style={styles.backdrop} onPress={props.onClose} />
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <Text style={text.h4}>Developer</Text>
        {error ? <Text style={{ color: colors.reference }}>{error}</Text> : null}
        <ScrollView contentContainerStyle={{ gap: space.md }} showsVerticalScrollIndicator={false}>
          <Text style={styles.label}>PERSONAS (real sign-in)</Text>
          <View style={styles.group}>
            {PERSONAS.map((p: Persona) => (
              <Pressable key={p.id} onPress={() => void run(p.id, () => switchToPersona(p))} disabled={!!busy} style={[styles.row, props.currentEmail === p.email && styles.rowActive]}>
                <Text style={text.body}>{p.label}</Text>
                <Text style={text.small}>{busy === p.id ? '…' : p.role ?? 'none'}</Text>
              </Pressable>
            ))}
          </View>
          {props.isOwner ? (
            <Pressable onPress={() => void run('seed', seed)} disabled={!!busy} style={[styles.row, styles.group]}>
              <Text style={text.body}>Seed demo team into this project</Text>
              <Text style={text.small}>{busy === 'seed' ? '…' : 'owner'}</Text>
            </Pressable>
          ) : null}
          <Text style={styles.label}>JUMP TO SCREEN (bypasses flow)</Text>
          <View style={styles.group}>
            {SCREEN_IDS.map((s) => (
              <Pressable key={s} onPress={() => { props.jump(s); props.onClose(); }} style={styles.row}>
                <Text style={text.body}>{TITLES[s]}</Text>
                <Text style={text.small}>{s}</Text>
              </Pressable>
            ))}
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: { maxHeight: '80%', backgroundColor: colors.background, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: space.lg, gap: space.md },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border },
  label: { fontSize: 11, fontWeight: '700', letterSpacing: 1, color: colors.mutedForeground },
  group: { backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, overflow: 'hidden' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: space.lg, paddingVertical: space.md, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  rowActive: { backgroundColor: 'rgba(253, 195, 23, 0.25)' }
});
