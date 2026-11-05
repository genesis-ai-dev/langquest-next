// Breaking up a book: the change being made and saving it (breakup/BreakUpBook.tsx).
import { languageName, privilegesFor, withBookBrokenUp, type LibraryItemView, type TemplateDoc } from '@langquest-next/core';
import { useState } from 'react';
import type { Ctx } from '../shell/ctx';
import { useLibrary } from '../library/useLibrary';
import { failureMessage } from '../diagnostics/report';
import { useTemplateUsers } from './useBreakup';
import { publishChange } from './breakupActions';
import { templateUsersFor, type TemplateUser } from './model';


/** The questions a book change asks, for BookChangeSheets (parts.tsx) to draw. */
export interface BookChangeSheet {
  warn: boolean;
  asking: boolean;
  busy: boolean;
  users: TemplateUser[] | null;
  bookName: string;
  here: string;
  /** The other languages the change reaches, by name. */
  others: string[];
  /** The book was divided before: its work moves to Earlier sections (decision 74). */
  redo: boolean;
  /** The other languages chosen to change too, by name, for the warning that follows the choice. */
  also: string[];
  /** This language's sections of the book that have recordings on this phone; unknown where no language is open. */
  recorded?: number;
  closeWarn(): void;
  confirmRedo(): void;
  closeAsk(): void;
  apply(chosen: Set<string>): void;
}
/**
 * Changing how one book is divided, whatever the new division is (a ready-made
 * way, or the language's own): the warning when the book was divided before,
 * which languages it changes when the template is shared (decision 74), then
 * the change. `sheets` is what BookChangeSheets (parts.tsx) asks.
 */
export function useBookChange(ctx: Ctx, c: { book: string; bookName: string; doc: TemplateDoc; item: LibraryItemView | null; redo: boolean; recorded?: number; onDone: () => void }) {
  const lib = useLibrary(ctx);
  const { users: rows } = useTemplateUsers(ctx);
  const sel = ctx.language.state?.template?.value;
  const [pending, setPending] = useState<{ way: TemplateDoc; note: string; said: string } | null>(null);
  const [warn, setWarn] = useState(false);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  // The languages chosen, kept while the warning that names them is open.
  const [chosen, setChosen] = useState<Set<string> | null>(null);
  const org = ctx.org.state;
  const users = sel ? templateUsersFor({
    users: rows, itemId: sel.itemId, nameOf: (id) => languageName(org, id),
    mayChange: (id) => !!org && privilegesFor(org, ctx.session.actorId, id).has('manage_templates')
  }) : null;
  const shared = !!users && users.filter((u) => u.languageId !== ctx.language.languageId).length > 0;

  async function apply(chosen: Set<string>, change = pending) {
    if (!change || !c.item || !sel) return;
    setBusy(true);
    try {
      const next = withBookBrokenUp(c.doc, c.book, change.way);
      const specs = await publishChange(ctx, lib, { item: c.item, doc: next, users, chosen, label: change.note });
      await ctx.act(specs, change.said);
      setBusy(false);
      setAsking(false);
      setWarn(false);
      setPending(null);
      setChosen(null);
      c.onDone();
    } catch (e) {
      setBusy(false);
      ctx.toast(failureMessage('break up a book', e), 'problem');
    }
  }
  const here = () => new Set([ctx.language.languageId ?? '']);
  return {
    busy,
    /**
     * Divide the book as `way` does; `note` is the new version's note, `said`
     * the toast. Which languages first, then one warning that names them all:
     * the other way round, the warning spoke of this language only and the
     * languages ticked after it went unmentioned (UI audit, finding 47).
     */
    start(way: TemplateDoc, note: string, said: string) {
      const change = { way, note, said };
      setPending(change);
      setChosen(null);
      if (shared) setAsking(true);
      else if (c.redo) setWarn(true);
      else void apply(here(), change);
    },
    sheets: {
      warn, asking, busy, users, bookName: c.bookName, here: ctx.language.languageId ?? '', redo: c.redo,
      others: users ? users.filter((u) => u.languageId !== ctx.language.languageId).map((u) => u.name) : [],
      also: chosen && users ? users.filter((u) => chosen.has(u.languageId) && u.languageId !== ctx.language.languageId).map((u) => u.name) : [],
      ...(c.recorded !== undefined ? { recorded: c.recorded } : {}),
      closeWarn: () => { setWarn(false); setChosen(null); },
      confirmRedo: () => void apply(chosen ?? here()),
      closeAsk: () => setAsking(false),
      apply: (picked: Set<string>) => {
        if (!c.redo) { void apply(picked); return; }
        setChosen(picked);
        setAsking(false);
        setWarn(true);
      }
    } satisfies BookChangeSheet
  };
}
