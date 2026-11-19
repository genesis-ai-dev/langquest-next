import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { cleanTree, covered, decide, pushedCommits, readRecord, record, recordPath } from './guardrails-passed.mjs';

/**
 * The pre-push hook skips its checks only when `npm run guardrails` passed
 * on the very files being pushed (scripts/guardrails-passed.mjs,
 * decisions.md 164, amended 2026-11-19). A wrong skip lets a red commit
 * leave the machine (CI still holds main), so every doubt runs the checks.
 */

const ZERO = '0'.repeat(40);
const line = (sha: string, ref = 'refs/heads/b') => `${ref} ${sha} ${ref} ${ZERO}`;

describe('what a push sends', () => {
  it('reads the local commit of each ref git gives pre-push, and none for a deletion', () => {
    const a = 'a'.repeat(40);
    const b = 'b'.repeat(40);
    expect(pushedCommits(`${line(a)}\n${line(b, 'refs/heads/c')}\n`)).toEqual([a, b]);
    expect(pushedCommits(`(delete) ${ZERO} refs/heads/old ${a}\n`)).toEqual([]);
    expect(pushedCommits('')).toEqual([]);
  });

  it('is covered only when there is a record and every pushed commit has its tree', () => {
    expect(covered(['t1'], 't1')).toBe(true);
    expect(covered(['t1', 't1'], 't1')).toBe(true);
    expect(covered(['t1', 't2'], 't1')).toBe(false);
    expect(covered(['t2'], 't1')).toBe(false);
    expect(covered([], 't1')).toBe(false);
    expect(covered(['t1'], undefined)).toBe(false);
    expect(covered(['t1'], '')).toBe(false);
  });
});

describe('in a repository', () => {
  const dir = mkdtempSync(join(tmpdir(), 'guardrails-passed-'));
  // Without the GIT_* that a git hook exports: in a worktree's pre-push hook
  // GIT_DIR names the real repository, and a fixture's commit landed on the
  // branch being pushed (.githooks/pre-push).
  const hooked = Object.entries(process.env).filter(([k]) => k.startsWith('GIT_'));
  for (const [k] of hooked) delete process.env[k];
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
    for (const [k, v] of hooked) process.env[k] = v;
  });
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.org', '-c', 'init.defaultBranch=main', ...args], { cwd: dir, encoding: 'utf8' }).trim();
  const commit = (file: string, text: string) => {
    writeFileSync(join(dir, file), text);
    git('add', file);
    git('commit', '-qm', file);
    return git('rev-parse', 'HEAD');
  };
  git('init', '-q');
  writeFileSync(join(dir, '.gitignore'), 'ignored\n');
  git('add', '.gitignore');
  const first = commit('a', '1');

  it('takes the tree only when nothing is uncommitted or untracked', () => {
    expect(cleanTree(dir)).toBe(git('rev-parse', `${first}^{tree}`));
    writeFileSync(join(dir, 'ignored'), 'x');
    expect(cleanTree(dir), 'an ignored file does not count').toBe(git('rev-parse', `${first}^{tree}`));
    writeFileSync(join(dir, 'new'), 'x');
    expect(cleanTree(dir), 'an untracked file').toBe('');
    rmSync(join(dir, 'new'));
    writeFileSync(join(dir, 'a'), 'changed');
    expect(cleanTree(dir), 'an uncommitted change').toBe('');
    git('checkout', '-q', '--', 'a');
  });

  it('records a run that began and passed clean on the same tree, and nothing else', () => {
    rmSync(recordPath(dir), { force: true });
    expect(record(dir, '')).toMatch(/^Not recorded/);
    writeFileSync(join(dir, 'new'), 'x');
    expect(record(dir, ''), 'untracked when it began and when it passed').toMatch(/^Not recorded/);
    rmSync(join(dir, 'new'));
    expect(readRecord(dir)).toBeNull();

    const before = cleanTree(dir);
    commit('b', 'during the run');
    expect(record(dir, before), 'a commit during the run').toMatch(/^Not recorded/);
    expect(readRecord(dir)).toBeNull();

    const clean = cleanTree(dir);
    writeFileSync(join(dir, 'b'), 'edited during the run');
    expect(record(dir, clean), 'an edit during the run').toMatch(/^Not recorded/);
    git('checkout', '-q', '--', 'b');

    expect(record(dir, clean, new Date('2026-11-19T12:00:00Z'))).toMatch(/^Recorded/);
    expect(readRecord(dir)).toEqual({ tree: clean, commit: git('rev-parse', 'HEAD'), at: '2026-11-19T12:00:00.000Z' });
  });

  it('skips the hook for a push of commits with the recorded tree, and runs it for anything else', () => {
    const head = git('rev-parse', 'HEAD');
    record(dir, cleanTree(dir));
    expect(decide(dir, line(head))).toMatchObject({ skip: true, say: expect.stringMatching(/not run again/) });

    // The same files on another commit (an amended message) are the same checks.
    git('commit', '-q', '--amend', '-m', 'new message');
    const amended = git('rev-parse', 'HEAD');
    expect(decide(dir, line(amended)).skip).toBe(true);
    expect(decide(dir, `${line(amended)}\n${line(first, 'refs/heads/other')}`).skip, 'one ref with other files').toBe(false);

    const later = commit('c', 'after the run');
    expect(decide(dir, line(later)).skip, 'files the run did not see').toBe(false);
    expect(decide(dir, `(delete) ${ZERO} refs/heads/old ${head}`).skip, 'nothing pushed').toBe(false);
    expect(decide(dir, '').skip).toBe(false);

    writeFileSync(recordPath(dir), 'not json');
    expect(decide(dir, line(amended)).skip, 'a record that cannot be read').toBe(false);
  });

  it('as the hook runs it: exit 0 to skip, 1 to check, and 1 on any error', () => {
    record(dir, cleanTree(dir));
    const covers = (input: string, cwd = dir) =>
      spawnSync(process.execPath, [fileURLToPath(new URL('./guardrails-passed.mjs', import.meta.url)), 'covers'], { cwd, input, encoding: 'utf8' });
    const head = git('rev-parse', 'HEAD');
    expect(covers(line(head)).status).toBe(0);
    expect(covers(line(first)).status).toBe(1);
    expect(covers(line('f'.repeat(40))).status, 'a commit git does not know').toBe(1);
    expect(covers(line(head), tmpdir()).status, 'outside a repository').toBe(1);
  });
});

describe('the hook and guardrails use it', () => {
  const hook = readFileSync('.githooks/pre-push', 'utf8');
  const guardrails = readFileSync('scripts/guardrails.sh', 'utf8');

  it('the hook asks before its checks, with what git pushes', () => {
    const asks = hook.indexOf('node scripts/guardrails-passed.mjs covers');
    expect(asks).toBeGreaterThan(0);
    expect(asks).toBeLessThan(hook.indexOf('npm run --silent typecheck'));
    expect(hook).toMatch(/pushed=\$\(cat\)/);
  });

  it('guardrails takes the state before any check and records it only after every check the hook makes', () => {
    const state = guardrails.indexOf('guardrails-passed.mjs state');
    const recorded = guardrails.indexOf('guardrails-passed.mjs record "$before"');
    expect(state).toBeGreaterThan(0);
    expect(state).toBeLessThan(guardrails.indexOf('npm run --silent typecheck'));
    for (const check of ['npm run --silent typecheck', 'npm run --silent lint', 'npm run --silent test:coverage', 'npm run --silent build:push-delivery'])
      expect(recorded, check).toBeGreaterThan(guardrails.indexOf(check));
    expect(recorded).toBeLessThan(guardrails.indexOf('[ "$level" = checks ]'));
  });

  it('the hook checks nothing that guardrails does not', () => {
    // If the hook gains a check, guardrails must run it too, or a skip would leave it out.
    const hookChecks = [...hook.matchAll(/npm run --silent ([\w:-]+)|npx (vitest) run/g)].map((m) => m[1] ?? m[2]);
    expect(hookChecks.length).toBeGreaterThan(0);
    for (const check of hookChecks) {
      const inGuardrails = check === 'vitest' ? 'npm run --silent test:coverage' : `npm run --silent ${check}`;
      expect(guardrails, check).toContain(inGuardrails);
    }
  });
});
