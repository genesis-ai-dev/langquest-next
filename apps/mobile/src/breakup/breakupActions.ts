// What the break-up screens do with templates: adopt a way, make one the language's own,
// publish a change, and who uses each (breakup/useBreakup.ts holds the hooks).
import { CommandError, languageName, orgLanguages, privilegesFor, selectTemplateSpecs, templateBooks, type EventSpec, type LibraryItemView, type TemplateDoc, type VersificationDoc } from '@langquest-next/core';
import * as Crypto from 'expo-crypto';
import type { LibraryChoice } from '../templates/contentTemplates';
import type { Ctx } from '../shell/ctx';
import { t } from '../i18n';
import { appendToLanguage } from '../sync/languageWriter';
import { flushOutbox, keepNewDoc, loadDocs, prepareDoc } from '../library/docStore';
import { newItemId } from '../library/model';
import type { useLibrary } from '../library/useLibrary';
import { noteExpected } from '../diagnostics/report';
import { copyName, copyOffOps, planChange, type TemplateUser } from './model';

/**
 * Use a choice in this organization: ours as it is; another organization's
 * followed with automatic updates (copied when it may not be followed).
 */
export async function adoptWay(lib: ReturnType<typeof useLibrary>, c: LibraryChoice): Promise<string> {
  if (c.source === 'ours') return c.item.itemId;
  return c.shared.subscribable ? lib.subscribe(c.shared, true) : lib.copy(c.shared);
}

/**
 * Publish a document as this organization's own template, reusing an item
 * of its own whose current version is already that document ("FIA
 * passages, other books by chapter" made for an earlier language).
 */
export async function ownTemplate(ctx: Ctx, lib: ReturnType<typeof useLibrary>, c: { doc: TemplateDoc; name: string; from: LibraryItemView | null; fromHash: string }): Promise<{ itemId: string; docHash: string }> {
  const { text, hash } = await prepareDoc(c.doc);
  const existing = lib.items('template').find((it) => !it.archived && it.source !== 'subscription' && it.current === hash);
  if (existing) return { itemId: existing.itemId, docHash: hash };
  await keepNewDoc(ctx.language.orgId, text, hash);
  const itemId = newItemId(c.name, Crypto.randomUUID());
  const orgName = ctx.org.state?.org?.value.name ?? '';
  const ops = c.from
    ? copyOffOps({ orgId: ctx.language.orgId, orgName, item: c.from, itemId, name: c.name, from: c.fromHash, next: hash })
    : [{ type: 'v1.LibraryItemDefined' as const, payload: { itemId, kind: 'template' as const, name: c.name, description: c.doc.description } },
      { type: 'v1.LibraryVersionPublished' as const, payload: { itemId, kind: 'template' as const, docHash: hash } }];
  for (const op of ops) await ctx.org.append(op.type, op.payload as never);
  void flushOutbox(ctx.language.orgId).catch((e: unknown) => noteExpected('library upload', e));
  return { itemId, docHash: hash };
}

/**
 * Publish a changed template for the languages chosen (decision 74): its
 * next version when every language using it changes, else a copy for the
 * chosen ones, which keep their part ids. The open language changes now
 * (with Undo); the others move to the copy, and the next phone that opens
 * each one brings it up to date (library/follow.ts).
 */
export async function publishChange(ctx: Ctx, lib: ReturnType<typeof useLibrary>, c: {
  item: LibraryItemView; doc: TemplateDoc; users: TemplateUser[] | null; chosen: Set<string>; label: string;
}): Promise<EventSpec[]> {
  const state = ctx.language.state;
  const sel = state?.template?.value;
  if (!state || !sel) throw new CommandError(t('breakup.errors.noTemplate'));
  const plan = planChange({ item: c.item, users: c.users, chosen: c.chosen });
  let itemId = c.item.itemId;
  let docHash: string;
  if (plan === 'version') {
    ({ docHash } = await lib.publish({ kind: 'template', itemId: c.item.itemId, name: c.item.name, description: c.item.description, doc: c.doc, note: c.label }));
  } else {
    const names = (c.users ?? []).filter((u) => c.chosen.has(u.languageId)).map((u) => u.name);
    const own = await ownTemplate(ctx, lib, {
      doc: c.doc, name: copyName(c.item.name, names.length ? names : [languageName(ctx.org.state, ctx.language.languageId ?? '')]),
      from: c.item, fromHash: sel.docHash
    });
    ({ itemId, docHash } = own);
    // The other chosen languages move to the copy at the version they had; they catch up on their own phones.
    for (const u of c.users ?? []) {
      if (u.languageId === ctx.language.languageId || !c.chosen.has(u.languageId) || !u.mayChange) continue;
      await appendToLanguage({
        orgId: ctx.language.orgId, languageId: u.languageId, actorId: ctx.session.actorId,
        specs: [{ id: Crypto.randomUUID(), type: 'v1.TemplateSelected', payload: { itemId, docHash: sel.docHash, unitPrefix: u.unitPrefix, ...(u.books ? { books: u.books } : {}) } } as EventSpec]
      }).catch((e: unknown) => noteExpected('template copy for another language', e));
    }
  }
  const docs = await loadDocs(ctx.language.orgId, [docHash]);
  const v11n = c.doc.bible ? ((docs.get(c.doc.bible.versification) as VersificationDoc | undefined) ?? null) : null;
  if (c.doc.bible && !v11n) throw new CommandError(t('breakup.errors.versificationMissing'));
  return selectTemplateSpecs(state, {
    commandId: Crypto.randomUUID(), itemId, docHash, doc: c.doc, versification: v11n, unitPrefix: sel.unitPrefix,
    ...(sel.books ? { books: sel.books } : {})
  });
}
