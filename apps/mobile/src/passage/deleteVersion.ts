// Deleting a version (LAN-83): whoever published it, after the sheet that
// asks first (ConfirmDelete). It is a tombstone: its number is never used
// again, and a check of it, even one made offline after it was deleted,
// stays on the record to read and counts for nothing (core `deletedVersions`).
// Used by the Versions page and a version's own page.
import { commands, type Version } from '@langquest-next/core';
import * as Crypto from 'expo-crypto';
import type { Ctx } from '../shell/ctx';
import { t } from '../i18n';
import { indexesFor } from '../sync/indexes';
import { failureMessage } from '../diagnostics/report';
import { versionTitle, type PassageView } from './passageView';

/** Delete a version once the person has said yes. */
export function deleteVersion(ctx: Ctx, v: PassageView, ver: Version, after?: () => void) {
  const { state, unitId } = v;
  const me = ctx.session.actorId;
  const name = versionTitle(ver.n);
  let specs;
  try {
    specs = commands(state, indexesFor(state)).deleteVersion({ commandId: Crypto.randomUUID(), unitId, takeId: ver.takeId, actorId: me });
  } catch (e) {
    ctx.toast(t('passage.versions.notDeleted', { reason: failureMessage('versions: delete version', e) }), 'problem');
    return;
  }
  void ctx.act(specs, t('passage.versions.deleted', { name }))
    .then(() => after?.()).catch(() => { /* ctx.act said what went wrong */ });
}

