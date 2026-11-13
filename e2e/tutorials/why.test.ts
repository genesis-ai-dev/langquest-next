import { readFileSync } from 'node:fs';
import { TUTORIALS } from './all';
import { importsOf, screenCode, screenModules, stepScreens, type Files, type ScreenCode } from './screens';
import { causeLine, changedSteps, prOf, readLog, scriptOf, slotsOf, touching, whyFilm, type Change, type Tonight } from './why';

/** Why a video is filmed again, and what slots it (docs/tutorial-videos.md "Why a video is filmed again"). */

const sha = (n: number) => n.toString(16).padStart(40, '0');
const change = (n: number, pr: number | null, files: string[]): Change => ({ sha: sha(n), pr, subject: pr ? `Merge pull request #${pr} from x/y` : 'A commit', files });
const code: ScreenCode = {
  own: new Map([
    ['my_work', new Set(['apps/mobile/src/screens/work.tsx', 'apps/mobile/src/work/home.tsx'])],
    ['workspace', new Set(['apps/mobile/src/screens/translate.tsx', 'apps/mobile/src/recording/SplitPane.tsx'])]
  ]),
  shared: new Set(['apps/mobile/src/ui/kit.tsx'])
};
const night = (over: Partial<Tonight>): Tonight => ({
  film: { look: 'L', frame: 'F', script: 'S', steps: ['a', 'b', 'c'] }, named: false, frame: 'F',
  tried: { look: 'L', steps: ['a', 'b', 'c'] }, script: 'S', screens: ['my_work', 'workspace', 'workspace'],
  scriptFiles: new Set(['e2e/tutorials/record-a-passage.ts']), changes: [], code, ...over
});

describe('why a video is filmed again', () => {
  it('films none that reads and says as its film did', () => {
    expect(whyFilm(night({}))).toEqual([]);
  });

  it('films one with no film yet, one named by hand, and one framed as films no longer are', () => {
    expect(whyFilm(night({ film: undefined }))).toEqual([{ kind: 'new' }]);
    expect(whyFilm(night({ named: true }))).toEqual([{ kind: 'asked' }]);
    expect(whyFilm(night({ frame: 'G' }))).toEqual([{ kind: 'frame' }]);
  });

  it('films one whose script changed, naming the pull request that changed it', () => {
    // Why: a fix asked for in a comment comes in as a change to the script, and the words on screen stay the same.
    const changes = [change(3, 451, ['e2e/tutorials/record-a-passage.ts']), change(2, 450, ['apps/mobile/src/screens/work.tsx'])];
    expect(whyFilm(night({ script: 'T', changes }))).toEqual([{ kind: 'script', changes: [{ sha: sha(3), pr: 451, subject: 'Merge pull request #451 from x/y' }] }]);
    // A film from before scripts were kept is not filmed for it.
    expect(whyFilm(night({ film: { look: 'L', frame: 'F' }, script: 'T' }))).toEqual([]);
  });

  it('names the steps and screens whose words changed, and the changes to those screens\' own code', () => {
    const changes = [change(3, 403, ['apps/mobile/src/ui/kit.tsx']), change(2, 389, ['apps/mobile/src/screens/work.tsx']), change(1, 427, ['apps/mobile/src/recording/SplitPane.tsx'])];
    expect(whyFilm(night({ tried: { look: 'M', steps: ['x', 'b', 'c'] }, changes }))).toEqual([
      { kind: 'screen', steps: [1], screens: ['my_work'], changes: [{ sha: sha(2), pr: 389, subject: 'Merge pull request #389 from x/y' }] }
    ]);
    expect(whyFilm(night({ tried: { look: 'M', steps: ['a', 'b', 'y'] }, changes }))[0]).toMatchObject({ steps: [3], screens: ['workspace'], changes: [{ pr: 427 }] });
  });

  it('names the shared code when no screen\'s own code changed, and every step when the film kept no step looks', () => {
    const changes = [change(3, 403, ['apps/mobile/src/ui/kit.tsx']), change(2, 400, ['docs/decisions.md'])];
    expect(whyFilm(night({ tried: { look: 'M', steps: ['a', 'b', 'y'] }, changes }))[0]).toEqual(
      { kind: 'screen', steps: [3], screens: ['workspace'], changes: [{ sha: sha(3), pr: 403, subject: 'Merge pull request #403 from x/y' }], shared: true });
    expect(whyFilm(night({ film: { look: 'L', frame: 'F', script: 'S' }, tried: { look: 'M', steps: ['a', 'b', 'c'] }, changes: null }))[0]).toEqual(
      { kind: 'screen', steps: [1, 2, 3], screens: ['my_work', 'workspace'], changes: [] });
  });

  it('gives every cause that applies, in a line each', () => {
    const why = whyFilm(night({ named: true, script: 'T', tried: { look: 'M', steps: ['x', 'b', 'c'] }, changes: [change(2, 389, ['apps/mobile/src/screens/work.tsx'])] }));
    expect(why.map((c) => c.kind)).toEqual(['asked', 'script', 'screen']);
    expect(why.map(causeLine)).toEqual(['named by hand', 'its script changed', 'words changed on step 1 (my_work) (#389)']);
    expect(causeLine({ kind: 'screen', steps: [2, 3], screens: ['workspace'], changes: [{ sha: sha(9), pr: null, subject: 'x' }], shared: true }))
      .toBe(`words changed on steps 2, 3 (workspace), shared code (${sha(9).slice(0, 7)})`);
  });
});

describe('what slots a video', () => {
  it('is each change since its last check that touched the own code of a screen it shows', () => {
    const changes = [change(4, 404, ['apps/mobile/src/ui/kit.tsx']), change(3, 403, ['apps/mobile/src/work/home.tsx', 'apps/mobile/src/recording/SplitPane.tsx']), change(2, 402, ['README.md'])];
    expect(slotsOf(['my_work', 'workspace', 'my_work'], changes, code)).toEqual([{ sha: sha(3), pr: 403, subject: 'Merge pull request #403 from x/y', screens: ['my_work', 'workspace'] }]);
    expect(slotsOf(['sign_in'], changes, code)).toEqual([]);
    expect(slotsOf(['my_work'], null, code)).toEqual([]);
  });

  it('reads the changes merged into main from git, with their pull requests', () => {
    const log = `\0${sha(2)}\tMerge pull request #389 from genesis-ai-dev/claude/x\n\napps/mobile/src/screens/work.tsx\ne2e/tutorials/workspace.ts\n\0${sha(1)}\tFix a thing (#12)\n\nREADME.md\n`;
    expect(readLog(log)).toEqual([
      { sha: sha(2), pr: 389, subject: 'Merge pull request #389 from genesis-ai-dev/claude/x', files: ['apps/mobile/src/screens/work.tsx', 'e2e/tutorials/workspace.ts'] },
      { sha: sha(1), pr: 12, subject: 'Fix a thing (#12)', files: ['README.md'] }
    ]);
    expect(prOf('Tutorial videos: the spotlight')).toBeNull();
    expect(touching(readLog(log), new Set(['e2e/tutorials/workspace.ts']))).toEqual([{ sha: sha(2), pr: 389, subject: 'Merge pull request #389 from genesis-ai-dev/claude/x' }]);
  });

  it('counts a step changed when the film had another number of steps', () => {
    expect(changedSteps(['a', 'b'], ['a', 'b', 'c'])).toEqual([1, 2, 3]);
    expect(changedSteps(['a', 'b', 'c'], ['a', 'x', 'c'])).toEqual([2]);
  });
});

describe('a video\'s script', () => {
  it('changes with its file or any line it says, and not otherwise', () => {
    const s = scriptOf('steps', ['Tap Save.', undefined]);
    expect(scriptOf('steps', ['Tap Save.', undefined])).toBe(s);
    expect(scriptOf('steps!', ['Tap Save.', undefined])).not.toBe(s);
    expect(scriptOf('steps', ['Tap Done.', undefined])).not.toBe(s);
    expect(scriptOf('steps', ['Tap Save.', undefined], ['grace-1'])).not.toBe(s);
  });

  it('is in a file named by each video\'s id', () => {
    for (const id of Object.keys(TUTORIALS)) expect(readFileSync(`e2e/tutorials/${id}.ts`, 'utf8')).toContain(`id: '${id}'`);
  });
});

describe('the code that draws each screen', () => {
  const tree: Record<string, string> = {
    'apps/mobile/App.tsx': `import * as Work from './src/screens/work';\nconst loadOrg = () => import('./src/screens/org');\nconst RECORDING_SCREENS = [];\nconst SCREENS: Record<ScreenId, X> = {\n  my_work: Work.MyWork,\n  org_home: lazyScreen(loadOrg, 'OrgHome'), language_home: lazyScreen(loadOrg, 'LanguageHome')\n};\n`,
    'apps/mobile/src/screens/work.tsx': `import { Row } from '../work/row';\nimport type { T } from '../work/types';\nimport { C } from '../ui/kit';\nimport x from 'react-native';`,
    'apps/mobile/src/work/row.tsx': `export const Row = 1;`,
    'apps/mobile/src/work/row.web.tsx': `import { C } from '../ui/kit';`,
    'apps/mobile/src/work/types.ts': `export type T = 1;`,
    'apps/mobile/src/screens/org.tsx': `import { C } from '../ui/kit';\nexport { Panel } from '../org/panel';`,
    'apps/mobile/src/org/panel.tsx': `const p = require('../org/data.json');`,
    'apps/mobile/src/org/data.json': '{}',
    'apps/mobile/src/ui/kit.tsx': `import './theme';`,
    'apps/mobile/src/ui/theme.ts': ''
  };
  const files: Files = { read: (f) => tree[f] ?? null };

  it('reads the screen table of App.tsx', () => {
    expect([...screenModules(tree['apps/mobile/App.tsx']!)]).toEqual([['my_work', './src/screens/work'], ['org_home', './src/screens/org'], ['language_home', './src/screens/org']]);
  });

  it('follows imports as the web export resolves them, and leaves out type-only imports and packages', () => {
    expect(importsOf(tree['apps/mobile/src/screens/work.tsx']!)).toEqual(['../work/row', '../ui/kit', 'react-native']);
    const { own } = screenCode(files);
    expect([...own.get('my_work')!].sort()).toEqual(['apps/mobile/src/screens/work.tsx', 'apps/mobile/src/ui/kit.tsx', 'apps/mobile/src/ui/theme.ts', 'apps/mobile/src/work/row.web.tsx']);
    expect([...own.get('org_home')!].sort()).toEqual(['apps/mobile/src/org/data.json', 'apps/mobile/src/org/panel.tsx', 'apps/mobile/src/screens/org.tsx', 'apps/mobile/src/ui/kit.tsx', 'apps/mobile/src/ui/theme.ts']);
  });

  it('in the app, keeps the code most screens share out of each screen\'s own', () => {
    const app = screenCode({ read: (f) => { try { return readFileSync(f, 'utf8'); } catch { return null; } } });
    expect(app.own.get('my_work')).toContain('apps/mobile/src/screens/work.tsx');
    expect(app.own.get('workspace')).toContain('apps/mobile/src/screens/translate.tsx');
    expect(app.shared).toContain('apps/mobile/src/ui/kit.tsx');
    expect(app.own.get('my_work')).not.toContain('apps/mobile/src/ui/kit.tsx');
    // Every screen a video shows has code of its own.
    for (const t of Object.values(TUTORIALS)) for (const screen of stepScreens(t)) expect(app.own.get(screen)?.size, `${t.id}: ${screen}`).toBeGreaterThan(0);
  });
});
