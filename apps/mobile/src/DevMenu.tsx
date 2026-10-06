// Persona sheet: switch persona (a real sign-in), seed the demo team, and in
// a dev build jump to any screen. Personas exist only on a local Supabase
// (dev.ts `personasAvailable`); seeding is for dev builds on a local server,
// so it can never write personas into a real organization.
import { commands, selectFlowSpecs, type FlowDoc } from '@langquest-next/core';
import * as Crypto from 'expo-crypto';
import { useState } from 'react';
import { Text } from 'react-native';
import { ensurePersonaAccount, maySeedDemoTeam, PERSONAS, personasAvailable, switchToPersona, type Persona } from './dev';
import { indexesFor } from './indexes';
import { SCREEN_IDS, TITLES, type ScreenId } from './flow';
import { Group, Row, SectionLabel, Sheet, txt } from './kit';
import { loadDocs } from './library/docStore';
import { subscribeOps, type SharedItem } from './library/model';
import { reportError } from './report';
import { supabase } from './supabase';
import type { OrgHandle } from './useOrg';
import type { PartitionHandle } from './usePartition';

export function DevMenu(props: {
  open: boolean;
  onClose: () => void;
  partition: PartitionHandle;
  org: OrgHandle;
  currentEmail: string | null;
  isOwner: boolean;
  /** Screen jumping bypasses the flow machine, so it stays in dev builds. */
  isDev: boolean;
  jump: (s: ScreenId) => void;
}) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const personas = personasAvailable();
  const canSeed = props.isOwner && maySeedDemoTeam(props.isDev);

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setError('');
    try {
      await fn();
      props.onClose();
    } catch (e) {
      // A developer tool: the message is the Supabase or persona error, which
      // is what the person using this sheet needs to fix their setup.
      reportError(`dev menu ${label}`, e);
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy('');
    }
  }

  /**
   * Owner-only: create every persona account, give it its org role (so it
   * sees the org and its own home) and its membership of the org's work,
   * then assign the translator and reviewer some work to look at. The
   * language gets a name and the standard Bible flow, so the Map and the
   * passage record have steps to show.
   */
  /**
   * The language follows LangQuest's Standard Bible Flow (docs/library.md):
   * the flow comes from the library now, so the local server must have been
   * seeded (`npm run library:seed`).
   */
  async function useStandardFlow(laneId: string) {
    const orgId = props.partition.orgId;
    const { data, error: failed } = await supabase.rpc('library_shared_items', { p_kind: 'flow', p_query: 'Standard Bible Flow', p_limit: 5, p_offset: 0 });
    if (failed) throw new Error(failed.message);
    const shared = ((data ?? []) as SharedItem[]).find((r) => r.org_id === 'langquest');
    if (!shared) throw new Error('LangQuest\'s flows are not on this server yet: run npm run library:seed.');
    const { error: denied } = await supabase.rpc('library_adopt', { p_org: orgId, p_source_org: shared.org_id, p_source_item: shared.item_id, p_hash: shared.latest_hash });
    if (denied) throw new Error(denied.message);
    const { itemId, ops } = subscribeOps(shared, true);
    for (const op of ops) await props.org.append(op.type, op.payload as never);
    const doc = (await loadDocs(orgId, [shared.latest_hash])).get(shared.latest_hash) as FlowDoc | undefined;
    const state = props.partition.state;
    if (!doc || !state) throw new Error('The flow could not be read.');
    await props.partition.run(selectFlowSpecs(state, { commandId: `seed-flow:${Crypto.randomUUID()}`, laneId, itemId, docHash: shared.latest_hash, doc }));
  }

  async function seed() {
    const { state, append } = props.partition;
    if (!state || !maySeedDemoTeam(props.isDev)) return;
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
        for (const unitId of units) await props.partition.run(c.ask({ commandId: `seed-ask:${Crypto.randomUUID()}`, unitId, laneId, what: 'record', profileId: id, dueDate: due }));
      }
    }
    if (laneId && !state.laneNames[laneId]) await append('v1.LaneNamed', { laneId, name: 'Dinka' });
    if (laneId && !state.laneFlows[laneId]) await useStandardFlow(laneId);
    await props.partition.sync();
    await props.org.sync();
  }

  return (
    <Sheet visible={props.open} title={props.isDev ? 'Developer' : 'Testing'} onClose={props.onClose}>
      {error ? <Text style={txt.error}>{error}</Text> : null}
      <SectionLabel label="Personas (real sign-in)" />
      {personas.ok ? null : <Text style={txt.smMuted}>{personas.reason}</Text>}
      <Group>
        {PERSONAS.map((p: Persona, i) => (
          <Row key={p.id} label={p.label} sub={busy === p.id ? 'Signing in…' : p.role ?? 'No organization'}
            role="radio" selected={props.currentEmail === p.email} muted={!personas.ok}
            onPress={personas.ok && !busy ? () => void run(p.id, () => switchToPersona(p)) : undefined}
            right={props.currentEmail === p.email ? <Text style={txt.xsStrong}>Current</Text> : undefined}
            last={i === PERSONAS.length - 1} />
        ))}
      </Group>
      {canSeed ? (
        <Group>
          <Row icon="people" label="Seed demo team into this organization" sub={busy === 'seed' ? 'Seeding…' : 'Local server, owner only'}
            onPress={busy ? undefined : () => void run('seed', seed)} last />
        </Group>
      ) : null}
      {props.isDev ? (
        <>
          <SectionLabel label="Jump to screen (bypasses flow)" />
          <Group>
            {SCREEN_IDS.map((s, i) => (
              <Row key={s} label={TITLES[s]} sub={s} onPress={() => { props.jump(s); props.onClose(); }} last={i === SCREEN_IDS.length - 1} />
            ))}
          </Group>
        </>
      ) : null}
    </Sheet>
  );
}
