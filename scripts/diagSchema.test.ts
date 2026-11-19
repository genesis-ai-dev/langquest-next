import { readdirSync, readFileSync } from 'node:fs';
import { DIAG_CONTEXT, DIAG_SCHEMA, DIAG_TOKEN } from '@langquest-next/sync';
import { NEARBY_DIAG_SCHEMA } from '@langquest-next/sync/nearby';

// The phone and the server apply the same diagnostics allowlist
// (docs/diagnostics.md). The server's copy is a JSON literal between
// diag-schema markers in the newest migration that defines it; this holds
// the two equal, so a field added on one side only is a failing test, not a
// silent drop. Android's `nearby` kind is held in the nearby entry, so the
// web carries none of it, and the server allows it beside the rest.

const dir = new URL('../supabase/migrations/', import.meta.url);
const sql = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
  .map((f) => readFileSync(new URL(f, dir), 'utf8')).filter((text) => text.includes('-- diag-schema:begin')).at(-1)!;

// The ops dashboard gives each sign-in record a class (diag.sign_in_class, in the newest
// migration that defines it): the step went as designed, it is no fault of the server or
// the app, or it is trouble, which is a line on the dashboard's Overview. An outcome the
// rule does not name is trouble, so a new one shows until someone says what it is. This
// makes that someone the developer who adds the outcome: name it in the rule, or here.
const classRule = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
  .map((f) => readFileSync(new URL(f, dir), 'utf8')).filter((text) => text.includes('function diag.sign_in_class(')).at(-1)!;
const TROUBLE_OUTCOMES = ['http', 'rate_limited', 'server', 'gone', 'failed'];

describe('sign-in classes', () => {
  it('every outcome the app can write is in a class someone chose', () => {
    const body = /function diag\.sign_in_class\(p_t jsonb\)[\s\S]*?\$\$([\s\S]*?)\$\$/.exec(classRule)?.[1];
    expect(body).toBeDefined();
    const named = new Set([...body!.matchAll(/'([a-z_0-9]+)'/g)].map((m) => m[1]!));
    for (const outcome of DIAG_SCHEMA.auth.t.outcome) expect(named.has(outcome) || TROUBLE_OUTCOMES.includes(outcome), outcome).toBe(true);
    for (const outcome of TROUBLE_OUTCOMES) expect(named.has(outcome), outcome).toBe(false);
  });
});

describe('diagnostics allowlist parity', () => {
  it('the migration allows exactly what packages/sync allows', () => {
    const literal = /-- diag-schema:begin\n'([^']*)'\n-- diag-schema:end/.exec(sql)?.[1];
    expect(literal).toBeDefined();
    expect(JSON.parse(literal!)).toEqual(JSON.parse(JSON.stringify({ kinds: { ...DIAG_SCHEMA, ...NEARBY_DIAG_SCHEMA }, context: DIAG_CONTEXT })));
  });

  it('the token pattern is the same on both sides', () => {
    const pattern = /p ~ '(\^\[[^']*\$)'/.exec(sql)?.[1];
    expect(pattern).toBe(DIAG_TOKEN.source);
  });
});
