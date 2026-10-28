import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { a11yState } from '../src/ui/a11yModel';

const SRC = join(__dirname, '..', 'src');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('a control says its state on the web too (UI audit, finding 21)', () => {
  it('says each state as the aria word for its role', () => {
    expect(a11yState({ checked: true, disabled: true }, 'switch')).toEqual({ accessibilityState: { checked: true, disabled: true }, 'aria-checked': true, 'aria-disabled': true });
    expect(a11yState({ selected: false }, 'radio')).toMatchObject({ 'aria-checked': false });
    expect(a11yState({ selected: true }, 'tab')).toMatchObject({ 'aria-selected': true });
    expect(a11yState({ selected: false }, 'button')).toMatchObject({ 'aria-pressed': false });
    expect(a11yState({ selected: true }, 'button', 'current')).toMatchObject({ 'aria-current': true });
    expect(a11yState({ selected: false }, 'button', 'current')).not.toHaveProperty('aria-current');
    expect(a11yState({ expanded: false }, 'button')).toMatchObject({ 'aria-expanded': false });
    expect(a11yState({ busy: true }, 'progressbar')).toMatchObject({ 'aria-busy': true });
    expect(a11yState(undefined, 'button')).toEqual({});
  });

  it('no control sets accessibilityState without its web twin', () => {
    const bare = files(SRC).flatMap((f) => readFileSync(f, 'utf8').split('\n')
      .flatMap((line, i) => (/accessibilityState=/.test(line) ? [`${relative(SRC, f)}:${i + 1}`] : [])));
    expect(bare).toEqual([]);
  });
});
