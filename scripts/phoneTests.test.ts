import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PREFIX } from './nightly-report.mjs';
import {
  addLook, addToHistory, file, flowKey, HISTORY_NIGHTS, junitFlows, MANY, markdown, nightSummary, oldShots,
  phoneOutcomes, PICTURE, runKey, safeName, safeNames, shotFor, slug
} from './phone-tests.mjs';

// The nightly phone tests' report (decision 208). These tests hold what keeps
// it worth reading: every failed flow is found with its picture, filed once
// per phone and only once, a failure that stays quiet stays quiet, one outage
// is one issue, and Claude's words reach the summary only in the shape asked.

const SHA = 'abc1234def5678';
const RUN = 'https://github.com/o/r/actions/runs/9';
const AT = new Date('2026-11-12T09:40:00Z');

const JUNIT = `<?xml version='1.0' encoding='UTF-8'?>
<testsuites>
  <testsuite name="Test Suite" device="emulator-5554" tests="3" failures="1" time="60.2">
    <testcase id="P0 A viewer follows a passage to Done" name="P0 A viewer follows a passage to Done" classname="P0 A viewer follows a passage to Done" time="20.5" status="SUCCESS"/>
    <testcase id="REC-020" name="REC-020" classname="REC-020" time="31.25" status="ERROR">
      <failure>Element not found: Text matching regex: Ask the Peer check team &amp; more</failure>
    </testcase>
    <testcase id="SYNC-015" name="SYNC-015" classname="SYNC-015" time="8" status="SUCCESS"></testcase>
  </testsuite>
</testsuites>`;

/** A phone's results folder as its job leaves it. */
function results(root: string, platform: string, { junit = JUNIT, shots = ['REC-020'], device = true } = {}) {
  const dir = join(root, platform);
  mkdirSync(join(dir, '2026-11-12_093000'), { recursive: true });
  if (junit) writeFileSync(join(dir, 'report.xml'), junit);
  for (const name of shots) {
    writeFileSync(join(dir, '2026-11-12_093000', `screenshot-❌-1762940000000-(${name}).png`), 'png');
    writeFileSync(join(dir, '2026-11-12_093000', `screenshot-1762930000000-(${name}).png`), 'older');
  }
  if (device) writeFileSync(join(dir, 'device.json'), JSON.stringify({ device: 'Pixel 6', os: 'Android 15' }));
  writeFileSync(join(dir, 'skipped.json'), JSON.stringify([{ flow: 'REC-023', tag: 'voice', why: 'need a microphone signal' }]));
  return dir;
}

function night(statuses: Record<string, string>, setup: (root: string) => void) {
  const root = mkdtempSync(join(tmpdir(), 'phone-tests-'));
  const shots = join(root, 'out', 'shots');
  mkdirSync(shots, { recursive: true });
  setup(join(root, 'in'));
  const flows = join(root, 'flows');
  mkdirSync(flows);
  writeFileSync(join(flows, 'REC-020.yaml'), 'appId: x\ntags:\n  - rec\n---\n- tapOn: a\n');
  writeFileSync(join(flows, 'P0-viewer-done.yaml'), 'appId: x\nname: "P0 A viewer follows a passage to Done"\n---\n- tapOn: a\n');
  const summary = nightSummary({ inDir: join(root, 'in'), sha: SHA, url: RUN, event: 'schedule', statuses, at: AT, shotsOut: shots, flowsDir: flows });
  return { summary, shots };
}

describe('junitFlows', () => {
  it('reads each flow, its time, and the error of a failed one', () => {
    expect(junitFlows(JUNIT)).toEqual([
      { name: 'P0 A viewer follows a passage to Done', seconds: 20.5, passed: true, error: null },
      { name: 'REC-020', seconds: 31.25, passed: false, error: 'Element not found: Text matching regex: Ask the Peer check team & more' },
      { name: 'SYNC-015', seconds: 8, passed: true, error: null }
    ]);
  });

  it('takes a failure with only a message, CDATA, or only a failing status', () => {
    const xml = '<testcase name="A" time="1"><failure message="Assertion is false: x"/></testcase>'
      + '<testcase name="B"><error><![CDATA[Timed out <waiting>]]></error></testcase>'
      + '<testcase name="C" status="ERROR"/>';
    expect(junitFlows(xml).map((f) => [f.name, f.passed, f.error])).toEqual([
      ['A', false, 'Assertion is false: x'], ['B', false, 'Timed out <waiting>'], ['C', false, 'failed']
    ]);
  });
});

describe('shotFor', () => {
  it('takes the failure screenshot that names the flow, not another flow\'s or an older one', () => {
    const files = ['/r/a/screenshot-❌-2-(REC-020).png', '/r/a/screenshot-3-(REC-020).png', '/r/a/screenshot-❌-9-(REC-0201).png', '/r/a/commands-(REC-020).json'];
    expect(shotFor(files, 'REC-020')).toBe('/r/a/screenshot-❌-2-(REC-020).png');
    expect(shotFor(files, 'SYNC-015')).toBeNull();
  });
  it('takes the last step\'s picture from the flow\'s own folder (Maestro 2.8)', () => {
    const dir = '/r/2026-11-11_231018/P0 A reviewer reviews- looks good';
    const files = [
      `${dir}/screenshots/step-012-tapOn.png`, `${dir}/screenshots/step-079-assertCondition-Consultant_check,_moved.png`,
      '/r/2026-11-11_231018/P0 Another flow/screenshots/step-099-assertCondition.png'
    ];
    expect(shotFor(files, 'P0 A reviewer reviews: looks good')).toBe(files[1]);
    expect(shotFor(files, 'P0 Nothing here')).toBeNull();
  });
  it('finds the picture after its folder and name went through safeName', () => {
    const files = ['/r/2026-11-11_222406/P0 A reviewer reviews- looks good/screenshot-❌-5-(P0 A reviewer reviews- looks good).png'];
    expect(shotFor(files, 'P0 A reviewer reviews: looks good')).toBe(files[0]);
  });
  it('renames what GitHub\'s artifacts refuse, folders and files alike', () => {
    const root = mkdtempSync(join(tmpdir(), 'safe-'));
    const deep = join(root, 'run', 'P0 A: b?');
    mkdirSync(deep, { recursive: true });
    writeFileSync(join(deep, 'screenshot-❌-1-(P0 A: b?).png'), '');
    writeFileSync(join(root, 'report.xml'), '');
    expect(safeNames(root)).toBe(2);
    expect(existsSync(join(root, 'run', 'P0 A- b-', 'screenshot-❌-1-(P0 A- b-).png'))).toBe(true);
    expect(existsSync(join(root, 'report.xml'))).toBe(true);
    expect(safeName('a "b" <c> | d * e')).toBe('a -b- -c- - d - e');
  });
  it('makes a name safe for a file', () => {
    expect(slug('P0 A viewer: Done (é)')).toBe('p0-a-viewer-done-e');
  });
});

describe('nightSummary', () => {
  it('says what each phone did, failed flows first, with their pictures and files', () => {
    const { summary, shots } = night({ android: 'failure', ios: 'success' }, (root) => {
      results(root, 'android');
      results(root, 'ios', { shots: [], junit: JUNIT.replace(/<testcase id="REC-020"[\s\S]*?<\/testcase>/, '') });
    });
    const [android, ios] = summary.platforms;
    expect(android).toMatchObject({ platform: 'android', label: 'Android emulator', os: 'Android 15', status: 'failure', broke: null, ran: 3, passed: 2, failed: 1 });
    expect(android!.flows[0]).toMatchObject({ name: 'REC-020', file: 'REC-020.yaml', passed: false, shot: '20261112-android-rec-020.png' });
    expect(android!.flows[1]).toMatchObject({ name: 'P0 A viewer follows a passage to Done', file: 'P0-viewer-done.yaml', shot: null });
    expect(android!.notRun).toEqual([{ flow: 'REC-023', why: 'need a microphone signal' }]);
    expect(ios).toMatchObject({ failed: 0, passed: 2, broke: null });
    expect(readdirSync(shots)).toEqual(['20261112-android-rec-020.png']);
  });

  it('says a phone broke when it left no report, when no flow ran, or when most flows failed', () => {
    const many = `<testsuites>${Array.from({ length: MANY + 1 }, (_, i) => `<testcase name="F${i}" status="ERROR"><failure>x</failure></testcase>`).join('')}</testsuites>`;
    const { summary } = night({ android: 'failure', ios: 'cancelled' }, (root) => {
      results(root, 'android', { junit: many, shots: [] });
      results(root, 'ios', { junit: '', shots: [] });
    });
    expect(summary.platforms[0]!.broke).toMatch(/^11 of 11 flows failed on the Android emulator: one cause/);
    expect(summary.platforms[1]!.broke).toBe('The iPhone simulator job was cancelled before the flows ran to the end, and left no report.');
  });

  it('leaves out a phone a manual run left out', () => {
    const { summary } = night({ android: 'success', ios: 'skipped' }, (root) => results(root, 'android', { shots: [] }));
    expect(summary.platforms.map((p) => p.platform)).toEqual(['android']);
  });
});

describe('addLook', () => {
  it('takes Claude\'s sentence and cause for a failed flow only, in the shape asked', () => {
    const { summary } = night({ android: 'failure' }, (root) => results(root, 'android'));
    addLook(summary, [
      { platform: 'android', flow: 'REC-020', what: '  The Publish   screen shows an error banner.  ', cause: 'app' },
      { platform: 'android', flow: 'SYNC-015', what: 'It passed, so this is left out.', cause: 'app' },
      { platform: 'ios', flow: 'REC-020', what: 'No such phone tonight.', cause: 'test' },
      { platform: 'android', flow: 'REC-020', what: 'x'.repeat(500), cause: 'blame' },
      'not an object'
    ]);
    const rec = summary.platforms[0]!.flows.find((f) => f.name === 'REC-020')!;
    expect(rec.what).toHaveLength(301);
    expect(rec.cause).toBe('app');
    expect(summary.platforms[0]!.flows.find((f) => f.name === 'SYNC-015')!.what).toBeUndefined();
    expect(addLook(summary, { not: 'a list' })).toBe(summary);
  });
});

type Issue = { id: string; identifier: string; title: string; stateType: string; createdAt: string; comments: string[] };
const issue = (key: string, over: Partial<Issue> = {}): Issue => ({
  id: `id-${key}`, identifier: 'LAN-300', title: `${PREFIX}${key}`, stateType: 'backlog', createdAt: '2026-11-10T00:00:00Z', comments: [], ...over
});

function fakeLinear(issues: Issue[]) {
  const created: { title: string; description: string }[] = [];
  const comments: { id: string; body: string }[] = [];
  const uploads: string[] = [];
  return {
    created, comments, uploads,
    api: {
      issues: async () => issues,
      create: async (title: string, description: string) => (created.push({ title, description }), `LAN-${400 + created.length}`),
      comment: async (id: string, body: string) => void comments.push({ id, body }),
      upload: async (path: string) => (uploads.push(path), `https://uploads.linear.app/${uploads.length}.png`),
      urlOf: async (id: string) => `https://linear.app/team/issue/${id}`
    }
  };
}

describe('filing in Linear', () => {
  it('opens one issue per failed flow and phone, with its picture and Claude\'s words, and says nothing for flows that pass', async () => {
    const { summary, shots } = night({ android: 'failure' }, (root) => results(root, 'android'));
    addLook(summary, [{ platform: 'android', flow: 'REC-020', what: 'The screen shows no Done button.', cause: 'app' }]);
    const linear = fakeLinear([]);
    const said = await file(linear.api, summary, shots);
    expect(linear.created.map((c) => c.title)).toEqual(['Nightly: REC-020 [Android emulator]']);
    const body = linear.created[0]!.description;
    expect(body).toMatch(/^\*\*What went wrong:\*\* The screen shows no Done button\./);
    expect(body).toContain('![The screen when the flow failed](https://uploads.linear.app/1.png)');
    expect(body).not.toContain(PICTURE);
    expect(body).toContain('apps/mobile/test/maestro/flows/REC-020.yaml');
    expect(linear.uploads).toEqual([join(shots, '20261112-android-rec-020.png')]);
    expect(said).toEqual(['opened LAN-401: Nightly: REC-020 [Android emulator]']);
    expect(summary.platforms[0]!.flows[0]).toMatchObject({ issue: 'LAN-401', issueUrl: 'https://linear.app/team/issue/LAN-401' });
  });

  it('adds nothing for a flow whose open issue already says it fails, and names that issue in the summary', async () => {
    const { summary, shots } = night({ android: 'failure' }, (root) => results(root, 'android'));
    const linear = fakeLinear([issue('REC-020 [Android emulator]', { identifier: 'LAN-350' })]);
    expect(await file(linear.api, summary, shots)).toEqual(['nothing new to tell Linear']);
    expect(linear.created).toEqual([]);
    expect(summary.platforms[0]!.flows[0]!.issue).toBe('LAN-350');
  });

  it('says once on its issue that a flow passes again', async () => {
    const { summary, shots } = night({ android: 'success' }, (root) => results(root, 'android', { junit: JUNIT.replace('status="ERROR"', 'status="SUCCESS"').replace(/<failure>[\s\S]*?<\/failure>/, ''), shots: [] }));
    const linear = fakeLinear([issue('REC-020 [Android emulator]')]);
    await file(linear.api, summary, shots);
    expect(linear.comments).toEqual([{ id: 'id-REC-020 [Android emulator]', body: `Nightly passed · abc1234 · ${RUN}` }]);
  });

  it('keeps the same flow on the two phones apart', () => {
    const { summary } = night({ android: 'failure', ios: 'failure' }, (root) => { results(root, 'android'); results(root, 'ios'); });
    const failed = phoneOutcomes(summary).filter((o) => !o.passed).map((o) => o.key);
    expect(failed).toEqual(['REC-020 [Android emulator]', 'REC-020 [iPhone simulator]']);
  });

  it('files one issue for a phone that broke as a whole, not one per flow', () => {
    const many = `<testsuites>${Array.from({ length: MANY + 1 }, (_, i) => `<testcase name="F${i}" status="ERROR"><failure>x</failure></testcase>`).join('')}</testsuites>`;
    const { summary } = night({ android: 'failure' }, (root) => results(root, 'android', { junit: many, shots: [] }));
    const outcomes = phoneOutcomes(summary);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({ key: runKey(summary.platforms[0]!), passed: false });
    expect(flowKey(summary.platforms[0]!, { name: 'F1' })).toBe('F1 [Android emulator]');
  });
});

describe('history and pictures', () => {
  it('keeps the newest nights first, a run once, and at most HISTORY_NIGHTS', () => {
    const { summary } = night({ android: 'success' }, (root) => results(root, 'android', { shots: [] }));
    const old = Array.from({ length: HISTORY_NIGHTS + 5 }, (_, i) => ({ at: `2026-10-${String(i + 1).padStart(2, '0')}`, url: `u${i}`, platforms: [] }));
    const history = addToHistory([{ url: RUN, at: 'again' }, ...old], summary);
    expect(history).toHaveLength(HISTORY_NIGHTS);
    expect(history[0]).toMatchObject({ at: AT.toISOString(), sha: SHA, url: RUN, platforms: [{ platform: 'android', passed: 2, failed: 1, broke: false }] });
    expect(history.filter((n) => n.url === RUN)).toHaveLength(1);
    expect(addToHistory(null, summary)).toHaveLength(1);
  });

  it('drops pictures older than 14 days, and nothing else', () => {
    expect(oldShots(['20261028-android-a.png', '20261029-ios-b.png', 'summary.json', 'history.json', '20261111-android-c.png'], AT))
      .toEqual(['20261028-android-a.png']);
  });

  it('writes the run\'s page: each phone\'s counts and each failure', () => {
    const { summary } = night({ android: 'failure' }, (root) => results(root, 'android'));
    summary.platforms[0]!.flows[0]!.issue = 'LAN-401';
    const md = markdown(summary);
    expect(md).toContain('| Android emulator (Android 15) | 2 | 1 | 1 |');
    expect(md).toContain('- **REC-020** (LAN-401): Element not found: Text matching regex: Ask the Peer check team & more');
  });
});
