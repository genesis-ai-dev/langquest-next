// Avatar P. Progress across languages (status_home). The map itself (map_home, book_map) is in map.tsx.
import { ChevronRight, Globe } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import type { Ctx } from '../ctx';
import { Header, Note, Screen } from '../pui';
import { colors, space } from '../theme';
import { Card, text } from '../ui';
import { CountBars, flowName, laneCounts, WaitingBadge } from './org';

/**
 * J-VIEW-1 "Progress": several counts per language (ADR-004), no single
 * percent, no bottleneck, no assigning from here. Only the open project is
 * folded on this device, so other projects are not listed.
 */
export function StatusHome(ctx: Ctx) {
  const { state } = ctx.project;
  const lanes = state ? Object.entries(state.lanes) : [];
  const [query, setQuery] = useState('');
  const counts = useMemo(() => new Map(state ? Object.keys(state.lanes).map((l) => [l, laneCounts(state, l)] as const) : []), [state]);
  const all = [...counts.values()];
  const sum = (k: 'total' | 'recorded' | 'done' | 'waiting') => all.reduce((n, c) => n + c[k], 0);
  const q = query.trim().toLowerCase();
  const shown = q ? lanes.filter(([id, l]) => `${l.languoidId} ${id}`.toLowerCase().includes(q)) : lanes;
  const scope = ctx.session.adminScope?.level === 'lane' ? 'This language' : ctx.session.adminScope?.level === 'project' ? 'This project' : 'All languages';
  return (
    <Screen>
      <Header title="Progress" sub={`${ctx.org.state?.org?.value.name ?? 'Organization'} · ${scope}`} />
      <Card>
        <Text style={text.muted}>{`Across ${lanes.length} language${lanes.length === 1 ? '' : 's'} · ${sum('total')} passages`}</Text>
        <View style={{ flexDirection: 'row', gap: space.xl, flexWrap: 'wrap' }}>
          {([['recorded', 'recorded'], ['done', 'done'], ['waiting', 'with reviewers']] as const).map(([k, label]) => (
            <View key={k} accessible accessibilityLabel={`${sum(k)} ${label}`}>
              <Text style={text.h3}>{sum(k)}</Text>
              <Text style={text.small}>{label}</Text>
            </View>
          ))}
        </View>
      </Card>
      {lanes.length > 5 ? (
        <TextInput accessibilityLabel="Find a language" placeholder="Find a language" value={query} onChangeText={setQuery}
          style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12, backgroundColor: colors.card, color: colors.foreground }} />
      ) : null}
      <Text style={[text.small, { fontWeight: '700' }]}>{(state?.project?.value.name ?? 'Project').toUpperCase()}</Text>
      {lanes.length === 0 ? <Note>No languages yet.</Note> : null}
      {q && shown.length === 0 ? <Note>{`No language matches “${query}”.`}</Note> : null}
      {shown.map(([laneId, lane]) => {
        const c = counts.get(laneId);
        return (
          <Pressable key={laneId} onPress={() => ctx.go('map_home', { laneId })} accessibilityRole="button"
            accessibilityLabel={`${lane.languoidId}, ${flowName(state, laneId)}`} style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}>
            <Card>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
                <Globe size={20} color={colors.translate} />
                <View style={{ flex: 1 }}>
                  <Text style={text.h4}>{lane.languoidId}</Text>
                  <Text style={text.small} numberOfLines={1}>{flowName(state, laneId)}</Text>
                </View>
                <WaitingBadge n={c?.waiting ?? 0} />
                <ChevronRight size={20} color={colors.mutedForeground} />
              </View>
              {c ? <CountBars counts={c} /> : null}
            </Card>
          </Pressable>
        );
      })}
      <Note>Each bar counts passages that have cleared that step of the language's review flow. A passage is done when every step is complete — or, with no flow, once it's recorded.</Note>
    </Screen>
  );
}

import { contractsFor } from '../screenContracts';
export const contracts = contractsFor('status_home');
