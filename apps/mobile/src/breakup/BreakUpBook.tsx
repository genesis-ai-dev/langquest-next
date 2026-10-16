// One book of a language, broken up or waiting to be (decisions.md 74):
// what it is broken up by now and what the language calls it, and the same
// ways an admin chose from for the whole Bible, to break it up or change
// it. Changing a book that is already broken up warns first; a change to a
// template other languages use asks which of them it goes to. Naming the
// book offers what the team's Bibles and the organization's other
// languages call it (demo ADR-042, `?simple=helpsBookName`).
import { wayCovers, type EventSpec, type LibraryItemView, type TemplateDoc, type VersificationDoc } from '@langquest-next/core';
import * as Crypto from 'expo-crypto';
import { useRef, useState, type ReactNode } from 'react';
import { View } from 'react-native';
import { Text } from '../ui/text';
import type { Ctx } from '../shell/ctx';
import { t } from '../i18n';
import { Card, Field, GhostBtn, Header, Ico, PrimaryBtn, Row, Group, Screen, SectionLabel, Sheet } from '../ui/kit';
import { txt } from '../ui/textStyles';
import { useLibraryDocs } from '../library/useLibrary';
import { failureMessage } from '../diagnostics/report';
import { ChoiceCard, Question } from '../admin/admin';
import { C, space } from '../ui/theme';
import { isItself, wayNow, type WayRow } from './model';
import { BookChangeSheets, PieceBar, PreviewSheet, WayCard } from './parts';
import { useBookNameChoices, useWays } from './useBreakup';
import { alsoUsedLine } from './templateNames';
import { SavedMark } from '../ui/SavedMark';
import { useSaver } from '../ui/useSaveStatus';
import { useBookChange } from './useBookChange';

/** The numbering a template is in (decision 80): its versification document's code. */
function useNumberingCode(ctx: Ctx, doc: TemplateDoc | null): string | null {
  const docs = useLibraryDocs(ctx.language.orgId, [doc?.bible?.versification]);
  return doc?.bible ? docs.get<VersificationDoc>(doc.bible.versification)?.code ?? null : null;
}

/** Above the book's chapters: how it is broken up, what the language calls it, and Change. */
export function BookHead(props: {
  ctx: Ctx; book: string; templateName: string; language: string; doc: TemplateDoc | null; v11n: VersificationDoc | null; canShape: boolean; onChange: () => void;
}) {
  const { ctx, book } = props;
  const code = useNumberingCode(ctx, props.doc);
  const ways = useWays(ctx, ctx.language.languageId, code);
  const now = wayNow(ways.rows, (r) => ways.docOf(r.choice), props.doc, book, ctx.language.state?.template?.value.itemId);
  const own = ctx.language.state?.bookNames?.[book]?.value;
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const choices = useBookNameChoices(ctx, book, naming);
  const title = t('breakup.bookName.title', { language: props.language, book: props.templateName });
  // The name applies as it is picked, as its field is left, or as the sheet closes (decision 111).
  const saver = useSaver();
  const [marked, setMarked] = useState(false);
  const kept = useRef('');
  const refused = useRef('');
  const writing = useRef<Promise<boolean> | null>(null);
  function startNaming() {
    setName(own ?? '');
    setMarked(false);
    kept.current = own ?? '';
    refused.current = '';
    setNaming(true);
  }
  function applyName(value: string): Promise<boolean> {
    if (writing.current) return writing.current.then(() => applyName(value));
    const trimmed = value.trim();
    if (!trimmed || trimmed === kept.current) return Promise.resolve(true);
    setMarked(true);
    const write = saver.run(async () => {
      try {
        await ctx.act([{ id: Crypto.randomUUID(), type: 'v1.BookNameSet', payload: { book, name: trimmed } } as EventSpec], t('breakup.book.namedToast', { language: props.language, name: trimmed }));
      } catch (e) {
        refused.current = trimmed;
        ctx.toast(failureMessage('book name', e));
        throw e;
      }
      kept.current = trimmed;
      return true;
    }).then((ok) => ok === true).finally(() => { writing.current = null; });
    writing.current = write;
    return write;
  }
  function pick(value: string) {
    setName(value);
    void applyName(value);
  }
  /** ✕ or the backdrop: a new name is kept, then the sheet closes; one not kept stays open once. */
  function closeNaming() {
    if (name.trim() === refused.current) { setNaming(false); return; }
    void applyName(name).then((ok) => { if (ok) setNaming(false); });
  }
  return (
    <Card>
      <View style={{ gap: space.sm }}>
        <Text style={txt.label}>{t('breakup.book.brokenUp')}</Text>
        <Text style={txt.h3}>{now ? now.choice.name : t('breakup.book.ownWay')}</Text>
        <PieceBar doc={props.doc} v11n={props.v11n} book={book} explain />
        {props.canShape ? <GhostBtn label={t('breakup.book.breakDifferently')} help={t('breakup.book.breakDifferentlyHelp')} icon="cut" onPress={props.onChange} /> : null}
      </View>
      <Group style={{ marginTop: space.md }}>
        <Row icon="edit" label={t('breakup.book.calledIn', { name: own ?? props.templateName, language: props.language })}
          sub={own ? t('breakup.book.templateCalls', { name: props.templateName }) : t('breakup.book.tapToName')} help={t('breakup.book.nameHelp')} last
          onPress={props.canShape ? startNaming : undefined} />
      </Group>
      <Sheet visible={naming} title={title} sub={t('breakup.bookName.sub')} onClose={closeNaming} action={<SavedMark status={marked ? saver.status : 'idle'} />}>
        <Field value={name} onChangeText={setName} accessibilityLabel={title} autoCapitalize="words"
          onSubmit={() => void applyName(name)} onBlur={() => void applyName(name)}
          placeholder={choices.bibles.length || choices.languages.length ? t('breakup.bookName.typeOrTap') : props.templateName} />
        {choices.bibles.length ? (
          <>
            <SectionLabel label={t('breakup.bookName.fromBibles')} />
            <NameChoices rows={choices.bibles} current={name.trim()} onPick={pick} />
          </>
        ) : null}
        {choices.languages.length ? (
          <>
            <SectionLabel label={t('breakup.bookName.fromLanguages')} />
            <NameChoices rows={choices.languages} current={name.trim()} onPick={pick} />
          </>
        ) : null}
      </Sheet>
    </Card>
  );
}

/** Names to use, each with who uses it: one tapped is the name now, in the field and ticked. */
function NameChoices(props: { rows: { name: string; from: string[] }[]; current: string; onPick: (name: string) => void }) {
  return (
    <Group>
      {props.rows.map((r, i) => (
        <Row key={r.name} label={r.name} sub={r.from.join(' · ')} last={i === props.rows.length - 1} onPress={() => props.onPick(r.name)}
          help={props.current === r.name ? t('breakup.bookName.inBoxHelp') : t('breakup.bookName.useHelp')}
          accessibilityLabel={t('breakup.bookName.useLabel', { name: r.name, from: r.from.join(t('admin.list.separator')) })}
          right={props.current === r.name
            ? <Ico name="check" size={22} color={C.green} strokeWidth={3} />
            : <Text style={txt.link}>{t('breakup.bookName.use')}</Text>} />
      ))}
    </Group>
  );
}

/**
 * How should this book be broken up? Dividing it your own way comes first,
 * set apart (design principle 12), then the same ready-made ways as for the
 * whole Bible, with this book drawn in each. Break up / Change applies to
 * this language and, when the template is shared, to the languages chosen.
 * In the template editor (decision 107) `apply` takes the way instead: the
 * book changes in the template being edited, which that editor publishes, and
 * `self` is that template, `sub` its name and `extra` what else the editor
 * offers for the book (its name, removing it).
 */
export function BreakUpBook(props: {
  ctx: Ctx; book: string; bookName: string; language: string; doc: TemplateDoc; item: LibraryItemView | null; redo: boolean; onClose: () => void; onOwn: () => void;
  apply?: (way: TemplateDoc, note: string, said: string) => void; self?: string | null; extra?: ReactNode;
}) {
  const { ctx, book } = props;
  const code = useNumberingCode(ctx, props.doc);
  const ways = useWays(ctx, ctx.language.languageId, code);
  const self = props.apply ? props.self : ctx.language.state?.template?.value.itemId;
  const now = wayNow(ways.rows, (r) => ways.docOf(r.choice), props.doc, book, self);
  const offered = ways.rows.filter((r) => !r.later && !isItself(r, self) && (() => { const d = ways.docOf(r.choice); return !!d && wayCovers(d, book); })());
  const [key, setKey] = useState<string | null>(null);
  const picked = offered.find((r) => r.choice.key === key) ?? null;
  const [peek, setPeek] = useState<WayRow | null>(null);
  const change = useBookChange(ctx, { book, bookName: props.bookName, doc: props.doc, item: props.item, redo: props.redo, onDone: props.onClose });

  const go = () => {
    const wayDoc = ways.docOf(picked?.choice);
    if (!picked || !wayDoc) return;
    const byChapter = picked.choice.name === 'By chapter';
    // i18n-ignore: the new version's note, stored in the event log
    const note = `${props.bookName} is broken up ${byChapter ? 'by chapter' : `into ${picked.choice.name}`}`;
    const said = byChapter
      ? t('breakup.book.brokenUpByChapter', { book: props.bookName })
      : t('breakup.book.brokenUpInto', { book: props.bookName, way: picked.choice.name });
    if (props.apply) props.apply(wayDoc, note, said);
    else change.start(wayDoc, note, said);
  };

  return (
    <Screen header={<Header title={props.bookName} sub={props.language} onBack={props.onClose} />} bodyStyle={{ paddingHorizontal: 20, gap: 14 }}
      footer={<>
        <PrimaryBtn label={props.redo ? t('breakup.book.change', { book: props.bookName }) : t('breakup.book.breakUp', { book: props.bookName })} icon="check" busy={change.busy}
          disabled={!picked || (!!now && picked === now) || (!props.item && !props.apply)} onPress={go} help={t('breakup.book.breakUpHelp')} />
        <GhostBtn label={t('common.notNow')} icon="clock" help={t('help.details.cancel')} onPress={props.onClose} />
      </>}>
      <Question>{props.redo ? t('breakup.book.changeQuestion', { book: props.bookName }) : t('breakup.book.question', { book: props.bookName })}</Question>
      <Text style={[txt.sm, { color: C.muted }]}>{now ? t('breakup.book.nowEachPiece', { way: now.choice.name }) : t('breakup.book.eachPiece')}</Text>
      {/* Your own way comes first and stands apart, so the list of ready-made ways can grow without burying it. */}
      <ChoiceCard own chevron on={false} icon="edit" title={t('breakup.own.title')} sub={t('breakup.own.sub', { book: props.bookName })} onPress={props.onOwn} />
      {offered.length ? <SectionLabel label={t('breakup.own.orReadyMade')} /> : null}
      {offered.map((r) => (
        <WayCard key={r.choice.key} row={{ ...r, usedIn: r.usedIn, inUse: r === now }} doc={ways.docOf(r.choice)} v11n={ways.v11nOf(ways.docOf(r.choice))}
          on={picked === r} onPress={() => setKey(r.choice.key)} onPreview={() => setPeek(r)} oneBook={book} />
      ))}
      {offered.length === 0 ? <Text style={txt.smMuted}>{ways.loaded ? t('breakup.book.connectForWays') : t('common.loading')}</Text> : null}
      {props.extra}
      <PreviewSheet key={peek?.choice.key ?? 'none'} visible={!!peek} name={peek?.choice.name ?? ''} doc={ways.docOf(peek?.choice)} v11n={ways.v11nOf(ways.docOf(peek?.choice))}
        book={book} onClose={() => setPeek(null)} onUse={peek ? () => { setKey(peek.choice.key); setPeek(null); } : undefined} />
      {props.apply ? null : <BookChangeSheets s={change.sheets} />}
    </Screen>
  );
}

