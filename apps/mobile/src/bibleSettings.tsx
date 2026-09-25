// Avatar P. One shared density setting for the language team.
import { bibleSettings } from '@langquest-next/core';
import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import type { Ctx } from './ctx';
import { Note, Section } from './pui';
import { ActionButton, text } from './ui';
import { colors, radius, space } from './theme';
import { BibleBrainPicker } from './bibleBrain';

export function BibleSettingsPanel({ ctx }: { ctx: Ctx }) {
  const state = ctx.project.state;
  const laneId = ctx.params['laneId'] ?? Object.keys(state?.lanes ?? {})[0] ?? '';
  const saved = state ? bibleSettings(state, laneId) : null;
  const [density, setDensity] = useState(saved?.density ?? 35);
  const [fileset, setFileset] = useState(saved?.audioFilesetId ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const width = useRef(1), locked = useRef(false);
  useEffect(() => {
    setDensity(saved?.density ?? 35); setFileset(saved?.audioFilesetId ?? '');
  }, [laneId, saved?.density, saved?.audioFilesetId]);
  if (!state || !laneId || state.obt.workspace) return null;
  const canManage = ctx.session.can('manage_reference');
  const setFromPosition = (x: number) => {
    if (canManage && !busy) setDensity(Math.max(0, Math.min(100, Math.round(x / width.current * 100))));
  };
  async function save() {
    if (!canManage || locked.current) return;
    locked.current = true; setBusy(true); setError('');
    try {
      await ctx.project.append('v1.BibleSettingsSet', {
        laneId, sourceId: 'bsb', density,
        ...(fileset.trim() ? { audioFilesetId: fileset.trim() } : {})
      });
    } catch (e) { setError((e as Error).message); }
    finally { locked.current = false; setBusy(false); }
  }
  return <Section label="Bible passage defaults">
    <View style={{ padding: space.lg, gap: space.md }}>
      <Text style={text.body}>Berean Standard Bible · text and key terms</Text>
      <Text style={text.small}>Key-term density · {density}%</Text>
      <Pressable accessibilityRole="adjustable" accessibilityLabel="Key-term density"
        accessibilityValue={{ min: 0, max: 100, now: density }}
        accessibilityState={{ disabled: !canManage || busy }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={e => {
          if (canManage && !busy) setDensity(v => Math.max(0, Math.min(100,
            v + (e.nativeEvent.actionName === 'increment' ? 5 : -5))));
        }}
        onLayout={e => { width.current = e.nativeEvent.layout.width; }}
        onStartShouldSetResponder={() => canManage && !busy}
        onMoveShouldSetResponder={() => canManage && !busy}
        onResponderGrant={e => setFromPosition(e.nativeEvent.locationX)}
        onResponderMove={e => setFromPosition(e.nativeEvent.locationX)}
        style={{ height: 48, justifyContent: 'center' }}>
        <View pointerEvents="none" style={{ height: 6, borderRadius: radius.md,
          backgroundColor: colors.border }}>
          <View style={{ height: 6, width: `${density}%`, backgroundColor: colors.translate }} />
          <View style={{ position: 'absolute', left: `${density}%`, top: -9,
            marginLeft: -12, width: 24, height: 24, borderRadius: 12,
            backgroundColor: colors.translate }} />
        </View>
      </Pressable>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={text.small}>Few key terms</Text><Text style={text.small}>All content words</Text>
      </View>
      <Text style={text.small}>Changing density updates passage shortlists. Recorded terms stay in the glossary.</Text>
      <Text style={text.small}>Additional Bible Brain audio fileset (optional)</Text>
      <TextInput accessibilityLabel="Bible Brain audio fileset" autoCapitalize="none"
        editable={canManage && !busy} value={fileset} onChangeText={setFileset}
        placeholder="Leave blank for BSB audio" style={{ padding: space.md,
          borderWidth: 1, borderColor: colors.border, borderRadius: radius.md }} />
      {canManage ? <BibleBrainPicker onSelect={setFileset} /> : null}
      <ActionButton label="Save Bible defaults" accessibilityLabel="Save Bible defaults" variant="outline"
        disabled={busy || !canManage} onPress={() => void save()} />
      {error ? <Note>{error}</Note> : null}
    </View>
  </Section>;
}
