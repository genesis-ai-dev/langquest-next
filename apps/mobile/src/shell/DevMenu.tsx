// i18n-ignore-file: developer tools, shown only in development builds.
// Persona sheet: switch persona (a real sign-in), seed the demo team, and in
// a dev build jump to any screen. Personas exist only on a local Supabase
// (dev.ts `personasAvailable`); seeding is for dev builds on a local server,
// so it can never write personas into a real organization.
import { useState } from 'react';

import { Text } from '../ui/text';
import { maySeedDemoTeam, PERSONAS, personasAvailable, type Persona } from '../auth/dev';
import { seedDemoTeam, signInAs } from '../auth/demoTeam';
import { SCREEN_IDS, screenTitle, type ScreenId } from './flow';
import { Group, Row, SectionLabel, Sheet } from '../ui/kit';
import { txt } from '../ui/textStyles';
import { previewSyncRing } from '../sync/syncStanding';
import { reportError } from '../diagnostics/report';
import { runStorageBench } from '../sync/storageBench';
import type { OrgHandle } from '../sync/useOrg';
import type { LanguageHandle } from '../sync/useLanguage';

export function DevMenu(props: {
  open: boolean;
  onClose: () => void;
  language: LanguageHandle;
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
  const [bench, setBench] = useState('');

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

  return (
    <Sheet visible={props.open} title={props.isDev ? 'Developer' : 'Testing'} onClose={props.onClose}>
      {error ? <Text style={txt.error}>{error}</Text> : null}
      <SectionLabel label="Personas (real sign-in)" />
      {personas.ok ? null : <Text style={txt.smMuted}>{personas.reason}</Text>}
      <Group>
        {PERSONAS.map((p: Persona, i) => (
          <Row key={p.id} label={p.label} sub={busy === p.id ? 'Signing in…' : p.role ?? 'No organization'}
            role="radio" selected={props.currentEmail === p.email} muted={!personas.ok}
            onPress={personas.ok && !busy ? () => void run(p.id, () => signInAs(p)) : undefined}
            right={props.currentEmail === p.email ? <Text style={txt.xsStrong}>Current</Text> : undefined}
            last={i === PERSONAS.length - 1} />
        ))}
      </Group>
      {canSeed ? (
        <Group>
          <Row icon="people" label="Seed demo team into this organization" sub={busy === 'seed' ? 'Seeding…' : 'Local server, owner only'}
            onPress={busy ? undefined : () => void run('seed', () => seedDemoTeam({ org: props.org, language: props.language, isDev: props.isDev }))} last />
        </Group>
      ) : null}
      {props.isDev ? (
        <>
          <SectionLabel label="Measure" />
          <Group>
            <Row label="Storage benchmark" sub={bench || '200 appends and 4 pull pages, old driver and new (storageBench.ts)'}
              onPress={busy ? undefined : () => {
                setBusy('bench');
                setBench('Running…');
                void runStorageBench()
                  .then((rs) => setBench(rs.map((r) => `${r.driver}: append ${r.appendMsEach} ms, page ${r.pageMsEach} ms`).join('; ')))
                  .catch((e: unknown) => setBench(e instanceof Error ? e.message : 'failed'))
                  .finally(() => setBusy(''));
              }} />
            <Row label="Preview the sync ring" sub="A scripted queue on My Work, about 35 seconds" onPress={() => { previewSyncRing(); props.onClose(); }} last />
          </Group>
          <SectionLabel label="Jump to screen (bypasses flow)" />
          <Group>
            {SCREEN_IDS.map((s, i) => (
              <Row key={s} label={screenTitle(s)} sub={s} onPress={() => { props.jump(s); props.onClose(); }} last={i === SCREEN_IDS.length - 1} />
            ))}
          </Group>
        </>
      ) : null}
    </Sheet>
  );
}
