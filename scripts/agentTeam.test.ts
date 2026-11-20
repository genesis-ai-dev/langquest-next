import { readFileSync } from 'node:fs';
import {
  ACTS, causeProven, changesOf, decisionLines, DEFAULT_PLAN, EFFORTS, gate, isJpeg, isTest, LABELS, logTail, MERGE_MARK, MODE_FILE, MODELS, MODES, modeOf, nextStep, OPEN_HOURS,
  pathRefusal, PICTURES, planOf, REASONS, reviewNeeded, saysMerge, TRIES, triesOf, VERDICTS, verdictOf, waitingBody, withTry
} from './agent-team.mjs';
import * as model from '../server/userIssues';

/** The agent team's rule, in code (docs/agent-team.md, docs/decisions/2026-11-19-an-agent-team-fixes-user-issues.md). */

const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

const verdict = (over: Record<string, unknown> = {}) => verdictOf({
  verdict: 'fix', cause: 'save() closes the file before the last part is written.', proof: 'recorder.test.ts fails without the change.', why: '', ...over
});
const CHANGES = [{ file: 'apps/mobile/src/recording/recorder.ts', lines: 6 }, { file: 'apps/mobile/test/recorder.test.ts', lines: 20 }];
const PASSED = { typecheck: 'passed', tests: 'passed' };
const AGREES = { ok: true, why: 'The change does what it says.' };
const all = (over: Record<string, unknown> = {}) => ({ mode: 'on', verdict: verdict(), changes: CHANGES, checks: PASSED, vet: AGREES, ...over });

describe('the mode', () => {
  it('is ask on main until a person changes the file, and ask for anything odd', () => {
    expect(MODES).toEqual(['on', 'ask', 'off']);
    expect(modeOf(read(MODE_FILE))).toBe('ask');
    expect(modeOf('{"mode":"on"}')).toBe('on');
    expect(modeOf('{"mode":"off"}')).toBe('off');
    for (const odd of ['', 'on', '{"mode":"ON"}', '{"mode":true}', '[]', 'null', '{']) expect(modeOf(odd), odd).toBe('ask');
  });

  it('is a file no draft fix may change, nor the rule itself', async () => {
    const { fixRefusal } = await import('./user-issues.mjs');
    for (const p of [MODE_FILE, 'scripts/agent-team.mjs', '.github/workflows/user-issues.yml']) expect(fixRefusal([p], 10), p).toMatch(/which a draft fix may not$/);
  });
});

describe('the manager', () => {
  it('runs on the model and effort the coordinator chose, or the default', () => {
    expect(planOf({ model: 'sonnet', effort: 'low' })).toEqual({ model: 'sonnet', effort: 'low' });
    expect(planOf({ model: 'gpt', effort: 'max' })).toEqual(DEFAULT_PLAN);
    expect(planOf(null)).toEqual(DEFAULT_PLAN);
    expect(planOf({ model: 'opus; rm -rf', effort: ['low'] })).toEqual(DEFAULT_PLAN);
    expect(MODELS).toEqual([...model.FIX_MODELS]);
    expect(EFFORTS).toEqual([...model.FIX_EFFORTS]);
  });

  it('gives a verdict the script checks: an odd one waits for a developer', () => {
    expect(VERDICTS).toEqual([...model.FIX_VERDICTS]);
    expect(verdictOf({ verdict: 'merge it now' }).verdict).toBe('review');
    expect(verdictOf(null)).toEqual({ verdict: 'review', cause: '', proof: '', why: '', twins: '', display: false });
    expect(verdictOf({ display: 'yes' }).display).toBe(false);
    expect(verdictOf({ verdict: 'fix', cause: ' a\nb ', twins: 'x'.repeat(5000) })).toMatchObject({ cause: 'a b', twins: expect.stringMatching(/^x{999}…$/) });
    expect(causeProven(verdict())).toBe(true);
    expect(causeProven(verdict({ proof: '' }))).toBe(false);
    expect(causeProven(verdict({ cause: 'A race.' }))).toBe(false);
  });
});

describe('the gate', () => {
  it('lets a fix merge without a person only when every part of the rule holds', () => {
    expect(gate(all())).toEqual({ merge: true, reason: null, why: 'The change does what it says.' });
    // No limit on its size, and none on how many merge in a day.
    expect(gate(all({ changes: [{ file: 'apps/mobile/src/a.ts', lines: 4000 }, ...Array.from({ length: 40 }, (_, i) => ({ file: `apps/mobile/test/t${i}.test.ts`, lines: 90 }))] })).merge).toBe(true);
  });

  it('says one fixed reason when a fix waits, in the order a developer would ask', () => {
    const reason = (over: Record<string, unknown>) => gate(all(over)).reason;
    expect(reason({ mode: 'ask' })).toBe('mode');
    expect(reason({ mode: 'off' })).toBe('mode');
    expect(reason({ mode: undefined })).toBe('mode');
    expect(reason({ verdict: null })).toBe('unconfirmed');
    expect(reason({ changes: [] })).toBe('unconfirmed');
    expect(reason({ changes: [], verdict: verdict({ verdict: 'not_a_bug' }) })).toBe('not_a_bug');
    expect(reason({ changes: [], verdict: verdict({ verdict: 'decision' }) })).toBe('decision');
    expect(reason({ verdict: verdict({ verdict: 'decision' }) })).toBe('decision');
    expect(reason({ verdict: verdict({ verdict: 'review' }) })).toBe('review');
    expect(reason({ verdict: verdict({ verdict: 'unconfirmed' }) })).toBe('review');
    // `approved` is a developer's word, which the script checks; the manager's verdict alone merges nothing.
    expect(reason({ verdict: verdict({ verdict: 'approved' }) })).toBe('review');
    expect(reason({ verdict: verdict({ proof: '' }) })).toBe('cause');
    expect(reason({ changes: [CHANGES[0]] })).toBe('cause');
    expect(reason({ changes: [CHANGES[0], { file: 'apps/mobile/test/recorder.test.ts', lines: 0 }] })).toBe('cause');
    expect(reason({ changes: [...CHANGES, { file: 'supabase/migrations/20261119000001_x.sql', lines: 3 }] })).toBe('paths');
    expect(reason({ checks: { typecheck: 'failed', tests: 'passed' } })).toBe('checks');
    expect(reason({ checks: { typecheck: 'passed', tests: 'none' } })).toBe('checks');
    expect(reason({ checks: { typecheck: 'passed', tests: 'not run' } })).toBe('checks');
    expect(reason({ vet: null })).toBe('reviewer');
    expect(reason({ vet: { ok: false, why: 'It also changes what a tap does.' } })).toBe('reviewer');
    expect(reason({ instructed: true })).toBe('instruction');
    expect(reason({ app: false })).toBe('app');
    // Every reason is one the Worker keeps and the ops dashboard can say.
    expect(REASONS).toEqual([...model.FIX_REASONS]);
    expect(gate(all({ mode: 'ask' })).why).toContain('passed every other part of the rule');
  });

  it('merges the draft fix a developer read when they say so on the ops dashboard, and never with failing checks', () => {
    const approved = { instructed: true, approved: true, verdict: verdict({ verdict: 'approved' }), vet: null, mode: 'ask' };
    expect(gate(all(approved))).toEqual({ merge: true, reason: null, why: 'A developer said to merge it on the ops dashboard.' });
    expect(gate(all({ ...approved, checks: { typecheck: 'passed', tests: 'failed' } })).reason).toBe('checks');
    expect(gate(all({ ...approved, app: false })).reason).toBe('app');
    expect(saysMerge(['Move the wait.', 'Looks good, merge it.'])).toBe(true);
    expect(saysMerge(['Move the wait before the emerge call.'])).toBe(false);
    expect(saysMerge(undefined)).toBe(false);
  });

  it('takes two pictures of the screen as the proof of a display fix, in place of a test', () => {
    const display = { verdict: verdict({ display: true, proof: 'Before: the label of Save is cut off. After: the whole word shows.' }), changes: [{ file: 'apps/mobile/src/ui/kit.tsx', lines: 2 }] };
    const both = { before: true, after: true };
    expect(gate(all({ ...display, pictures: both, checks: { typecheck: 'passed', tests: 'none' } })).merge).toBe(true);
    expect(gate(all({ ...display, pictures: both })).merge).toBe(true);
    expect(gate(all({ ...display, pictures: { before: true, after: false } }))).toMatchObject({ merge: false, reason: 'cause' });
    expect(gate(all({ ...display })).reason).toBe('cause');
    expect(gate(all({ ...display, pictures: both, checks: { typecheck: 'passed', tests: 'failed' } })).reason).toBe('checks');
    expect(gate(all({ ...display, pictures: both, checks: { typecheck: 'not run', tests: 'none' } })).reason).toBe('checks');
    // The other parts of the rule hold as for any fix: the paths, the reviewer, the mode.
    expect(gate(all({ ...display, pictures: both, changes: [{ file: 'apps/mobile/app.json', lines: 1 }] })).reason).toBe('paths');
    expect(gate(all({ ...display, pictures: both, vet: { ok: false, why: 'The second picture also moves the title.' } })).reason).toBe('reviewer');
    expect(gate(all({ ...display, pictures: both, mode: 'ask' })).reason).toBe('mode');
    // Pictures do not stand in for a test on a fix that is not a display fix.
    expect(gate(all({ changes: [CHANGES[0]], pictures: both })).reason).toBe('cause');
    expect(reviewNeeded({ ...display, checks: { typecheck: 'passed', tests: 'none' }, pictures: both })).toBe(true);
    // The picture job runs the change's code: a file counts only when it is a JPEG of a sane size.
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200)]);
    expect(isJpeg(jpeg)).toBe(true);
    expect(isJpeg(Buffer.from('<svg onload="x">'.repeat(20)))).toBe(false);
    expect(isJpeg(Buffer.concat([jpeg, Buffer.alloc(PICTURES.maxBytes)]))).toBe(false);
  });

  it('keeps a fix that merges without a person to the screens, the ops dashboard and the core, with tests in their folders', () => {
    for (const p of ['apps/mobile/src/screens/record.tsx', 'apps/admin/src/pageIssues.ts', 'packages/core/src/passage.ts', 'apps/mobile/test/recorder.test.ts', 'packages/core/test/passage.test.ts']) {
      expect(pathRefusal(p), p).toBeNull();
    }
    for (const p of ['supabase/migrations/20261119000001_x.sql', 'packages/sync/src/push.ts', 'apps/web/worker/index.ts', 'server/userIssues.ts', 'apps/mobile/app.json',
      'apps/mobile/modules/nearby-link/ios/Link.swift', 'docs/decisions/README.md', 'scripts/diag.ts', 'e2e/ui/record.spec.ts', 'apps/mobile/src/server/v2.ts',
      'apps/mobile/src/diagnostics/send.ts', 'packages/core/src/events.ts', 'packages/core/src/reducer.ts', 'packages/core/src/validate.ts', 'apps/admin/src/auth.ts',
      'apps/mobile/src/recording/recorder.test.ts', 'apps/mobile/src/sync/session.ts', 'apps/mobile/src/auth/signIn.ts', 'apps/mobile/src/roles/model.ts',
      'apps/mobile/src/disguise/model.ts', 'packages/core/src/nearbySigning.ts', 'packages/core/src/snapshot.ts', 'apps/admin/src/db.ts']) {
      expect(pathRefusal(p), p).not.toBeNull();
    }
    expect(isTest('apps/mobile/test/a.test.ts')).toBe(true);
    expect(isTest('apps/mobile/src/a.ts')).toBe(false);
  });

  it('reads what a patch changes, with both names of a file it moves', () => {
    expect(changesOf('3\t2\tapps/mobile/src/a.ts\0-\t-\tapps/mobile/src/b.png\0')).toEqual([{ file: 'apps/mobile/src/a.ts', lines: 5 }, { file: 'apps/mobile/src/b.png', lines: 999 }]);
    expect(changesOf('1\t1\t\0apps/mobile/src/server/a.ts\0apps/mobile/src/a.ts\0')).toEqual([{ file: 'apps/mobile/src/server/a.ts', lines: 2 }, { file: 'apps/mobile/src/a.ts', lines: 0 }]);
    expect(changesOf('')).toEqual([]);
  });

  it('asks the reviewer only for a change that would merge with its word', () => {
    expect(reviewNeeded({ verdict: verdict(), changes: CHANGES, checks: PASSED })).toBe(true);
    expect(reviewNeeded({ verdict: verdict({ verdict: 'review' }), changes: CHANGES, checks: PASSED })).toBe(false);
    expect(reviewNeeded({ verdict: verdict(), changes: [], checks: PASSED })).toBe(false);
    expect(reviewNeeded({ verdict: verdict(), changes: CHANGES, checks: PASSED, instructed: true, approved: true })).toBe(false);
  });
});

describe('a pull request of the team', () => {
  it('says first what happens to it, and marks one that merges without a person', () => {
    expect(decisionLines({ merge: true, reason: null, why: 'The change does what it says.' })[0]).toBe(MERGE_MARK);
    expect(decisionLines({ merge: false, reason: 'mode', why: 'W.' })).toEqual(['**It waits for a developer.** W.']);
    const labels = JSON.parse(read('.github/labels.json')) as { name: string }[];
    for (const name of Object.values(LABELS)) expect(labels.map((l) => l.name), name).toContain(name);
  });

  it('gets up to 3 tries by Claude when it does not get into main, then waits for a developer', () => {
    const now = Date.parse('2026-11-20T12:00:00Z');
    const run = (conclusion: string | null, started_at = '2026-11-20T11:00:00Z') => ({ status: conclusion ? 'completed' : 'in_progress', conclusion, started_at });
    const fresh = { count: 0, last: null, at: null };
    const pr = (over: Record<string, unknown> = {}) => nextStep({ runs: [run('success')], mergeable: 'clean', autoMerge: true, tries: fresh, createdAt: '2026-11-20T10:00:00Z', team: true, ...over }, now);
    expect(TRIES).toBe(3);
    expect(ACTS).toEqual(['rerun', 'update', 'fix']);
    // In the merge queue, checks still running, or no check yet: nothing.
    expect(pr()).toBeNull();
    expect(pr({ runs: [run(null)] })).toBeNull();
    expect(pr({ runs: [] })).toBeNull();
    // Checks failed: first a rerun (a flaky test); failed again after a rerun: the manager changes the code.
    expect(pr({ runs: [run('failure')] })).toEqual({ act: 'rerun', why: 'Its checks failed (gate: failure).', count: 1 });
    expect(pr({ runs: [run('failure')], tries: { count: 1, last: 'rerun', at: '2026-11-20T11:00:00Z' } })).toEqual({ act: 'fix', why: 'Its checks failed (gate: failure).', count: 2 });
    // The newest run counts: a failed first run, then a green one.
    expect(pr({ runs: [run('failure', '2026-11-20T09:00:00Z'), run('success')] })).toBeNull();
    // A conflict with main: the manager writes the fix again on main.
    expect(pr({ mergeable: 'dirty' })).toMatchObject({ act: 'fix', why: 'It has a conflict with main.' });
    // Out of the merge queue (GitHub turned auto-merge off), or no merge in a day: main merged in, auto-merge on again.
    expect(pr({ autoMerge: false })).toMatchObject({ act: 'update', why: 'It left the merge queue and did not merge.' });
    expect(pr({ createdAt: '2026-11-19T11:00:00Z' })).toMatchObject({ act: 'update', why: `It did not merge within ${OPEN_HOURS} hours.` });
    // The day counts from the last try.
    expect(pr({ createdAt: '2026-11-18T11:00:00Z', tries: { count: 1, last: 'update', at: '2026-11-20T09:00:00Z' } })).toBeNull();
    // After 3 tries: a draft that waits for a developer, with the reason.
    expect(pr({ runs: [run('failure')], tries: { count: 3, last: 'fix', at: '2026-11-20T11:00:00Z' } })).toEqual({ act: 'waits', why: 'Claude tried 3 times to get it into main. Its checks failed (gate: failure).' });
    // A change needs the fix team: in mode off or without its token, it waits at once. A rerun does not need it.
    expect(pr({ mergeable: 'dirty', team: false })).toMatchObject({ act: 'waits' });
    expect(pr({ runs: [run('failure')], team: false })).toMatchObject({ act: 'rerun' });
  });

  it('keeps the count of tries in a hidden line of its body', () => {
    const body = `${MERGE_MARK}\n**This pull request merges without a person when its checks pass** (docs/agent-team.md). Why.\n\nTo stop it, make it a draft or close it.\n\nA fix.`;
    expect(triesOf(body)).toEqual({ count: 0, last: null, at: null });
    const once = withTry(body, { count: 1, last: 'rerun', at: '2026-11-20T11:00:00.000Z' });
    expect(triesOf(once)).toEqual({ count: 1, last: 'rerun', at: '2026-11-20T11:00:00.000Z' });
    const twice = withTry(once, { count: 2, last: 'fix', at: '2026-11-20T12:00:00.000Z' });
    expect(twice.match(/agent-team: try/g)).toHaveLength(1);
    expect(triesOf(twice)).toMatchObject({ count: 2, last: 'fix' });
    // A body that waits: no mark, the reason in place of the merge line, and the count kept.
    const waiting = waitingBody(twice, 'Claude tried 3 times.');
    expect(waiting).not.toContain(MERGE_MARK);
    expect(waiting).toContain('**It waits for a developer.** Claude tried 3 times.');
    expect(triesOf(waiting).count).toBe(2);
  });

  it('gives the manager the last lines of a failed job, without time stamps or colour', () => {
    const log = Array.from({ length: 200 }, (_, i) => `2026-11-20T11:00:00.1234567Z \x1b[31mline ${i}\x1b[0m`).join('\n');
    const tail = logTail(log);
    expect(tail.split('\n')).toHaveLength(120);
    expect(tail.split('\n')[0]).toBe('line 80');
    expect(tail).not.toMatch(/\x1b|2026-11-20T/);
    expect(logTail('x'.repeat(20_000)).length).toBe(12_000);
  });
});
