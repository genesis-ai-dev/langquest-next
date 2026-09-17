// Avatar P. Organization source Bibles, with project-level opt-out.
import {
  SOURCE_BIBLES, catalogKey, privilegesFor, sourceBibleEnabled
} from '@langquest-next/core';
import { useRef, useState } from 'react';
import { Switch } from 'react-native';
import type { Ctx } from './ctx';
import { Note, Row, Section } from './pui';

export function SourceBibleSettings({ ctx }: { ctx: Ctx }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const org = ctx.org.state;
  if (!org) return null;
  const canManageOrg = privilegesFor(org, ctx.session.actorId, {})
    .has('manage_reference');
  const canManageProject = ctx.session.can('manage_reference');
  async function toggle(id: string, enabled: boolean, level: 'org' | 'project') {
    if (lock.current || !(level === 'org' ? canManageOrg : canManageProject)) return;
    lock.current = true; setBusy(true); setError('');
    try {
      await ctx.org.append('v1.CatalogItemToggled', {
        kind: 'reference', itemId: id, level, enabled,
        ...(level === 'project' ? { projectId: ctx.project.projectId } : {})
      });
    } catch (e) { setError((e as Error).message); }
    finally { lock.current = false; setBusy(false); }
  }
  return <>
    <Section label="Source Bibles for your organization">
      {SOURCE_BIBLES.map((bible) => {
        const added = sourceBibleEnabled(org, bible.id);
        return <Row key={bible.id} label={bible.name}
          sub={`English · ${bible.narrator} · chapter audio · CC0`}
          right={<Switch accessibilityLabel={`Add ${bible.name} to organization`}
            value={added} disabled={busy || !canManageOrg}
            onValueChange={(on) => void toggle(bible.id, on, 'org')} />} />;
      })}
    </Section>
    {SOURCE_BIBLES.some((b) => sourceBibleEnabled(org, b.id)) ?
      <Section label="Source Bibles in this project">
        {SOURCE_BIBLES.filter((b) => sourceBibleEnabled(org, b.id)).map((b) =>
          <Row key={b.id} label={b.name}
            right={<Switch accessibilityLabel={`Use ${b.name} in this project`}
              value={org.catalog[catalogKey('reference', b.id, 'project',
                ctx.project.projectId)]?.value ?? true}
              disabled={busy || !canManageProject}
              onValueChange={(on) => void toggle(b.id, on, 'project')} />} />)}
      </Section> : null}
    {error ? <Note>{error}</Note> : null}
  </>;
}
