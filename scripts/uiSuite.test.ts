import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Traceability for the UI test suite (docs/testing.md "Spec traceability",
 * decision 102): every automated or P0 spec has an implementation, every
 * implementation names a spec, and the README's count is true.
 */

const DOCS = 'docs/ui-test-suite';
const ID = '[A-Z0-9]+-\\d+';

// Specs that are meant to be automated (or are P0) but have no test yet.
const KNOWN_GAPS: Record<string, string> = {
  'NAV-020': 'no test yet (2026-10-14)',
  'MAP-025': 'no test yet (2026-10-14)',
  'STUDY-027': 'no test yet (2026-10-14)',
  'SYNC-021': 'no test yet (2026-10-14)',
  'AUTH-050': 'phone-only, no flow yet (2026-10-14)',
  'NOORG-022': 'phone-only, no flow yet (2026-10-14)',
  'JRN-014': 'phone-only, no flow yet (2026-10-14)',
  'A11Y-001': 'P0 without automation, needs a screen reader (2026-10-14)',
  'A11Y-003': 'P0 without automation, needs a screen reader (2026-10-14)',
  'A11Y-005': 'P0 without automation, needs a screen reader (2026-10-14)',
  'A11Y-011': 'P0 without automation, needs a screen reader (2026-10-14)',
  'A11Y-024': 'P0 without automation, needs a device (2026-10-14)',
  'ACCT-038': 'P0 without automation, manual or device (2026-10-14)',
  'ACCT-047': 'P0 without automation, manual or device (2026-10-14)',
  'AUTH-025': 'P0 without automation, manual or device (2026-10-14)',
  'JRN-012': 'P0 without automation, manual or device (2026-10-14)',
  'JRN-013': 'P0 without automation, manual or device (2026-10-14)',
};

interface Spec {
  id: string;
  title: string;
  priority: string;
  run: string;
  retired: boolean;
  file: string;
}

function specs(): Spec[] {
  const out: Spec[] = [];
  for (const f of readdirSync(DOCS).filter((n) => /^\d.*\.md$/.test(n))) {
    const lines = readFileSync(`${DOCS}/${f}`, 'utf8').replace(/```[\s\S]*?```/g, (m) => m.replace(/[^\n]/g, '')).split('\n');
    lines.forEach((line, i) => {
      const h = new RegExp(`^### (${ID}) (.+)$`).exec(line);
      if (!h) return;
      const meta = lines.slice(i + 1, i + 4).find((l) => /Priority:/.test(l)) ?? '';
      const priority = /Priority: (P[012])/.exec(meta)?.[1] ?? '';
      const run = /Run: (Auto|Manual|Device)(.*)$/.exec(meta);
      out.push({
        id: h[1]!,
        title: h[2]!,
        priority,
        run: run ? run[1]! + (/^\s*\(model\)/.test(run[2]!) ? ' (model)' : '') : '',
        retired: h[2]!.includes('(retired)'),
        file: f,
      });
    });
  }
  return out;
}

function files(dir: string, test: (n: string) => boolean): string[] {
  try {
    return readdirSync(dir).filter(test).map((n) => `${dir}/${n}`);
  } catch {
    return [];
  }
}

function titles(paths: string[], fn: string): string[] {
  const re = new RegExp(`\\b${fn}\\(\\s*['"\`](${ID})\\b`, 'g');
  return paths.flatMap((p) => [...readFileSync(p, 'utf8').matchAll(re)].map((m) => m[1]!));
}

const all = specs();
const live = all.filter((s) => !s.retired);

const web = new Set(titles(files('smart-tests/ui', (n) => n.endsWith('.spec.ts')), 'test'));
const phone = new Set(files('apps/mobile/test/maestro/flows', (n) => /^[A-Z0-9]+-\d+\.yaml$/.test(n)).map((p) => p.replace(/.*\//, '').replace('.yaml', '')));
const modelFiles = [
  ...files('apps/mobile/test', (n) => n.endsWith('.test.ts')),
  ...readdirSync('packages').flatMap((p) => files(`packages/${p}/test`, (n) => n.endsWith('.test.ts'))),
];
const model = new Set([...titles(modelFiles, 'it'), ...titles(modelFiles, 'test')]);

const implemented = new Set([...web, ...phone, ...model]);

describe('UI test suite traceability', () => {
  if (process.env.VERBOSE) {
    console.log(`ui suite: ${live.length} specs; web ${web.size}, phone ${phone.size}, model ${model.size}`);
  }

  it('finds the specs', () => {
    expect(live.length).toBeGreaterThan(100);
    for (const s of live) {
      expect(s.priority, `${s.id} needs a Priority`).not.toBe('');
      expect(s.run, `${s.id} needs a Run`).not.toBe('');
    }
  });

  it('has unique IDs in the docs', () => {
    const seen = new Map<string, string>();
    for (const s of all) {
      expect(seen.has(s.id), `${s.id} is in ${seen.get(s.id)} and ${s.file}`).toBe(false);
      seen.set(s.id, s.file);
    }
  });

  it('implements every Auto spec, except the known gaps', () => {
    const missing = live.filter((s) => s.run.startsWith('Auto') && !implemented.has(s.id) && !KNOWN_GAPS[s.id]);
    expect(missing.map((s) => s.id), 'Auto specs with no test (add the test, or a KNOWN_GAPS entry with a reason)').toEqual([]);
  });

  it('implements every P0 spec, except the known gaps', () => {
    const missing = live.filter((s) => s.priority === 'P0' && !implemented.has(s.id) && !KNOWN_GAPS[s.id]);
    expect(missing.map((s) => s.id), 'P0 specs with no test (add the test, or a KNOWN_GAPS entry with a reason)').toEqual([]);
  });

  it('keeps KNOWN_GAPS honest', () => {
    const byId = new Map(all.map((s) => [s.id, s]));
    for (const id of Object.keys(KNOWN_GAPS)) {
      expect(byId.has(id), `${id} is not in the docs`).toBe(true);
      expect(implemented.has(id), `${id} now has a test; remove it from KNOWN_GAPS`).toBe(false);
    }
  });

  it('has no test for an ID the docs lack', () => {
    const known = new Set(all.map((s) => s.id));
    const orphans = [...implemented].filter((id) => !known.has(id));
    expect(orphans, 'tests naming no spec').toEqual([]);
  });

  it("matches the README's count", () => {
    const readme = readFileSync(`${DOCS}/README.md`, 'utf8');
    const n = /\*\*(\d+) tests in all\.\*\*/.exec(readme)?.[1];
    expect(Number(n), 'README "N tests in all" must equal the non-retired specs').toBe(live.length);
  });
});
