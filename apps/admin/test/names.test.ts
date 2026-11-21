import { describe, expect, it } from 'vitest';
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
