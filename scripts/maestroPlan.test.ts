// The phone runner's skip rules (scripts/maestro-plan.mjs) and the tags the
// flows must carry for them to work; and what a run does when Maestro's
// driver on the phone stops.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { driverStop, flowTags, mergeReports, NEW_DRIVERS, noDriver, plannedSkips, reportCases, skippedFlows, skipReport, withNewDrivers } from './maestro-plan.mjs';

const FLOWS = join(__dirname, '../apps/mobile/test/maestro/flows');
const flows = readdirSync(FLOWS).filter((f) => f.endsWith('.yaml')).map((f) => ({ name: f.replace(/\.yaml$/, ''), body: readFileSync(join(FLOWS, f), 'utf8') }));

describe('plannedSkips', () => {
  it('an unattended iOS run skips voice, android-only and wrapped flows', () => {
    expect(plannedSkips({ platform: 'ios' }).map((s) => s.tag)).toEqual(['voice', 'android-only', 'wrapped']);
  });
  it('--voice or --mic runs the microphone flows', () => {
    expect(plannedSkips({ platform: 'ios', voice: true }).map((s) => s.tag)).toEqual(['android-only', 'wrapped']);
    expect(plannedSkips({ platform: 'ios', mic: true }).map((s) => s.tag)).toEqual(['android-only', 'wrapped']);
  });
  it('Android with --voice and --wrapped skips nothing', () => {
    expect(plannedSkips({ platform: 'android', voice: true, wrapped: true })).toEqual([]);
  });
  it('flows named with --flow are run as asked', () => {
    expect(plannedSkips({ platform: 'ios', flows: ['flows/REC-026.yaml'] })).toEqual([]);
  });
});

describe('flowTags', () => {
  it('reads the tags block before the ---', () => {
    expect(flowTags('appId: x\nname: "n"\ntags:\n  - rec\n  - "voice"\n---\n- tapOn: tags\n')).toEqual(['rec', 'voice']);
    expect(flowTags('appId: x\n---\n- tapOn: a\n')).toEqual([]);
  });
});

describe('skipReport', () => {
  it('names the flows each rule skips and says nothing for a rule that skips none', () => {
    const lines = skipReport(plannedSkips({ platform: 'ios' }), [
      { name: 'REC-026', tags: ['rec', 'voice'] }, { name: 'REC-043', tags: ['rec', 'voice'] }, { name: 'ACCT-008', tags: ['acct'] }
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^Skipping 2 flows tagged voice \(REC-026, REC-043\): they need a microphone signal/);
  });
});

describe('the flows carry the tags the rules need', () => {
  // A flow that waits for the recorder to hear voice (parts made, or
  // "Recording…" while the voice plays) cannot pass on a silent input.
  const hearsVoice = (body: string) => /Parts 1–\d|"Recording…"/.test(body.split(/^---\s*$/m)[1] ?? '');
  for (const f of flows) {
    it(`${f.name}: tagged voice if and only if it listens for voice`, () => {
      expect(flowTags(f.body).includes('voice')).toBe(hearsVoice(f.body));
    });
    it(`${f.name}: tagged android-only if it insists on Android`, () => {
      const insists = /maestro\.platform == 'android'/.test(f.body);
      if (insists) expect(flowTags(f.body)).toContain('android-only');
    });
  }
});

describe('skippedFlows', () => {
  it('lists each flow left out once, with the first rule that leaves it out', () => {
    const out = skippedFlows(plannedSkips({ platform: 'ios' }), [
      { name: 'REC-026', tags: ['rec', 'voice'] }, { name: 'NOORG-010', tags: ['noorg', 'android-only'] }, { name: 'ACCT-008', tags: ['acct'] },
      { name: 'BOTH', tags: ['voice', 'wrapped'] }
    ]);
    expect(out.map((s) => [s.flow, s.tag])).toEqual([['REC-026', 'voice'], ['NOORG-010', 'android-only'], ['BOTH', 'voice']]);
    expect(out[0]!.why).toMatch(/microphone/);
  });
});

// A Maestro junit report as 2.8 writes it. `none` is a flow the driver left
// without a result: the words are those of the night of 2026-11-17.
type Result = 'pass' | 'fail' | 'none';
const GONE = `maestro.DeviceUnreachableException: Device became unreachable during deviceInfo
\tat maestro.drivers.IOSDriver.runDeviceCall(IOSDriver.kt:631)
Caused by: java.net.ConnectException: Failed to connect to /127.0.0.1:50815`;
const xml = (text: string) => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
function testcase(name: string, result: Result) {
  const head = `    <testcase id="${xml(name)}" name="${xml(name)}" classname="${xml(name)}" file="apps/mobile/test/maestro/flows/${name.split(' ')[0]}.yaml" time="12.5" status="${result === 'pass' ? 'SUCCESS' : 'ERROR'}">
      <properties>
        <property name="tags" value="p0"/>
      </properties>`;
  const failure = result === 'pass' ? '' : `\n      <failure>${xml(result === 'none' ? GONE : `Element not found: Text matching regex: ${name}`)}</failure>`;
  return `${head}${failure}\n    </testcase>`;
}
const junit = (flows: [string, Result][]) => `<?xml version='1.0' encoding='UTF-8'?>
<testsuites>
  <testsuite name="Test Suite" device="iPhone 17 - iOS 26.5" tests="${flows.length}" failures="${flows.filter(([, r]) => r !== 'pass').length}" time="99.5">
${flows.map(([name, r]) => testcase(name, r)).join('\n')}
  </testsuite>
</testsuites>`;
const results = (report: string) => reportCases(report).map((c) => [c.name, c.noDriver ? 'none' : c.failed ? 'fail' : 'pass']);
/** A start of Maestro that gives each flow it is asked for the result `of` says, and keeps what it was asked. */
function maestro(of: (name: string, n: number) => Result) {
  const asked: string[][] = [];
  const start = (stop: { at: string; again: string[] }, n: number) => {
    asked.push(stop.again);
    return junit(stop.again.map((name) => [name, of(name, n)]));
  };
  return { asked, start };
}

describe('reportCases', () => {
  it('reads each flow in the order it ran: name, file, and whether it failed or had no driver', () => {
    const report = junit([['P0 "Join" & more', 'pass'], ['JRN-006 signs it off', 'fail'], ['ACCT-029 Arabic', 'none']]);
    expect(reportCases(report)).toEqual([
      { name: 'P0 "Join" & more', file: 'apps/mobile/test/maestro/flows/P0.yaml', failed: false, noDriver: false },
      { name: 'JRN-006 signs it off', file: 'apps/mobile/test/maestro/flows/JRN-006.yaml', failed: true, noDriver: false },
      { name: 'ACCT-029 Arabic', file: 'apps/mobile/test/maestro/flows/ACCT-029.yaml', failed: true, noDriver: true }
    ]);
  });
  it('knows Maestro\'s words for a driver that is gone, and no others', () => {
    expect(noDriver(GONE)).toBe(true);
    expect(noDriver('Element not found: Text matching regex: Looks good')).toBe(false);
    expect(noDriver(null)).toBe(false);
  });
});

describe('when the driver stops', () => {
  // 2026-11-17 on the iPhone simulator: JRN-006 failed, the driver stopped in
  // the reviewer's flow, and the six flows after it never started.
  const NIGHT: [string, Result][] = [
    ['P0-coordinator asks', 'pass'], ['JRN-006 signs it off', 'fail'], ['MAP-031 Download buttons', 'pass'],
    ['P0-reviewer reviews', 'none'], ['ACCT-029 Arabic', 'none'], ['REC-020 Microphone', 'none'], ['AUTH-035 An invite link', 'none'],
    ['PASS-035 Keep a passage', 'none'], ['P0-join one person', 'none'], ['P0-signout hands over', 'none']
  ];
  const LEFT = NIGHT.filter(([, r]) => r === 'none').map(([name]) => name);

  it('says nothing of a run whose driver did not stop, and starts nothing', () => {
    const first = junit([['A', 'pass'], ['B', 'fail']]);
    const { asked, start } = maestro(() => 'pass');
    expect(driverStop(first, first)).toBeNull();
    expect(withNewDrivers(first, start)).toEqual({ report: first, stops: [] });
    expect(asked).toEqual([]);
  });

  it('runs the flow the driver stopped at and those after it with a new driver, in their order, once', () => {
    const first = junit(NIGHT);
    expect(driverStop(first, first)).toEqual({ at: 'P0-reviewer reviews', again: LEFT });
    const { asked, start } = maestro(() => 'pass');
    const { report, stops } = withNewDrivers(first, start);
    expect(asked).toEqual([LEFT]);
    expect(stops).toEqual([{ at: 'P0-reviewer reviews', again: LEFT }]);
    // Each flow where it was, with its result; the flow that failed is still the one failure.
    expect(results(report)).toEqual(NIGHT.map(([name, r]) => [name, r === 'none' ? 'pass' : r]));
    expect(report).toContain('tests="10" failures="1"');
  });

  it('never runs again a flow that got a result, pass or fail', () => {
    const { asked, start } = maestro((name) => (name.startsWith('ACCT-029') ? 'fail' : 'pass'));
    const { report } = withNewDrivers(junit(NIGHT), start);
    expect(asked.flat()).not.toContain('JRN-006 signs it off');
    expect(asked.flat().filter((name) => name.startsWith('ACCT-029'))).toHaveLength(1);
    expect(results(report).filter(([, r]) => r === 'fail').map(([name]) => name)).toEqual(['JRN-006 signs it off', 'ACCT-029 Arabic']);
    expect(report).toContain('failures="2"');
  });

  it('starts a third driver when the second stops too, for what is still without a result', () => {
    const { asked, start } = maestro((name, n) => (n === 1 && !name.startsWith('P0-reviewer') ? 'none' : 'pass'));
    const { report, stops } = withNewDrivers(junit(NIGHT), start);
    expect(asked).toEqual([LEFT, LEFT.slice(1)]);
    expect(stops.map((s) => s.at)).toEqual(['P0-reviewer reviews', 'ACCT-029 Arabic']);
    expect(results(report).filter(([, r]) => r === 'none')).toEqual([]);
  });

  it('leaves a flow the driver stops at twice with no result, so that the flows after it get theirs', () => {
    const { asked, start } = maestro((name, n) => (n === 1 ? 'none' : name.startsWith('REC-020') ? 'fail' : 'pass'));
    const { report, stops } = withNewDrivers(junit(NIGHT), start);
    expect(asked).toEqual([LEFT, LEFT.slice(1)]);
    expect(stops).toEqual([{ at: 'P0-reviewer reviews', again: LEFT }, { at: 'P0-reviewer reviews', again: LEFT.slice(1) }]);
    expect(results(report).filter(([, r]) => r !== 'pass')).toEqual([['JRN-006 signs it off', 'fail'], ['P0-reviewer reviews', 'none'], ['REC-020 Microphone', 'fail']]);
  });

  it(`stops after ${NEW_DRIVERS} new drivers when the phone is gone for good, and says where`, () => {
    const { asked, start } = maestro(() => 'none');
    const first = junit(NIGHT);
    const { report, stops } = withNewDrivers(first, start);
    expect(asked).toHaveLength(NEW_DRIVERS);
    expect(stops).toHaveLength(NEW_DRIVERS + 1);
    expect(stops.at(-1)!.again).toEqual([]);
    expect(results(report)).toEqual(results(first));
  });

  it('keeps the report as it was when a new start leaves none', () => {
    const first = junit(NIGHT);
    expect(withNewDrivers(first, () => null)).toEqual({ report: first, stops: [{ at: 'P0-reviewer reviews', again: [] }] });
  });
});

describe('mergeReports', () => {
  it('puts each flow a new driver ran in the place it had, and counts the failures again', () => {
    const merged = mergeReports(junit([['A "x"', 'none'], ['B', 'fail'], ['C', 'none']]), junit([['C', 'pass'], ['A "x"', 'fail']]));
    expect(results(merged)).toEqual([['A "x"', 'fail'], ['B', 'fail'], ['C', 'pass']]);
    expect(merged).toContain('tests="3" failures="2"');
    expect(merged.match(/<testcase\b/g)).toHaveLength(3);
  });
});
