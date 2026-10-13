import { ORG_STREAM, subscriptionItemId, type AnyEvent, type Role } from '@langquest-next/core';
import { durationMs, formatOf, sha256Hex } from './audio';
import { mapProject, type CopiedFile, type MapReport, type TemplateRef } from './map';
import { LIBRARY_ORG, orgFacts } from './orgFacts';
import type { V2Reader, V2ProjectSummary } from './reader';
import { reconcile, type Fact, type LedgerEntry } from './reconcile';
import { bucketName, type V2ProjectRows } from './rows';
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
}

export interface ProjectReport {
  projectId: string;
  skipped?: string;
  map?: MapReport;
  files?: { copied: number; missing: number; uploaded: number };
  append?: { accepted: number; duplicates: number; rejected: number };
  /** What was added, in words: "recordings" → 1,200. */
  added?: Record<string, number>;
  rejected?: { id: string; reason: string }[];
  /** Facts whose events were refused, so they are said again next pass. */
  retry?: number;
}

/** The ways LangQuest's Bible is broken up that v2's templates become (question 9 a). */
export const WAYS = {
  bible: { sourceItemId: 'langquest.bible.chapters', name: 'By chapter' },
  fia: { sourceItemId: 'langquest.bible.fia', name: 'FIA passages' }
} as const;

/** v2's own clocks are phones'; look this far back for rows that arrived late. */
const OVERLAP_MS = 24 * 3600_000;
/** A file v2 did not have is looked for again for this long. */
const RECHECK_MS = 7 * 24 * 3600_000;

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
  else if (opts.all) ids = confirmed;
  else {
    const since = await deps.target.cursor('changes');
    const changed = since ? await deps.v2.changedSince(new Date(since.getTime() - OVERLAP_MS)) : null;
    ids = confirmed.filter((id) => !changed || changed.has(id) || !passed.has(id));
  }
  deps.print?.('', 'info', `${ids.length} of ${confirmed.length} confirmed projects to read`);
  const summaries = new Map((opts.summaries ?? (await deps.v2.projects())).map((p) => [p.id, p]));
  const run = new Run(deps, plan, summaries);
  const reports: ProjectReport[] = [];
  let failed = 0;
  for (const id of ids) {
    try {
      reports.push(await run.project(id));
    } catch (e) {
      failed += 1;
      reports.push({ projectId: id, skipped: `failed: ${(e as Error).message}` });
    }
  }
  // Only a pass that read everything it meant to moves the cursor; otherwise the next looks again.
  if (!opts.projects?.length && failed === 0) await deps.target.cursor('changes', started);
  return reports;
}

class Run {
  private templates = new Map<string, Promise<TemplateRef | null>>();
  private orgsDone = new Set<string>();

  constructor(private deps: PassDeps, private plan: Plan, private summaries: Map<string, V2ProjectSummary>) {}

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
    if (!placement?.confirmed_at || !org || !placement.code) return { projectId, skipped: 'not confirmed on the board' };
    const name = this.summaries.get(projectId)?.name ?? projectId;
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
    const report: ProjectReport = { projectId };
    try {
      await say('info', `Started: ${name} → ${org.name}`);
      await progress({ step: 'reading' });
      await this.organization(org, say);
      const t0 = this.now();
      const rows = await this.deps.v2.projectRows(projectId);
      await say('info', `Read ${n(rows.assets.length)} recordings in ${n(rows.quests.length)} quests, and ${n(rows.votes.length)} votes (${((this.now() - t0) / 1000).toFixed(1)} s)`);

      const files = await this.copyFiles(rows, progress);
      report.files = { ...files.counts, uploaded: 0 };
      if (files.counts.copied) await say('info', `Copied ${n(files.counts.copied)} audio files from v2`);
      if (files.counts.missing) await say('warn', `${n(files.counts.missing)} audio files are not in v2's storage`);
      const kind = rows.project.template === 'bible' || rows.project.template === 'fia' ? rows.project.template : null;
      const template = kind ? await this.template(kind) : null;
      if (template) await this.deps.target.grantLibrary(org.org_id, template.docHash);

      const source = rows.languages.find((l) => l.active && l.language_type === 'source')?.languoid_id;
      const sourceCode = (source && (await this.deps.target.languoidCode(source))) || 'eng';
      // Roles chosen on the dashboard; an organization role's id stands for the project role with its privileges.
      const ROLE: Record<string, Role | 'none'> = { org_admin: 'owner', coordinator: 'coordinator', translator: 'translator', reviewer: 'reviewer', viewer: 'viewer', none: 'none' };
      const roles = new Map((this.plan.roles ?? []).filter((r) => r.project_id === projectId).map((r) => [r.profile_id, ROLE[r.role]!] as const));
      const mapped = mapProject(rows, {
        orgId: org.org_id,
        language: { code: placement.code, languoidId: placement.languoid_id, sourceCode, decidedAt: placement.confirmed_at, ...(placement.name ? { name: placement.name } : {}) },
        roles,
        files: files.map,
        templates: template && kind ? { [kind]: template } : {},
        now: this.now()
      });
      report.map = mapped.report;
      report.files.uploaded = await this.upload(org.org_id, projectId, files.map, rows, progress);
      if (report.files.uploaded) await say('info', `Stored ${n(report.files.uploaded)} audio files in Next`);

      const outcome = await this.say(projectId, org.org_id, mapped.facts, progress);
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
      await this.deps.target.addNames(names.flatMap((p) => (p.name ? [{ id: p.id, name: p.name }] : [])));
      await progress({ step: 'done' });
      await this.deps.target.passFinish(passId, { ...report, map: { ...mapped.report, missingFiles: mapped.report.missingFiles.length } });
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
    const r = await this.say(`org:${org.org_id}`, org.org_id, orgFacts({ orgId: org.org_id, name: org.name, existing: org.existing, admins: org.admins, ways, at }));
    if (r.created) await say('done', `Created the organization ${org.name} in Next`);
    else if (r.append?.accepted) await say('info', `Updated the organization ${org.name}`);
    if (r.rejected?.length) await say('error', `${org.name}: ${r.rejected[0]!.reason}`);
    this.orgsDone.add(org.org_id);
  }

  /** Reconcile, append the organization stream first (a language stream needs its listing), then save what was accepted. */
  private async say(scope: string, orgId: string, facts: Fact[], progress?: (p: Progress) => Promise<void>): Promise<Pick<ProjectReport, 'append' | 'rejected' | 'retry' | 'added'> & { created?: boolean }> {
    const ledger = await this.deps.target.ledger(scope);
    const r = reconcile(facts, ledger, { orgId, scope, now: this.now() });
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
      ...(rejected.length ? { rejected: rejected.slice(0, 50), retry: refusedKeys.size } : {})
    };
  }

  /**
   * Every file the project names: known ones from the file map, new ones
   * downloaded, hashed and measured. A file v2 did not have is looked for
   * again for a week, then left to the report.
   */
  private async copyFiles(rows: V2ProjectRows, progress: (p: Progress) => Promise<void>): Promise<{ map: Map<string, CopiedFile>; counts: { copied: number; missing: number } }> {
    const names = namesIn(rows);
    const known = await this.deps.target.files(names);
    const map = new Map<string, CopiedFile>();
    for (const [name, f] of known) if (!('missingSince' in f)) map.set(name, f);
    const todo = names.filter((n) => {
      const f = known.get(n);
      return !f || ('missingSince' in f && this.now() - Date.parse(f.missingSince) < RECHECK_MS);
    });
    const found: { name: string; file: CopiedFile | null }[] = [];
    let saved = 0;
    await progress({ step: 'files', done: 0, total: todo.length });
    await pool(todo, this.deps.concurrency ?? 8, async (name) => {
      const bytes = await this.bytes(name);
      const format = bytes ? formatOf(bytes) : null;
      if (!bytes || !format) found.push({ name, file: null });
      else {
        const file: CopiedFile = { hash: await sha256Hex(bytes), size: bytes.length, durationMs: durationMs(bytes, format), format };
        map.set(name, file);
        found.push({ name, file });
      }
      await progress({ step: 'files', done: found.length, total: todo.length });
      // Save the file map as it grows, so a transfer that stops keeps what it copied.
      if (found.length - saved >= 500) {
        const batch = found.slice(saved);
        saved = found.length;
        await this.deps.target.putFiles(batch);
      }
    });
    if (found.length > saved) await this.deps.target.putFiles(found.slice(saved));
    return { map, counts: { copied: found.filter((f) => f.file).length, missing: found.filter((f) => !f.file).length } };
  }

  /** Put every file the project uses into R2 for its language, once. */
  private async upload(orgId: string, languageId: string, files: Map<string, CopiedFile>, rows: V2ProjectRows, progress: (p: Progress) => Promise<void>): Promise<number> {
    const stored = await this.deps.target.stored(orgId, languageId);
    const todo = new Map<string, { name: string; file: CopiedFile }>();
    for (const name of namesIn(rows)) {
      const file = files.get(name);
      if (file && !stored.has(file.hash) && !todo.has(file.hash)) todo.set(file.hash, { name, file });
    }
    let uploaded = 0;
    let tried = 0;
    await progress({ step: 'uploading', done: 0, total: todo.size });
    await pool([...todo.values()], this.deps.concurrency ?? 8, async ({ name, file }) => {
      const bytes = await this.bytes(name);
      if (bytes) {
        await this.deps.target.upload(orgId, languageId, file.hash, file.format, bytes);
        uploaded += 1;
      }
      tried += 1;
      await progress({ step: 'uploading', done: tried, total: todo.size });
    });
    return uploaded;
  }

  private async bytes(name: string): Promise<Uint8Array | null> {
    const cached = await this.deps.cache?.get(name);
    if (cached) return cached;
    const bytes = await this.deps.v2.download(name);
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

async function pool<T>(items: readonly T[], size: number, work: (t: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    for (let i = next++; i < items.length; i = next++) await work(items[i]!);
  }));
}
