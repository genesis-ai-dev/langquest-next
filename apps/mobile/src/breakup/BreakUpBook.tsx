// One book of a language, broken up or waiting to be (decisions.md 74):
// what it is broken up by now and what the language calls it, and the same
// ways an admin chose from for the whole Bible, to break it up or change
// it. Changing a book that is already broken up warns first; a change to a
// template other languages use asks which of them it goes to.
import {
  sameParts, templateBooks, wayCovers, withBookBrokenUp,
  type EventSpec, type LibraryItemView, type TemplateDoc, type VersificationDoc
} from '@langquest-next/core';
import * as Crypto from 'expo-crypto';
import { useState } from 'react';
import { View } from 'react-native';
import { Text } from '../text';
import type { Ctx } from '../ctx';
import { useHelpPress } from '../helpContext';
import { t } from '../i18n';
import { Card, Field, GhostBtn, Header, PrimaryBtn, Row, Group, Screen, Sheet, txt } from '../kit';
import { useLibraryDocs } from '../library/useLibrary';
import { failureMessage } from '../report';
import { Question } from '../simple/admin';
import { C, space } from '../theme';
import { type WayRow } from './model';
import { ApplySheet, PieceBar, PreviewSheet, RedoSheet, WayCard } from './parts';
import { publishChange, templateUsersOf, useTemplateUsers, useWays } from './useBreakup';

/** The numbering a template is in (decision 80): its versification document's code. */
function useNumberingCode(ctx: Ctx, doc: TemplateDoc | null): string | null {
  const docs = useLibraryDocs(ctx.language.orgId, [doc?.bible?.versification]);
  return doc?.bible ? docs.get<VersificationDoc>(doc.bible.versification)?.code ?? null : null;
}

/** Which of the ways this book is broken up by now, if any matches it exactly. */
export function wayNow(rows: WayRow[], docOf: (r: WayRow) => TemplateDoc | null, doc: TemplateDoc | null, book: string): WayRow | null {
  if (!doc) return null;
  return rows.find((r) => !r.later && (() => { const d = docOf(r); return !!d && wayCovers(d, book) && sameParts(doc, d, book); })()) ?? null;
}

/** Above the book's chapters: how it is broken up, what the language calls it, and Change. */
export function BookHead(props: {
  ctx: Ctx; book: string; templateName: string; language: string; doc: TemplateDoc | null; v11n: VersificationDoc | null; canShape: boolean; onChange: () => void;
}) {
  const { ctx, book } = props;
  const code = useNumberingCode(ctx, props.doc);
  const ways = useWays(ctx, ctx.language.languageId, code);
  const now = wayNow(ways.rows, (r) => ways.docOf(r.choice), props.doc, book);
  const own = ctx.language.state?.bookNames?.[book]?.value;
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const change = useHelpPress(t('breakup.book.breakDifferently'), t('breakup.book.breakDifferentlyHelp'), props.onChange);
  async function saveName() {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      await ctx.act([{ id: Crypto.randomUUID(), type: 'v1.BookNameSet', payload: { book, name: trimmed } } as EventSpec], t('breakup.book.namedToast', { language: props.language, name: trimmed }));
      setNaming(false);
    } catch (e) {
      ctx.toast(failureMessage('book name', e));
    }
  }
  return (
    <Card>
      <View style={{ gap: space.sm }}>
        <Text style={txt.label}>{t('breakup.book.brokenUp')}</Text>
        <Text style={txt.h3}>{now ? now.choice.name : t('breakup.book.ownWay')}</Text>
        <PieceBar doc={props.doc} v11n={props.v11n} book={book} />
        {props.canShape ? <GhostBtn label={t('breakup.book.breakDifferently')} icon="cut" onPress={change} /> : null}
      </View>
      <Group style={{ marginTop: space.md }}>
        <Row icon="edit" label={t('breakup.book.calledIn', { name: own ?? props.templateName, language: props.language })}
          sub={own ? t('breakup.book.templateCalls', { name: props.templateName }) : t('breakup.book.tapToName')} last
          onPress={props.canShape ? () => { setName(own ?? props.templateName); setNaming(true); } : undefined} />
      </Group>
      <Sheet visible={naming} title={t('breakup.book.whatCalled', { language: props.language })} sub={t('breakup.book.namingSub')} onClose={() => setNaming(false)}
        footer={<PrimaryBtn label={t('common.save')} icon="check" disabled={!name.trim()} onPress={() => void saveName()} />}>
        <Field label={t('breakup.book.nameLabel')} value={name} onChangeText={setName} placeholder={props.templateName} autoCapitalize="words" />
      </Sheet>
    </Card>
  );
}

/**
 * How should this book be broken up? The same ways as for the whole Bible,
 * with this book drawn in each. Break up / Change applies to this language
 * and, when the template is shared, to the languages chosen.
 */
export function BreakUpBook(props: {
  ctx: Ctx; book: string; bookName: string; language: string; doc: TemplateDoc; item: LibraryItemView | null; redo: boolean; onClose: () => void;
}) {
  const { ctx, book } = props;
  const code = useNumberingCode(ctx, props.doc);
  const ways = useWays(ctx, ctx.language.languageId, code);
  const { users: rows } = useTemplateUsers(ctx);
  const sel = ctx.language.state?.template?.value;
  const now = wayNow(ways.rows, (r) => ways.docOf(r.choice), props.doc, book);
  const offered = ways.rows.filter((r) => !r.later && (() => { const d = ways.docOf(r.choice); return !!d && wayCovers(d, book); })());
  const [key, setKey] = useState<string | null>(null);
  const picked = offered.find((r) => r.choice.key === key) ?? null;
  const [peek, setPeek] = useState<WayRow | null>(null);
  const [warn, setWarn] = useState(false);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const users = sel ? templateUsersOf(ctx, rows, sel.itemId) : null;
  const shared = !!users && users.filter((u) => u.languageId !== ctx.language.languageId).length > 0;

  async function apply(chosen: Set<string>) {
    const wayDoc = ways.docOf(picked?.choice);
    if (!picked || !wayDoc || !props.item || !sel) return;
    setBusy(true);
    try {
      const next = withBookBrokenUp(props.doc, book, wayDoc);
      const byChapter = picked.choice.name === 'By chapter';
      // i18n-ignore: the new version's note, stored in the event log
      const note = `${props.bookName} is broken up ${byChapter ? 'by chapter' : `into ${picked.choice.name}`}`;
      const prev = sel;
      const undo = prev.docHash ? await ways.lib.applySpecs(prev.itemId, { docHash: prev.docHash, ...(prev.books ? { books: prev.books } : {}) }).catch(() => null) : null;
      const specs = await publishChange(ctx, ways.lib, { item: props.item, doc: next, users, chosen, label: note });
      const said = byChapter
        ? t('breakup.book.brokenUpByChapter', { book: props.bookName })
        : t('breakup.book.brokenUpInto', { book: props.bookName, way: picked.choice.name });
      await ctx.act(specs, said, undo ? () => undo : undefined);
      setBusy(false);
      setAsking(false);
      setWarn(false);
      props.onClose();
    } catch (e) {
      setBusy(false);
      ctx.toast(failureMessage('break up a book', e));
    }
  }
  const go = () => {
    if (props.redo) setWarn(true);
    else if (shared) setAsking(true);
    else void apply(new Set([ctx.language.languageId ?? '']));
  };
  const afterWarning = () => {
    setWarn(false);
    if (shared) setAsking(true);
    else void apply(new Set([ctx.language.languageId ?? '']));
  };

  return (
    <Screen header={<Header title={props.bookName} sub={props.language} onBack={props.onClose} />} bodyStyle={{ paddingHorizontal: 20, gap: 14 }}
      footer={<>
        <PrimaryBtn label={props.redo ? t('breakup.book.change', { book: props.bookName }) : t('breakup.book.breakUp', { book: props.bookName })} icon="check" busy={busy}
          disabled={!picked || (!!now && picked === now) || !props.item} onPress={go} />
        <GhostBtn label={t('common.notNow')} icon="clock" onPress={props.onClose} />
      </>}>
      <Question>{props.redo ? t('breakup.book.changeQuestion', { book: props.bookName }) : t('breakup.book.question', { book: props.bookName })}</Question>
      <Text style={[txt.sm, { color: C.muted }]}>{now ? t('breakup.book.nowEachPiece', { way: now.choice.name }) : t('breakup.book.eachPiece')}</Text>
      {offered.map((r) => (
        <WayCard key={r.choice.key} row={{ ...r, usedIn: r.usedIn, inUse: r === now }} doc={ways.docOf(r.choice)} v11n={ways.v11nOf(ways.docOf(r.choice))}
          on={picked === r} onPress={() => setKey(r.choice.key)} onPreview={() => setPeek(r)} oneBook={book} />
      ))}
      {offered.length === 0 ? <Text style={txt.smMuted}>{ways.loaded ? t('breakup.book.connectForWays') : t('common.loading')}</Text> : null}
      <PreviewSheet key={peek?.choice.key ?? 'none'} visible={!!peek} name={peek?.choice.name ?? ''} doc={ways.docOf(peek?.choice)} v11n={ways.v11nOf(ways.docOf(peek?.choice))}
        book={book} onClose={() => setPeek(null)} onUse={peek ? () => { setKey(peek.choice.key); setPeek(null); } : undefined} />
      <RedoSheet visible={warn} book={props.bookName} busy={busy} onClose={() => setWarn(false)} onConfirm={afterWarning} />
      {users && asking ? (
        <ApplySheet visible={asking} users={users} here={ctx.language.languageId ?? ''} busy={busy} onClose={() => setAsking(false)} onApply={(chosen) => void apply(chosen)}>
          <Text style={txt.body}>{alsoUsedLine(users.filter((u) => u.languageId !== ctx.language.languageId).map((u) => u.name), props.bookName)}</Text>
        </ApplySheet>
      ) : null}
    </Screen>
  );
}

/** "Used in Dinka too. Change Ruth for which of them?", for the languages that share the template. */
function alsoUsedLine(names: string[], book: string): string {
  if (names.length <= 1) return t('breakup.book.alsoUsedOne', { name: names[0] ?? '', book });
  if (names.length === 2) return t('breakup.book.alsoUsedTwo', { first: names[0], second: names[1], book });
  return t('breakup.book.alsoUsedMore', { name: names[0], count: names.length - 1, book });
}

/** The template's name for a book, else the fallback (the app's name for it). */
export function templateBookName(doc: TemplateDoc | null, book: string, fallback: string): string {
  return (doc ? templateBooks(doc).find((b) => b.book === book)?.name : undefined) ?? fallback;
}
