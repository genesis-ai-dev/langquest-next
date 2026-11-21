import { describe, expect, it } from 'vitest';
import { page } from '../src/page';
import { CODE_LOGIC } from '../src/pageCode';
import { EXPO_LOGIC } from '../src/pageExpo';
import { commitTitle } from '../src/sources/github';

interface Job { s: string; name: string; does: string; result: string; note: string; link: string | null }
interface View { host: string; web: { s: string; text: string; same: boolean; newest: { title: string; pr: number | null }; runs: { title: string; pr: number | null } }; jobs: Job[]; counts: Record<string, number> }

/** The part's pure helpers, as the page runs them (pageCode.ts CODE_LOGIC). */
const logic = new Function(`${CODE_LOGIC}; return { codeView, JOB_SAID };`)() as { codeView: (d: unknown, now?: number) => View; JOB_SAID: Record<string, [string, string]> };
const NOW = Date.parse('2026-11-21T03:00:00Z');
const run = (workflow: string, file: string, status: string, conclusion: string | null, nightly = false) =>
  ({ id: 1, workflow, path: `.github/workflows/${file}`, status, conclusion, sha: 'abc', at: '2026-11-21T01:00:00Z', url: 'https://github.com/o/r/actions/runs/1', event: 'schedule', number: 4, nightly });
const code = (over: Record<string, unknown> = {}) => ({
  repo: 'o/r', main: { sha: 'aaaaaaaa11112222', at: '2026-11-21T01:00:00Z', title: 'Overview rows open cards', pr: 602 },
  live: { url: 'https://app.langquest.org', build: 'bbbbbbbb', title: 'Tutorial videos tab counts', pr: 600, at: '2026-11-21T00:00:00Z' },
  behind: 2, appChanged: false, runs: [], needsYou: [], ...over });

describe('the web app and automatic jobs (pageCode.ts)', () => {
  it('names a commit by its pull request title', () => {
    expect(commitTitle('Merge pull request #602 from genesis-ai-dev/claude/x\n\nOverview rows open cards\n\nbody')).toEqual({ title: 'Overview rows open cards', pr: 602 });
    expect(commitTitle('Fix the web storage pool (#592)\n\nbody')).toEqual({ title: 'Fix the web storage pool', pr: 592 });
    expect(commitTitle('A plain commit')).toEqual({ title: 'A plain commit', pr: null });
  });

  it('says up to date when the newer merges do not change the web app, and shows both titles', () => {
    const v = logic.codeView(code(), NOW);
    expect(v.host).toBe('app.langquest.org');
    expect(v.web).toMatchObject({ s: 'ok', same: false, newest: { title: 'Overview rows open cards', pr: 602 }, runs: { title: 'Tutorial videos tab counts', pr: 600 } });
    expect(v.web.text).toBe('Up to date. The newer merges do not change the web app.');
    expect(logic.codeView(code({ live: { url: 'https://app.langquest.org', build: 'aaaaaaaa' }, behind: 0 }), NOW).web).toMatchObject({ s: 'ok', same: true, runs: { title: 'Overview rows open cards' } });
  });

  it('says deploying in the first minutes after a merge, then behind, and no answer when the host is down', () => {
    const late = code({ appChanged: true });
    expect(logic.codeView(late, Date.parse('2026-11-21T01:20:00Z')).web.s).toBe('run');
    expect(logic.codeView(late, NOW).web).toMatchObject({ s: 'fail' });
    expect(logic.codeView(late, NOW).web.text).toMatch(/^Behind\./);
    expect(logic.codeView(code({ appChanged: null }), NOW).web.text).toMatch(/^Maybe behind\./);
    expect(logic.codeView(code({ live: { url: 'https://app.langquest.org', build: null, error: 'HTTP 522' } }), NOW).web).toMatchObject({ s: 'fail', text: 'app.langquest.org did not answer (HTTP 522).' });
  });

  it('lists each job by its plain name, worst first, with a nightly failure apart and what needs a person', () => {
    const v = logic.codeView(code({ runs: [
      run('linear-sync', 'linear-sync.yml', 'completed', 'success'),
      run('phone-tests', 'phone-tests.yml', 'completed', 'failure', true),
      run('tutorials', 'tutorials.yml', 'completed', 'failure'),
      run('new-thing', 'new-thing.yml', 'in_progress', null)
    ], needsYou: [{ workflow: 'tutorials', what: "Gemini's credit", text: 'is used up', link: 'https://x' }] }), NOW);
    expect(v.jobs.map((j) => [j.s, j.name, j.result])).toEqual([['fail', 'Tutorial videos', 'Failed'], ['part', 'Nightly phone tests', 'Failed'], ['run', 'new-thing', 'Running'], ['ok', 'Linear links', 'Passed']]);
    expect(v.jobs[0]!.note).toBe("Needs you: Gemini's credit.");
    expect(v.jobs[1]!.note).toMatch(/Nightly tests says/);
    expect(v.jobs[2]!.does).toBe('');
    // Only the jobs are counted: the web app is not a job.
    expect(v.counts).toEqual({ fail: 1, part: 1, run: 1, ok: 1, off: 0 });
  });

  it('has a plain name for each workflow in the repository', async () => {
    const { readdirSync } = await import('node:fs');
    const files = readdirSync(new URL('../../../.github/workflows/', import.meta.url)).filter((f) => f.endsWith('.yml'));
    for (const f of files) expect(logic.JOB_SAID[f], f).toBeTruthy();
  });

  it('runs in the page', async () => {
    const html = await page({ supabaseUrl: 'https://abc.supabase.co', anonKey: 'k' }, 'n').text();
    expect(html).toContain('function codeBox(');
    expect(html).toContain('The web app and automatic jobs');
  });
});

describe('phone app builds and updates (pageExpo.ts)', () => {
  const expo = new Function(`${EXPO_LOGIC}; return { expoView };`)() as { expoView: (d: unknown) => { builds: { s: string; name: string; result: string; note: string; sentAt: string | null }[]; updates: { name: string; note: string }[]; counts: Record<string, number> } };
  const b = (platform: string, profile: string, status: string, at: string, appVersion: string | null) => ({ platform, profile, status, at, appVersion, runtime: null });

  it('lists builds newest first by phone, what they are for and version, with the store send that took each', () => {
    const v = expo.expoView({
      builds: [b('ANDROID', 'carried', 'FINISHED', '2026-11-17T03:00:00Z', '2026.1117.1'), b('IOS', 'production', 'ERRORED', '2026-11-20T03:00:00Z', '2026.1120.1'),
        b('ANDROID', 'production', 'FINISHED', '2026-11-20T02:00:00Z', '2026.1120.1'), b('IOS', 'production', 'IN_PROGRESS', '2026-11-20T04:00:00Z', null)],
      submissions: [{ platform: 'ANDROID', status: 'FINISHED', at: '2026-11-20T05:00:00Z', error: null, version: '2026.1120.1' }],
      updates: [{ branch: 'preview', platform: 'ios, android', runtime: '7', group: 'g', at: '2026-11-19T00:00:00Z' }, { branch: 'production', platform: 'android', runtime: '7', group: 'g', at: '2026-11-20T00:00:00Z' }]
    });
    expect(v.builds.map((x) => [x.s, x.name, x.result])).toEqual([
      ['run', 'iPhone, for the App Store', 'Building'], ['fail', 'iPhone, for the App Store · 2026.1120.1', 'Failed'],
      ['ok', 'Android, for Google Play · 2026.1120.1', 'Built'], ['ok', 'Android, install file to share nearby · 2026.1117.1', 'Built']]);
    expect(v.builds[2]).toMatchObject({ note: 'Sent to Google Play', sentAt: '2026-11-20T05:00:00Z' });
    expect(v.builds[3]!.note).toBe('Not for a store');
    expect(v.counts).toEqual({ fail: 1, run: 1, ok: 2, off: 0 });
    expect(v.updates.map((u) => u.name)).toEqual(['For phones with a store build · Android', 'For test phones · iPhone and Android']);
  });

  it('marks a build red when its store send failed', () => {
    const v = expo.expoView({ builds: [b('IOS', 'production', 'FINISHED', '2026-11-20T03:00:00Z', '1.0')],
      submissions: [{ platform: 'IOS', status: 'ERRORED', at: '2026-11-20T04:00:00Z', error: 'INVALID_BUNDLE: bad', version: '1.0' }], updates: [] });
    expect(v.builds[0]).toMatchObject({ s: 'fail', note: 'Sending it to the App Store failed: INVALID_BUNDLE.' });
  });
});
