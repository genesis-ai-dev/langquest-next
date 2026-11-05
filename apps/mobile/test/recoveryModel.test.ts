import { recoveredRecording, saysFileMissing } from '../src/sync/recoveryModel';
import { recoveryCode, recoverRecordings, type RecoveryEnv } from '../src/sync/recoverRecordings';
import type { JournalEntry } from '../src/recording/recordingJournalModel';

const entry = (over: Partial<JournalEntry> = {}) => ({
  id: 'rec-1', uri: 'file:///a.wav', format: 'wav' as const, durationMs: 900, stage: 'ingested' as const, hash: 'h1',
  target: { orgId: 'org', languageId: 'lang', unitId: 'passage' }, ...over
});

describe('recovered recording payload', () => {
  it('carries the journal id, the passage and one target card', () => {
    expect(recoveredRecording(entry())).toEqual({
      recordingId: 'rec-1', unitId: 'passage', kind: 'target',
      cards: [{ hash: 'h1', durationMs: 900, format: 'wav' }]
    });
  });

  it('names a vanished file apart from other failures, by cause class only', () => {
    expect(saysFileMissing('Recording file is missing; keep the journal for recovery.')).toBe(true);
    expect(saysFileMissing('ENOSPC: no space left')).toBe(false);
    expect(recoveryCode('No such file or directory')).toBe('missing');
  });
});

describe('recoverRecordings', () => {
  function setup(resumeResult: { resumed: string[]; dropped: string[]; failed: { id: string; error: string }[] } | Error) {
    const log = { appended: [] as unknown[], refreshed: 0, uploads: 0, noted: [] as (string | undefined)[], reported: [] as string[] };
    const session = {
      hasRecording: async () => false,
      refresh: async () => { log.refreshed += 1; },
      triggerUpload: () => { log.uploads += 1; },
      client: { append: async (_type: string, payload: unknown) => { log.appended.push(payload); } }
    } as unknown as Parameters<typeof recoverRecordings>[0];
    const files = { exists: () => true, ingest: async () => ({ ref: { hash: 'h', format: 'wav' }, size: 5 }) } as unknown as Parameters<typeof recoverRecordings>[1];
    const env: RecoveryEnv = {
      journal: {
        resume: async (_language, deps) => {
          if (resumeResult instanceof Error) throw resumeResult;
          await deps.append(entry());
          return resumeResult;
        }
      },
      cut: async (uri) => uri, deleteChunk: () => {},
      reportError: (where) => { log.reported.push(where); },
      noteExpected: (_where, _e, code) => { log.noted.push(code); }
    };
    return { session, files, env, log };
  }
  const language = { orgId: 'org', languageId: 'lang' };

  it('appends the recovered card, then refreshes and uploads', async () => {
    const { session, files, env, log } = setup({ resumed: ['rec-1'], dropped: [], failed: [] });
    expect(await recoverRecordings(session, files, language, env)).toBe(true);
    expect(log.appended).toEqual([recoveredRecording(entry())]);
    expect(log).toMatchObject({ refreshed: 1, uploads: 1 });
  });

  it('counts a failed entry by class and does nothing else when nothing resumed', async () => {
    const { session, files, env, log } = setup({ resumed: [], dropped: [], failed: [{ id: 'x', error: 'file is missing' }] });
    expect(await recoverRecordings(session, files, language, env)).toBe(false);
    expect(log.noted).toEqual(['missing']);
    expect(log).toMatchObject({ refreshed: 0, uploads: 0 });
  });

  it('reports a journal that threw, and a cancelled open leaves the session alone', async () => {
    const a = setup(new Error('boom'));
    expect(await recoverRecordings(a.session, a.files, language, a.env)).toBe(false);
    expect(a.log.reported).toEqual(['recording recovery']);
    const b = setup({ resumed: ['rec-1'], dropped: [], failed: [] });
    expect(await recoverRecordings(b.session, b.files, language, b.env, () => true)).toBe(false);
    expect(b.log.refreshed).toBe(0);
  });
});
