import { CUSTOM_FLOW, ORG_STREAM, parseRef, refId, templateUnits, type Card, type Role, type TemplateDoc, type VersificationDoc } from '@langquest-next/core';
import type { Fact, Said } from './reconcile';
import { bucketName, isoTime, metadataOf, type V2Asset, type V2ProjectRows, type V2Quest } from './rows';

/**
 * One v2 project as facts (docs/v2-import.md section 4): what it says now,
 * for `reconcile` to compare with what the import already said. Pure.
 *
 * A v2 project is one language here, whose id is the project's. A quest
 * that holds the team's own recordings is a passage, and those recordings
 * are the parts of one recording of it, in v2's order; each change v2 gets
 * (a publish) becomes a new version. In a Bible or FIA project a chapter or
 * FIA passage quest is that passage of LangQuest's Bible, so verse labels,
 * reference material and reports work. In older projects a quest holds
 * source material instead: each piece is a passage with the material on it,
 * and each translation of it a version.
 */

export interface CopiedFile {
  hash: string;
  size: number;
  durationMs: number;
  format: 'wav' | 'm4a';
}

export interface TemplateRef {
  itemId: string;
  docHash: string;
  doc: TemplateDoc;
  versification: VersificationDoc | null;
}

export interface MapContext {
  orgId: string;
  /** The language decided for the project (never v2's own, AGENTS.md), when it was decided, and its name in Next when not the project's. */
  language: { code: string; languoidId: string | null; sourceCode: string; decidedAt: string; name?: string };
  /** Roles chosen on the dashboard, by v2 person; `none` leaves them out. Everyone else's follows their v2 work. */
  roles?: ReadonlyMap<string, Role | 'none'>;
  /** v2 file name → the file as copied here. A name that is absent has not been copied (yet). */
  files: ReadonlyMap<string, CopiedFile>;
  /** LangQuest's Bible by chapters and FIA's passages, when a Bible or FIA project's quests become their passages. */
  templates: { bible?: TemplateRef; fia?: TemplateRef };
  now: number;
  /** How long a version waits for files that have not reached v2's bucket. */
  waitMs?: number;
}

export interface MapReport {
  quests: number;
  passages: number;
  recordings: number;
  versions: number;
  reviews: number;
  backTranslations: number;
  notes: number;
  materials: number;
  /** Recordings waiting for their files, and files given up on. */
  waiting: number;
  missingFiles: string[];
  /** Quests whose Bible place did not match LangQuest's Bible, made units of their own. */
  unmatchedQuests: number;
  /** Assets that sit in no quest: nowhere to hang them. */
  unplaced: number;
}

export interface Mapped {
  facts: Fact[];
  /** Who worked in the project and the role their work amounts to. */
  roles: Map<string, Role>;
  owner: string;
  report: MapReport;
}

export const SYSTEM_ACTOR = 'v2import';
const WAIT_MS = 7 * 24 * 3600_000;
const COMMUNITY = 'community';
const BACK_TRANSLATION = 'bt';

/** v2's own Bible book ids, where they are not the USFM code in lower case. */
const V2_BOOK: Record<string, string> = { mar: 'MRK', joe: 'JOL', nah: 'NAM', phi: 'PHP' };
const usfm = (v2Book: string) => V2_BOOK[v2Book.toLowerCase()] ?? v2Book.toUpperCase();

/** Project role → the seeded organization role with the same privileges, at the language's scope. */
const ROLE_ID: Record<Role, string> = { owner: 'org_admin', coordinator: 'coordinator', translator: 'translator', reviewer: 'reviewer', viewer: 'viewer' };

const pad = (n: number, w = 6) => String(Math.max(0, Math.trunc(n))).padStart(w, '0');
const latest = (times: string[]) => times.reduce((a, b) => (Date.parse(b) > Date.parse(a) ? b : a));

export function mapProject(rows: V2ProjectRows, ctx: MapContext): Mapped {
  const languageId = rows.project.id;
  const report: MapReport = {
    quests: 0, passages: 0, recordings: 0, versions: 0, reviews: 0, backTranslations: 0, notes: 0, materials: 0,
    waiting: 0, missingFiles: [], unmatchedQuests: 0, unplaced: 0
  };
  const facts: Fact[] = [];
  const at = (t: string) => isoTime(t);

  // ---- who ---------------------------------------------------------------------------
  const owners = rows.members.filter((m) => m.active && m.membership === 'owner').sort((a, b) => a.created_at.localeCompare(b.created_at));
  const owner = owners[0]?.profile_id ?? rows.project.creator_id ?? SYSTEM_ACTOR;
  const actor = (id: string | null) => id ?? owner;

  // ---- what v2 holds, indexed ----------------------------------------------------------
  const v2Target = rows.languages.find((l) => l.active && l.language_type === 'target')?.languoid_id ?? null;
  const v2Sources = new Set(rows.languages.filter((l) => l.active && l.language_type === 'source').map((l) => l.languoid_id));
  const live = (q: V2Quest) => q.active && q.visible !== false && !q.duplicate_of;
  const quests = rows.quests.filter(live);
  const questIds = new Set(quests.map((q) => q.id));
  const assets = new Map(rows.assets.filter((a) => a.active && a.visible !== false).map((a) => [a.id, a]));
  const contentsOf = groupBy(rows.contents.filter((c) => c.active), (c) => c.asset_id);
  for (const list of contentsOf.values()) list.sort((a, b) => a.order_index - b.order_index || a.id.localeCompare(b.id));
  const childrenOf = groupBy([...assets.values()].filter((a) => a.source_asset_id), (a) => a.source_asset_id!);
  const votesOf = groupBy(rows.votes.filter((v) => v.active && v.creator_id), (v) => v.asset_id);
  const placed = groupBy(rows.placements.filter((p) => p.active && p.visible && questIds.has(p.quest_id) && assets.has(p.asset_id)), (p) => p.quest_id);
  for (const list of placed.values()) {
    list.sort((a, b) => a.order_index - b.order_index || assets.get(a.asset_id)!.created_at.localeCompare(assets.get(b.asset_id)!.created_at) || a.asset_id.localeCompare(b.asset_id));
  }
  const inSomeQuest = new Set(rows.placements.filter((p) => p.active).map((p) => p.asset_id));
  report.unplaced = [...assets.values()].filter((a) => !a.source_asset_id && !inSomeQuest.has(a.id)).length;

  /** The language an asset is in: its segments' most common. */
  const languageOf = (a: V2Asset): string | null => {
    const counts = new Map<string, number>();
    for (const c of contentsOf.get(a.id) ?? []) {
      const l = c.languoid_id ?? c.source_language_id;
      if (l) counts.set(l, (counts.get(l) ?? 0) + 1);
    }
    return [...counts.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0]?.[0] ?? null;
  };
  /** Source material: in one of the project's source languages and not its own. */
  const isMaterial = (a: V2Asset) => {
    const l = languageOf(a);
    return l !== null && l !== v2Target && v2Sources.has(l);
  };

  // ---- files --------------------------------------------------------------------------
  type Ready = { cards: Card[]; waiting: boolean; lost: string[] };
  const cardsOf = (a: V2Asset): Ready => {
    const cards: Card[] = [];
    const lost: string[] = [];
    let waiting = false;
    for (const c of contentsOf.get(a.id) ?? []) {
      for (const raw of c.audio ?? []) {
        const name = bucketName(raw);
        const file = name ? ctx.files.get(name) : undefined;
        if (file) cards.push({ hash: file.hash, durationMs: file.durationMs, ...(file.format === 'wav' ? { format: 'wav' as const } : {}) });
        else if (name && ctx.now - Date.parse(at(a.created_at)) < (ctx.waitMs ?? WAIT_MS)) waiting = true;
        else lost.push(raw);
      }
    }
    return { cards, waiting, lost };
  };
  const textOf = (a: V2Asset) => (contentsOf.get(a.id) ?? []).map((c) => c.text?.trim() ?? '').filter(Boolean).join('\n');

  // ---- where quests go -----------------------------------------------------------------
  const template = rows.project.template === 'bible' ? ctx.templates.bible : rows.project.template === 'fia' ? ctx.templates.fia : undefined;
  const templateUnitIds = template ? new Set(templateUnits(template.doc, template.itemId, template.versification).map((u) => u.unitId)) : new Set<string>();
  const unitOf = new Map<string, string>();
  const books = new Set<string>();
  if (template) {
    for (const q of quests) {
      const meta = metadataOf(q.metadata);
      const bible = meta?.['bible'] as { book?: string; chapter?: number } | undefined;
      const fia = meta?.['fia'] as { bookId?: string; verseRange?: string } | undefined;
      let node: string | null = null;
      if (rows.project.template === 'bible' && bible?.book) node = bible.chapter ? `${usfm(bible.book)}.${bible.chapter}` : usfm(bible.book);
      if (rows.project.template === 'fia' && fia?.bookId) {
        const r = fia.verseRange ? parseRef(`${usfm(fia.bookId)} ${fia.verseRange}`) : null;
        node = fia.verseRange ? (r ? refId(r) : null) : usfm(fia.bookId);
      }
      const unitId = node ? `${template.itemId}/${node}` : null;
      if (unitId && templateUnitIds.has(unitId)) {
        unitOf.set(q.id, unitId);
        books.add(node!.slice(0, 3));
      } else if (node) report.unmatchedQuests += 1;
    }
  }
  const childQuests = groupBy(quests.filter((q) => q.parent_id && questIds.has(q.parent_id)), (q) => q.parent_id!);

  // ---- the language, in the organization's stream ------------------------------------------
  const t0 = at(rows.project.created_at);
  // A v2 project's name is often not its language's ("BEROM FAN EL NIGERIA"); the dashboard may give another.
  const languageName = ctx.language.name?.trim() || rows.project.name;
  const nothing = () => [] as Said[];
  facts.push(
    {
      key: 'language', streamId: ORG_STREAM, actorId: owner, at: t0, restate: false, unsay: nothing,
      say: () => [{ type: 'v1.LanguageAdded', payload: { languageId, name: languageName, code: ctx.language.code, sourceCode: ctx.language.sourceCode } }]
    },
    {
      key: 'name', streamId: ORG_STREAM, actorId: owner, at: at(rows.project.last_updated), unsay: nothing,
      say: () => [{ type: 'v1.LanguageRenamed', payload: { languageId, name: languageName } }]
    },
    {
      key: 'code', streamId: ORG_STREAM, actorId: owner, at: ctx.language.decidedAt, unsay: nothing,
      say: () => [{ type: 'v1.LanguageCodeSet', payload: { languageId, code: ctx.language.code, languoidId: ctx.language.languoidId } }]
    }
  );

  // ---- the language's own stream: structure ------------------------------------------------
  facts.push({
    key: 'flow', streamId: languageId, actorId: owner, at: t0, restate: false, unsay: nothing,
    say: () => [
      { type: 'v1.FlowSelected', payload: { flowId: CUSTOM_FLOW } },
      { type: 'v1.FlowStepSet', payload: { stepId: `${CUSTOM_FLOW}/${COMMUNITY}`, order: 's00', kindIds: [COMMUNITY], checkpoint: false } }
    ]
  });
  if (template && books.size > 0) {
    const units = templateUnits(template.doc, template.itemId, template.versification);
    const sorted = [...books].sort();
    facts.push({
      key: 'template', streamId: languageId, actorId: owner, at: t0, unsay: nothing,
      say: () => [{ type: 'v1.TemplateSelected', payload: { itemId: template.itemId, docHash: template.docHash, unitPrefix: template.itemId, books: sorted } }]
    });
    for (const book of sorted) {
      const mine = units.filter((u) => u.unitId.slice(template.itemId.length + 1, template.itemId.length + 4) === book);
      facts.push({
        key: `book:${book}`, streamId: languageId, actorId: owner, at: t0, restate: false, unsay: nothing,
        say: () => mine.map((payload) => ({ type: 'v1.UnitAdded', payload }))
      });
    }
  }

  // Quests that are not a place in LangQuest's Bible are units of their own.
  const questOrder = [...rows.quests].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  questOrder.forEach((q, i) => {
    if (unitOf.has(q.id)) return;
    const holdsMaterial = (placed.get(q.id) ?? []).some((p) => isMaterial(assets.get(p.asset_id)!));
    const parent = q.parent_id && questIds.has(q.parent_id) ? q.parent_id : null;
    const kind = childQuests.has(q.id) || holdsMaterial ? (parent ? 'folder' : 'book') : 'passage';
    const parentUnitId = parent ? unitOf.get(parent) ?? parent : null;
    facts.push(unitFact(`unit:${q.id}`, q.id, parentUnitId, kind, q.name?.trim() || `Quest ${i + 1}`, pad(i), q.creator_id ?? owner, at(q.created_at), !live(q), at(q.last_updated)));
    if (live(q)) unitOf.set(q.id, q.id);
  });
  report.quests = quests.length;

  // ---- the work ---------------------------------------------------------------------------
  const recorded = new Set<string>();
  const voted = new Set<string>();
  const wavHashes = new Set<string>();

  for (const q of quests) {
    const unitId = unitOf.get(q.id);
    if (!unitId) continue;
    const here = (placed.get(q.id) ?? []).map((p) => ({ p, a: assets.get(p.asset_id)! })).filter(({ a }) => !a.source_asset_id);
    const own = here.filter(({ a }) => !isMaterial(a));
    const material = here.filter(({ a }) => isMaterial(a));

    const verses = new Map(own.map(({ p, a }) => [a.id, verseOf(metadataOf(p.metadata) ?? metadataOf(a.metadata), q, rows.project.template)]));
    const labelOf = (a: V2Asset) => {
      const v = verses.get(a.id);
      if (v) return v.from === v.to ? v.from : `${v.from}–${v.to.split(':')[1]}`;
      return a.name?.trim() || 'Part';
    };

    // The team's recordings: one recording of the passage.
    if (own.length > 0) {
      report.passages += 1;
      const parts: { a: V2Asset; cards: Card[] }[] = [];
      let waiting = false;
      for (const { a } of own) {
        const r = cardsOf(a);
        report.missingFiles.push(...r.lost);
        if (r.waiting) { waiting = true; report.waiting += 1; }
        if (r.cards.length === 0) continue;
        parts.push({ a, cards: r.cards });
        recorded.add(actor(a.creator_id));
        const verse = verses.get(a.id) ?? null;
        facts.push({
          key: `rec:${q.id}:${a.id}`, streamId: languageId, actorId: actor(a.creator_id), at: at(a.created_at), unsay: 'redact', hold: r.waiting,
          say: (s) => [
            { type: 'v1.RecordingAdded', payload: { recordingId: `rec:${a.id}:${q.id}#${s.n}`, unitId, kind: 'target', cards: r.cards } },
            // Which verses it holds, when v2 says: the first card is set to them and the rest join it.
            ...(verse ? r.cards.map((c, i): Said => ({
              type: 'v1.CardVerseSet',
              payload: i === 0 ? { unitId, hash: c.hash, mark: 'set', from: verse.from, to: verse.to } : { unitId, hash: c.hash, mark: 'join' }
            })) : [])
          ]
        });
        report.recordings += 1;
      }
      const cardHashes = parts.flatMap((x) => x.cards.map((c) => c.hash));
      const last = parts.reduce<V2Asset | null>((m, x) => (!m || Date.parse(at(x.a.created_at)) > Date.parse(at(m.created_at)) ? x.a : m), null);
      if (last) {
        facts.push(takeFact(`take:${q.id}`, unitId, cardHashes, actor(last.creator_id), at(last.created_at), waiting));
        report.versions += 1;
      }

      // Votes on any of its parts: one Community Check per person, on the version current when they were given.
      const byPerson = groupBy(own.flatMap(({ a }) => (votesOf.get(a.id) ?? []).map((v) => ({ v, a }))), ({ v }) => v.creator_id!);
      for (const [person, list] of byPerson) {
        voted.add(person);
        facts.push(reviewFact(`review:${q.id}:${person}`, `take:${q.id}`, person, list.map(({ v, a }) => ({ ...v, label: labelOf(a) }))));
        report.reviews += 1;
      }

      // What hangs off a part: a back translation with audio, or a transcription or written translation as a note.
      for (const { a } of own) {
        for (const child of childrenOf.get(a.id) ?? []) {
          const text = textOf(child);
          const r = cardsOf(child);
          report.missingFiles.push(...r.lost);
          if (child.content_type === 'translation' && r.cards.length > 0) {
            for (const c of r.cards) if (c.format === 'wav') wavHashes.add(c.hash);
            facts.push(backTranslationFact(`bt:${child.id}`, `take:${q.id}`, actor(child.creator_id), at(child.created_at), r.cards, text, r.waiting));
            report.backTranslations += 1;
          } else if (text) {
            facts.push(writtenFact(`note:${child.id}`, unitId, actor(child.creator_id), at(child.created_at), `${labelOf(a)}: ${text}`, child.content_type === 'transcription' ? 'transcription' : 'translation'));
            report.notes += 1;
          }
        }
        // A part with words and no audio: a note, so nothing written is lost.
        const r = cardsOf(a);
        const text = textOf(a);
        if (r.cards.length === 0 && !r.waiting && text) {
          facts.push(writtenFact(`note:${a.id}`, unitId, actor(a.creator_id), at(a.created_at), text, 'translation'));
          report.notes += 1;
        }
      }
    }

    // Source material: each piece a passage, its translations versions of it.
    material.forEach(({ p, a }, i) => {
      const passage = a.id;
      const label = a.name?.trim() || textOf(a).slice(0, 60) || `Part ${i + 1}`;
      facts.push(unitFact(`unit:${a.id}`, passage, unitId, 'passage', label, `${pad(p.order_index)}.${pad(i)}`, actor(a.creator_id), at(a.created_at), false, at(a.last_updated)));
      report.passages += 1;
      const fields: Said[] = [];
      for (const [j, c] of (contentsOf.get(a.id) ?? []).entries()) {
        if (c.text?.trim()) fields.push({ type: 'v1.MaterialFieldSet', payload: { materialId: `v2src:${a.id}`, fieldId: `${j}:text`, text: c.text } });
        (c.audio ?? []).forEach((raw, k) => {
          const file = ctx.files.get(bucketName(raw) ?? '');
          if (!file) return;
          if (file.format === 'wav') wavHashes.add(file.hash);
          fields.push({ type: 'v1.MaterialFieldSet', payload: { materialId: `v2src:${a.id}`, fieldId: `${j}:audio:${k}`, blobHash: file.hash } });
        });
      }
      if (fields.length > 0) {
        facts.push({
          key: `src:${a.id}`, streamId: languageId, actorId: actor(a.creator_id), at: at(a.created_at), unsay: 'redact',
          say: () => [{ type: 'v1.MaterialDefined', payload: { materialId: `v2src:${a.id}`, kind: 'source', title: 'Source', scope: { unitId: passage } } }, ...fields]
        });
        report.materials += 1;
      }
      for (const t of (childrenOf.get(a.id) ?? []).sort((x, y) => x.created_at.localeCompare(y.created_at) || x.id.localeCompare(y.id))) {
        const r = cardsOf(t);
        report.missingFiles.push(...r.lost);
        if (r.waiting) report.waiting += 1;
        if (r.cards.length === 0) {
          const text = textOf(t);
          if (text && !r.waiting) {
            facts.push(writtenFact(`note:${t.id}`, passage, actor(t.creator_id), at(t.created_at), text, 'translation'));
            report.notes += 1;
          }
          continue;
        }
        recorded.add(actor(t.creator_id));
        facts.push({
          key: `rec:${t.id}`, streamId: languageId, actorId: actor(t.creator_id), at: at(t.created_at), unsay: 'redact', hold: r.waiting,
          say: (s) => [{ type: 'v1.RecordingAdded', payload: { recordingId: `rec:${t.id}#${s.n}`, unitId: passage, kind: 'target', cards: r.cards } }]
        });
        facts.push(takeFact(`take:${t.id}`, passage, r.cards.map((c) => c.hash), actor(t.creator_id), at(t.created_at), r.waiting));
        report.recordings += 1;
        report.versions += 1;
        for (const [person, list] of groupBy(votesOf.get(t.id) ?? [], (v) => v.creator_id!)) {
          voted.add(person);
          facts.push(reviewFact(`review:${t.id}:${person}`, `take:${t.id}`, person, list.map((v) => ({ ...v, label: '' }))));
          report.reviews += 1;
        }
      }
    });
  }

  // A file that is not m4a, used where only the log can say so (decisions.md 77).
  for (const hash of [...wavHashes].sort()) {
    facts.push({
      key: `format:${hash}`, streamId: languageId, actorId: owner, at: t0, restate: false, unsay: nothing,
      say: () => [{ type: 'v1.AudioFormatSet', payload: { hash, format: 'wav' } }]
    });
  }

  // ---- members ---------------------------------------------------------------------------
  // v2 knows owner and member only; the role here follows what people did,
  // as the first import had it, and v2 lets people who are not members
  // record and vote on open projects.
  const roles = new Map<string, Role>();
  for (const id of [...rows.members.filter((m) => m.active).map((m) => m.profile_id), ...recorded, ...voted]) {
    if (id === SYSTEM_ACTOR || roles.has(id)) continue;
    roles.set(id, recorded.has(id) && voted.has(id) ? 'coordinator' : voted.has(id) ? 'reviewer' : 'translator');
  }
  for (const m of owners) roles.set(m.profile_id, 'owner');
  // Someone who left a v2 project has left the language, whatever they did there.
  for (const m of rows.members) if (!m.active) roles.delete(m.profile_id);
  // What the dashboard chose wins over all of that.
  for (const [id, role] of ctx.roles ?? []) {
    if (role === 'none') roles.delete(id);
    else roles.set(id, role);
  }
  const scope = { level: 'language' as const, languageId };
  const membership = new Map(rows.members.map((m) => [m.profile_id, m]));
  const firstWork = (id: string) => {
    const times = [...rows.assets, ...rows.votes].filter((r) => r.creator_id === id).map((r) => at(r.created_at));
    return times.length ? times.reduce((a, b) => (Date.parse(a) < Date.parse(b) ? a : b)) : t0;
  };
  const people = new Set([...roles.keys(), ...rows.members.map((m) => m.profile_id)]);
  for (const id of [...people].sort()) {
    const m = membership.get(id);
    const role = roles.get(id);
    facts.push({
      key: `member:${id}`, streamId: ORG_STREAM, actorId: owner,
      at: m ? at(role === undefined ? m.last_updated : m.created_at) : firstWork(id),
      gone: role === undefined,
      say: () => [{ type: 'v1.MemberAdded', payload: { profileId: id, roleId: ROLE_ID[role ?? 'translator'], scope } }],
      unsay: () => [{ type: 'v1.MemberRemoved', payload: { profileId: id, scope } }]
    });
  }
  return { facts, roles, owner, report };

  // ---- fact makers -----------------------------------------------------------------------
  function unitFact(key: string, unitId: string, parentUnitId: string | null, kind: string, label: string, order: string, actorId: string, when: string, gone: boolean, goneAt: string): Fact {
    return {
      key, streamId: languageId, actorId, at: gone ? goneAt : when, restate: false, gone,
      say: () => [{ type: 'v1.UnitAdded', payload: { unitId, parentUnitId, kind, label, order } }],
      unsay: () => [{ type: 'v1.UnitHidden', payload: { unitId, hidden: true } }],
      resay: () => [{ type: 'v1.UnitHidden', payload: { unitId, hidden: false } }]
    };
  }

  function takeFact(key: string, unitId: string, cardHashes: string[], actorId: string, when: string, hold: boolean): Fact {
    return {
      key, streamId: languageId, actorId, at: when, unsay: 'redact', hold, value: cardHashes,
      say: (s) => [
        { type: 'v1.TakeComposed', payload: { takeId: `${key}#${s.n}`, unitId, cardHashes, parentTakeId: s.lastSaid ? `${key}#${s.lastSaid}` : null } },
        { type: 'v1.TakeSubmitted', payload: { takeId: `${key}#${s.n}` } }
      ]
    };
  }

  function reviewFact(key: string, takeKey: string, person: string, votes: { polarity: string; comment: string | null; created_at: string; label: string }[]): Fact {
    const down = votes.some((v) => v.polarity === 'down');
    const comment = votes.filter((v) => v.comment?.trim()).sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((v) => (v.label ? `${v.label}: ${v.comment!.trim()}` : v.comment!.trim())).join('\n');
    const value = { outcome: down ? 'needs_changes' : 'looks_good', comment };
    return {
      key, streamId: languageId, actorId: person, at: latest(votes.map((v) => at(v.created_at))), unsay: 'redact', value,
      say: (s, look) => {
        const take = look(takeKey);
        if (!take?.lastSaid) return [];
        return [{
          type: 'v1.ReviewRecorded',
          payload: { reviewId: `${key}#${s.n}`, takeId: `${takeKey}#${take.lastSaid}`, kindId: COMMUNITY, outcome: value.outcome as 'looks_good' | 'needs_changes', via: 'app', ...(comment ? { comment } : {}) }
        }];
      }
    };
  }

  function backTranslationFact(key: string, takeKey: string, actorId: string, when: string, cards: Card[], text: string, hold: boolean): Fact {
    return {
      key, streamId: languageId, actorId, at: when, unsay: 'redact', hold, value: { cards, text },
      say: (s, look) => {
        const take = look(takeKey);
        if (!take?.lastSaid) return [];
        return [{
          type: 'v1.ReviewRecorded',
          payload: { reviewId: `${key}#${s.n}`, takeId: `${takeKey}#${take.lastSaid}`, kindId: BACK_TRANSLATION, outcome: 'recorded', via: 'app', artifacts: cards, ...(text ? { comment: text } : {}) }
        }];
      }
    };
  }

  /**
   * Written work: a transcription, or a translation with words and no audio.
   * This app has no written translations yet, so each is a note on its
   * passage and nothing written is lost. Written translations alongside
   * audio are being planned; when they exist, this is the one place that
   * changes (`kind` says which is which).
   */
  function writtenFact(key: string, unitId: string, actorId: string, when: string, text: string, _kind: 'transcription' | 'translation'): Fact {
    return {
      key, streamId: languageId, actorId, at: when, unsay: 'redact',
      say: (s) => [{ type: 'v1.NoteAdded', payload: { noteId: `${key}#${s.n}`, unitId, anchor: { kind: 'passage' }, text } }]
    };
  }
}

/** The verses a part holds, as chapter:verse, from v2's `{ verse: { from, to } }` in a chapter or one-chapter FIA quest. */
function verseOf(meta: Record<string, unknown> | null, q: V2Quest, template: string | null): { from: string; to: string } | null {
  const verse = meta?.['verse'] as { from?: unknown; to?: unknown } | undefined;
  const from = Number(verse?.from);
  const to = Number(verse?.to ?? verse?.from);
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from) return null;
  const chapter = chapterOf(q, template);
  return chapter ? { from: `${chapter}:${from}`, to: `${chapter}:${to}` } : null;
}

function chapterOf(q: V2Quest, template: string | null): number | null {
  const meta = metadataOf(q.metadata);
  if (template === 'bible') {
    const c = Number((meta?.['bible'] as { chapter?: unknown } | undefined)?.chapter);
    return Number.isInteger(c) && c > 0 ? c : null;
  }
  if (template === 'fia') {
    const range = String((meta?.['fia'] as { verseRange?: unknown } | undefined)?.verseRange ?? '');
    const m = /^(\d+):\d+[a-z]?-(?:(\d+):)?\d+[a-z]?$/.exec(range);
    return m && (!m[2] || m[2] === m[1]) ? Number(m[1]) : null;
  }
  return null;
}

function groupBy<T, K>(items: readonly T[], key: (t: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const t of items) {
    const k = key(t);
    const list = out.get(k);
    if (list) list.push(t);
    else out.set(k, [t]);
  }
  return out;
}
