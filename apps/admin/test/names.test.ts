import { describe, expect, it } from 'vitest';
import { readdirSync } from 'node:fs';
import { page } from '../src/page';

describe('the page’s script', () => {
  it('declares each top-level function and constant once: a second one would quietly replace the first', async () => {
    const html = await page({ supabaseUrl: 'https://abc.supabase.co', anonKey: 'k' }, 'n').text();
    const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]!).join('\n');
    const names = [...scripts.matchAll(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(|^(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=/gm)].map((m) => m[1] ?? m[2]);
    const twice = [...new Set(names.filter((n, i) => names.indexOf(n) !== i))];
    expect(twice).toEqual([]);
  });
});

describe('the page’s style', () => {
  it('gives each plain class rule to one file: a second one in another file would quietly change the first one’s rows', async () => {
    // The page puts every file's CSS in one style element. Two files that both style ".mrow" on its own
    // made the Releases rows one word wide (the bell's list and the meter rows had the same class).
    const files = readdirSync(new URL('../src/', import.meta.url)).filter((f) => /^page.*\.ts$/.test(f));
    const owners = new Map<string, Set<string>>();
    for (const f of files) {
      const mod = (await import('../src/' + f)) as Record<string, unknown>;
      for (const [name, css] of Object.entries(mod)) {
        if (!name.endsWith('_CSS') || typeof css !== 'string') continue;
        for (const m of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{/g)) {
          for (const sel of m[1]!.split(',').map((s) => s.trim())) {
            const lone = /^\.([\w-]+)(?::[\w-]+(?:\([^)]*\))?)*$/.exec(sel);
            if (lone) owners.set(lone[1]!, (owners.get(lone[1]!) ?? new Set()).add(f));
          }
        }
      }
    }
    const twice = [...owners].filter(([, fs]) => fs.size > 1).map(([c, fs]) => '.' + c + ' in ' + [...fs].join(', '));
    expect(twice).toEqual([]);
  });
});
