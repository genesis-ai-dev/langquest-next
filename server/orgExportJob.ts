import { foldOrg, ORG_STREAM, orgLanguages, planOrgExport, safeName, toCsv, type AnyEvent, type LanguageState, type OrgState } from '@langquest-next/core';
import { ZipWriter } from './orgExportZip';

/**
 * The export's work, apart from where its pieces live (server/orgExport.ts
 * wires the database, the Worker and R2 in): fold the organization and each
 * language to export, plan the archive (core's `planOrgExport`), write the
 * text files, copy each audio file by name from the bucket, then the whole
 * event log. Decisions.md 205, docs/org-export.md.
 */

export interface ExportRequest { orgId: string; /** null: every language of the organization. */ languageIds: string[] | null }

export interface ExportDeps {
  pull(orgId: string, streamId: string, after: number, limit: number): Promise<AnyEvent[]>;
  fold(orgId: string, streamId: string): Promise<LanguageState>;
  names(ids: string[]): Promise<Record<string, string>>;
  /** The bytes of `<org>/<stream>/<hash>.<ext>`, or null when the bucket does not have it. */
  blob(key: string): Promise<Uint8Array | null>;
  progress(p: ExportProgress): Promise<void>;
  now(): number;
}

export interface ExportProgress { phase: 'reading' | 'audio' | 'log' | 'done'; filesDone: number; filesTotal: number; bytes: number }

/** Events per file of the raw log: a Bible-size language stays in files a tool can open. */
export const LOG_FILE_EVENTS = 20_000;

export async function allEvents(deps: Pick<ExportDeps, 'pull'>, orgId: string, streamId: string, each: (page: AnyEvent[]) => Promise<void>): Promise<void> {
  for (let after = 0; ;) {
    const page = await deps.pull(orgId, streamId, after, 1000);
    if (page.length) await each(page);
    if (page.length < 1000) return;
    after = page[page.length - 1]!.serverSeq!;
  }
}

export interface ExportResult { languages: number; files: number; missing: number; bytes: number; events: number }

export async function writeExport(deps: ExportDeps, req: ExportRequest, zip: ZipWriter, shouldStop: () => boolean = () => false): Promise<ExportResult> {
  const now = deps.now();
  const progress = (p: Partial<ExportProgress> & Pick<ExportProgress, 'phase'>) =>
    deps.progress({ filesDone: 0, filesTotal: 0, bytes: zip.bytesWritten, ...p });
  await progress({ phase: 'reading' });

  const orgEvents: AnyEvent[] = [];
  await allEvents(deps, req.orgId, ORG_STREAM, async (page) => { orgEvents.push(...page); });
  const org: OrgState = foldOrg(orgEvents);
  const wanted = orgLanguages(org).map((l) => l.languageId).filter((id) => !req.languageIds || req.languageIds.includes(id));
  const languages = [];
  for (const languageId of wanted) {
    if (shouldStop()) throw new Error('stopped');
    languages.push({ languageId, state: await deps.fold(req.orgId, languageId) });
  }

  // The names come from the database, which the plan cannot read: plan once to learn who appears, then again with their names.
  const seen = new Set<string>();
  const first = planOrgExport({ orgId: req.orgId, org, languages, nameOf: (id) => { seen.add(id); return id; }, now });
  const names = await deps.names([...seen]);
  const plan = planOrgExport({ orgId: req.orgId, org, languages, nameOf: (id) => names[id] || id, now });

  for (const t of plan.texts) await zip.add(t.path, new TextEncoder().encode(t.content), now);

  const missing: string[][] = [['file', 'hash', 'stream']];
  let done = 0;
  for (const a of plan.audio) {
    if (shouldStop()) throw new Error('stopped');
    const bytes = await deps.blob(`${req.orgId}/${a.streamId}/${a.hash}.${a.ext}`);
    if (bytes) await zip.add(a.path, bytes, now); else missing.push([a.path, a.hash, a.streamId]);
    done += 1;
    if (done % 25 === 0 || done === plan.audio.length) await progress({ phase: 'audio', filesDone: done, filesTotal: plan.audio.length });
  }
  await zip.add('metadata/missing-files.csv', new TextEncoder().encode('﻿' + toCsv(missing)), now);

  // The raw log: the organization's stream and each exported language's, as one JSON object per line.
  await progress({ phase: 'log', filesDone: done, filesTotal: plan.audio.length });
  let events = 0;
  for (const streamId of [ORG_STREAM, ...wanted]) {
    let n = 0;
    let lines: string[] = [];
    let part = 0;
    const flush = async () => {
      if (!lines.length) return;
      part += 1;
      await zip.add(`events/${safeName(streamId)}/${String(part).padStart(4, '0')}.jsonl`, new TextEncoder().encode(lines.join('\n') + '\n'), now);
      lines = [];
    };
    await allEvents(deps, req.orgId, streamId, async (page) => {
      for (const e of page) {
        lines.push(JSON.stringify(e));
        n += 1;
        if (lines.length >= LOG_FILE_EVENTS) await flush();
      }
    });
    await flush();
    events += n;
  }
  await zip.finish();
  await progress({ phase: 'done', filesDone: done, filesTotal: plan.audio.length });
  return { languages: languages.length, files: plan.audio.length - (missing.length - 1), missing: missing.length - 1, bytes: zip.bytesWritten, events };
}
