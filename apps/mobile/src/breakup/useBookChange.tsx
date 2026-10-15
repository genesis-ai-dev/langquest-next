// Breaking up a book: the change being made and saving it (breakup/BreakUpBook.tsx).
import { withBookBrokenUp, type LibraryItemView, type TemplateDoc } from '@langquest-next/core';
import { useState } from 'react';
import { Text } from '../ui/text';
import type { Ctx } from '../shell/ctx';
import { txt } from '../ui/kit';
import { useLibrary } from '../library/useLibrary';
import { failureMessage } from '../diagnostics/report';
import { ApplySheet, RedoSheet } from './parts';
import { publishChange, templateUsersOf, useTemplateUsers } from './useBreakup';
import { alsoUsedLine } from './templateNames';

/**
 * Changing how one book is divided, whatever the new division is (a ready-made
 * way, or the language's own): the warning when the book was divided before,
 * which languages it changes when the template is shared (decision 74), then
 * the change with Undo. `sheets` renders the warning and the question.
 */
export function useBookChange(ctx: Ctx, c: { book: string; bookName: string; doc: TemplateDoc; item: LibraryItemView | null; redo: boolean; onDone: () => void }) {
  const lib = useLibrary(ctx);
  const { users: rows } = useTemplateUsers(ctx);
  const sel = ctx.language.state?.template?.value;
  const [pending, setPending] = useState<{ way: TemplateDoc; note: string; said: string } | null>(null);
  const [warn, setWarn] = useState(false);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const users = sel ? templateUsersOf(ctx, rows, sel.itemId) : null;
  const shared = !!users && users.filter((u) => u.languageId !== ctx.language.languageId).length > 0;

  async function apply(chosen: Set<string>, change = pending) {
    if (!change || !c.item || !sel) return;
    setBusy(true);
    try {
      const next = withBookBrokenUp(c.doc, c.book, change.way);
      const prev = sel;
      const undo = prev.docHash ? await lib.applySpecs(prev.itemId, { docHash: prev.docHash, ...(prev.books ? { books: prev.books } : {}) }).catch(() => null) : null;
      const specs = await publishChange(ctx, lib, { item: c.item, doc: next, users, chosen, label: change.note });
      await ctx.act(specs, change.said, undo ? () => undo : undefined);
      setBusy(false);
      setAsking(false);
      setWarn(false);
      setPending(null);
      c.onDone();
    } catch (e) {
      setBusy(false);
      ctx.toast(failureMessage('break up a book', e));
    }
  }
  const here = () => new Set([ctx.language.languageId ?? '']);
  return {
    busy,
    /** Divide the book as `way` does; `note` is the new version's note, `said` the toast. */
    start(way: TemplateDoc, note: string, said: string) {
      const change = { way, note, said };
      setPending(change);
      if (c.redo) setWarn(true);
      else if (shared) setAsking(true);
      else void apply(here(), change);
    },
    sheets: (
      <>
        <RedoSheet visible={warn} book={c.bookName} busy={busy} onClose={() => setWarn(false)}
          onConfirm={() => { setWarn(false); if (shared) setAsking(true); else void apply(here()); }} />
        {users && asking ? (
          <ApplySheet visible={asking} users={users} here={ctx.language.languageId ?? ''} busy={busy} onClose={() => setAsking(false)} onApply={(chosen) => void apply(chosen)}>
            <Text style={txt.body}>{alsoUsedLine(users.filter((u) => u.languageId !== ctx.language.languageId).map((u) => u.name), c.bookName)}</Text>
          </ApplySheet>
        ) : null}
      </>
    )
  };
}
