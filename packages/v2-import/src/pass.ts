import { ORG_STREAM, subscriptionItemId, type AnyEvent, type Role } from '@langquest-next/core';
import { durationMs, formatOf, sha256Hex, type AudioFormat } from './audio';
import { chosenHere, mapProject, type CopiedFile, type MapContext, type MapReport, type TemplateRef } from './map';
import { shownName } from './board';
import { LIBRARY_ORG, libraryFact, orgFacts } from './orgFacts';
import type { V2Reader, V2ProjectSummary } from './reader';
import { reconcile, type Fact, type LedgerEntry } from './reconcile';
import { bucketName, isoTime, type V2ProjectRows } from './rows';
import type { LogLine, Plan, PlanOrg, Progress, Target } from './target';

/**
 * A transfer (a pass, docs/v2-import.md sections 1 and 5): for each
 * confirmed v2 project that may have changed, read it whole, copy the files
 * it names, and append what it says now that the import has not said yet.
 * Each one records its progress while it runs and writes a running log, so
 * the dashboard shows what is happening wherever the transfer runs.
 */

export interface PassDeps {
  v2: V2Reader;
  target: Target;
  now?: () => number;
  /** Also print the log here (the command line); the line names a project only by id. */
  print?: (projectId: string, level: LogLine['level'], message: string) => void;
  /** Who starts these transfers: a person's name, or "every 15 minutes". */
  by?: string;
  /** Bytes already downloaded, so a second upload (a cloned project's files) need not download again. */
  cache?: { get(name: string): Promise<Uint8Array | null>; put(name: string, bytes: Uint8Array): Promise<void> };
  concurrency?: number;
  /** How a retry waits (tests pass one that does not). */
  wait?: (ms: number) => Promise<void>;
  /**
   * A v2 file this app does not play (MP3 chapters a team uploaded, a
   * browser's WebM), as AAC in M4A, as a phone keeps a take (decisions.md
   * 58, 106); null when it cannot be read. Without one, such a file is left
   * for a run that can convert it, and is not marked missing.
   */
  convert?: (bytes: Uint8Array) => Promise<Uint8Array | null>;
  /**
   * Asked before each project. True stops the pass there (the job container
   * asks to stop on SIGTERM, decisions.md 141): the project in hand finishes,
   * the rest wait for the next pass, and the cursor does not move.
   */
  stop?: () => boolean;
}

export interface ProjectReport {
  projectId: string;
  /** The language it came over into, when not the project's own id: it came over again into another organization. */
  languageId?: string;
  skipped?: string;
  map?: MapReport;
  files?: { copied: number; missing: number; uploaded: number; converted: number; unreadable: number; later: number; mismatched: number };
  append?: { accepted: number; duplicates: number; rejected: number };
  /** What was added, in words: "recordings" → 1,200. */
  added?: Record<string, number>;
  rejected?: { id: string; reason: string }[];
  /** Facts whose events were refused, so they are said again next pass. */
  retry?: number;
  /** What stopped the project (with `skipped: 'failed: …'`), for the pass's job run to classify. */
  error?: unknown;
}

/** The ways LangQuest's Bible is broken up that v2's templates become (question 9 a). */
export const WAYS = {
  bible: { sourceItemId: 'langquest.bible.chapters', name: 'By chapter' },
  fia: { sourceItemId: 'langquest.bible.fia', name: 'FIA passages' }
} as const;

/** FIA's study guides, one library item per language (`langquest.fia.fra`); a team gets them in the language it reads, else English. */
export const FIA_GUIDES = 'langquest.fia';

/** v2's own clocks are phones'; look this far back for rows that arrived late. */
const OVERLAP_MS = 24 * 3600_000;
/** A file v2 did not have is looked for again for this long. */
const RECHECK_MS = 7 * 24 * 3600_000;
/** For this long a missing file is looked for on every pass: a phone's upload can trail its rows. */
const TRAILING_MS = 3600_000;
/** A whole read cut off (a deploy's rollout) resumes for this long after it began; later, the next starts over. */
const RESUME_MS = 24 * 3600_000;

/** What an event adds, in the words the log uses; events not named here are left out of the summary. */
const ADDS: Partial<Record<AnyEvent['type'], string>> = {
  'v1.RecordingAdded': 'recordings',
  'v1.TakeSubmitted': 'versions',
  'v1.ReviewRecorded': 'reviews',
  'v1.NoteAdded': 'notes',
  'v1.UnitAdded': 'books and passages',
  'v1.MemberAdded': 'people',
  'v1.MemberRemoved': 'people removed',
  'v1.Redacted': 'taken back',
  'v1.UnitHidden': 'parts hidden or shown',
  'v1.MaterialDefined': 'source materials'
};

export async function sync(deps: PassDeps, opts: { all?: boolean; projects?: string[]; summaries?: V2ProjectSummary[] } = {}): Promise<ProjectReport[]> {
  const now = deps.now ?? Date.now;
  const started = new Date(now());
  const plan = await deps.target.plan();
  const confirmed = plan.placements.filter((p) => p.confirmed_at && p.org_id).map((p) => p.project_id);
  const passed = new Set(plan.passes.map((p) => p.project_id));
  let ids: string[];
  if (opts.projects?.length) ids = opts.projects.filter((id) => confirmed.includes(id));
  else if (opts.all) ids = await wholeRead(deps, plan.passes, confirmed, started);
  else {
    const since = await deps.target.cursor('changes');
    const changed = since ? await deps.v2.changedSince(new Date(since.getTime() - OVERLAP_MS)) : null;
    // One that came over again since its last pass is read whole now, whatever v2 says changed.
    const lastPass = new Map(plan.passes.map((p) => [p.project_id, Date.parse(p.finished_at)]));
    const moved = new Set(plan.placements.filter((p) => p.moved_at && Date.parse(p.moved_at) > (lastPass.get(p.project_id) ?? 0)).map((p) => p.project_id));
    ids = confirmed.filter((id) => !changed || changed.has(id) || !passed.has(id) || moved.has(id));
  }
  deps.print?.('', 'info', `${ids.length} of ${confirmed.length} confirmed projects to read`);
  const summaries = new Map((opts.summaries ?? (await deps.v2.projects())).map((p) => [p.id, p]));
  // A whole read, or projects someone named, looks again for files missing up to a week; a 15-minute pass does not.
  const run = new Run(deps, plan, summaries, !!opts.all || !!opts.projects?.length);
  const reports: ProjectReport[] = [];
  let failed = 0;
  let stopped = false;
  for (const id of ids) {
    if (deps.stop?.()) {
      stopped = true;
      deps.print?.('', 'info', `stopped after ${reports.length} of ${ids.length} projects`);
      break;
    }
    try {
      reports.push(await run.project(id));
    } catch (e) {
      failed += 1;
      reports.push({ projectId: id, skipped: `failed: ${(e as Error).message}`, error: e });
    }
  }
  // Only a pass that read everything it meant to moves the cursor; otherwise the next looks again.
  if (!opts.projects?.length && failed === 0 && !stopped) {
    await deps.target.cursor('changes', started);
    if (opts.all) await deps.target.cursor('whole_done', new Date(now()));
  }
  return reports;
}

/**
 * Whether a pass asks v2's storage for a file. One never looked for, yes;
 * one missing under an hour, on every pass, since a phone's upload can
 * trail its rows; one missing up to a week, only in the nightly whole read
 * (or a transfer someone started for the project), so about once a day: on 2026-10-20 the 15-minute pass asked again for some
 * 10,000 absent files every time and took 10 of its 15 minutes. Older, no, unless v2 says it has the file
 * now (`arrivedAt`, its `audio_uploaded_at`) and got it after the import missed it: a phone that sent its
 * rows weeks before its audio. Then the pass that sees it arrive asks, and every whole read until it is copied.
 */
export function looksFor(known: CopiedFile | { missingSince: string } | undefined, now: number, whole: boolean, arrivedAt?: number): boolean {
  if (!known) return true;
  if (!('missingSince' in known)) return false;
  const missed = Date.parse(known.missingSince);
  const age = now - missed;
  if (age < TRAILING_MS || (whole && age < RECHECK_MS)) return true;
  return arrivedAt !== undefined && arrivedAt > missed && (whole || now - arrivedAt < TRAILING_MS);
}

/**
 * The projects a whole read still has to read. A whole read begun less than
 * a day ago and never finished (a deploy's rollout stopped it, decisions.md
 * 141) resumes: a project read since it began, by it or by a 15-minute pass,
 * was read whole then and is not read again. Otherwise a new one begins.
 */
async function wholeRead(deps: PassDeps, passes: Plan['passes'], confirmed: string[], started: Date): Promise<string[]> {
  const begun = await deps.target.cursor('whole');
  const done = await deps.target.cursor('whole_done');
  if (begun && (!done || done < begun) && started.getTime() - begun.getTime() < RESUME_MS) {
    const readSince = new Set(passes.filter((p) => Date.parse(p.finished_at) >= begun.getTime()).map((p) => p.project_id));
    const ids = confirmed.filter((id) => !readSince.has(id));
    deps.print?.('', 'info', `resuming the whole read begun ${begun.toISOString()}: ${confirmed.length - ids.length} projects already read since`);
    return ids;
  }
  await deps.target.cursor('whole', started);
  return confirmed;
}

class Run {
  private templates = new Map<string, Promise<TemplateRef | null>>();
  private orgsDone = new Set<string>();
  private followed = new Map<string, Promise<{ itemId: string; name: string } | null>>();
  /** Per organization: an admin the import made there already, who signs changes to who is in it. */
  private managers = new Map<string, string>();
  /** v2 people confirmed on the dashboard as an account already in Next, by v2 id. */
  private get people(): ReadonlyMap<string, string> {
    return new Map((this.plan.links ?? []).filter((l) => l.active !== false).map((l) => [l.v2_id, l.next_id]));
  }
  /** Links undone on the dashboard, by v2 id: the Next account they had pointed to. */
  private get released(): ReadonlyMap<string, string> {
    return new Map((this.plan.links ?? []).filter((l) => l.active === false).map((l) => [l.v2_id, l.next_id]));
  }

  constructor(private deps: PassDeps, private plan: Plan, private summaries: Map<string, V2ProjectSummary>, private whole = false) {}

  private now() { return (this.deps.now ?? Date.now)(); }

  private template(kind: 'bible' | 'fia'): Promise<TemplateRef | null> {
    const way = WAYS[kind];
    let p = this.templates.get(kind);
    if (!p) {
      p = this.deps.target.template(way.sourceItemId).then((t) => t && { itemId: subscriptionItemId(LIBRARY_ORG.id, way.sourceItemId), docHash: t.docHash, doc: t.doc, versification: t.versification });
      this.templates.set(kind, p);
    }
    return p;
  }

  async project(projectId: string): Promise<ProjectReport> {
    const placement = this.plan.placements.find((p) => p.project_id === projectId);
    const org = this.plan.orgs.find((o) => o.org_id === placement?.org_id);
    if (!placement?.confirmed_at || !org) return { projectId, skipped: 'not confirmed on the board' };
    const name = this.summaries.get(projectId)?.name ?? projectId;
    // The project's own id, unless it came over again into another organization as a new language.
    const languageId = placement.language_id ?? projectId;
    const passId = await this.deps.target.passStart(projectId, org.org_id, this.deps.by ?? 'unknown');
    const say = (level: LogLine['level'], message: string, counts?: Record<string, number>) => {
      this.deps.print?.(projectId, level, message);
      return this.deps.target.log([{ pass_id: passId, project_id: projectId, org_id: org.org_id, level, message, ...(counts ? { counts } : {}) }]);
    };
    // Progress is written at most once a second, and always when the step changes.
    let lastStep = '';
    let lastAt = 0;
    const progress = async (p: Progress) => {
      if (p.step === lastStep && this.now() - lastAt < 1000 && p.done !== p.total) return;
      lastStep = p.step;
      lastAt = this.now();
      await this.deps.target.passProgress(passId, p);
    };
    const report: ProjectReport = { projectId, ...(languageId !== projectId ? { languageId } : {}) };
    try {
      await say('info', `Started: ${name} → ${org.name}`);
      await progress({ step: 'reading' });
      await this.organization(org, say);
      const t0 = this.now();
      const rows = await this.deps.v2.projectRows(projectId);
      await say('info', `Read ${n(rows.assets.length)} recordings in ${n(rows.quests.length)} quests, and ${n(rows.votes.length)} votes (${((this.now() - t0) / 1000).toFixed(1)} s)`);

      const kind = rows.project.template === 'bible' || rows.project.template === 'fia' ? rows.project.template : null;
      const template = kind ? await this.template(kind) : null;
      if (template) await this.deps.target.grantLibrary(org.org_id, template.docHash);

      const source = rows.languages.find((l) => l.active && l.language_type === 'source')?.languoid_id;
      const sourceCode = (source && (await this.deps.target.languoidCode(source))) || 'eng';
      const guides = kind === 'fia' ? await this.fiaGuides(org, sourceCode, say) : null;
      // A language chosen without its code takes the language list's; one not chosen comes over unlinked.
      const code = placement.code ?? (placement.languoid_id ? await this.deps.target.languoidCode(placement.languoid_id) : null);
      // Roles chosen on the dashboard; an organization role's id stands for the project role with its privileges.
      const ROLE: Record<string, Role | 'none'> = { org_admin: 'owner', coordinator: 'coordinator', translator: 'translator', reviewer: 'reviewer', viewer: 'viewer', none: 'none' };
      const roles = new Map((this.plan.roles ?? []).filter((r) => r.project_id === projectId).map((r) => [r.profile_id, ROLE[r.role]!] as const));
      const decidedAt = placement.confirmed_at;
      const context = (files: ReadonlyMap<string, CopiedFile>): MapContext => ({
        orgId: org.org_id,
        languageId,
        language: { code, languoidId: placement.languoid_id, sourceCode, decidedAt, ...(placement.name ? { name: placement.name } : {}) },
        roles,
        people: this.people,
        released: this.released,
        ...(this.managers.get(org.org_id) ? { manager: this.managers.get(org.org_id)! } : {}),
        files,
        templates: template && kind ? { [kind]: template } : {},
        ...(guides ? { guides } : {}),
        now: this.now()
      });
      // Which files stay in v2 (written work) does not depend on the files, so it is known before copying,
      // and each file the language uses is stored in Next as soon as it is downloaded: once, not twice.
      const held = new Set(mapProject(rows, context(new Map())).report.heldFiles);
      const files = await this.copyFiles(rows, progress, { orgId: org.org_id, languageId, skip: held });
      const { stored, ...counts } = files.counts;
      report.files = { ...counts, uploaded: stored, mismatched: 0 };
      if (files.counts.copied) await say('info', `Copied ${n(files.counts.copied)} audio files from v2`);
      if (files.counts.converted) await say('info', `Of those, ${n(files.counts.converted)} were MP3 or another kind phones may not play, and were converted to M4A`);
      if (files.counts.missing) await say('warn', `${n(files.counts.missing)} audio files are not in v2's storage`);
      if (files.counts.unreadable) await say('warn', `${n(files.counts.unreadable)} files are in v2's storage but could not be read as audio`);
      if (files.counts.later) await say('warn', `${n(files.counts.later)} audio files are MP3 or another kind that needs converting, and this computer cannot convert (it needs ffmpeg); a run that can brings them over`);
      const mapped = mapProject(rows, context(files.map));
      report.map = mapped.report;
      if (mapped.report.heldBack) await say('info', `Left in v2 for now: ${n(mapped.report.heldBack)} written translations, transcriptions and back translations`);
      // Files copied on an earlier pass (or by another project) that this language does not have yet.
      const later = await this.upload(org.org_id, languageId, files.map, rows, progress, new Set(mapped.report.heldFiles));
      report.files.uploaded += later.uploaded;
      report.files.mismatched = later.mismatched;
      if (report.files.uploaded) await say('info', `Stored ${n(report.files.uploaded)} audio files in Next`);
      if (later.mismatched) await say('error', `${n(later.mismatched)} converted files came out different from their first conversion, so they were not stored for this language`);

      // The guides a team is offered are chosen here, so one no longer chosen is taken back; nothing from v2 is.
      // The ledger's scope is the language's id: a project that came over again starts a ledger of its own there.
      const outcome = await this.say(languageId, org.org_id, mapped.facts, progress, this.managers.get(org.org_id) ?? mapped.owner, chosenHere);
      if (outcome.languageAdded && !code) await say('info', `No language linked yet: it comes over as “${placement.name ?? name}”, and its admins can link it in Next`);
      Object.assign(report, outcome);
      const added = outcome.added ?? {};
      const total = outcome.append?.accepted ?? 0;
      if (total) await say('done', `Added to ${org.name} / ${name}: ${summary(added) || `${n(total)} changes`}`, added);
      else if (!outcome.rejected?.length) await say('done', `${name} is up to date`);
      if (outcome.rejected?.length) {
        await say('error', `${n(outcome.append?.rejected ?? 0)} changes were refused: ${outcome.rejected[0]!.reason}. They are tried again next time.`);
      }
      if (mapped.report.waiting) await say('warn', `${n(mapped.report.waiting)} recordings wait for their audio to reach v2`);
      if (mapped.report.unmatchedQuests) await say('warn', `${n(mapped.report.unmatchedQuests)} quests did not match a place in the Bible; they came over as parts of their own`);

      const names = await this.deps.v2.people([...mapped.roles.keys()]);
      // A username that is an email address is not shown to others as a name.
      await this.deps.target.addNames(names.flatMap((p) => { const name = shownName(p.name); return name ? [{ id: p.id, name }] : []; }));
      await progress({ step: 'done' });
      await this.deps.target.passFinish(passId, { ...report, map: { ...mapped.report, missingFiles: mapped.report.missingFiles.length, heldFiles: mapped.report.heldFiles.length } });
      return report;
    } catch (e) {
      const message = (e as Error).message;
      await say('error', `Stopped: ${message}`).catch(() => {});
      await this.deps.target.passFinish(passId, report, message).catch(() => {});
      throw e;
    }
  }

  /** The organization's own facts, once per run, from every project the board puts in it. */
  private async organization(org: PlanOrg, say: (level: LogLine['level'], message: string) => Promise<void>): Promise<void> {
    if (this.orgsDone.has(org.org_id)) return;
    if (!org.existing) {
      const creator = await this.deps.target.orgCreator(org.org_id);
      if (creator && creator !== 'v2import') throw new Error(`${org.name} was made by someone else in Next; choose it on the board as an organization that already exists`);
    }
    const kinds = new Set(this.plan.placements.filter((p) => p.org_id === org.org_id && p.confirmed_at)
      .map((p) => this.summaries.get(p.project_id)?.template).filter((t): t is 'bible' | 'fia' => t === 'bible' || t === 'fia'));
    const ways = [];
    for (const kind of [...kinds].sort()) {
      const t = await this.template(kind);
      if (t) ways.push({ sourceItemId: WAYS[kind].sourceItemId, name: WAYS[kind].name, docHash: t.docHash });
    }
    const at = new Date(this.now()).toISOString();
    const admins = [...new Set(org.admins.map((id) => this.people.get(id) ?? id))];
    // Changes are signed by an admin the import already made, so swapping who someone is (a link or
    // its undo) is signed by someone who is an admin when it lands; a new organization by its first admin.
    const ledger = await this.deps.target.ledger(`org:${org.org_id}`);
    const current = [...ledger.values()].filter((e) => e.key.startsWith('admin:') && !e.withdrawn && e.live.length > 0).map((e) => e.key.slice('admin:'.length));
    const actor = current.find((id) => admins.includes(id)) ?? current[0] ?? admins[0];
    if (actor) this.managers.set(org.org_id, actor);
    const r = await this.say(`org:${org.org_id}`, org.org_id, orgFacts({ orgId: org.org_id, name: org.name, existing: org.existing, admins, ...(actor ? { actor } : {}), ways, at }), undefined, actor, true);
    if (r.created) await say('done', `Created the organization ${org.name} in Next`);
    else if (r.append?.accepted) await say('info', `Updated the organization ${org.name}`);
    if (r.rejected?.length) await say('error', `${org.name}: ${r.rejected[0]!.reason}`);
    this.orgsDone.add(org.org_id);
  }

  /**
   * FIA's study guides for an FIA project's team, in the language it reads,
   * else English: the organization follows them once (in a scope of their
   * own, so nothing else takes them back) and the language is offered them.
   */
  private async fiaGuides(org: PlanOrg, reads: string, say: (level: LogLine['level'], message: string) => Promise<void>): Promise<{ itemId: string } | null> {
    for (const code of new Set([reads, 'eng'])) {
      const sourceItemId = `${FIA_GUIDES}.${code}`;
      const key = `${org.org_id}|${sourceItemId}`;
      let p = this.followed.get(key);
      if (!p) {
        p = (async () => {
          const item = await this.deps.target.libraryItem(sourceItemId);
          if (!item) return null;
          await this.deps.target.grantLibrary(org.org_id, item.docHash);
          const at = new Date(this.now()).toISOString();
          const r = await this.say(`org:${org.org_id}:${sourceItemId}`, org.org_id, [libraryFact({ sourceItemId, name: item.name, docHash: item.docHash, kind: 'material' }, (this.managers.get(org.org_id) ?? 'v2import'), at)]);
          if (r.rejected?.length) throw new Error(`${item.name}: ${r.rejected[0]!.reason}`);
          if (r.append?.accepted) await say('info', `${org.name} now follows ${item.name}`);
          return { itemId: subscriptionItemId(LIBRARY_ORG.id, sourceItemId), name: item.name };
        })();
        this.followed.set(key, p);
      }
      const followed = await p;
      if (followed) return { itemId: followed.itemId };
    }
    return null;
  }

  /** Reconcile, append the organization stream first (a language stream needs its listing), then save what was accepted. */
  private async say(scope: string, orgId: string, facts: Fact[], progress?: (p: Progress) => Promise<void>, actor?: string, takeBackAbsent: boolean | ((key: string) => boolean) = false): Promise<Pick<ProjectReport, 'append' | 'rejected' | 'retry' | 'added'> & { created?: boolean; languageAdded?: boolean }> {
    const ledger = await this.deps.target.ledger(scope);
    const r = reconcile(facts, ledger, { orgId, scope, now: this.now(), ...(actor ? { actor } : {}), takeBackAbsent });
    // v2's stamps go in before the events they are about, so the API never reads imported work without them (decisions.md 188).
    if (r.stamps.length) await this.deps.target.putStamps(orgId, r.stamps);
    const orgEvents = r.events.filter((e) => e.streamId === ORG_STREAM);
    const rest = r.events.filter((e) => e.streamId !== ORG_STREAM);
    const total = r.events.length;
    const report = (done: number) => progress?.({ step: 'events', done, total });
    await report(0);
    const first = await this.deps.target.append(orgEvents, (done) => report(done));
    // Nothing goes into a language the organization stream refused to list.
    const listingRefused = first.rejected.some((x) => r.events.find((e) => e.id === x.id)?.type === 'v1.LanguageAdded');
    const second = listingRefused
      ? { accepted: 0, duplicates: 0, rejected: rest.map((e) => ({ id: e.id, reason: 'its language was not listed' })) }
      : await this.deps.target.append(rest, (done) => report(orgEvents.length + done));
    const rejected = [...first.rejected, ...second.rejected];
    const refusedKeys = new Map<string, string>();
    for (const x of rejected) {
      const key = r.owner.get(x.id);
      if (key) refusedKeys.set(key, x.reason);
    }
    const save: LedgerEntry[] = [];
    for (const [key, entry] of r.entries) {
      const reason = refusedKeys.get(key);
      if (!reason) save.push(entry);
      // An id this pass reused for something else (a pass died between append and saving):
      // keep the number so the next statement takes a fresh one.
      else if (/already used/.test(reason)) save.push({ ...entry, digest: '' });
    }
    await this.deps.target.putLedger(scope, save);
    const refused = new Set(rejected.map((x) => x.id));
    const added: Record<string, number> = {};
    for (const e of r.events) {
      const what = ADDS[e.type];
      if (what && !refused.has(e.id)) added[what] = (added[what] ?? 0) + 1;
    }
    return {
      append: { accepted: first.accepted + second.accepted, duplicates: first.duplicates + second.duplicates, rejected: rejected.length },
      added,
      created: r.events.some((e) => e.type === 'v1.OrgCreated' && !refused.has(e.id)),
      languageAdded: r.events.some((e) => e.type === 'v1.LanguageAdded' && !refused.has(e.id)),
      ...(rejected.length ? { rejected: rejected.slice(0, 50), retry: refusedKeys.size } : {})
    };
  }

  /**
   * Every file the project names: known ones from the file map, new ones
   * downloaded, hashed and measured, and stored for the language there and
   * then unless `store.skip` names it (written work left in v2). A file v2
   * did not have, or had and was not audio, is looked for again for a week,
   * then left to the report. One that needs converting where nothing can
   * convert is not written down, so a run that can convert it finds it.
   */
  private async copyFiles(rows: V2ProjectRows, progress: (p: Progress) => Promise<void>, store: { orgId: string; languageId: string; skip: ReadonlySet<string> }): Promise<{ map: Map<string, CopiedFile>; counts: { copied: number; missing: number; stored: number; converted: number; unreadable: number; later: number } }> {
    const names = namesIn(rows);
    const known = await this.deps.target.files(names);
    const stored = await this.deps.target.stored(store.orgId, store.languageId);
    let storedNow = 0;
    const map = new Map<string, CopiedFile>();
    for (const [name, f] of known) if (!('missingSince' in f)) map.set(name, f);
    const arrived = arrivals(rows);
    const todo = names.filter((n) => looksFor(known.get(n), this.now(), this.whole, arrived.get(n)));
    const found: { name: string; file: CopiedFile | null }[] = [];
    let saved = 0;
    let converted = 0;
    let unreadable = 0;
    let later = 0;
    let tried = 0;
    await progress({ step: 'files', done: 0, total: todo.length });
    await pool(todo, this.deps.concurrency ?? 8, async (name) => {
      const got = await this.playable(name);
      if (got === 'later') later += 1;
      else if (got === 'absent' || got === 'unreadable') {
        if (got === 'unreadable') unreadable += 1;
        found.push({ name, file: null });
      } else {
        const { bytes, format } = got;
        const file: CopiedFile = { hash: await sha256Hex(bytes), size: bytes.length, durationMs: durationMs(bytes, format), format };
        if (!store.skip.has(name) && !stored.has(file.hash)) {
          stored.add(file.hash);
          await again(() => this.deps.target.upload(store.orgId, store.languageId, file.hash, file.format, bytes), this.deps.wait);
          storedNow += 1;
        }
        if (got.converted) converted += 1;
        map.set(name, file);
        found.push({ name, file });
      }
      tried += 1;
      await progress({ step: 'files', done: tried, total: todo.length });
      // Save the file map as it grows, so a transfer that stops keeps what it copied.
      if (found.length - saved >= 500) {
        const batch = found.slice(saved);
        saved = found.length;
        await this.deps.target.putFiles(batch);
      }
    });
    if (found.length > saved) await this.deps.target.putFiles(found.slice(saved));
    const missing = found.filter((f) => !f.file).length - unreadable;
    return { map, counts: { copied: found.filter((f) => f.file).length, missing, stored: storedNow, converted, unreadable, later } };
  }

  /**
   * Put every file the project uses into R2 for its language, once; not the
   * ones `skip` names (written work left in v2). A converted file is
   * converted again here, and stored only if it comes out as it did the
   * first time: R2 refuses bytes that do not hash to their name, and a
   * converter that changed (a new ffmpeg) would otherwise stop the project
   * on every pass.
   */
  private async upload(orgId: string, languageId: string, files: Map<string, CopiedFile>, rows: V2ProjectRows, progress: (p: Progress) => Promise<void>, skip: ReadonlySet<string>): Promise<{ uploaded: number; mismatched: number }> {
    const stored = await this.deps.target.stored(orgId, languageId);
    const todo = new Map<string, { name: string; file: CopiedFile }>();
    for (const name of namesIn(rows)) {
      if (skip.has(name)) continue;
      const file = files.get(name);
      if (file && !stored.has(file.hash) && !todo.has(file.hash)) todo.set(file.hash, { name, file });
    }
    let uploaded = 0;
    let mismatched = 0;
    let tried = 0;
    await progress({ step: 'uploading', done: 0, total: todo.size });
    await pool([...todo.values()], this.deps.concurrency ?? 8, async ({ name, file }) => {
      const got = await this.playable(name);
      if (typeof got === 'object') {
        if (got.converted && (await sha256Hex(got.bytes)) !== file.hash) mismatched += 1;
        else {
          await again(() => this.deps.target.upload(orgId, languageId, file.hash, file.format, got.bytes), this.deps.wait);
          uploaded += 1;
        }
      }
      tried += 1;
      await progress({ step: 'uploading', done: tried, total: todo.size });
    });
    return { uploaded, mismatched };
  }

  /**
   * A file as this app keeps it: WAV or M4A as v2 has it, anything else
   * converted to M4A (`deps.convert`). `absent` when v2's storage does not
   * have it, `unreadable` when it has something that is not audio, `later`
   * when it needs converting and nothing here converts.
   */
  private async playable(name: string): Promise<{ bytes: Uint8Array; format: AudioFormat; converted: boolean } | 'absent' | 'unreadable' | 'later'> {
    const bytes = await this.bytes(name);
    if (!bytes) return 'absent';
    const format = formatOf(bytes);
    if (format) return { bytes, format, converted: false };
    if (!this.deps.convert) return 'later';
    const out = await this.deps.convert(bytes);
    return out && formatOf(out) === 'm4a' ? { bytes: out, format: 'm4a', converted: true } : 'unreadable';
  }

  private async bytes(name: string): Promise<Uint8Array | null> {
    const cached = await this.deps.cache?.get(name);
    if (cached) return cached;
    const bytes = await again(() => this.deps.v2.download(name), this.deps.wait);
    if (bytes) await this.deps.cache?.put(name, bytes);
    return bytes;
  }
}

/** "1,200 recordings, 321 versions": the summary a log line gives. */
export function summary(added: Record<string, number>): string {
  return Object.entries(added).filter(([, c]) => c > 0).sort((a, b) => b[1] - a[1]).map(([what, c]) => `${n(c)} ${what}`).join(', ');
}

const n = (x: number) => x.toLocaleString('en-US');

/** Every bucket file a project's live segments name. */
function namesIn(rows: V2ProjectRows): string[] {
  return [...new Set(rows.contents.filter((c) => c.active).flatMap((c) => (c.audio ?? []).map(bucketName)).filter((x): x is string => !!x))];
}

/** When v2's storage had each file, by name, as its live segments say (`audio_uploaded_at`); the latest when two name one. */
function arrivals(rows: V2ProjectRows): Map<string, number> {
  const out = new Map<string, number>();
  for (const c of rows.contents) {
    const at = c.active && c.audio_uploaded_at ? Date.parse(isoTime(c.audio_uploaded_at)) : NaN;
    if (Number.isNaN(at)) continue;
    for (const raw of c.audio ?? []) {
      const name = bucketName(raw);
      if (name && at > (out.get(name) ?? -Infinity)) out.set(name, at);
    }
  }
  return out;
}

/**
 * A file step tried again after a passing failure (Next's storage answered 502, a connection dropped):
 * five tries in all, waiting 1, 2, 4 and 8 seconds. One hiccup among a big project's thousands of
 * files used to stop the whole transfer before anything was saved.
 */
export async function again<T>(work: () => Promise<T>, wait: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await work();
    } catch (e) {
      if (attempt >= 5) throw e;
      await wait(1000 * 2 ** (attempt - 1));
    }
  }
}

async function pool<T>(items: readonly T[], size: number, work: (t: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    for (let i = next++; i < items.length; i = next++) await work(items[i]!);
  }));
}
