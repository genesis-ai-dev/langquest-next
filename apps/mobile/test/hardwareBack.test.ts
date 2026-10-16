import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openBackStep, takeHardwareBack } from '../src/ui/hardwareBack';

describe("Android's Back goes back through the steps open on the screen (decision 137)", () => {
  const step = (log: string[], name: string, showing = () => true) => openBackStep({ showing, run: () => log.push(name) });

  it('nothing open: the navigator decides', () => {
    expect(takeHardwareBack()).toBe(false);
  });

  it('the newest step answers: a page inside a wizard before the wizard', () => {
    const log: string[] = [];
    const closeWizard = step(log, 'wizard step');
    const closePage = step(log, 'page inside it');
    expect(takeHardwareBack()).toBe(true);
    closePage();
    expect(takeHardwareBack()).toBe(true);
    closeWizard();
    expect(takeHardwareBack()).toBe(false);
    expect(log).toEqual(['page inside it', 'wizard step']);
  });

  it('only the screen showing answers: a screen pushed on top keeps its own Back', () => {
    const log: string[] = [];
    let underneathShowing = false;
    const closeUnder = step(log, 'screen underneath', () => underneathShowing);
    expect(takeHardwareBack()).toBe(false);
    // Back on top again: its step answers, in the order it opened, however its listeners came back.
    underneathShowing = true;
    const closeLater = step(log, 'opened later');
    expect(takeHardwareBack()).toBe(true);
    closeLater();
    closeUnder();
    expect(log).toEqual(['opened later']);
  });
});

describe("one listener for Android's Back (decision 137)", () => {
  const SRC = join(__dirname, '..', 'src');
  const files = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.tsx?$/.test(name) ? [path] : [];
  });

  it('only the shell listens: a step uses useHardwareBack, a sheet its onBack', () => {
    // Another listener, added later, would be asked before the shell's and pop past the steps open.
    const listening = [...files(SRC), join(SRC, '..', 'App.tsx')]
      .filter((f) => /BackHandler\.addEventListener/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(SRC, f));
    expect(listening).toEqual(['shell/useRootBack.ts']);
  });
});
