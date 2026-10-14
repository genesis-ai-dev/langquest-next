// The phone runner's skip rules (scripts/maestro-plan.mjs) and the tags the
// flows must carry for them to work.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { flowTags, plannedSkips, skipReport } from './maestro-plan.mjs';

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
