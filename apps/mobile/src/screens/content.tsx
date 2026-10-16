// Content templates: the structure each language records against. Ports the
// UX demo's src/screens/content.tsx: ContentTemplatesScreen (templates_home,
// the organization's templates and a language's own), TemplatePickerScreen
// (template_picker), TemplateEditorScreen with OutlineScroll, LevelSheet and
// NodeSheet (template_editor) and BookStructureScreen (book_structure).
// Requirements TPL-1, TPL-2, TPL-7, TPL-9; ADR-025 (a language uses its own
// version, suggestions are advice), ADR-026 (a whole book in one scroll) and
// ADR-027 (the book reads like a Bible, FIA's breaks are suggestions).
//
// Templates are library items (docs/library.md, docs/decisions.md 36): the
// organization's own, copies, and ones it follows from another organization,
// plus what other organizations share. A language uses one version of one;
// when the item moves to a new version the language follows it
// (library/follow.ts). A Bible template's books are divided one by one,
// here in the editor as from the map (decisions.md 74, 93, 107).
//
// Below the organization there are only languages (docs/decisions.md 63).
// templates_home params: `level` ('org' | 'language') and/or `languageId`.
// template_picker: `languageId`. template_editor: `itemId` (a library
// template), `new` (start one), or `languageId` (that language's template).
// book_structure: `languageId`, `bookId`. A `languageId` param opens that
// language, so its state is the open language's.
import {
  bookParts, chaptersInBook, languageName, languageProgress, libraryItemView, usfmOf,
  type LibraryItemView, type TemplateDoc, type VersificationDoc
} from '@langquest-next/core';
import { BookHead, BreakUpBook } from '../breakup/BreakUpBook';
import { templateBookName } from '../breakup/templateNames';
import { DivideOwnWay } from '../breakup/DivideOwnWay';
import { useBookText } from '../breakup/useBookText';
import { booksLine, divisionLine, sharedTemplateShown, wayNow } from '../breakup/model';
import { atOf } from '../breakup/ownWay';
import { RedoSheet } from '../breakup/parts';
import { TranslateQuestion } from '../breakup/TranslateStep';
import { useTranslate } from '../breakup/useTranslate';
import { useWays } from '../breakup/useBreakup';
import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import * as Crypto from 'expo-crypto';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../ui/text';
import {
  bibleBook, bookNameOf, bookRows, withWaitingBooks, chapterBlocks, chipLabel, choiceLine, continuesInto, addNode,
  docLevels, formFromDoc, levelsForDivide,
  levelsForOutline, libraryChoices, moveNode, newTemplateForm, partWords, recordedCount, removeNode, renameNode,
  setAsideCount, siblingsOf, findNode, STARTER_TEMPLATE, templateLine, templateOf, versesText, versificationBooks,
  type BibleBook, type Block, type LibraryChoice, type Segment, type TemplateForm
} from '../templates/contentTemplates';
import { bookName } from '../i18n/coreText';
import type { Ctx } from '../shell/ctx';
import { t } from '../i18n';
import { indexesFor } from '../sync/indexes';
import { Banner, Card, Chip, ChipRow, Disclosure, EmptyState, Field, GhostBtn, Group, Header, HelpInfo, Ico, PrimaryBtn, QuietLinks, Row, Screen, SearchField, SectionLabel, SmallBtn, Sheet, ShowMore, Toggle } from '../ui/kit';
import { useHardwareBack } from '../ui/useHardwareBack';
import { txt } from '../ui/textStyles';
import { useOpenDetail } from '../ui/useLayout';
import { useHelpSpot } from '../helpMode/useHelpMode';
import { HelpBadge, HelpRow } from '../helpMode/helpBadge';
import { mayWriteLibrary, sourceLine, type SharedItem } from '../library/model';
import { useLibrary, useLibraryDocs, useLibraryUpdates, useSharedItems } from '../library/useLibrary';
import { failureMessage } from '../diagnostics/report';
import { DashedRow } from '../admin/admin';
import { contractsFor } from '../shell/screenContracts';
import { chipLabel as sourceChip } from '../sources/sourceText';
import { C, radius, space, target, tile, TINT, type as T } from '../ui/theme';
import { bookStructureData, chapterNumbers, chapterTileLabel, partsStartingIn } from '../templates/bookStructureModel';
import { useRunner, type Lib } from '../templates/useRunner';
import {
  bookRowSub, choiceInUse, defaultDisplay, displayExample, filterBooks, isOpenLanguage, joinNames, languageSummary, languageVersionView,
  levelNameAt, levelSub, lower, missingBooks, orgNameOf, outlineHolds, outlineSummary, partsCount, pendingUpdate, pickerLists, pickerNote,
  renamedTitle, splitArchived, templatesLevel, usersOf
} from '../templates/model';
import { usePickTemplate } from '../templates/usePickTemplate';
import { useTemplateEditor } from '../templates/useTemplateEditor';
import { draftKey } from '../drafts/draftModel';
import { isTemplateDraft, type TemplateDraft } from '../drafts/editorDrafts';
import { useDraft, type Draft } from '../drafts/useDraft';
import { SavedMark } from '../ui/SavedMark';

/**
 * What to say when something fails (error-tracking): a command's own reason,
 * or, for a fault, a code a tester can read out, having reported it.
 */
const failure = failureMessage;

/** Which view of templates this is: the level from params, else the viewer's own scope (ADR-017). */
const levelOf = (ctx: Ctx) => templatesLevel(ctx.params, ctx.session.adminScope, ctx.languageId);

/** Is this the open language (whose state the screen reads)? */
const isOpen = (ctx: Ctx, languageId: string | null | undefined): languageId is string => isOpenLanguage(ctx.language.languageId, languageId);

const NO_VERSES: readonly number[] = [];

const orgName = (ctx: Ctx) => orgNameOf(ctx.org.state);

/**
 * Book › Chapter › Passage: folders, then what's recorded (TPL-2). `explain`:
 * it says what its marks mean in help mode (not inside a card that explains itself).
 */
function LevelsLine(props: { levels: string[]; explain?: boolean }) {
  const label = t('content.levelsLabel', { levels: props.levels.join(t('content.list.separator')) });
  const line = (
    <View style={styles.levels} accessibilityLabel={label}>
      {props.levels.map((l, i) => (
        <View key={`${l}-${i}`} style={styles.level}>
          {i > 0 ? <Ico name="right" size={14} color={C.muted} /> : null}
          <Ico name={i === props.levels.length - 1 ? 'media' : 'folder'} size={16} color={C.primary} />
          <Text style={[txt.sm, { color: C.primary, fontWeight: '700' }]}>{l}</Text>
        </View>
      ))}
    </View>
  );
  return props.explain ? <HelpInfo label={label} detail={t('content.levelsHelp')}>{line}</HelpInfo> : line;
}

/** A document still on its way: a light line, never a spinner over the screen. */
function LoadingLine() {
  return <Text style={txt.smMuted}>{t('common.loading')}</Text>;
}

function Loading(props: { title: string; onBack: () => void }) {
  return (
    <Screen header={<Header title={props.title} onBack={props.onBack} />}>
      <EmptyState icon="template" title={t('content.loadingOrg')} />
    </Screen>
  );
}

/** Offline, the list of shared templates is the one this phone saved. */
function SharedOffline(props: { error: string; empty: boolean }) {
  if (!props.error) return null;
  return (
    <Banner icon="cloud" tone="amber" title={t('content.sharedOffline.title')}
      body={props.empty ? t('content.sharedOffline.connect') : t('content.sharedOffline.saved')} />
  );
}

// ---- Content Templates -------------------------------------------------------------------

export function TemplatesHome(ctx: Ctx) {
  const { level, languageId } = levelOf(ctx);
  if (level === 'language') return <LanguageTemplateView ctx={ctx} languageId={languageId} />;
  return <TemplateLibraryView ctx={ctx} />;
}

/** The organization: its templates, what others share, and what each language uses (TPL-1). */
function TemplateLibraryView({ ctx }: { ctx: Ctx }) {
  const state = ctx.language.state;
  const lib = useLibrary(ctx);
  const library = ctx.org.state?.library;
  // The organization's library is written at organization scope (library/model.ts `mayWriteLibrary`).
  const canManage = lib.canWrite('template');
  const all = lib.items('template');
  const { active, archived } = splitArchived(all);
  const shared = useSharedItems('template', lib.orgId);
  // LangQuest's ways once each (English numbering here), not its older templates or the same ways in every numbering (decision 107).
  const others = useMemo(() => libraryChoices(library ?? {}, [], shared.rows.filter((r) => sharedTemplateShown(r, 'eng')), STARTER_TEMPLATE.name), [library, shared.rows]);
  const { updates } = useLibraryUpdates(lib.orgId);
  const [limit, setLimit] = useState(8);
  const [sharedLimit, setSharedLimit] = useState(5);
  const [languageLimit, setLanguageLimit] = useState(8);
  const [options, setOptions] = useState<string | null>(null);
  const [browsing, setBrowsing] = useState<SharedItem | null>(null);
  const beside = useOpenDetail();
  const docs = useLibraryDocs(lib.orgId, [...all.map((i) => i.current), ...others.slice(0, sharedLimit).map((c) => c.hash)]);
  const archivedOpen = ctx.details('templates:archived');
  const languages = ctx.languages;
  const scopeName = orgName(ctx);
  const optionsItem = options ? lib.item(options) : null;

  const itemCard = (it: LibraryItemView) => {
    const doc = docs.get<TemplateDoc>(it.current);
    const users = usersOf(state, ctx.org.state, ctx.language.languageId, it.itemId);
    const update = it.source === 'subscription' ? pendingUpdate(it, updates) : undefined;
    return (
      <HelpRow key={it.itemId} of="content.template">
        <Card current={beside?.screen === 'template_editor' && beside.params['itemId'] === it.itemId}>
          <View style={styles.head}>
            <View style={styles.tile}><Ico name={doc?.structure === 'outline' ? 'folder' : 'book'} size={22} color={C.primary} /></View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={txt.h3}>{it.name}</Text>
              <Text style={[txt.sm, { fontWeight: '600', color: C.primary }]}>{sourceLine(it)}</Text>
              {it.description ? <Text style={[txt.smMuted, { marginTop: 2 }]}>{it.description}</Text> : null}
            </View>
          </View>
          {doc ? <LevelsLine levels={docLevels(doc)} explain /> : <LoadingLine />}
          <Text style={[txt.sm, { fontWeight: '600', color: users.length ? C.primary : C.muted }]}>
            {users.length ? t('content.library.usedBy', { names: joinNames(users) }) : t('content.library.notUsedHere')}
          </Text>
          {update ? <Text style={[txt.sm, { color: TINT.amberText }]}>{t('content.newerVersion', { org: it.subscription!.sourceOrgName })}</Text> : null}
          <View style={styles.cardActions}>
            {canManage ? <SmallBtn label={t('content.library.options')} icon="settings" onPress={() => setOptions(it.itemId)}
              help={it.subscription ? t('content.library.optionsFollowedHelp') : t('content.library.optionsHelp')} /> : null}
            <View style={{ flex: 1 }} />
            <SmallBtn label={canManage && it.source !== 'subscription' ? t('common.edit') : t('content.library.view')} icon="right" onPress={() => ctx.go('template_editor', { itemId: it.itemId })}
              help={canManage && it.source !== 'subscription' ? t('content.library.editHelp') : t('content.library.viewHelp')} />
          </View>
        </Card>
      </HelpRow>
    );
  };

  return (
    <Screen header={<Header title={t('content.library.title')} sub={scopeName} onBack={ctx.back}
      action={canManage ? <SmallBtn label={t('content.library.addTemplate')} icon="plus" tone="primary" onPress={() => ctx.go('template_editor', { new: '1' })}
        help={t('content.library.addTemplateHelp')} /> : undefined} />}>
      <Text style={[txt.smMuted, { paddingHorizontal: space.xs }]}>{t('content.library.intro')}</Text>

      <SectionLabel label={t('content.sections.yourOrganization')} />
      {active.length === 0 ? (
        <Text style={[txt.smMuted, { paddingHorizontal: space.xs }]}>
          {canManage ? t('content.library.emptyManage') : t('content.library.empty')}
        </Text>
      ) : active.slice(0, limit).map(itemCard)}
      <ShowMore remaining={active.length - limit} step={8} onMore={() => setLimit((l) => l + 8)} />
      {archived.length > 0 ? (
        <Disclosure icon="history" title={t('content.library.archived')} summary={t('content.library.archivedSummary', { count: archived.length })}
          open={archivedOpen.open} onToggle={archivedOpen.onToggle} {...(archivedOpen.open ? {} : { help: t('content.library.archivedHelp') })}>
          {archived.map((it, i) => (
            <HelpRow key={it.itemId} of="content.archivedTemplate">
              <Row icon="template" iconColor={C.muted} iconBg={C.bg} label={it.name} sub={sourceLine(it)} muted
                help={canManage ? t('content.library.archivedRowHelp') : t('content.library.viewHelp')}
                onPress={canManage ? () => setOptions(it.itemId) : () => ctx.go('template_editor', { itemId: it.itemId })} last={i === archived.length - 1} />
            </HelpRow>
          ))}
        </Disclosure>
      ) : null}

      <SectionLabel label={t('content.sections.fromOthers')} />
      <SharedOffline error={shared.error} empty={shared.rows.length === 0} />
      {shared.loaded && others.length === 0 && !shared.error ? (
        <Text style={[txt.smMuted, { paddingHorizontal: space.xs }]}>{t('content.library.nothingShared')}</Text>
      ) : null}
      {others.slice(0, sharedLimit).map((c) => {
        if (c.source !== 'shared') return null;
        const doc = docs.get<TemplateDoc>(c.hash);
        return (
          <HelpRow key={c.key} of="content.sharedTemplate">
            <Card onPress={() => setBrowsing(c.shared)} accessibilityLabel={t('content.library.sharedLabel', { name: c.name, org: c.shared.org_name })}
              help={canManage ? t('content.library.sharedHelp') : t('content.library.sharedViewHelp')}>
              <View style={styles.head}>
                <View style={styles.tile}><Ico name={doc?.structure === 'outline' ? 'folder' : 'book'} size={22} color={C.primary} /></View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={txt.h3}>{c.name}</Text>
                  <Text style={[txt.sm, { color: C.muted }]}>{choiceLine(c, sourceLine)}</Text>
                  {c.shared.description ? <Text style={[txt.smMuted, { marginTop: 2 }]}>{c.shared.description}</Text> : null}
                </View>
                <Ico name="right" size={22} color={C.muted} />
              </View>
              {doc ? <LevelsLine levels={docLevels(doc)} /> : null}
            </Card>
          </HelpRow>
        );
      })}
      <ShowMore remaining={others.length - sharedLimit} step={5} onMore={() => setSharedLimit((l) => l + 5)} />

      <SectionLabel label={t('content.library.byLanguage')} />
      {languages.length === 0 ? (
        <Text style={[txt.smMuted, { paddingHorizontal: space.xs }]}>{t('content.library.noLanguages')}</Text>
      ) : (
        <>
          <Group>
            {languages.slice(0, languageLimit).map((l, i, shown) => (
              <HelpRow key={l.languageId} of="content.language">
                <Row icon="globe" iconColor={C.muted} iconBg={C.bg} label={l.name}
                  sub={state && isOpen(ctx, l.languageId) ? templateLine(state, lib.item) : t('content.library.openToSee')} help={t('content.library.languageHelp')}
                  onPress={() => ctx.go('templates_home', { level: 'language', languageId: l.languageId })} last={i === shown.length - 1} />
              </HelpRow>
            ))}
          </Group>
          <ShowMore remaining={languages.length - languageLimit} step={8} onMore={() => setLanguageLimit((l) => l + 8)} />
        </>
      )}

      {optionsItem ? (
        <ItemOptions ctx={ctx} lib={lib} item={optionsItem} update={updates[optionsItem.itemId]} onClose={() => setOptions(null)} />
      ) : null}
      {browsing ? <SharedTemplateSheet ctx={ctx} lib={lib} shared={browsing} canManage={canManage} onClose={() => setBrowsing(null)} /> : null}
    </Screen>
  );
}

/**
 * What an admin can do with one of the organization's templates: share it
 * (and let others follow it), archive it, or, for one it follows, how it
 * takes updates, take one, stop following, or copy it to change it.
 */
function ItemOptions(props: { ctx: Ctx; lib: Lib; item: LibraryItemView; update?: string; onClose: () => void }) {
  const { ctx, lib, item: it, onClose } = props;
  const { busy, run } = useRunner(ctx);
  const sub = it.subscription;

  const setSharing = (shared: boolean, subscribable: boolean, message: string) => run('template sharing', async () => { // i18n-ignore: log label
    await lib.setSharing(it, shared, subscribable);
    ctx.toast(message);
  });

  if (sub) {
    return (
      <Sheet visible title={it.name} sub={sourceLine(it)} onClose={onClose}>
        {sub.active ? (
          <Group>
            <Row label={t('content.options.autoUpdate')} sub={t('content.options.autoUpdateSub', { org: sub.sourceOrgName })} last
              right={<Toggle on={sub.autoUpdate} disabled={busy} label={t('content.options.autoUpdate')} help={t('content.options.autoUpdateSub', { org: sub.sourceOrgName })}
                onToggle={() => void run('template updates', async () => { // i18n-ignore: log label
                  const auto = !sub.autoUpdate;
                  await lib.follow(it.itemId, { autoUpdate: auto });
                  ctx.toast(auto ? t('content.options.autoOn', { name: it.name }) : t('content.options.autoOff', { name: it.name }));
                })} />} />
          </Group>
        ) : null}
        {props.update ? (
          <GhostBtn label={t('content.options.takeUpdate')} icon="download" disabled={busy} help={t('content.options.takeUpdateHelp')} onPress={() => void run('take template update', async () => { // i18n-ignore: log label
            await lib.takeUpdate(it, props.update!);
            onClose();
            ctx.toast(t('content.options.updated', { name: it.name }));
          })} />
        ) : null}
        {sub.active ? (
          <GhostBtn label={t('content.options.stopFollowing')} icon="close" disabled={busy} help={t('content.options.stopFollowingHelp')} onPress={() => void run('stop following template', async () => { // i18n-ignore: log label
            await lib.follow(it.itemId, { active: false });
            onClose();
            ctx.toast(t('content.options.stoppedFollowing', { name: it.name }));
          })} />
        ) : (
          // The way back from Stop following stays here, as in the library's settings (decision 134).
          <GhostBtn label={t('config.library.followAgain')} disabled={busy} help={t('config.library.followAgainHelp')} onPress={() => void run('follow template again', async () => { // i18n-ignore: log label
            await lib.follow(it.itemId, { active: true });
            onClose();
            ctx.toast(t('config.library.followingAgain', { org: sub.sourceOrgName }));
          })} />
        )}
        <GhostBtn label={t('content.options.copyToChange')} icon="edit" disabled={busy} help={t('content.options.copyToChangeHelp')} onPress={() => void run('copy template', async () => { // i18n-ignore: log label
          await lib.copyFollowed(it);
          onClose();
          ctx.toast(t('content.copied', { name: it.name }));
        })} />
      </Sheet>
    );
  }

  return (
    <Sheet visible title={it.name} sub={sourceLine(it)} onClose={onClose}>
      <Group>
        <Row label={t('content.options.share')} sub={t('content.options.shareSub')} last={!it.shared}
          right={<Toggle on={it.shared} disabled={busy} label={t('content.options.share')} help={t('content.options.shareSub')}
            onToggle={() => void setSharing(!it.shared, it.subscribable, it.shared ? t('content.options.unshared', { name: it.name }) : t('content.options.shared', { name: it.name }))} />} />
        {it.shared ? (
          <Row label={t('content.options.letFollow')} sub={t('content.options.letFollowSub')} last
            right={<Toggle on={it.subscribable} disabled={busy} label={t('content.options.letFollow')} help={t('content.options.letFollowSub')}
              onToggle={() => void setSharing(true, !it.subscribable, it.subscribable ? t('content.options.followOff') : t('content.options.followOn'))} />} />
        ) : null}
      </Group>
      <GhostBtn label={it.archived ? t('content.options.unarchive') : t('content.options.archive')} icon="history" disabled={busy}
        help={it.archived ? t('content.options.unarchiveHelp') : t('content.options.archiveHelp')} onPress={() => void run('archive template', async () => { // i18n-ignore: log label
        const archived = !it.archived;
        await lib.archive(it, archived);
        onClose();
        ctx.toast(archived ? t('content.options.archivedToast', { name: it.name }) : t('content.options.unarchivedToast', { name: it.name }));
      })} />
    </Sheet>
  );
}

/** Another organization's template: follow it (automatic updates or not), or copy it to make it ours. */
function SharedTemplateSheet(props: { ctx: Ctx; lib: Lib; shared: SharedItem; canManage: boolean; onClose: () => void }) {
  const { ctx, lib, shared: s, onClose } = props;
  const { busy, run } = useRunner(ctx);
  const [following, setFollowing] = useState(false);
  const follow = (auto: boolean) => run('follow template', async () => { // i18n-ignore: log label
    await lib.subscribe(s, auto);
    onClose();
    ctx.toast(t('content.shared.followingToast', { name: s.name, org: s.org_name }));
  });
  return (
    <Sheet visible title={s.name} sub={t('content.fromOrgVersions', { org: s.org_name, count: s.version_count })} onClose={onClose}>
      {s.description ? <Text style={txt.body}>{s.description}</Text> : null}
      {!props.canManage ? (
        <Text style={txt.smMuted}>{t('content.shared.whoever')}</Text>
      ) : following ? (
        <Group>
          <Row icon="download" label={t('content.options.autoUpdate')} sub={t('content.shared.autoSub')} onPress={busy ? undefined : () => void follow(true)} />
          <Row icon="notif" label={t('content.shared.takeMyself')} sub={t('content.shared.takeMyselfSub')} onPress={busy ? undefined : () => void follow(false)} last />
        </Group>
      ) : (
        <Group>
          {s.subscribable ? (
            <Row icon="history" label={t('content.shared.follow')} sub={t('content.shared.followSub', { org: s.org_name })} onPress={() => setFollowing(true)} />
          ) : null}
          <Row icon="edit" label={t('content.shared.copy')} sub={t('content.shared.copySub')} last onPress={busy ? undefined : () => void run('copy template', async () => { // i18n-ignore: log label
            await lib.copy(s);
            onClose();
            ctx.toast(t('content.copied', { name: s.name }));
          })} />
        </Group>
      )}
    </Sheet>
  );
}

/** A language: its template and version, its levels and counts, Change, and the books (TPL-1, TPL-7). */
function LanguageTemplateView({ ctx, languageId }: { ctx: Ctx; languageId: string | null }) {
  const state = ctx.language.state;
  const lib = useLibrary(ctx);
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(8);
  const { busy, run } = useRunner(ctx);
  const open = isOpen(ctx, languageId);
  const sel = state && open ? templateOf(state) : null;
  const docs = useLibraryDocs(lib.orgId, [sel?.docHash]);
  const { updates } = useLibraryUpdates(lib.orgId);
  const data = useMemo(() => {
    if (!state || !open) return null;
    const idx = indexesFor(state);
    return {
      language: languageName(ctx.org.state, languageId),
      // Books waiting to be divided are listed too, so they can be opened and divided here (decision 107).
      books: withWaitingBooks(bookRows(state, idx), state, idx),
      progress: languageProgress(state, idx),
      setAside: setAsideCount(state)
    };
  }, [state, open, languageId, ctx.org.state]);
  if (!state) return <Loading title={t('content.language.title')} onBack={ctx.back} />;
  if (!data || !languageId) {
    return (
      <Screen header={<Header title={t('content.language.title')} onBack={ctx.back} />}>
        <EmptyState icon="globe" title={t('content.noLanguage')} sub={t('content.language.noLanguageSub')} />
      </Screen>
    );
  }
  const canManage = ctx.session.can('manage_templates');
  // Editing the template, taking an update and following one are the organization's library (`mayWriteLibrary`);
  // choosing which template the language uses is the language's own.
  const canWrite = lib.canWrite('template');
  const canShape = ctx.session.can('shape_templates') || canManage;
  const item = sel ? lib.item(sel.itemId) : null;
  const doc = docs.get<TemplateDoc>(sel?.docHash);
  const v11n = doc?.bible ? docs.get<VersificationDoc>(doc.bible.versification) : null;
  const levels = doc ? docLevels(doc) : [];
  const words = partWords(doc);
  const books = filterBooks(data.books, query, bookName);
  const { versionLine, newer, update } = languageVersionView(item, sel, updates);
  const { bibleLine, countsLine } = languageSummary({
    doc, chosenBooks: sel?.books ? sel.books.length : null, v11n, bookRows: data.books.length, progress: data.progress, words
  });

  return (
    <Screen header={<Header title={t('content.language.title')} sub={data.language} onBack={ctx.back} />}>
      {sel ? (
        <Card>
          <View>
            <Text style={txt.label}>{t('content.language.recordsAgainst', { language: data.language })}</Text>
            <Text style={[txt.h2, { marginTop: space.xs }]}>{item?.name ?? doc?.name ?? t('content.language.itsTemplate')}</Text>
            <Text style={[txt.smMuted, { marginTop: 2 }]}>{versionLine}</Text>
          </View>
          {!doc ? <LoadingLine /> : <LevelsLine levels={levels} explain />}
          {bibleLine !== null ? <Text style={txt.sm}>{bibleLine}</Text> : null}
          <Text style={txt.sm}>{countsLine}</Text>
          {newer ? (
            <Text style={[txt.sm, { color: C.primary, fontWeight: '600' }]}>{t('content.language.newerOut', { n: newer, language: data.language })}</Text>
          ) : update ? (
            <>
              <Text style={[txt.sm, { color: TINT.amberText }]}>{t('content.newerVersion', { org: item!.subscription!.sourceOrgName })}</Text>
              {canWrite ? (
                <SmallBtn label={t('content.options.takeUpdate')} icon="download" disabled={busy} help={t('content.options.takeUpdateHelp')} onPress={() => void run('take template update', async () => { // i18n-ignore: log label
                  await lib.takeUpdate(item!, update);
                  ctx.toast(t('content.language.movesToNew', { language: data.language, name: item!.name }));
                })} />
              ) : null}
            </>
          ) : null}
          {canManage ? (
            <View style={{ gap: space.sm }}>
              <GhostBtn label={item && item.source !== 'subscription' && canWrite ? t('content.language.editTemplate') : t('content.language.viewTemplate')} icon="edit"
                help={item && item.source !== 'subscription' && canWrite ? t('content.language.editTemplateHelp') : t('content.library.viewHelp')}
                onPress={() => ctx.go('template_editor', { itemId: sel.itemId })} />
              <GhostBtn label={t('content.language.changeTemplate')} icon="swap" help={t('content.language.changeTemplateHelp', { language: data.language })}
                onPress={() => ctx.go('template_picker', { languageId })} />
            </View>
          ) : null}
        </Card>
      ) : (
        <Card>
          <Text style={txt.h3}>{t('content.noTemplate')}</Text>
          <Text style={txt.smMuted}>
            {canManage
              ? t('content.language.chooseStructure', { language: data.language })
              : t('content.language.whoeverChooses', { language: data.language })}
          </Text>
          {canManage ? <PrimaryBtn label={t('content.language.chooseTemplate')} icon="template" onPress={() => ctx.go('template_picker', { languageId })} /> : null}
        </Card>
      )}

      {data.setAside > 0 ? (
        <Banner icon="history" title={t('content.language.setAsideTitle', { count: data.setAside })}
          body={t('content.language.setAsideBody', { count: data.setAside, language: data.language })} />
      ) : null}

      {sel && canShape && data.books.length > 0 ? (
        <>
          <SectionLabel label={t('content.language.divideInto', { parts: lower(words.many) })} />
          <Text style={[txt.smMuted, { paddingHorizontal: space.xs }]}>
            {t('content.language.openABook', { part: lower(words.one) })}
          </Text>
          <SearchField value={query} onChangeText={(v) => { setQuery(v); setLimit(8); }} placeholder={t('content.language.findBook')} />
          {books.length === 0 ? (
            <Text style={[txt.smMuted, { paddingHorizontal: space.xs }]}>{t('content.language.noBookMatches', { query: query.trim() })}</Text>
          ) : (
            <Group>
              {books.slice(0, limit).map((b, i, shown) => (
                <HelpRow key={b.book.itemId} of="content.book">
                  <Row icon="book" label={b.label} sub={b.waiting ? t('map.waiting') : partsCount(b.parts, words)}
                    help={b.waiting ? t('content.language.bookWaitingHelp') : t('content.language.bookHelp', { part: lower(words.one) })}
                    onPress={() => ctx.go('book_structure', { languageId, bookId: b.book.itemId })} last={i === shown.length - 1} />
                </HelpRow>
              ))}
            </Group>
          )}
          <ShowMore remaining={books.length - limit} step={8} onMore={() => setLimit((l) => l + 8)} />
        </>
      ) : null}
    </Screen>
  );
}

// ---- Choose a Template ------------------------------------------------------------------------

export function TemplatePicker(ctx: Ctx) {
  const state = ctx.language.state;
  const languageId = ctx.params['languageId'] ?? ctx.languageId;
  const lib = useLibrary(ctx);
  const libItems = lib.items;
  const library = ctx.org.state?.library;
  const shared = useSharedItems('template', lib.orgId);
  const choices = useMemo(() => libraryChoices(library ?? {}, libItems('template'), shared.rows, STARTER_TEMPLATE.name), [library, libItems, shared.rows]);
  const [picked, setPicked] = useState<string | null>(null);
  const [sharedLimit, setSharedLimit] = useState(5);
  const open = isOpen(ctx, languageId);
  const sel = state && open ? templateOf(state) : null;
  const pick = choices.find((c) => c.key === picked);
  const docs = useLibraryDocs(lib.orgId, [pick?.hash, sel?.docHash]);
  const selDoc = sel ? docs.get<TemplateDoc>(sel.docHash) : null;
  // Using another organization's template follows it first, an organization write (`mayWriteLibrary`); LangQuest's
  // ways are offered in the numbering the language uses now (decision 107).
  const numbering = (selDoc?.bible ? docs.get<VersificationDoc>(selDoc.bible.versification)?.code : null) ?? 'eng';
  const { ours, others } = pickerLists(choices, lib.canWrite('template'), numbering);
  const recorded = useMemo(() => (state && open ? recordedCount(state) : 0), [state, open]);
  const { busy, use } = usePickTemplate(ctx, lib, state, languageId);
  if (!state) return <Loading title={t('content.picker.title')} onBack={ctx.back} />;
  if (!isOpen(ctx, languageId)) {
    return (
      <Screen header={<Header title={t('content.picker.title')} onBack={ctx.back} />}>
        <EmptyState icon="globe" title={t('content.noLanguage')} sub={t('content.picker.noLanguageSub')} />
      </Screen>
    );
  }
  const language = languageName(ctx.org.state, languageId);
  const canUse = ctx.session.can('manage_templates');
  const currentName = sel ? lib.item(sel.itemId)?.name ?? t('content.picker.itsTemplate') : null;
  const inUse = (c: LibraryChoice) => choiceInUse(c, sel);
  const currentDoc = sel ? docs.get<TemplateDoc>(sel.docHash) : null;
  const currentParts = lower(partWords(currentDoc).many);

  const card = (c: LibraryChoice) => {
    const on = picked === c.key;
    const used = inUse(c);
    const doc = on ? docs.get<TemplateDoc>(c.hash) : null;
    const description = c.source === 'ours' ? c.item.description : c.shared.description;
    return (
      <HelpRow key={c.key} of="content.choice">
        <Card onPress={() => setPicked(on ? null : c.key)} accessibilityLabel={used ? t('content.picker.inUseLabel', { name: c.name }) : c.name}
          help={on ? t('content.picker.pickedHelp') : used ? t('content.picker.inUseHelp', { language }) : t('content.picker.cardHelp')}
          style={on ? { borderWidth: 2, borderColor: C.primary } : null}>
          <View style={styles.head}>
            <View style={[styles.tile, on ? { backgroundColor: C.primary } : null]}>
              <Ico name={doc?.structure === 'outline' ? 'folder' : 'book'} size={22} color={on ? C.white : C.primary} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={txt.h3}>{used ? t('content.picker.inUseTitle', { name: c.name }) : c.name}</Text>
              <Text style={[txt.sm, { fontWeight: '600', color: C.primary }]}>{choiceLine(c, sourceLine)}</Text>
              {description ? <Text style={[txt.smMuted, { marginTop: 2 }]}>{description}</Text> : null}
            </View>
            {on ? <Ico name="check" size={22} color={C.primary} /> : null}
          </View>
          {on ? (doc ? <LevelsLine levels={docLevels(doc)} /> : <LoadingLine />) : null}
        </Card>
      </HelpRow>
    );
  };

  const changing = !!pick && !inUse(pick);
  return (
    <Screen
      header={<Header title={t('content.picker.title')}
        sub={currentName ? t('content.picker.forNow', { language, template: currentName }) : t('content.picker.for', { language })} onBack={ctx.back} />}
      footer={changing && pick ? (
        <>
          <Text style={txt.smMuted}>{pickerNote({ hasCurrent: !!sel, recorded, language, currentParts, pick })}</Text>
          <PrimaryBtn label={t('content.picker.use', { name: pick.name })} icon="check" busy={busy} disabled={!canUse} onPress={() => void use(pick)} />
        </>
      ) : undefined}>
      {/* Making your own comes first and stands apart, so the ready-made list below can grow without burying it (design principle 12). */}
      {ctx.session.can('manage_templates') ? <DashedRow icon="plus" label={t('breakup.translate.makeOwn')} detail={t('content.picker.makeOwnHelp')} onPress={() => ctx.go('template_editor', { new: '1' })} /> : null}
      <SectionLabel label={t('content.sections.yourOrganization')} />
      {ours.length === 0 ? (
        <Text style={[txt.smMuted, { paddingHorizontal: space.xs }]}>{t('content.picker.noneOurs')}</Text>
      ) : ours.map(card)}
      {lib.canWrite('template') ? (
        <>
          <SectionLabel label={t('content.sections.fromOthers')} />
          <SharedOffline error={shared.error} empty={shared.rows.length === 0} />
          {others.slice(0, sharedLimit).map(card)}
        </>
      ) : null}
      <ShowMore remaining={others.length - sharedLimit} step={5} onMore={() => setSharedLimit((l) => l + 5)} />
    </Screen>
  );
}

// ---- Template editor (TPL-9) -------------------------------------------------------------------

export function TemplateEditor(ctx: Ctx) {
  const languageId = ctx.params['languageId'] ?? ctx.languageId;
  const used = ctx.language.state && isOpen(ctx, languageId) ? templateOf(ctx.language.state)?.itemId : undefined;
  const itemId = ctx.params['itemId'] ?? (ctx.params['new'] ? undefined : used);
  if (itemId) return <LibraryTemplate ctx={ctx} itemId={itemId} />;
  if (ctx.params['new']) return <NewTemplate ctx={ctx} />;
  if (!ctx.language.state) return <Loading title={t('content.editor.outlineTitle')} onBack={ctx.back} />;
  return (
    <Screen header={<Header title={t('content.editor.outlineTitle')} onBack={ctx.back} />}>
      <EmptyState icon="template" title={t('content.editor.notFound')} sub={t('content.editor.notFoundOpen')} />
    </Screen>
  );
}

/** The changes this person has not finished to a template (`itemId`) or a new one, kept on this phone (decision 127). */
function useTemplateDraft(ctx: Ctx, lib: Lib, itemId: string | null): Draft<TemplateDraft | null> {
  return useDraft<TemplateDraft | null>(draftKey('editor', ctx.session.actorId, lib.orgId, 'template', itemId ?? 'new'), null, isTemplateDraft);
}

/** One of the organization's templates, opened once its document (and any draft of it) is on the phone. */
function LibraryTemplate({ ctx, itemId }: { ctx: Ctx; itemId: string }) {
  const lib = useLibrary(ctx);
  const item = lib.item(itemId);
  const docs = useLibraryDocs(lib.orgId, [item?.current]);
  const doc = docs.get<TemplateDoc>(item?.current);
  const draft = useTemplateDraft(ctx, lib, itemId);
  if (!item || item.kind !== 'template') {
    return (
      <Screen header={<Header title={t('content.editor.outlineTitle')} onBack={ctx.back} />}>
        <EmptyState icon="template" title={t('content.editor.notFound')} sub={t('content.editor.notInLibrary')} />
      </Screen>
    );
  }
  if (!doc || !draft.loaded) {
    return (
      <Screen header={<Header title={item.name} sub={sourceLine(item)} onBack={ctx.back} />}>
        {!doc && docs.error ? <Banner icon="cloud" tone="amber" title={t('content.editor.notOnDevice')} body={t('content.editor.connectToOpen')} /> : <LoadingLine />}
      </Screen>
    );
  }
  return <TemplateEditorForm key={item.current} ctx={ctx} lib={lib} item={item} initial={formFromDoc(doc, item.name, item.description)} draft={draft} />;
}

/**
 * "New template": Scripture, or an outline built by hand. Scripture asks
 * what New language asks (decision 107): the Bible the team translates
 * from (or the quiz, or the list), then how the Bible is divided, your own
 * way first. The template starts as that way divides it, and each book can
 * then be divided on its own in the editor.
 */
function NewTemplate({ ctx }: { ctx: Ctx }) {
  const lib = useLibrary(ctx);
  // Opened from "Something else: Make your own" (`kind: 'outline'`): the outline, without asking again.
  const [form, setForm] = useState<TemplateForm | null>(() => (ctx.params['kind'] === 'outline' ? newTemplateForm('outline') : null));
  const [bible, setBible] = useState(false);
  const tq = useTranslate(ctx, null);
  // A new template begun before opens as it was left, without asking again.
  const draft = useTemplateDraft(ctx, lib, null);
  const start = form ?? draft.value?.form;
  // Back from the first question leaves Scripture; otherwise it goes back a question.
  const backOut = () => { if ((tq.page === 'find' && !tq.numbering) || tq.page === 'what' || !tq.retreat()) setBible(false); };
  // A phone's Back does the same as the header's arrow (decision 135).
  useHardwareBack(bible && !start, backOut);
  if (start) return <TemplateEditorForm ctx={ctx} lib={lib} item={null} initial={start} draft={draft} />;
  if (!draft.loaded) return <Screen header={<Header title={t('content.newTemplate.title')} sub={orgName(ctx)} onBack={ctx.back} />}>{null}</Screen>;

  const scripture = () => { tq.setWhat('bible'); tq.setPage(tq.numbering ? 'numbered' : 'find'); setBible(true); };
  const begin = () => {
    if (!tq.doc?.bible) return;
    // The way's books and how it divides them, its levels and numbering; the name and purpose are the admin's own.
    setForm({ ...formFromDoc(tq.doc, '', ''), name: '', description: '' });
  };

  if (bible) {
    return (
      <Screen header={<Header title={t('content.newTemplate.title')} sub={orgName(ctx)} onBack={backOut} />}
        footer={tq.showContinue && tq.page !== 'what' ? (
          <PrimaryBtn label={t('org.continue')} icon="right" disabled={tq.page === 'ways' ? !tq.ready : !tq.canContinue} help={t('content.newTemplate.continueHelp')} onPress={() => { if (!tq.advance()) begin(); }} />
        ) : undefined}>
        <TranslateQuestion ctx={ctx} t={tq} lang={orgName(ctx)} canMake={false} onMake={() => undefined} />
      </Screen>
    );
  }

  return (
    <Screen header={<Header title={t('content.newTemplate.title')} sub={orgName(ctx)} onBack={ctx.back} />}>
      <Text style={txt.body}>{t('content.newTemplate.what')}</Text>
      <Card onPress={scripture} accessibilityLabel={t('content.newTemplate.scripture')} help={t('content.newTemplate.scriptureHelp')}>
        <View style={styles.head}>
          <View style={styles.tile}><Ico name="book" size={22} color={C.primary} /></View>
          <View style={{ flex: 1 }}>
            <Text style={txt.h3}>{t('content.newTemplate.scripture')}</Text>
            <Text style={txt.smMuted}>{t('content.newTemplate.scriptureSub')}</Text>
          </View>
        </View>
      </Card>
      <Card onPress={() => setForm(newTemplateForm('outline'))} accessibilityLabel={t('content.newTemplate.else')} help={t('content.newTemplate.elseHelp')}>
        <View style={styles.head}>
          <View style={styles.tile}><Ico name="folder" size={22} color={C.primary} /></View>
          <View style={{ flex: 1 }}>
            <Text style={txt.h3}>{t('content.newTemplate.else')}</Text>
            <Text style={txt.smMuted}>{t('content.newTemplate.elseSub')}</Text>
          </View>
        </View>
      </Card>
    </Screen>
  );
}

/**
 * The editor itself (the demo's TemplateEditorScreen): name, description,
 * levels, and for Scripture the versification, the books and their names,
 * and how they divide; for an outline, the whole outline in one scroll.
 * What is changed is kept on this phone as it changes (`draft`, decision
 * 111); Done publishes the next version. A followed template opens read-only.
 */
function TemplateEditorForm({ ctx, lib, item, initial, draft }: { ctx: Ctx; lib: Lib; item: LibraryItemView | null; initial: TemplateForm; draft: Draft<TemplateDraft | null> }) {
  const [editingLevel, setEditingLevel] = useState<number | null>(null);
  const [editingBook, setEditingBook] = useState<string | null>(null);
  const [addingBook, setAddingBook] = useState(false);
  const [choosingV11n, setChoosingV11n] = useState(false);
  const [editingNode, setEditingNode] = useState<string | null>(null);
  const [bookLimit, setBookLimit] = useState(12);
  // The book being divided (decision 107), and whether it is being divided its own way.
  const [dividing, setDividing] = useState<string | null>(null);
  const [ownWay, setOwnWay] = useState(false);
  const {
    f, set, busy, run, v, v11n, isNew, followed, readOnly, newer, users, bible, v11nName, ready, sub, done, doc, perBook, divide, redone, redoing, cancelRedo
  } = useTemplateEditor(ctx, lib, item, initial, draft);
  const ways = useWays(ctx, ctx.language.languageId, bible ? v11n?.code ?? null : null);
  const shownBooks = f.books.slice(0, bookLimit);
  const bookSheet = editingBook ? f.books.find((b) => b.book === editingBook) : undefined;
  const missing = missingBooks(v11n ? versificationBooks(v11n) : null, f.books);
  const node = editingNode ? findNode(f.outline, editingNode) : undefined;
  const nodeSiblings = editingNode ? siblingsOf(f.outline, editingNode) : [];
  const templateName = f.name.trim() || t('content.editor.untitled');
  const bookSheetView = bookSheet ? (
    <BookSheet book={bookSheet} onClose={() => setEditingBook(null)}
      onSave={(name) => { set({ books: f.books.map((b) => (b.book === bookSheet.book ? { ...b, name } : b)) }); setEditingBook(null); }}
      onRemove={() => { set({ books: f.books.filter((b) => b.book !== bookSheet.book) }); setEditingBook(null); setDividing(null); }} />
  ) : null;

  // A book of the template, divided here as it is from the map: your own way first, then the ready-made ways (decision 107).
  const divided = dividing ? f.books.find((b) => b.book === dividing) : undefined;
  if (bible && divided) {
    const apply = (way: TemplateDoc) => {
      divide(divided.book, way);
      setOwnWay(false);
      setDividing(null);
      ctx.toast(t('content.divide.done', { book: divided.name }));
    };
    if (ownWay) {
      return (
        <DivideOwnWay ctx={ctx} book={divided.book} bookName={divided.name} doc={doc} v11n={v11n} fallbackVerses={v11n?.maxVerses[divided.book] ?? []}
          item={item} redo={false} apply={apply} onClose={() => setOwnWay(false)} onDone={() => { setOwnWay(false); setDividing(null); }} />
      );
    }
    const page: ReactNode = (
      <BreakUpBook ctx={ctx} book={divided.book} bookName={divided.name} language={templateName} doc={doc} item={item}
        redo={!!bookParts(doc, divided.book)} apply={apply} self={item?.itemId ?? null}
        onClose={() => setDividing(null)} onOwn={() => setOwnWay(true)}
        extra={<QuietLinks items={[{ label: t('content.divide.nameOrRemove', { book: divided.name }), icon: 'edit', onPress: () => setEditingBook(divided.book), help: t('content.divide.nameOrRemoveHelp') }]} />} />
    );
    return <>{page}{bookSheetView}</>;
  }

  return (
    <Screen
      header={<Header title={f.name.trim() || t('content.editor.untitled')} sub={sub} onBack={ctx.back}
        action={readOnly ? undefined : <SavedMark status={draft.status} help={t('saved.draftHelp')} />} />}
      footer={readOnly ? undefined : (
        <PrimaryBtn label={isNew ? t('content.editor.create') : t('common.done')} icon="check" busy={busy} disabled={!ready} onPress={done}
          help={isNew ? t('content.editor.createHelp') : t('content.editor.doneHelp')} />
      )}>
      {newer && !readOnly && !busy ? <Banner icon="history" tone="amber" title={t('guides.editor.newer')} body={t('guides.editor.newerBody')} /> : null}
      {followed ? (
        <>
          <Banner icon="lock" title={t('content.editor.follows', { org: item!.subscription!.sourceOrgName })} body={t('content.editor.followsBody')} />
          {lib.canWrite('template') ? (
            <GhostBtn label={t('content.options.copyToChange')} icon="edit" disabled={busy} help={t('content.options.copyToChangeHelp')} onPress={() => void run('copy template', async () => { // i18n-ignore: log label
              await lib.copyFollowed(item!);
              ctx.toast(t('content.editor.copiedFind', { name: item!.name }));
              ctx.back();
            })} />
          ) : null}
        </>
      ) : null}

      {readOnly ? (
        f.description ? <Card><Text style={txt.body}>{f.description}</Text></Card> : null
      ) : (
        <>
          <Field label={t('content.name')} value={f.name} onChangeText={(name) => set({ name })} placeholder={t('content.editor.namePlaceholder')} autoCapitalize="words"
            help={t('content.editor.nameHelp')} />
          <Field label={t('content.editor.whatFor')} value={f.description} onChangeText={(description) => set({ description })} placeholder={t('content.editor.whatForPlaceholder')} multiline />
        </>
      )}
      {users.length > 0 ? (
        <Text style={[txt.smMuted, { paddingHorizontal: space.xs }]}>
          {t('content.editor.usedBy', { count: users.length, names: joinNames(users) })}
        </Text>
      ) : null}

      <SectionLabel label={t('content.editor.levels')} />
      <Group>
        {f.levels.map((l, i) => (
          <HelpRow key={`${l.name}-${i}`} of="content.level">
            <Row icon={i === f.levels.length - 1 ? 'media' : 'folder'} label={l.name}
              sub={levelSub(i, f.levels.length, defaultDisplay(l, bible))}
              help={bible && i === f.levels.length - 1 ? t('content.editor.lastLevelHelp') : t('content.editor.levelHelp')}
              onPress={readOnly ? undefined : () => setEditingLevel(i)} right={readOnly ? undefined : <Ico name="edit" size={20} color={C.muted} />}
              last={i === f.levels.length - 1} />
          </HelpRow>
        ))}
      </Group>

      {bible ? (
        <>
          <SectionLabel label={t('content.editor.versification')} />
          <Group>
            <Row icon="book" label={v11nName} sub={t('content.editor.versificationSub')} help={t('content.editor.versificationHelp')} last
              onPress={readOnly || perBook ? undefined : () => setChoosingV11n(true)} right={readOnly || perBook ? undefined : <Ico name="edit" size={20} color={C.muted} />} />
          </Group>

          {perBook ? null : (
            <>
              <SectionLabel label={t('content.editor.divideInto')} />
              <ChipRow>
                <Chip label={t('content.editor.wholeBooks')} on={f.divide === 'books'} help={t('content.editor.eachBook')} onPress={() => !readOnly && set({ divide: 'books', levels: levelsForDivide(f.levels, 'books') })} />
                <Chip label={t('content.editor.chapters')} on={f.divide === 'chapters'} help={t('content.editor.eachChapter')} onPress={() => !readOnly && set({ divide: 'chapters', levels: levelsForDivide(f.levels, 'chapters') })} />
                {f.passages.length > 0 ? (
                  <Chip label={t('content.editor.passages')} on={f.divide === 'passages'} help={t('content.editor.passagesHelp')} onPress={() => !readOnly && set({ divide: 'passages', levels: levelsForDivide(f.levels, 'passages') })} />
                ) : null}
              </ChipRow>
              <Text style={[txt.smMuted, { paddingHorizontal: space.xs }]}>
                {f.divide === 'passages'
                  ? t('content.editor.passagesNote', { count: f.passages.length })
                  : f.divide === 'books' ? t('content.editor.eachBook') : t('content.editor.eachChapter')}
              </Text>
            </>
          )}

          <SectionLabel label={t('content.editor.booksCount', { n: f.books.length })} />
          {f.books.length > 0 && !readOnly ? <Text style={[txt.smMuted, { paddingHorizontal: space.xs }]}>{t('content.divide.tapBook')}</Text> : null}
          {f.books.length === 0 ? (
            <Text style={[txt.smMuted, { paddingHorizontal: space.xs }]}>{t('content.editor.noBooks')}</Text>
          ) : (
            <Group>
              {shownBooks.map((b, i) => {
                const known = bookNameOf(b.book);
                const chapters = v11n ? chaptersInBook(v11n, b.book) : 0;
                // How it is divided: the ready-made way it matches, its own way, or waiting (decision 107).
                const way = perBook ? wayNow(ways.rows, (r) => ways.docOf(r.choice), doc, b.book, item?.itemId ?? null) : null;
                return (
                  <HelpRow key={b.book} of="content.editorBook">
                    <Row icon="book" label={b.name}
                      sub={perBook ? [...(known !== b.name ? [known] : []), divisionLine(doc, b.book, way?.choice.name ?? null, v11n)].join(' · ') : bookRowSub(b.book, b.name, known, chapters)}
                      help={t('content.editor.bookHelp')}
                      onPress={readOnly ? undefined : () => setDividing(b.book)} right={readOnly ? undefined : <Ico name="right" size={20} color={C.muted} />}
                      last={i === shownBooks.length - 1} />
                  </HelpRow>
                );
              })}
            </Group>
          )}
          <ShowMore remaining={f.books.length - bookLimit} step={12} onMore={() => setBookLimit((l) => l + 12)} />
          {!readOnly ? <GhostBtn label={t('content.editor.addBook')} icon="plus" disabled={!v11n || missing.length === 0} help={t('content.editor.addBookHelp')} onPress={() => setAddingBook(true)} /> : null}
        </>
      ) : (
        <>
          <SectionLabel label={t('content.editor.outline')} />
          <OutlineScroll outline={f.outline} levels={f.levels} readOnly={readOnly}
            onChange={(outline, edit) => { set({ outline, levels: levelsForOutline(outline, f.levels) }); if (edit) setEditingNode(edit); }}
            onEdit={setEditingNode} />
        </>
      )}

      {editingLevel !== null && f.levels[editingLevel] ? (
        <LevelSheet level={f.levels[editingLevel]!} last={editingLevel === f.levels.length - 1} bible={bible} onClose={() => setEditingLevel(null)}
          onSave={(l) => { set({ levels: f.levels.map((x, i) => (i === editingLevel ? l : x)) }); setEditingLevel(null); }} />
      ) : null}
      {bookSheetView}
      {addingBook ? (
        <AddBookSheet books={missing} onClose={() => setAddingBook(false)}
          onAdd={(book) => set({ books: [...f.books, { book, name: bookNameOf(book) }] })} />
      ) : null}
      {choosingV11n ? (
        <Sheet visible title={t('content.editor.versification')} sub={t('content.editor.versificationSheetSub')} onClose={() => setChoosingV11n(false)}>
          <SharedOffline error={v.error} empty={v.choices.length === 0} />
          <Group>
            {v.choices.map((c, i) => (
              <HelpRow key={c.key} of="content.versification">
                <Row label={c.name} sub={choiceLine(c, sourceLine)} role="radio" selected={c.hash === f.versification} help={t('content.editor.versificationChoiceHelp')}
                  onPress={() => { set({ versification: c.hash }); setChoosingV11n(false); }} last={i === v.choices.length - 1}
                  right={c.hash === f.versification ? <Ico name="check" size={22} color={C.primary} /> : <View style={{ width: 22 }} />} />
              </HelpRow>
            ))}
          </Group>
        </Sheet>
      ) : null}
      {node ? (
        <NodeSheet node={node} index={nodeSiblings.findIndex((s) => s.id === node.id)} count={nodeSiblings.length} onClose={() => setEditingNode(null)}
          onRename={(title) => set({ outline: renameNode(f.outline, node.id, title) })}
          onMove={(by) => set({ outline: moveNode(f.outline, node.id, by) })}
          onRemove={() => { const outline = removeNode(f.outline, node.id); set({ outline, levels: levelsForOutline(outline, f.levels) }); setEditingNode(null); }} />
      ) : null}
      <RedoSheet visible={redoing} book={booksLine(redone)} busy={busy} onClose={cancelRedo} onConfirm={done} />
    </Screen>
  );
}

/**
 * A level: what the team calls it, and for a Bible template's last level how
 * each part is shown (the demo's LevelSheet). Closing it keeps what was
 * changed, as Done does; an empty name is not kept.
 */
function LevelSheet(props: { level: TemplateForm['levels'][number]; last: boolean; bible: boolean; onClose: () => void; onSave: (l: TemplateForm['levels'][number]) => void }) {
  const [name, setName] = useState(props.level.name);
  const start = defaultDisplay(props.level, props.bible);
  const [display, setDisplay] = useState(start);
  const example = `${bookName('luk')} 15:11–32`;
  const done = () => {
    if (name.trim() && (name.trim() !== props.level.name || display !== start)) props.onSave({ name: name.trim(), ...(props.last ? { display } : {}) });
    else props.onClose();
  };
  return (
    <Sheet visible title={t('content.levelSheet.title')} sub={t('content.levelSheet.sub')} onClose={done}
      footer={<PrimaryBtn label={t('common.done')} disabled={!name.trim()} help={t('content.levelSheet.doneHelp')} onPress={done} />}>
      <Field label={t('content.name')} value={name} onChangeText={setName} placeholder={t('content.levelSheet.placeholder')} autoCapitalize="words" help={t('content.levelSheet.nameHelp')} />
      {props.last && props.bible ? (
        <>
          <Text style={txt.xsStrong}>{t('content.levelSheet.showBy')}</Text>
          <ChipRow>
            <Chip label={t('content.levelSheet.reference')} on={display === 'reference'} help={t('content.levelSheet.referenceHelp', { example })} onPress={() => setDisplay('reference')} />
            <Chip label={t('content.name')} on={display === 'name'} help={t('content.levelSheet.byNameHelp')} onPress={() => setDisplay('name')} />
            <Chip label={t('content.levelSheet.both')} on={display === 'both'} help={t('content.levelSheet.bothHelp')} onPress={() => setDisplay('both')} />
          </ChipRow>
          <Text style={txt.smMuted}>{displayExample(display, example)}</Text>
        </>
      ) : null}
    </Sheet>
  );
}

/** A book: its name in the language, or take it out of the template. Closing it keeps a name changed, as Done does. */
function BookSheet(props: { book: { book: string; name: string }; onClose: () => void; onSave: (name: string) => void; onRemove: () => void }) {
  const [name, setName] = useState(props.book.name);
  const done = () => (name.trim() && name.trim() !== props.book.name ? props.onSave(name.trim()) : props.onClose());
  return (
    <Sheet visible title={bookNameOf(props.book.book)} sub={t('content.bookSheet.sub')} onClose={done}
      footer={<PrimaryBtn label={t('common.done')} disabled={!name.trim()} help={t('content.keepNameHelp')} onPress={done} />}>
      <Field label={t('content.bookSheet.nameLabel')} value={name} onChangeText={setName} placeholder={bookNameOf(props.book.book)} autoCapitalize="words" />
      <GhostBtn label={t('content.bookSheet.remove')} icon="trash" tone="red" help={t('content.bookSheet.removeNote')} onPress={props.onRemove} />
      <Text style={txt.smMuted}>{t('content.bookSheet.removeNote')}</Text>
    </Sheet>
  );
}

/** Books the versification has that the template does not, to add. */
function AddBookSheet(props: { books: string[]; onClose: () => void; onAdd: (book: string) => void }) {
  const [limit, setLimit] = useState(20);
  const [added, setAdded] = useState<string[]>([]);
  const left = props.books.filter((b) => !added.includes(b));
  return (
    <Sheet visible title={t('content.editor.addBook')} sub={t('content.addBook.sub')} onClose={props.onClose}
      footer={<PrimaryBtn label={t('common.done')} help={t('content.addBook.doneHelp')} onPress={props.onClose} />}>
      {left.length === 0 ? <Text style={txt.smMuted}>{t('content.addBook.allIn')}</Text> : (
        <Group>
          {left.slice(0, limit).map((b, i, shown) => (
            <HelpRow key={b} of="content.addBook">
              <Row icon="plus" label={bookNameOf(b)} sub={b} help={t('content.addBook.bookHelp')} onPress={() => { props.onAdd(b); setAdded((a) => [...a, b]); }} last={i === shown.length - 1} />
            </HelpRow>
          ))}
        </Group>
      )}
      <ShowMore remaining={left.length - limit} step={20} onMore={() => setLimit((l) => l + 20)} />
    </Sheet>
  );
}

/**
 * The outline in one scroll (the demo's OutlineScroll): folders are headers
 * and what's recorded sits under them. A folder holds folders or items,
 * never both; a folder of items is what a phone downloads for offline use.
 */
function OutlineScroll(props: {
  outline: TemplateForm['outline']; levels: TemplateForm['levels']; readOnly: boolean;
  onChange: (outline: TemplateForm['outline'], edit?: string) => void; onEdit: (id: string) => void;
}) {
  const levelName = (d: number) => levelNameAt(props.levels, d);

  function add(parentId: string | null, folder: boolean, depth: number) {
    const id = `n${Crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`;
    // Opened straight away so it can be named.
    props.onChange(addNode(props.outline, parentId, { id, title: t('content.outline.newNode', { level: lower(levelName(depth)) }), folder }), id);
  }

  function render(list: TemplateForm['outline'], depth: number, parentId: string | null) {
    const holds = outlineHolds(list);
    return (
      <View style={depth ? styles.outlineIndent : null}>
        {list.map((n) => n.children ? (
          // Each depth is its own kind of row, so a folder inside the first folder speaks too.
          <HelpRow key={n.id} of={`content.outlineFolder${depth}`}>
            <View>
              <OutlineFolder title={n.title} summary={outlineSummary(n.children)} depth={depth} readOnly={props.readOnly} onEdit={() => props.onEdit(n.id)} />
              {render(n.children, depth + 1, n.id)}
            </View>
          </HelpRow>
        ) : (
          <HelpRow key={n.id} of="content.outlineItem">
            <OutlineItem title={n.title} level={levelName(depth)} readOnly={props.readOnly} onEdit={() => props.onEdit(n.id)} />
          </HelpRow>
        ))}
        {!props.readOnly ? (
          <View style={styles.addRow}>
            {holds !== 'items' ? <SmallBtn label={t('content.outline.addFolder', { level: lower(levelName(depth)) })} icon="folder" help={t('content.outline.addFolderHelp')} onPress={() => add(parentId, true, depth)} /> : null}
            {holds !== 'folders' ? <SmallBtn label={t('content.outline.addItem', { level: lower(levelName(depth)) })} icon="media" help={t('content.outline.addItemHelp')} onPress={() => add(parentId, false, depth)} /> : null}
          </View>
        ) : null}
      </View>
    );
  }

  if (props.readOnly && props.outline.length === 0) return <Text style={[txt.smMuted, { paddingHorizontal: space.xs }]}>{t('content.outline.empty')}</Text>;
  return render(props.outline, 0, null);
}

/** A folder of the outline, as a header over what it holds: tap to rename, move or remove it. */
function OutlineFolder(props: { title: string; summary: string; depth: number; readOnly: boolean; onEdit: () => void }) {
  const spot = useHelpSpot(props.title, t('content.outline.folderHelp'), props.readOnly ? undefined : props.onEdit);
  return (
    <Pressable disabled={props.readOnly} onPress={spot.onPress} accessibilityRole="button" accessibilityLabel={t('content.outline.editLabel', { name: props.title })}
      style={({ pressed }) => [styles.outlineHead, pressed && { opacity: 0.7 }]}>
      <Ico name="folder" size={props.depth ? 18 : 22} color={C.primary} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[props.depth ? txt.body : txt.h3, { fontWeight: '700' }]} numberOfLines={1}>{props.title}</Text>
        <Text style={txt.smMuted}>{props.summary}</Text>
      </View>
      {!props.readOnly ? <Ico name="edit" size={20} color={C.muted} /> : null}
      <HelpBadge spot={spot} />
    </Pressable>
  );
}

/** Something people record, in the outline: tap to rename, move or remove it. */
function OutlineItem(props: { title: string; level: string; readOnly: boolean; onEdit: () => void }) {
  const spot = useHelpSpot(props.title, t('content.outline.itemHelp'), props.readOnly ? undefined : props.onEdit);
  return (
    <Pressable disabled={props.readOnly} onPress={spot.onPress} accessibilityRole="button" accessibilityLabel={t('content.outline.editLabel', { name: props.title })}
      style={({ pressed }) => [styles.outlineItem, pressed && { opacity: 0.7 }]}>
      <View style={[styles.tile, { backgroundColor: TINT.green }]}><Ico name="media" size={20} color={TINT.greenText} /></View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[txt.body, { fontWeight: '600' }]} numberOfLines={1}>{props.title}</Text>
        <Text style={txt.smMuted}>{props.level}</Text>
      </View>
      {!props.readOnly ? <Ico name="edit" size={20} color={C.muted} /> : null}
      <HelpBadge spot={spot} />
    </Pressable>
  );
}

/** One part of the outline: rename, move, or remove it (the demo's NodeSheet). */
function NodeSheet(props: {
  node: TemplateForm['outline'][number]; index: number; count: number;
  onClose: () => void; onRename: (title: string) => void; onMove: (by: number) => void; onRemove: () => void;
}) {
  const [title, setTitle] = useState(props.node.title);
  const folder = !!props.node.children;
  const done = () => {
    const renamed = renamedTitle(title, props.node.title);
    if (renamed) props.onRename(renamed);
    props.onClose();
  };
  return (
    <Sheet visible title={folder ? t('content.node.folder') : t('content.node.item')} sub={folder ? t('content.node.folderSub') : t('content.node.itemSub')} onClose={done}
      footer={<PrimaryBtn label={t('common.done')} disabled={!title.trim()} help={t('content.keepNameHelp')} onPress={done} />}>
      <Field label={t('content.name')} value={title} onChangeText={setTitle} placeholder={t('content.name')} autoCapitalize="sentences" help={t('content.node.nameHelp')} />
      <View style={styles.pair}>
        <View style={{ flex: 1 }}><GhostBtn label={t('content.node.moveUp')} icon="up" disabled={props.index <= 0} help={t('content.node.moveUpHelp')} onPress={() => props.onMove(-1)} /></View>
        <View style={{ flex: 1 }}><GhostBtn label={t('content.node.moveDown')} icon="down" disabled={props.index >= props.count - 1} help={t('content.node.moveDownHelp')} onPress={() => props.onMove(1)} /></View>
      </View>
      <GhostBtn label={folder ? t('content.node.removeFolder') : t('content.node.removeItem')} icon="trash" tone="red" help={t('content.node.removeNote')} onPress={props.onRemove} />
      <Text style={txt.smMuted}>{t('content.node.removeNote')}</Text>
    </Sheet>
  );
}

// ---- Divide a Book ------------------------------------------------------------------------------

export function BookStructure(ctx: Ctx) {
  const state = ctx.language.state;
  const languageId = ctx.params['languageId'] ?? ctx.languageId;
  const bookId = ctx.params['bookId'];
  const book = bookId ? bibleBook(bookId) : undefined;
  const list = useRef<FlatList<number>>(null);
  const [picking, setPicking] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [own, setOwn] = useState(false);
  const canShape = ctx.session.can('shape_templates') || ctx.session.can('manage_templates');
  // Breaking up a book changes the language's template: coordinators and admins (decision 74). It publishes a
  // version of the template in the organization's library, so it needs organization scope (`mayWriteLibrary`).
  const canBreak = mayWriteLibrary(ctx.org.state, ctx.session.actorId, 'template');
  const open = isOpen(ctx, languageId);
  const sel = state && open ? templateOf(state) : null;
  const docs = useLibraryDocs(ctx.language.orgId, [sel?.docHash]);
  const doc = sel ? docs.get<TemplateDoc>(sel.docHash) : null;
  const v11n = doc?.bible ? docs.get<VersificationDoc>(doc.bible.versification) : null;
  const usfmCode = book ? usfmOf(book.itemId) : '';
  // The words in a Bible the team has, as the own-way editor reads them, where the app has none of its own (decision 107).
  const bookText = useBookText(ctx, usfmCode, v11n?.maxVerses[usfmCode] ?? book?.verses ?? NO_VERSES);

  const data = useMemo(() => {
    if (!state || !open || !book) return null;
    return bookStructureData(state, indexesFor(state), book, ctx.org.state, languageId!);
  }, [state, open, languageId, book, ctx.org.state]);
  const textOf = useCallback((c: number, v: number) => data?.textOf(c, v) ?? (bookText.byAt.get(atOf(c, v)) || undefined), [data, bookText.byAt]);
  const sourceName = bookText.option ? sourceChip(bookText.option, bookText.options) : undefined;

  if (!state) return <Loading title={t('content.book.title')} onBack={ctx.back} />;
  if (!book || !data || !languageId) {
    return (
      <Screen header={<Header title={t('content.book.title')} onBack={ctx.back} />}>
        <EmptyState icon="book" title={t('content.book.chooseBook')} sub={t('content.book.chooseBookSub')} />
      </Screen>
    );
  }
  const usfm = usfmOf(book.itemId);
  const item = sel ? libraryItemView(ctx.org.state?.library ?? {}, sel.itemId) : null;
  const templateName = templateBookName(doc, usfm, bookName(book.itemId));
  // Not broken up yet, or Break up differently: the ways to choose from (decision 74).
  if (doc?.bible && canBreak && (choosing || data.segments.length === 0)) {
    // Dividing it your own way: the book's text, where other Bibles start sections, and its helps (decision 93).
    if (own) {
      return (
        <DivideOwnWay ctx={ctx} book={usfm} bookName={data.label} doc={doc} v11n={v11n} fallbackVerses={book.verses} item={item} redo={data.segments.length > 0}
          onClose={() => setOwn(false)} onDone={() => { setOwn(false); setChoosing(false); }} />
      );
    }
    return (
      <BreakUpBook ctx={ctx} book={usfm} bookName={data.label} language={data.language} doc={doc} item={item} redo={data.segments.length > 0}
        onClose={() => (choosing ? setChoosing(false) : ctx.back())} onOwn={() => setOwn(true)} />
    );
  }
  const words = partWords(doc);
  const part = words.one;
  const parts = lower(words.many);
  const chapters = chapterNumbers(book);
  const fia = canShape ? data.fia : new Set<number>();
  const jump = (c: number) => list.current?.scrollToIndex({ index: c - 1, animated: true });

  return (
    <Screen fixed header={<Header title={data.label} sub={`${data.language} · ${partsCount(data.segments.length, words)}`} onBack={ctx.back} />}>
      <View style={styles.jumpBar}>
        <ChipRow>
          <Chip label={t('content.book.chapterChip')} icon="down" on help={t('content.book.chapterChipHelp')} onPress={() => setPicking(true)} />
          {data.segments.map((s) => (
            <HelpRow key={s.unitId} of="content.segment">
              <Chip label={chipLabel(book, s)} on={false} help={t('content.book.segmentHelp', { part: lower(part) })} onPress={() => jump(s.from.c)} />
            </HelpRow>
          ))}
        </ChipRow>
      </View>
      <FlatList
        ref={list}
        data={chapters}
        keyExtractor={(c) => String(c)}
        initialNumToRender={2}
        windowSize={5}
        contentContainerStyle={{ paddingBottom: space.xxl }}
        onScrollToIndexFailed={(info) => {
          list.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false });
          setTimeout(() => list.current?.scrollToIndex({ index: info.index, animated: false }), 120);
        }}
        ListHeaderComponent={
          <View style={{ padding: space.lg, gap: space.md }}>
            {doc?.bible ? (
              <BookHead ctx={ctx} book={usfm} templateName={templateName} language={data.language} doc={doc} v11n={v11n} canShape={canBreak}
                onChange={() => setChoosing(true)} />
            ) : null}
            {data.segments.length === 0 ? (
              <Text style={txt.smMuted}>{canBreak ? t('content.book.noParts', { language: data.language, parts, book: data.label }) : t('content.book.coordinatorBreaks', { book: data.label })}</Text>
            ) : null}
          </View>
        }
        renderItem={({ item: c }) => (
          <ChapterView book={book} c={c} segments={data.segments} fia={fia} text={textOf} part={part}
            translation={data.translation.get(c) ?? sourceName} recorded={data.recorded} />
        )}
      />
      <Sheet visible={picking} title={data.label} sub={t('content.book.jump')} onClose={() => setPicking(false)}>
        <View style={styles.grid}>
          {chapters.map((c) => (
            <HelpRow key={c} of="content.chapterTile">
              <ChapterTile c={c} n={partsStartingIn(data.segments, c)} part={part} parts={parts} onPress={() => { setPicking(false); jump(c); }} />
            </HelpRow>
          ))}
        </View>
      </Sheet>
    </Screen>
  );
}

/** A chapter in the jump sheet: its number, and how many parts start in it when more than one. */
function ChapterTile(props: { c: number; n: number; part: string; parts: string; onPress: () => void }) {
  const label = chapterTileLabel(props.c, props.n, props.part, props.parts);
  const spot = useHelpSpot(label, props.n > 1 ? t('content.book.tileCountHelp', { parts: props.parts }) : t('content.book.tileHelp'), props.onPress);
  return (
    <Pressable onPress={spot.onPress} accessibilityRole="button" accessibilityLabel={label}
      style={({ pressed }) => [styles.chapterTile, pressed && { opacity: 0.7 }]}>
      <Text style={[txt.h3, { fontVariant: ['tabular-nums'] }]}>{props.c}</Text>
      {props.n > 1 ? <Text style={txt.xsStrong}>{props.n}</Text> : null}
      <HelpBadge spot={spot} />
    </Pressable>
  );
}

/** One chapter read like a Bible: cards where parts start, FIA's suggestions, gaps, and the verses (ADR-027). */
function ChapterView(props: {
  book: BibleBook; c: number; segments: Segment[]; fia: Set<number>; text: (c: number, v: number) => string | undefined;
  part: string; translation?: string; recorded: Set<string>;
}) {
  const { book, c, part } = props;
  const blocks = useMemo(() => chapterBlocks(book, c, props.segments, props.fia, props.text), [book, c, props.segments, props.fia, props.text]);
  const continues = continuesInto(props.segments, c);
  return (
    <View style={{ paddingHorizontal: space.lg }}>
      <Text style={[txt.label, styles.chapterHead]}>
        {t('content.book.chapter', { chapter: c })}
        {props.translation ? <Text style={txt.xs}> · {props.translation}</Text> : null}
        {continues ? <Text style={txt.xs}> · {t('content.book.continues', { part: lower(part), verses: versesText(continues) })}</Text> : null}
      </Text>
      {blocks.map((b, i) => <BlockView key={i} block={b} c={c} part={part} recorded={props.recorded} />)}
    </View>
  );
}

function BlockView(props: { block: Block; c: number; part: string; recorded: Set<string> }) {
  const b = props.block;
  const part = lower(props.part);
  if (b.kind === 'card') {
    const recorded = props.recorded.has(b.seg.unitId);
    return (
      <View style={styles.passageCard} accessibilityLabel={t(recorded ? 'content.block.cardLabelRecorded' : 'content.block.cardLabel', { part: props.part, n: b.n, verses: versesText(b.seg) })}>
        <View style={styles.tile}><Ico name="media" size={22} color={C.primary} /></View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[txt.body, { fontWeight: '700' }]}>{props.part} {versesText(b.seg)}</Text>
          <View style={styles.cardSub}>
            {recorded ? <Ico name="check" size={14} color={TINT.greenText} /> : null}
            <Text style={[txt.sm, { color: recorded ? TINT.greenText : C.muted }]}>{recorded ? t('content.block.recorded') : t('content.block.notRecorded')}</Text>
          </View>
        </View>
      </View>
    );
  }
  if (b.kind === 'fia') {
    return (
      <View style={styles.fia}>
        <Ico name="cut" size={16} color={C.muted} />
        <Text style={[txt.sm, { color: C.muted, flex: 1 }]}>{t('content.block.fiaStarts', { chapter: b.at.c, verse: b.at.v })}</Text>
      </View>
    );
  }
  if (b.kind === 'gap') {
    return (
      <Text style={[txt.sm, styles.gap]}>{t('content.block.gap', { verse: b.from, part })}</Text>
    );
  }
  return (
    <Text style={[styles.para, { borderLeftColor: b.seg ? (b.n % 2 ? C.primary : C.soft) : C.border }]}>
      {b.verses.map((v) => (
        <Text key={v.v} accessibilityLabel={t('content.block.verseLabel', { chapter: props.c, verse: v.v })}>
          <Text style={styles.verseNo}>{v.v} </Text>
          {v.text ?? <Text style={{ color: C.muted }}>{t('content.block.versePlaceholder', { verse: v.v })}</Text>}{' '}
        </Text>
      ))}
    </Text>
  );
}

const styles = StyleSheet.create({
  levels: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.xs },
  level: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  tile: { width: tile.sm, height: tile.sm, borderRadius: 14, backgroundColor: C.light, alignItems: 'center', justifyContent: 'center' },
  cardActions: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  pair: { flexDirection: 'row', gap: space.sm },
  outlineIndent: { marginLeft: space.lg, paddingLeft: space.md, borderLeftWidth: 2, borderColor: C.border },
  outlineHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: target.min, paddingTop: space.sm },
  outlineItem: {
    flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: target.row, marginTop: space.sm,
    paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.lg, borderWidth: 1, borderColor: C.border, backgroundColor: C.card
  },
  addRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, paddingTop: space.sm },
  jumpBar: { backgroundColor: C.card, paddingHorizontal: space.md, paddingVertical: space.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: C.border },
  chapterHead: { paddingTop: space.xl, paddingBottom: space.xs, paddingHorizontal: space.xs },
  passageCard: {
    flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: target.row, marginTop: space.sm, marginBottom: space.xs,
    paddingHorizontal: space.lg, paddingVertical: space.md, borderRadius: radius.lg, borderWidth: 1.5, borderColor: C.border, backgroundColor: C.card
  },
  cardSub: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  fia: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: target.min, marginVertical: space.xs,
    paddingHorizontal: space.md, borderRadius: radius.md, borderWidth: 1.5, borderStyle: 'dashed', borderColor: C.border
  },
  gap: { marginTop: space.sm, paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.md, backgroundColor: TINT.gray, color: TINT.grayText },
  para: { fontSize: T.base, lineHeight: 30, color: C.dark, paddingLeft: space.md, paddingVertical: space.xs, borderLeftWidth: 3 },
  verseNo: { fontSize: T.xs, fontWeight: '700', color: C.primary },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chapterTile: {
    width: target.primary, height: target.primary, borderRadius: radius.lg, borderWidth: 1.5, borderColor: C.border, backgroundColor: C.card,
    alignItems: 'center', justifyContent: 'center'
  }
});

export const contracts = contractsFor('templates_home', 'template_picker', 'template_editor', 'book_structure');
