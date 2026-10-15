// Deleting a version (LAN-83): only the person's latest, while nobody has
// checked it or been asked to (core `canDeleteVersion`). Used by the
// Versions page and a version's own page.
import { commands, type Version } from '@langquest-next/core';
import * as Crypto from 'expo-crypto';
import type { Ctx } from '../shell/ctx';
import { t } from '../i18n';
import { indexesFor } from '../sync/indexes';
import { failureMessage } from '../diagnostics/report';
import { versionTitle, type PassageView } from './passageView';

/**
 * Delete the person's latest version while nobody has checked it (LAN-83).
 * Undo publishes the same parts again, with what it said changed, so it is
 * that version again.
 */
export function deleteVersion(ctx: Ctx, v: PassageView, ver: Version, after?: () => void) {
  const { state, unitId } = v;
  const me = ctx.session.actorId;
  const name = versionTitle(ver.n);
  let specs;
  try {
    specs = commands(state, indexesFor(state)).deleteVersion({ commandId: Crypto.randomUUID(), unitId, takeId: ver.takeId, actorId: me });
  } catch (e) {
    ctx.toast(t('passage.versions.notDeleted', { reason: failureMessage('versions: delete version', e) }));
    return;
  }
  void ctx.act(specs, t('passage.versions.deleted', { name }), () => {
    const s = ctx.language.state ?? state;
    return commands(s, indexesFor(s)).publishVersion({ commandId: Crypto.randomUUID(), unitId, cardHashes: ver.cardHashes, actorId: me, parentTakeId: ver.parentTakeId,
      ...(ver.changeNote ? { note: ver.changeNote } : ver.n > 1 ? { note: '—' } : {}), ...(ver.changeBlobHash ? { noteBlobHash: ver.changeBlobHash } : {}) });
  }).then(() => after?.()).catch(() => { /* ctx.act said what went wrong */ });
}

