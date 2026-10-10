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
// (library/follow.ts). Dividing books into passages (TPL-4..7), drafts and
// template tasks need events that do not exist yet: book_structure reads.
//
// Below the organization there are only languages (docs/decisions.md 63).
// templates_home params: `level` ('org' | 'language') and/or `languageId`.
// template_picker: `languageId`. template_editor: `itemId` (a library
// template), `new` (start one), or `languageId` (that language's template).
// book_structure: `languageId`, `bookId`. A `languageId` param opens that
// language, so its state is the open language's.
import {
  chaptersInBook, derivePassage, languageName, languageProgress, libraryItemView, usfmOf,
  type LevelDisplay, type LibraryItemView, type TemplateDoc, type VersificationDoc
} from '@langquest-next/core';
import { BookHead, BreakUpBook, templateBookName } from '../breakup/BreakUpBook';
import { useMemo, useRef, useState } from 'react';
import * as Crypto from 'expo-crypto';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  bibleBook, bookNameOf, bookRows, bookSegments, chapterBlocks, chipLabel, choiceLine, continuesInto, countOutline, addNode, docFromForm,
  docLevels, fiaStarts, formChanged, formFromDoc, levelsForDivide,
  levelsForOutline, libraryChoices, moveNode, newTemplateForm, partWords, recordedCount, removeNode, renameNode,
  setAsideCount, siblingsOf, findNode, STARTER_TEMPLATE, templateLine, templateOf, versesText, versificationBooks, versionNumber,
  type BibleBook, type Block, type LibraryChoice, type Segment, type TemplateForm
} from '../contentTemplates';
import { bookName } from '../coreText';
import type { Ctx } from '../ctx';
import { t } from '../i18n';
import { indexesFor } from '../indexes';
import {
  Banner, Card, Chip, ChipRow, Disclosure, EmptyState, Field, GhostBtn, Group, Header, Ico, PrimaryBtn, Row, Screen, SearchField,
  SectionLabel, SmallBtn, Sheet, ShowMore, Toggle, txt, useOpenDetail
} from '../kit';
import { loadDocs } from '../library/docStore';
import { sourceLine, usesItem, type SharedItem } from '../library/model';
import { useLibrary, useLibraryDocs, useLibraryUpdates, useSharedItems } from '../library/useLibrary';
import { failureMessage } from '../report';
import { readingsFor } from '../scripture';
import { contractsFor } from '../screenContracts';
import { C, radius, space, target, tile, TINT, type as T } from '../theme';

/**
 * What to say when something fails (error-tracking): a command's own reason,
 * or, for a fault, a code a tester can read out, having reported it.
 */
const failure = failureMessage;

const lower = (s: string) => s.toLowerCase();

/** "Dinka", "Dinka and Nuer", "Dinka, Nuer and Shilluk". */
function joinNames(names: string[]): string {
  return names.length <= 1 ? names.join('') : t('content.list.and', { items: names.slice(0, -1).join(t('content.list.separator')), last: names.at(-1) });
}

/** "Dinka moves to it by itself." / "Dinka and Nuer move to it by themselves." */
function movesLine(names: string[]): string {
  if (names.length === 0) return '';
  return t('content.moves', { count: names.length, names: joinNames(names) });
}

/** "12 passages", "1 story": a count of what a language records, in the template's word for it. */
function partsCount(count: number, words: { one: string; many: string }): string {
  return t('content.partsCount', { count, part: lower(words.one), parts: lower(words.many) });
}

type Level = 'org' | 'language';
type Lib = ReturnType<typeof useLibrary>;

/** Which view of templates this is: the level from params, else the viewer's own scope (ADR-017). */
function levelOf(ctx: Ctx): { level: Level; languageId: string | null } {
  const level = ctx.params['level'];
  const languageParam = ctx.params['languageId'];
  if (level === 'org') return { level: 'org', languageId: null };
  if (level === 'language' || languageParam) return { level: 'language', languageId: languageParam ?? ctx.languageId };
  const scope = ctx.session.adminScope;
  if (scope?.level === 'org') return { level: 'org', languageId: null };
  return { level: 'language', languageId: scope?.languageId ?? ctx.languageId };
}

/** Is this the open language (whose state the screen reads)? */
function isOpen(ctx: Ctx, languageId: string | null | undefined): languageId is string {
  return !!languageId && languageId === ctx.language.languageId;
}

/** The languages using a template: the open one, when it does (other languages' choices are in their own logs). */
function usersOf(ctx: Ctx, itemId: string): string[] {
  return usesItem(ctx.language.state, itemId) ? [languageName(ctx.org.state, ctx.language.languageId)] : [];
}

function orgName(ctx: Ctx): string {
  return ctx.org.state?.org?.value.name ?? t('content.orgFallback');
}

/** Book › Chapter › Passage: folders, then what's recorded (TPL-2). */
function LevelsLine(props: { levels: string[] }) {
  return (
    <View style={styles.levels} accessibilityLabel={t('content.levelsLabel', { levels: props.levels.join(t('content.list.separator')) })}>
      {props.levels.map((l, i) => (
        <View key={`${l}-${i}`} style={styles.level}>
          {i > 0 ? <Ico name="right" size={14} color={C.muted} /> : null}
          <Ico name={i === props.levels.length - 1 ? 'media' : 'folder'} size={16} color={C.primary} />
          <Text style={[txt.sm, { color: C.primary, fontWeight: '700' }]}>{l}</Text>
        </View>
      ))}
    </View>
  );
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

/** Run one library action: busy while it runs, and "Not saved" with the reason when it fails. */
function useRunner(ctx: Ctx) {
  const [busy, setBusy] = useState(false);
  async function run(what: string, fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      ctx.toast(t('common.notSaved', { reason: failure(what, e) }));
    } finally {
      setBusy(false);
    }
  }
  return { busy, run };
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
  const canManage = ctx.session.can('manage_templates');
  const all = lib.items('template');
  const active = all.filter((i) => !i.archived);
  const archived = all.filter((i) => i.archived);
  const shared = useSharedItems('template', lib.orgId);
  const others = useMemo(() => libraryChoices(library ?? {}, [], shared.rows, STARTER_TEMPLATE.name), [library, shared.rows]);
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
    const users = usersOf(ctx, it.itemId);
    const update = it.source === 'subscription' && it.subscription?.active && !it.subscription.autoUpdate ? updates[it.itemId] : undefined;
    return (
      <Card key={it.itemId} current={beside?.screen === 'template_editor' && beside.params['itemId'] === it.itemId}>
        <View style={styles.head}>
          <View style={styles.tile}><Ico name={doc?.structure === 'outline' ? 'folder' : 'book'} size={22} color={C.primary} /></View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={txt.h3}>{it.name}</Text>
            <Text style={[txt.sm, { fontWeight: '600', color: C.primary }]}>{sourceLine(it)}</Text>
            {it.description ? <Text style={[txt.smMuted, { marginTop: 2 }]}>{it.description}</Text> : null}
          </View>
        </View>
        {doc ? <LevelsLine levels={docLevels(doc)} /> : <LoadingLine />}
        <Text style={[txt.sm, { fontWeight: '600', color: users.length ? C.primary : C.muted }]}>
          {users.length ? t('content.library.usedBy', { names: joinNames(users) }) : t('content.library.notUsedHere')}
        </Text>
        {update ? <Text style={[txt.sm, { color: TINT.amberText }]}>{t('content.newerVersion', { org: it.subscription!.sourceOrgName })}</Text> : null}
        <View style={styles.cardActions}>
          {canManage ? <SmallBtn label={t('content.library.options')} icon="settings" onPress={() => setOptions(it.itemId)} /> : null}
          <View style={{ flex: 1 }} />
          <SmallBtn label={canManage && it.source !== 'subscription' ? t('common.edit') : t('content.library.view')} icon="right" onPress={() => ctx.go('template_editor', { itemId: it.itemId })} />
        </View>
      </Card>
    );
  };

  return (
    <Screen header={<Header title={t('content.library.title')} sub={scopeName} onBack={ctx.back}
      action={canManage ? <SmallBtn label={t('content.library.addTemplate')} icon="plus" tone="primary" onPress={() => ctx.go('template_editor', { new: '1' })} /> : undefined} />}>
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
          open={archivedOpen.open} onToggle={archivedOpen.onToggle}>
          {archived.map((it, i) => (
            <Row key={it.itemId} icon="template" iconColor={C.muted} iconBg={C.bg} label={it.name} sub={sourceLine(it)} muted
              onPress={canManage ? () => setOptions(it.itemId) : () => ctx.go('template_editor', { itemId: it.itemId })} last={i === archived.length - 1} />
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
          <Card key={c.key} onPress={() => setBrowsing(c.shared)} accessibilityLabel={t('content.library.sharedLabel', { name: c.name, org: c.shared.org_name })}>
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
              <Row key={l.languageId} icon="globe" iconColor={C.muted} iconBg={C.bg} label={l.name}
                sub={state && isOpen(ctx, l.languageId) ? templateLine(state, lib.item) : t('content.library.openToSee')}
                onPress={() => ctx.go('templates_home', { level: 'language', languageId: l.languageId })} last={i === shown.length - 1} />
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
    const before = { shared: it.shared, subscribable: it.subscribable };
    await lib.setSharing(it, shared, subscribable);
    ctx.toast(message, () => run('undo template sharing', async () => { // i18n-ignore: log label
      await lib.setSharing(it, before.shared, before.subscribable);
      ctx.toast(t('common.undone'));
    }));
  });

  if (sub) {
    return (
      <Sheet visible title={it.name} sub={sourceLine(it)} onClose={onClose}>
        {sub.active ? (
          <Group>
            <Row label={t('content.options.autoUpdate')} sub={t('content.options.autoUpdateSub', { org: sub.sourceOrgName })} last
              right={<Toggle on={sub.autoUpdate} disabled={busy} label={t('content.options.autoUpdate')}
                onToggle={() => void run('template updates', async () => { // i18n-ignore: log label
                  const auto = !sub.autoUpdate;
                  await lib.follow(it.itemId, { autoUpdate: auto });
                  ctx.toast(auto ? t('content.options.autoOn', { name: it.name }) : t('content.options.autoOff', { name: it.name }), () => run('undo template updates', async () => { // i18n-ignore: log label
                    await lib.follow(it.itemId, { autoUpdate: !auto });
                    ctx.toast(t('common.undone'));
                  }));
                })} />} />
          </Group>
        ) : null}
        {props.update ? (
          <GhostBtn label={t('content.options.takeUpdate')} icon="download" disabled={busy} onPress={() => void run('take template update', async () => { // i18n-ignore: log label
            await lib.takeUpdate(it, props.update!);
            onClose();
            ctx.toast(t('content.options.updated', { name: it.name }));
          })} />
        ) : null}
        {sub.active ? (
          <GhostBtn label={t('content.options.stopFollowing')} icon="close" disabled={busy} onPress={() => void run('stop following template', async () => { // i18n-ignore: log label
            await lib.follow(it.itemId, { active: false });
            onClose();
            ctx.toast(t('content.options.stoppedFollowing', { name: it.name }), () => run('undo stop following', async () => { // i18n-ignore: log label
              await lib.follow(it.itemId, { active: true });
              ctx.toast(t('common.undone'));
            }));
          })} />
        ) : null}
        <GhostBtn label={t('content.options.copyToChange')} icon="edit" disabled={busy} onPress={() => void run('copy template', async () => { // i18n-ignore: log label
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
          right={<Toggle on={it.shared} disabled={busy} label={t('content.options.share')}
            onToggle={() => void setSharing(!it.shared, it.subscribable, it.shared ? t('content.options.unshared', { name: it.name }) : t('content.options.shared', { name: it.name }))} />} />
        {it.shared ? (
          <Row label={t('content.options.letFollow')} sub={t('content.options.letFollowSub')} last
            right={<Toggle on={it.subscribable} disabled={busy} label={t('content.options.letFollow')}
              onToggle={() => void setSharing(true, !it.subscribable, it.subscribable ? t('content.options.followOff') : t('content.options.followOn'))} />} />
        ) : null}
      </Group>
      <GhostBtn label={it.archived ? t('content.options.unarchive') : t('content.options.archive')} icon="history" disabled={busy} onPress={() => void run('archive template', async () => { // i18n-ignore: log label
        const archived = !it.archived;
        await lib.archive(it, archived);
        onClose();
        ctx.toast(archived ? t('content.options.archivedToast', { name: it.name }) : t('content.options.unarchivedToast', { name: it.name }), () => run('undo archive', async () => { // i18n-ignore: log label
          await lib.archive(it, !archived);
          ctx.toast(t('common.undone'));
        }));
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
    const itemId = await lib.subscribe(s, auto);
    onClose();
    ctx.toast(t('content.shared.followingToast', { name: s.name, org: s.org_name }), () => run('undo follow', async () => { // i18n-ignore: log label
      await lib.follow(itemId, { active: false });
      ctx.toast(t('common.undone'));
    }));
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

/** "Version 2 · from LangQuest", "Version 3 · copied from LangQuest", "from LangQuest", or nothing. */
function versionLineOf(n: number | null, item: LibraryItemView | null): string {
  const sub = item?.subscription ? item.subscription.sourceOrgName : null;
  const copied = item?.copiedFrom ? item.copiedFrom.orgName : null;
  if (n) {
    if (sub !== null) return t('content.language.versionFrom', { n, org: sub });
    if (copied !== null) return t('content.language.versionCopied', { n, org: copied });
    return t('content.language.version', { n });
  }
  if (sub !== null) return t('content.language.from', { org: sub });
  if (copied !== null) return t('content.language.copied', { org: copied });
  return '';
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
      books: bookRows(state, idx),
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
  const canShape = ctx.session.can('shape_templates') || canManage;
  const item = sel ? lib.item(sel.itemId) : null;
  const doc = docs.get<TemplateDoc>(sel?.docHash);
  const v11n = doc?.bible ? docs.get<VersificationDoc>(doc.bible.versification) : null;
  const levels = doc ? docLevels(doc) : [];
  const words = partWords(doc);
  const q = query.trim().toLowerCase();
  const books = data.books.filter((b) => !q || [b.label, bookName(b.book.itemId), b.book.label].some((name) => name.toLowerCase().includes(q)));
  const n = versionNumber(item, sel?.docHash);
  const versionLine = versionLineOf(n, item);
  const newer = item?.current && sel && item.current !== sel.docHash ? versionNumber(item, item.current) : null;
  const update = item?.subscription?.active && !item.subscription.autoUpdate ? updates[item.itemId] : undefined;

  return (
    <Screen header={<Header title={t('content.language.title')} sub={data.language} onBack={ctx.back} />}>
      {sel ? (
        <Card>
          <View>
            <Text style={txt.label}>{t('content.language.recordsAgainst', { language: data.language })}</Text>
            <Text style={[txt.h2, { marginTop: space.xs }]}>{item?.name ?? doc?.name ?? t('content.language.itsTemplate')}</Text>
            <Text style={[txt.smMuted, { marginTop: 2 }]}>{versionLine}</Text>
          </View>
          {!doc ? <LoadingLine /> : <LevelsLine levels={levels} />}
          {doc?.bible ? (
            <Text style={txt.sm}>
              {[
                sel?.books
                  ? t('content.language.booksOfIts', { chosen: sel.books.length, count: doc.bible.books.length })
                  : t('content.books', { count: doc.bible.books.length }),
                v11n ? t('content.language.versification', { name: v11n.name }) : t('content.language.versificationLoading')
              ].join(' · ')}
            </Text>
          ) : null}
          <Text style={txt.sm}>
            {[
              ...(data.books.length && !doc?.bible ? [t('content.books', { count: data.books.length })] : []),
              partsCount(data.progress.total, words),
              t('content.language.recorded', { count: data.progress.recorded })
            ].join(' · ')}
          </Text>
          {newer ? (
            <Text style={[txt.sm, { color: C.primary, fontWeight: '600' }]}>{t('content.language.newerOut', { n: newer, language: data.language })}</Text>
          ) : update ? (
            <>
              <Text style={[txt.sm, { color: TINT.amberText }]}>{t('content.newerVersion', { org: item!.subscription!.sourceOrgName })}</Text>
              {canManage ? (
                <SmallBtn label={t('content.options.takeUpdate')} icon="download" disabled={busy} onPress={() => void run('take template update', async () => { // i18n-ignore: log label
                  await lib.takeUpdate(item!, update);
                  ctx.toast(t('content.language.movesToNew', { language: data.language, name: item!.name }));
                })} />
              ) : null}
            </>
          ) : null}
          {canManage ? (
            <View style={{ gap: space.sm }}>
              <GhostBtn label={item && item.source !== 'subscription' ? t('content.language.editTemplate') : t('content.language.viewTemplate')} icon="edit"
                onPress={() => ctx.go('template_editor', { itemId: sel.itemId })} />
              <GhostBtn label={t('content.language.changeTemplate')} icon="swap" onPress={() => ctx.go('template_picker', { languageId })} />
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
                <Row key={b.book.itemId} icon="book" label={b.label} sub={partsCount(b.parts, words)}
                  onPress={() => ctx.go('book_structure', { languageId, bookId: b.book.itemId })} last={i === shown.length - 1} />
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
  const library = ctx.org.state?.library;
  const shared = useSharedItems('template', lib.orgId);
  const choices = useMemo(() => libraryChoices(library ?? {}, lib.items('template'), shared.rows, STARTER_TEMPLATE.name), [library, lib.items, shared.rows]);
  const ours = choices.filter((c) => c.source === 'ours');
  const others = choices.filter((c) => c.source === 'shared');
  const [picked, setPicked] = useState<string | null>(null);
  const [sharedLimit, setSharedLimit] = useState(5);
  const [busy, setBusy] = useState(false);
  const open = isOpen(ctx, languageId);
  const sel = state && open ? templateOf(state) : null;
  const pick = choices.find((c) => c.key === picked);
  const docs = useLibraryDocs(lib.orgId, [pick?.hash, sel?.docHash]);
  const recorded = useMemo(() => (state && open ? recordedCount(state) : 0), [state, open]);
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
  const inUse = (c: LibraryChoice) => !!sel && c.source === 'ours' && c.item.itemId === sel.itemId;
  const currentDoc = sel ? docs.get<TemplateDoc>(sel.docHash) : null;
  const currentParts = lower(partWords(currentDoc).many);

  async function use(c: LibraryChoice) {
    if (!state || busy || !canUse) return;
    setBusy(true);
    try {
      const prev = state.template?.value;
      const books = prev?.books;
      // Undo re-applies the version used before, worked out now (none when that version's document is not on the phone).
      const undo = prev?.itemId && prev.docHash
        ? await lib.applySpecs(prev.itemId, { docHash: prev.docHash, ...(books ? { books } : {}) }).catch(() => null)
        : null;
      // Another organization's template is followed, with automatic updates, before it is used.
      const itemId = c.source === 'shared' ? await lib.subscribe(c.shared, true) : c.item.itemId;
      const specs = await lib.applySpecs(itemId, { docHash: c.hash, ...(books ? { books } : {}) });
      // ctx.act says "Not saved" and why itself; stay here to try again.
      try {
        await ctx.act(specs, t('content.picker.nowUses', { language, name: c.name }), undo ? () => undo : undefined);
      } catch { return; }
      ctx.go('templates_home', { languageId });
    } catch (e) {
      ctx.toast(failure('use template', e));
    } finally {
      setBusy(false);
    }
  }

  const card = (c: LibraryChoice) => {
    const on = picked === c.key;
    const used = inUse(c);
    const doc = on ? docs.get<TemplateDoc>(c.hash) : null;
    const description = c.source === 'ours' ? c.item.description : c.shared.description;
    return (
      <Card key={c.key} onPress={() => setPicked(on ? null : c.key)} accessibilityLabel={used ? t('content.picker.inUseLabel', { name: c.name }) : c.name}
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
    );
  };

  const changing = !!pick && !inUse(pick);
  return (
    <Screen
      header={<Header title={t('content.picker.title')}
        sub={currentName ? t('content.picker.forNow', { language, template: currentName }) : t('content.picker.for', { language })} onBack={ctx.back} />}
      footer={changing && pick ? (
        <>
          <Text style={txt.smMuted}>
            {sel
              ? recorded
                ? t('content.picker.hiddenRecorded', { language, parts: currentParts, count: recorded })
                : t('content.picker.hidden', { language, parts: currentParts })
              : t('content.picker.willRecord', { language, name: pick.name })}
            {pick.source === 'shared' ? ` ${t('content.picker.followsIt', { org: pick.shared.org_name, language })}` : ''}
          </Text>
          <PrimaryBtn label={t('content.picker.use', { name: pick.name })} icon="check" busy={busy} disabled={!canUse} onPress={() => void use(pick)} />
        </>
      ) : undefined}>
      <SectionLabel label={t('content.sections.yourOrganization')} />
      {ours.length === 0 ? (
        <Text style={[txt.smMuted, { paddingHorizontal: space.xs }]}>{t('content.picker.noneOurs')}</Text>
      ) : ours.map(card)}
      <SectionLabel label={t('content.sections.fromOthers')} />
      <SharedOffline error={shared.error} empty={shared.rows.length === 0} />
      {others.slice(0, sharedLimit).map(card)}
      <ShowMore remaining={others.length - sharedLimit} step={5} onMore={() => setSharedLimit((l) => l + 5)} />
    </Screen>
  );
}

// ---- Template editor (TPL-9) -------------------------------------------------------------------

/** What a level is for: the last is recorded (and how each is shown), the one above holds it, the rest hold folders. */
function levelSub(i: number, count: number, display?: LevelDisplay): string {
  if (i < count - 1) return i === count - 2 ? t('content.editor.levelHolds') : t('content.editor.levelFolders');
  switch (display ?? 'reference') {
    case 'reference': return t('content.editor.levelShownByReference');
    case 'name': return t('content.editor.levelShownByName');
    case 'both': return t('content.editor.levelShownByBoth');
  }
}

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

/** One of the organization's templates, opened once its document is on the phone. */
function LibraryTemplate({ ctx, itemId }: { ctx: Ctx; itemId: string }) {
  const lib = useLibrary(ctx);
  const item = lib.item(itemId);
  const docs = useLibraryDocs(lib.orgId, [item?.current]);
  const doc = docs.get<TemplateDoc>(item?.current);
  if (!item || item.kind !== 'template') {
    return (
      <Screen header={<Header title={t('content.editor.outlineTitle')} onBack={ctx.back} />}>
        <EmptyState icon="template" title={t('content.editor.notFound')} sub={t('content.editor.notInLibrary')} />
      </Screen>
    );
  }
  if (!doc) {
    return (
      <Screen header={<Header title={item.name} sub={sourceLine(item)} onBack={ctx.back} />}>
        {docs.error ? <Banner icon="cloud" tone="amber" title={t('content.editor.notOnDevice')} body={t('content.editor.connectToOpen')} /> : <LoadingLine />}
      </Screen>
    );
  }
  return <TemplateEditorForm key={item.current} ctx={ctx} lib={lib} item={item} initial={formFromDoc(doc, item.name, item.description)} />;
}

/** The versifications a Bible template can be numbered in: the organization's, then shared ones (LangQuest's English first). */
function useVersifications(ctx: Ctx, lib: Lib, enabled = true) {
  const shared = useSharedItems('versification', lib.orgId, enabled);
  const library = ctx.org.state?.library;
  // i18n-ignore: LangQuest's English versification by its library name, matched to list it first
  const choices = useMemo(() => libraryChoices(library ?? {}, lib.items('versification'), shared.rows, 'English'), [library, lib.items, shared.rows]);
  return { choices, error: shared.error };
}

/** "New template": Scripture from a chosen versification, or an outline built by hand. */
function NewTemplate({ ctx }: { ctx: Ctx }) {
  const lib = useLibrary(ctx);
  const v = useVersifications(ctx, lib);
  const [form, setForm] = useState<TemplateForm | null>(null);
  const [bible, setBible] = useState(false);
  const [busy, setBusy] = useState(false);
  if (form) return <TemplateEditorForm ctx={ctx} lib={lib} item={null} initial={form} />;

  async function start(c: LibraryChoice) {
    if (busy) return;
    setBusy(true);
    try {
      const doc = (await loadDocs(lib.orgId, [c.hash])).get(c.hash);
      if (!doc || doc.format !== 'versification@1') throw new Error('Its versification is not on this device yet. Try again when connected.');
      setForm(newTemplateForm('bible', { hash: c.hash, doc }));
    } catch (e) {
      ctx.toast(failure('new template versification', e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen header={<Header title={t('content.newTemplate.title')} sub={orgName(ctx)} onBack={bible ? () => setBible(false) : ctx.back} />}>
      {!bible ? (
        <>
          <Text style={txt.body}>{t('content.newTemplate.what')}</Text>
          <Card onPress={() => setBible(true)} accessibilityLabel={t('content.newTemplate.scripture')}>
            <View style={styles.head}>
              <View style={styles.tile}><Ico name="book" size={22} color={C.primary} /></View>
              <View style={{ flex: 1 }}>
                <Text style={txt.h3}>{t('content.newTemplate.scripture')}</Text>
                <Text style={txt.smMuted}>{t('content.newTemplate.scriptureSub')}</Text>
              </View>
            </View>
          </Card>
          <Card onPress={() => setForm(newTemplateForm('outline'))} accessibilityLabel={t('content.newTemplate.else')}>
            <View style={styles.head}>
              <View style={styles.tile}><Ico name="folder" size={22} color={C.primary} /></View>
              <View style={{ flex: 1 }}>
                <Text style={txt.h3}>{t('content.newTemplate.else')}</Text>
                <Text style={txt.smMuted}>{t('content.newTemplate.elseSub')}</Text>
              </View>
            </View>
          </Card>
        </>
      ) : (
        <>
          <Text style={txt.body}>{t('content.newTemplate.numbering')}</Text>
          <SharedOffline error={v.error} empty={v.choices.length === 0} />
          <Group>
            {v.choices.map((c, i) => (
              <Row key={c.key} icon="book" label={c.name} sub={choiceLine(c, sourceLine)} onPress={busy ? undefined : () => void start(c)} last={i === v.choices.length - 1} />
            ))}
          </Group>
        </>
      )}
    </Screen>
  );
}

/**
 * The editor itself (the demo's TemplateEditorScreen): name, description,
 * levels, and for Scripture the versification, the books and their names,
 * and how they divide; for an outline, the whole outline in one scroll.
 * Save publishes the next version. A followed template opens read-only.
 */
function TemplateEditorForm({ ctx, lib, item, initial }: { ctx: Ctx; lib: Lib; item: LibraryItemView | null; initial: TemplateForm }) {
  const state = ctx.language.state;
  const [f, setF] = useState<TemplateForm>(initial);
  const [editingLevel, setEditingLevel] = useState<number | null>(null);
  const [editingBook, setEditingBook] = useState<string | null>(null);
  const [addingBook, setAddingBook] = useState(false);
  const [choosingV11n, setChoosingV11n] = useState(false);
  const [editingNode, setEditingNode] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [bookLimit, setBookLimit] = useState(12);
  const { busy, run } = useRunner(ctx);
  const v = useVersifications(ctx, lib, f.structure === 'bible');
  const docs = useLibraryDocs(lib.orgId, [f.versification]);
  const v11n = docs.get<VersificationDoc>(f.versification);
  const set = (patch: Partial<TemplateForm>) => setF((prev) => ({ ...prev, ...patch }));
  const isNew = item === null;
  const followed = item?.source === 'subscription';
  const readOnly = !ctx.session.can('manage_templates') || followed;
  const changed = isNew || formChanged(f, initial) || f.name.trim() !== initial.name || f.description.trim() !== initial.description;
  const users = item ? usersOf(ctx, item.itemId) : [];
  const bible = f.structure === 'bible';
  const v11nChoice = v.choices.find((c) => c.hash === f.versification);
  const v11nName = v11n?.name ?? v11nChoice?.name ?? (f.versification ? t('common.loading') : t('content.editor.chooseOne'));
  const ready = !!f.name.trim() && (!bible || (!!f.versification && f.books.length > 0)) && (bible || f.outline.length > 0);

  function save() {
    void run('save template', async () => { // i18n-ignore: log label
      const name = f.name.trim();
      // A versification another organization shares is followed (or copied) first, so this organization may name it.
      if (bible && v11nChoice?.source === 'shared') {
        if (v11nChoice.shared.subscribable) await lib.subscribe(v11nChoice.shared, true);
        else await lib.copy(v11nChoice.shared);
      }
      const { docHash } = await lib.publish({
        kind: 'template', ...(item ? { itemId: item.itemId } : {}), name, description: f.description.trim(), doc: docFromForm(f)
      });
      const n = (item?.versions.length ?? 0) + (item?.versions.some((x) => x.docHash === docHash) ? 0 : 1);
      ctx.toast(isNew ? t('content.editor.created', { name }) : `${t('content.editor.savedAs', { name, n })} ${movesLine(users)}`.trim());
      ctx.back();
    });
  }

  const sub = isNew ? t('content.editor.subNew', { org: orgName(ctx) }) : followed ? sourceLine(item) : t('content.editor.subTemplate', { source: sourceLine(item) });
  const shownBooks = f.books.slice(0, bookLimit);
  const bookSheet = editingBook ? f.books.find((b) => b.book === editingBook) : undefined;
  const missing = v11n ? versificationBooks(v11n).filter((b) => !f.books.some((x) => x.book === b)) : [];
  const node = editingNode ? findNode(f.outline, editingNode) : undefined;
  const nodeSiblings = editingNode ? siblingsOf(f.outline, editingNode) : [];

  return (
    <Screen
      header={<Header title={f.name.trim() || t('content.editor.untitled')} sub={sub} onBack={() => (changed && !readOnly && !isNew ? setLeaving(true) : ctx.back())} />}
      footer={readOnly ? undefined : (
        <PrimaryBtn label={isNew ? t('content.editor.create') : t('content.editor.saveChanges')} icon="check" busy={busy} disabled={!changed || !ready} onPress={save} />
      )}>
      {followed ? (
        <>
          <Banner icon="lock" title={t('content.editor.follows', { org: item!.subscription!.sourceOrgName })} body={t('content.editor.followsBody')} />
          {ctx.session.can('manage_templates') ? (
            <GhostBtn label={t('content.options.copyToChange')} icon="edit" disabled={busy} onPress={() => void run('copy template', async () => { // i18n-ignore: log label
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
          <Field label={t('content.name')} value={f.name} onChangeText={(name) => set({ name })} placeholder={t('content.editor.namePlaceholder')} autoCapitalize="words" />
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
          <Row key={`${l.name}-${i}`} icon={i === f.levels.length - 1 ? 'media' : 'folder'} label={l.name}
            sub={levelSub(i, f.levels.length, l.display ?? (bible ? 'reference' : 'name'))}
            onPress={readOnly ? undefined : () => setEditingLevel(i)} right={readOnly ? undefined : <Ico name="edit" size={20} color={C.muted} />}
            last={i === f.levels.length - 1} />
        ))}
      </Group>

      {bible ? (
        <>
          <SectionLabel label={t('content.editor.versification')} />
          <Group>
            <Row icon="book" label={v11nName} sub={t('content.editor.versificationSub')} last
              onPress={readOnly ? undefined : () => setChoosingV11n(true)} right={readOnly ? undefined : <Ico name="edit" size={20} color={C.muted} />} />
          </Group>

          <SectionLabel label={t('content.editor.divideInto')} />
          <ChipRow>
            <Chip label={t('content.editor.wholeBooks')} on={f.divide === 'books'} onPress={() => !readOnly && set({ divide: 'books', levels: levelsForDivide(f.levels, 'books') })} />
            <Chip label={t('content.editor.chapters')} on={f.divide === 'chapters'} onPress={() => !readOnly && set({ divide: 'chapters', levels: levelsForDivide(f.levels, 'chapters') })} />
            {f.passages.length > 0 ? (
              <Chip label={t('content.editor.passages')} on={f.divide === 'passages'} onPress={() => !readOnly && set({ divide: 'passages', levels: levelsForDivide(f.levels, 'passages') })} />
            ) : null}
          </ChipRow>
          <Text style={[txt.smMuted, { paddingHorizontal: space.xs }]}>
            {f.divide === 'passages'
              ? t('content.editor.passagesNote', { count: f.passages.length })
              : f.divide === 'books' ? t('content.editor.eachBook') : t('content.editor.eachChapter')}
          </Text>

          <SectionLabel label={t('content.editor.booksCount', { n: f.books.length })} />
          {f.books.length === 0 ? (
            <Text style={[txt.smMuted, { paddingHorizontal: space.xs }]}>{t('content.editor.noBooks')}</Text>
          ) : (
            <Group>
              {shownBooks.map((b, i) => {
                const known = bookNameOf(b.book);
                const chapters = v11n ? chaptersInBook(v11n, b.book) : 0;
                return (
                  <Row key={b.book} icon="book" label={b.name}
                    sub={[b.book, ...(known !== b.name ? [known] : []), ...(chapters ? [t('content.editor.chapterCount', { count: chapters })] : [])].join(' · ')}
                    onPress={readOnly ? undefined : () => setEditingBook(b.book)} right={readOnly ? undefined : <Ico name="edit" size={20} color={C.muted} />}
                    last={i === shownBooks.length - 1} />
                );
              })}
            </Group>
          )}
          <ShowMore remaining={f.books.length - bookLimit} step={12} onMore={() => setBookLimit((l) => l + 12)} />
          {!readOnly ? <GhostBtn label={t('content.editor.addBook')} icon="plus" disabled={!v11n || missing.length === 0} onPress={() => setAddingBook(true)} /> : null}
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
      {bookSheet ? (
        <BookSheet book={bookSheet} onClose={() => setEditingBook(null)}
          onSave={(name) => { set({ books: f.books.map((b) => (b.book === bookSheet.book ? { ...b, name } : b)) }); setEditingBook(null); }}
          onRemove={() => { set({ books: f.books.filter((b) => b.book !== bookSheet.book) }); setEditingBook(null); }} />
      ) : null}
      {addingBook ? (
        <AddBookSheet books={missing} onClose={() => setAddingBook(false)}
          onAdd={(book) => set({ books: [...f.books, { book, name: bookNameOf(book) }] })} />
      ) : null}
      {choosingV11n ? (
        <Sheet visible title={t('content.editor.versification')} sub={t('content.editor.versificationSheetSub')} onClose={() => setChoosingV11n(false)}>
          <SharedOffline error={v.error} empty={v.choices.length === 0} />
          <Group>
            {v.choices.map((c, i) => (
              <Row key={c.key} label={c.name} sub={choiceLine(c, sourceLine)} role="radio" selected={c.hash === f.versification}
                onPress={() => { set({ versification: c.hash }); setChoosingV11n(false); }} last={i === v.choices.length - 1}
                right={c.hash === f.versification ? <Ico name="check" size={22} color={C.primary} /> : <View style={{ width: 22 }} />} />
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
      {leaving ? (
        <Sheet visible title={t('content.editor.leaveTitle')} sub={t('content.editor.leaveSub')} onClose={() => setLeaving(false)}
          footer={<>
            <PrimaryBtn label={t('content.editor.keepEditing')} onPress={() => setLeaving(false)} />
            <GhostBtn label={t('content.editor.leave')} tone="red" onPress={() => { setLeaving(false); ctx.back(); }} />
          </>}>
          <Text style={txt.smMuted}>{t('content.editor.leaveNote')}</Text>
        </Sheet>
      ) : null}
    </Screen>
  );
}

/** A level: what the team calls it, and for a Bible template's last level how each part is shown (the demo's LevelSheet). */
function LevelSheet(props: { level: TemplateForm['levels'][number]; last: boolean; bible: boolean; onClose: () => void; onSave: (l: TemplateForm['levels'][number]) => void }) {
  const [name, setName] = useState(props.level.name);
  const [display, setDisplay] = useState(props.level.display ?? (props.bible ? 'reference' : 'name'));
  const example = `${bookName('luk')} 15:11–32`;
  return (
    <Sheet visible title={t('content.levelSheet.title')} sub={t('content.levelSheet.sub')} onClose={props.onClose}
      footer={<PrimaryBtn label={t('common.done')} disabled={!name.trim()} onPress={() => props.onSave({ name: name.trim(), ...(props.last ? { display } : {}) })} />}>
      <Field label={t('content.name')} value={name} onChangeText={setName} placeholder={t('content.levelSheet.placeholder')} autoCapitalize="words" />
      {props.last && props.bible ? (
        <>
          <Text style={txt.xsStrong}>{t('content.levelSheet.showBy')}</Text>
          <ChipRow>
            <Chip label={t('content.levelSheet.reference')} on={display === 'reference'} onPress={() => setDisplay('reference')} />
            <Chip label={t('content.name')} on={display === 'name'} onPress={() => setDisplay('name')} />
            <Chip label={t('content.levelSheet.both')} on={display === 'both'} onPress={() => setDisplay('both')} />
          </ChipRow>
          <Text style={txt.smMuted}>
            {display === 'reference' ? example : display === 'name' ? t('content.levelSheet.exampleName') : t('content.levelSheet.exampleBoth', { reference: example })}
          </Text>
        </>
      ) : null}
    </Sheet>
  );
}

/** A book: its name in the language, or take it out of the template. */
function BookSheet(props: { book: { book: string; name: string }; onClose: () => void; onSave: (name: string) => void; onRemove: () => void }) {
  const [name, setName] = useState(props.book.name);
  return (
    <Sheet visible title={bookNameOf(props.book.book)} sub={t('content.bookSheet.sub')} onClose={props.onClose}
      footer={<PrimaryBtn label={t('common.done')} disabled={!name.trim()} onPress={() => props.onSave(name.trim())} />}>
      <Field label={t('content.bookSheet.nameLabel')} value={name} onChangeText={setName} placeholder={bookNameOf(props.book.book)} autoCapitalize="words" />
      <GhostBtn label={t('content.bookSheet.remove')} icon="trash" tone="red" onPress={props.onRemove} />
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
      footer={<PrimaryBtn label={t('common.done')} onPress={props.onClose} />}>
      {left.length === 0 ? <Text style={txt.smMuted}>{t('content.addBook.allIn')}</Text> : (
        <Group>
          {left.slice(0, limit).map((b, i, shown) => (
            <Row key={b} icon="plus" label={bookNameOf(b)} sub={b} onPress={() => { props.onAdd(b); setAdded((a) => [...a, b]); }} last={i === shown.length - 1} />
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
  const levelName = (d: number) => props.levels[Math.min(d, props.levels.length - 1)]?.name ?? t('content.levels.part');

  function add(parentId: string | null, folder: boolean, depth: number) {
    const id = `n${Crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`;
    // Opened straight away so it can be named.
    props.onChange(addNode(props.outline, parentId, { id, title: t('content.outline.newNode', { level: lower(levelName(depth)) }), folder }), id);
  }

  function render(list: TemplateForm['outline'], depth: number, parentId: string | null) {
    const holds = list.length === 0 ? 'either' : list[0]!.children ? 'folders' : 'items';
    return (
      <View style={depth ? styles.outlineIndent : null}>
        {list.map((n) => n.children ? (
          <View key={n.id}>
            <Pressable disabled={props.readOnly} onPress={() => props.onEdit(n.id)} accessibilityRole="button" accessibilityLabel={t('content.outline.editLabel', { name: n.title })}
              style={({ pressed }) => [styles.outlineHead, pressed && { opacity: 0.7 }]}>
              <Ico name="folder" size={depth ? 18 : 22} color={C.primary} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[depth ? txt.body : txt.h3, { fontWeight: '700' }]} numberOfLines={1}>{n.title}</Text>
                <Text style={txt.smMuted}>{(() => { const c = countOutline(n.children); return c.folders ? t('content.outline.folders', { count: c.folders }) : t('content.outline.items', { count: c.items }); })()}</Text>
              </View>
              {!props.readOnly ? <Ico name="edit" size={20} color={C.muted} /> : null}
            </Pressable>
            {render(n.children, depth + 1, n.id)}
          </View>
        ) : (
          <Pressable key={n.id} disabled={props.readOnly} onPress={() => props.onEdit(n.id)} accessibilityRole="button" accessibilityLabel={t('content.outline.editLabel', { name: n.title })}
            style={({ pressed }) => [styles.outlineItem, pressed && { opacity: 0.7 }]}>
            <View style={[styles.tile, { backgroundColor: TINT.green }]}><Ico name="media" size={20} color={TINT.greenText} /></View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[txt.body, { fontWeight: '600' }]} numberOfLines={1}>{n.title}</Text>
              <Text style={txt.smMuted}>{levelName(depth)}</Text>
            </View>
            {!props.readOnly ? <Ico name="edit" size={20} color={C.muted} /> : null}
          </Pressable>
        ))}
        {!props.readOnly ? (
          <View style={styles.addRow}>
            {holds !== 'items' ? <SmallBtn label={t('content.outline.addFolder', { level: lower(levelName(depth)) })} icon="folder" onPress={() => add(parentId, true, depth)} /> : null}
            {holds !== 'folders' ? <SmallBtn label={t('content.outline.addItem', { level: lower(levelName(depth)) })} icon="media" onPress={() => add(parentId, false, depth)} /> : null}
          </View>
        ) : null}
      </View>
    );
  }

  if (props.readOnly && props.outline.length === 0) return <Text style={[txt.smMuted, { paddingHorizontal: space.xs }]}>{t('content.outline.empty')}</Text>;
  return render(props.outline, 0, null);
}

/** One part of the outline: rename, move, or remove it (the demo's NodeSheet). */
function NodeSheet(props: {
  node: TemplateForm['outline'][number]; index: number; count: number;
  onClose: () => void; onRename: (title: string) => void; onMove: (by: number) => void; onRemove: () => void;
}) {
  const [title, setTitle] = useState(props.node.title);
  const folder = !!props.node.children;
  const done = () => {
    if (title.trim() && title.trim() !== props.node.title) props.onRename(title.trim());
    props.onClose();
  };
  return (
    <Sheet visible title={folder ? t('content.node.folder') : t('content.node.item')} sub={folder ? t('content.node.folderSub') : t('content.node.itemSub')} onClose={done}
      footer={<PrimaryBtn label={t('common.done')} disabled={!title.trim()} onPress={done} />}>
      <Field label={t('content.name')} value={title} onChangeText={setTitle} placeholder={t('content.name')} autoCapitalize="sentences" />
      <View style={styles.pair}>
        <View style={{ flex: 1 }}><GhostBtn label={t('content.node.moveUp')} icon="up" disabled={props.index <= 0} onPress={() => props.onMove(-1)} /></View>
        <View style={{ flex: 1 }}><GhostBtn label={t('content.node.moveDown')} icon="down" disabled={props.index >= props.count - 1} onPress={() => props.onMove(1)} /></View>
      </View>
      <GhostBtn label={folder ? t('content.node.removeFolder') : t('content.node.removeItem')} icon="trash" tone="red" onPress={props.onRemove} />
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
  const canShape = ctx.session.can('shape_templates') || ctx.session.can('manage_templates');
  // Breaking up a book changes the language's template: coordinators and admins (decision 74).
  const canBreak = ctx.session.can('manage_templates');
  const open = isOpen(ctx, languageId);
  const sel = state && open ? templateOf(state) : null;
  const docs = useLibraryDocs(ctx.language.orgId, [sel?.docHash]);
  const doc = sel ? docs.get<TemplateDoc>(sel.docHash) : null;
  const v11n = doc?.bible ? docs.get<VersificationDoc>(doc.bible.versification) : null;

  const data = useMemo(() => {
    if (!state || !open || !book) return null;
    const idx = indexesFor(state);
    const segments = bookSegments(state, idx, book);
    const recorded = new Set(segments.filter((s) => derivePassage(state, s.unitId, idx).recorded).map((s) => s.unitId));
    // The words, where the app has them (scripture.ts); verse numbers otherwise.
    const text = new Map<string, string>();
    const translation = new Map<number, string>();
    for (const s of segments) {
      const reading = readingsFor(state, s.unitId)[0];
      if (!reading) continue;
      for (const v of reading.verses) {
        text.set(`${v.chapter}:${v.verse}`, v.text);
        translation.set(v.chapter, reading.code);
      }
    }
    // FIA's breaks show only where the language divides differently (TPL-5): where a part starts there, no mark.
    const textOf = (c: number, v: number) => text.get(`${c}:${v}`);
    const label = bookRows(state, idx).find((r) => r.book.itemId === book.itemId)?.label ?? bookName(book.itemId);
    return { language: languageName(ctx.org.state, languageId!), label, segments, recorded, textOf, translation, fia: fiaStarts(book) };
  }, [state, open, languageId, book, ctx.org.state]);

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
    return (
      <BreakUpBook ctx={ctx} book={usfm} bookName={data.label} language={data.language} doc={doc} item={item} redo={data.segments.length > 0}
        onClose={() => (choosing ? setChoosing(false) : ctx.back())} />
    );
  }
  const words = partWords(doc);
  const part = words.one;
  const parts = lower(words.many);
  const chapters = book.verses.map((_, i) => i + 1);
  const fia = canShape ? data.fia : new Set<number>();
  const jump = (c: number) => list.current?.scrollToIndex({ index: c - 1, animated: true });

  return (
    <Screen fixed header={<Header title={data.label} sub={`${data.language} · ${partsCount(data.segments.length, words)}`} onBack={ctx.back} />}>
      <View style={styles.jumpBar}>
        <ChipRow>
          <Chip label={t('content.book.chapterChip')} icon="down" on onPress={() => setPicking(true)} />
          {data.segments.map((s) => (
            <Chip key={s.unitId} label={chipLabel(book, s)} on={false} onPress={() => jump(s.from.c)} />
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
          <ChapterView book={book} c={c} segments={data.segments} fia={fia} text={data.textOf} part={part}
            translation={data.translation.get(c)} recorded={data.recorded} />
        )}
      />
      <Sheet visible={picking} title={data.label} sub={t('content.book.jump')} onClose={() => setPicking(false)}>
        <View style={styles.grid}>
          {chapters.map((c) => {
            const n = data.segments.filter((s) => s.from.c === c).length;
            return (
              <Pressable key={c} onPress={() => { setPicking(false); jump(c); }} accessibilityRole="button"
                accessibilityLabel={n > 1 ? t('content.book.chapterParts', { chapter: c, count: n, part: lower(part), parts }) : t('content.book.chapter', { chapter: c })}
                style={({ pressed }) => [styles.chapterTile, pressed && { opacity: 0.7 }]}>
                <Text style={[txt.h3, { fontVariant: ['tabular-nums'] }]}>{c}</Text>
                {n > 1 ? <Text style={txt.xsStrong}>{n}</Text> : null}
              </Pressable>
            );
          })}
        </View>
      </Sheet>
    </Screen>
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
