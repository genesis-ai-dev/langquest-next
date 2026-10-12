import { ORG_STREAM, subscriptionItemId } from '@langquest-next/core';
import { durationMs, formatOf, sha256Hex } from './audio';
import { mapProject, type CopiedFile, type MapReport, type TemplateRef } from './map';
import { LIBRARY_ORG, orgFacts } from './orgFacts';
import type { V2Reader, V2ProjectSummary } from './reader';
import { reconcile, type Fact, type LedgerEntry } from './reconcile';
import { bucketName, type V2ProjectRows } from './rows';
import type { Plan, PlanOrg, Target } from './target';

/**
 * A pass: for each confirmed v2 project that may have changed, read it
 * whole, copy the files it names, and append what it says now that the
 * import has not said yet (docs/v2-import.md sections 1 and 5).
 */

export interface PassDeps {
  v2: V2Reader;
  target: Target;
  now?: () => number;
  log?: (line: string) => void;
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

export async function sync(deps: PassDeps, opts: { all?: boolean; projects?: string[] } = {}): Promise<ProjectReport[]> {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? (() => {});
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
  log(`${ids.length} of ${confirmed.length} confirmed projects to read`);
  const summaries = new Map((await deps.v2.projects()).map((p) => [p.id, p]));
  const run = new Run(deps, plan, summaries);
  const reports: ProjectReport[] = [];
  let failed = 0;
  for (const id of ids) {
    try {
      const r = await run.project(id);
      reports.push(r);
      log(`${id}: ${r.skipped ?? `${r.append?.accepted ?? 0} new, ${r.rejected?.length ?? 0} refused, ${r.files?.copied ?? 0} files copied`}`);
    } catch (e) {
      failed += 1;
      reports.push({ projectId: id, skipped: `failed: ${(e as Error).message}` });
      log(`${id}: failed: ${(e as Error).message}`);
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
    const started = new Date(this.now());
    const placement = this.plan.placements.find((p) => p.project_id === projectId);
    const org = this.plan.orgs.find((o) => o.org_id === placement?.org_id);
    if (!placement?.confirmed_at || !org || !placement.code) return { projectId, skipped: 'not confirmed on the board' };

    await this.organization(org);
    const rows = await this.deps.v2.projectRows(projectId);
    const files = await this.copyFiles(rows);
    const kind = rows.project.template === 'bible' || rows.project.template === 'fia' ? rows.project.template : null;
    const template = kind ? await this.template(kind) : null;
    if (template) await this.deps.target.grantLibrary(org.org_id, template.docHash);

    const source = rows.languages.find((l) => l.active && l.language_type === 'source')?.languoid_id;
    const sourceCode = (source && (await this.deps.target.languoidCode(source))) || 'eng';
    const mapped = mapProject(rows, {
      orgId: org.org_id,
      language: { code: placement.code, languoidId: placement.languoid_id, sourceCode, decidedAt: placement.confirmed_at },
      files: files.map,
      templates: template && kind ? { [kind]: template } : {},
      now: this.now()
    });
    const uploaded = await this.upload(org.org_id, projectId, files.map, rows);

    const outcome = await this.say(projectId, org.org_id, mapped.facts);
    const names = await this.deps.v2.people([...mapped.roles.keys()]);
    await this.deps.target.addNames(names.flatMap((p) => (p.name ? [{ id: p.id, name: p.name }] : [])));
    const report: ProjectReport = { projectId, map: mapped.report, files: { ...files.counts, uploaded }, ...outcome };
    await this.deps.target.recordPass(projectId, started, { ...report, map: { ...mapped.report, missingFiles: mapped.report.missingFiles.length } });
    return report;
  }

  /** The organization's own facts, once per run, from every project the board puts in it. */
  private async organization(org: PlanOrg): Promise<void> {
    if (this.orgsDone.has(org.org_id)) return;
    if (!org.existing) {
      const creator = await this.deps.target.orgCreator(org.org_id);
      if (creator && creator !== 'v2import') throw new Error(`organization ${org.org_id} was made by someone else here; choose it on the board as an existing organization`);
    }
    const kinds = new Set(this.plan.placements.filter((p) => p.org_id === org.org_id && p.confirmed_at)
      .map((p) => this.summaries.get(p.project_id)?.template).filter((t): t is 'bible' | 'fia' => t === 'bible' || t === 'fia'));
    const ways = [];
    for (const kind of [...kinds].sort()) {
      const t = await this.template(kind);
      if (t) ways.push({ sourceItemId: WAYS[kind].sourceItemId, name: WAYS[kind].name, docHash: t.docHash });
    }
    const at = new Date(this.now()).toISOString();
    await this.say(`org:${org.org_id}`, org.org_id, orgFacts({ orgId: org.org_id, name: org.name, existing: org.existing, admins: org.admins, ways, at }));
    this.orgsDone.add(org.org_id);
  }

  /** Reconcile, append the organization stream first (a language stream needs its listing), then save what was accepted. */
  private async say(scope: string, orgId: string, facts: Fact[]): Promise<Pick<ProjectReport, 'append' | 'rejected' | 'retry'>> {
    const ledger = await this.deps.target.ledger(scope);
    const r = reconcile(facts, ledger, { orgId, scope, now: this.now() });
    const orgEvents = r.events.filter((e) => e.streamId === ORG_STREAM);
    const rest = r.events.filter((e) => e.streamId !== ORG_STREAM);
    const first = await this.deps.target.append(orgEvents);
    // Nothing goes into a language the organization stream refused to list.
    const listingRefused = first.rejected.some((x) => r.events.find((e) => e.id === x.id)?.type === 'v1.LanguageAdded');
    const second = listingRefused ? { accepted: 0, duplicates: 0, rejected: rest.map((e) => ({ id: e.id, reason: 'its language was not listed' })) } : await this.deps.target.append(rest);
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
    return {
      append: { accepted: first.accepted + second.accepted, duplicates: first.duplicates + second.duplicates, rejected: rejected.length },
      ...(rejected.length ? { rejected: rejected.slice(0, 50), retry: refusedKeys.size } : {})
    };
  }

  /**
   * Every file the project names: known ones from the file map, new ones
   * downloaded, hashed and measured. A file v2 did not have is looked for
   * again for a week, then left to the report.
   */
  private async copyFiles(rows: V2ProjectRows): Promise<{ map: Map<string, CopiedFile>; counts: { copied: number; missing: number } }> {
    const names = namesIn(rows);
    const known = await this.deps.target.files(names);
    const map = new Map<string, CopiedFile>();
    for (const [name, f] of known) if (!('missingSince' in f)) map.set(name, f);
    const todo = names.filter((n) => {
      const f = known.get(n);
      return !f || ('missingSince' in f && this.now() - Date.parse(f.missingSince) < RECHECK_MS);
    });
    const found: { name: string; file: CopiedFile | null }[] = [];
    await pool(todo, this.deps.concurrency ?? 8, async (name) => {
      const bytes = await this.bytes(name);
      const format = bytes ? formatOf(bytes) : null;
      if (!bytes || !format) { found.push({ name, file: null }); return; }
      const file: CopiedFile = { hash: await sha256Hex(bytes), size: bytes.length, durationMs: durationMs(bytes, format), format };
      map.set(name, file);
      found.push({ name, file });
    });
    if (found.length) await this.deps.target.putFiles(found);
    return { map, counts: { copied: found.filter((f) => f.file).length, missing: found.filter((f) => !f.file).length } };
  }

  /** Put every file the project uses into R2 for its language, once. */
  private async upload(orgId: string, languageId: string, files: Map<string, CopiedFile>, rows: V2ProjectRows): Promise<number> {
    const stored = await this.deps.target.stored(orgId, languageId);
    const todo = new Map<string, { name: string; file: CopiedFile }>();
    for (const name of namesIn(rows)) {
      const file = files.get(name);
      if (file && !stored.has(file.hash) && !todo.has(file.hash)) todo.set(file.hash, { name, file });
    }
    let uploaded = 0;
    await pool([...todo.values()], this.deps.concurrency ?? 8, async ({ name, file }) => {
      const bytes = await this.bytes(name);
      if (!bytes) return;
      await this.deps.target.upload(orgId, languageId, file.hash, file.format, bytes);
      uploaded += 1;
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

/** Every bucket file a project's live segments name. */
function namesIn(rows: V2ProjectRows): string[] {
  return [...new Set(rows.contents.filter((c) => c.active).flatMap((c) => (c.audio ?? []).map(bucketName)).filter((n): n is string => !!n))];
}

async function pool<T>(items: readonly T[], size: number, work: (t: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    for (let i = next++; i < items.length; i = next++) await work(items[i]!);
  }));
}

