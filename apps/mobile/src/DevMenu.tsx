// Persona sheet: switch persona (a real sign-in), seed the demo team, and in
// a dev build jump to any screen. Shown to dev builds and to the testers named
// in dev.ts, so the other roles' experience can be walked through in a real
// build without five phones.
import { commands } from '@langquest-next/core';
import * as Crypto from 'expo-crypto';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ensurePersonaAccount, PERSONAS, switchToPersona, type Persona } from './dev';
import { indexesFor } from './indexes';
import { SCREEN_IDS, TITLES, type ScreenId } from './flow';
import type { OrgHandle } from './useOrg';
import type { ProjectHandle } from './useProject';
import { colors, radius, space } from './theme';
import { text } from './ui';

export function DevMenu(props: {
  open: boolean;
  onClose: () => void;
  project: ProjectHandle;
  org: OrgHandle;
  currentEmail: string | null;
  isOwner: boolean;
  /** Screen jumping bypasses the flow machine, so it stays in dev builds. */
  isDev: boolean;
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

  /**
   * Owner-only: create every persona account, give it its org role (so it
   * sees the org, the project and its own home) and its project membership,
   * then assign the translator and reviewer some work to look at. The
   * language gets a name and the standard Bible flow, so the Map and the
   * passage record have steps to show.
   */
  async function seed() {
    const { state, append } = props.project;
    if (!state) return;
    const laneId = Object.keys(state.lanes)[0];
    // A handful of passages, in canon order: enough to show For you and the
    // Map without flooding a whole Bible with requests.
    const units = Object.entries(state.units).filter(([, u]) => u.parentUnitId !== null)
      .sort(([, a], [, b]) => (a.order < b.order ? -1 : 1)).slice(0, 5).map(([id]) => id);
    for (const p of PERSONAS) {
      if (!p.role) continue;
      const id = await ensurePersonaAccount(p);
      if (p.roleId && props.org.state && !Object.values(props.org.state.members[id] ?? {}).some((m) => m.removed.value === false)) {
        await props.org.append('v1.OrgMemberAdded', {
          profileId: id, roleId: p.roleId, scope: { level: 'org' }, displayName: p.email.split('@')[0]!
        });
      }
      if (state.members[id] && !state.members[id]!.removed.value) continue;
      await append('v1.MemberAdded', { profileId: id, role: p.role });
      if (laneId && p.role === 'translator') {
        const due = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
        const c = commands(state, indexesFor(state));
        for (const unitId of units) await props.project.run(c.ask({ commandId: `seed-ask:${Crypto.randomUUID()}`, unitId, laneId, what: 'record', profileId: id, dueDate: due }));
      }
    }
    if (laneId && !state.laneNames[laneId]) await append('v1.LaneNamed', { laneId, name: 'Dinka' });
    if (laneId && !state.laneFlows[laneId]) {
      await props.project.run(commands(state, indexesFor(state)).useFlow({ commandId: `seed-flow:${Crypto.randomUUID()}`, laneId, flowId: 'standard_bible' }));
    }
    await props.project.sync();
    await props.org.sync();
  }

  return (
    <Modal visible={props.open} animationType="slide" transparent onRequestClose={props.onClose}>
      <Pressable style={styles.backdrop} onPress={props.onClose} />
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <Text style={text.h4}>{props.isDev ? 'Developer' : 'Testing'}</Text>
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
          {props.isDev ? (
            <>
              <Text style={styles.label}>JUMP TO SCREEN (bypasses flow)</Text>
              <View style={styles.group}>
                {SCREEN_IDS.map((s) => (
                  <Pressable key={s} onPress={() => { props.jump(s); props.onClose(); }} style={styles.row}>
                    <Text style={text.body}>{TITLES[s]}</Text>
                    <Text style={text.small}>{s}</Text>
                  </Pressable>
                ))}
              </View>
            </>
          ) : null}
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
