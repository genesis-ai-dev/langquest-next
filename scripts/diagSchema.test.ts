import { readdirSync, readFileSync } from 'node:fs';
import { DIAG_CONTEXT, DIAG_SCHEMA, DIAG_TOKEN } from '../packages/client/src/diagnostics';

// The phone and the server apply the same diagnostics allowlist
// (docs/diagnostics.md). The server's copy is a JSON literal between
// diag-schema markers in the newest migration that defines it; this holds
// the two equal, so a field added on one side only is a failing test, not a
// silent drop.

const dir = new URL('../supabase/migrations/', import.meta.url);
const sql = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
  .map((f) => readFileSync(new URL(f, dir), 'utf8')).filter((text) => text.includes('-- diag-schema:begin')).at(-1)!;

describe('diagnostics allowlist parity', () => {
  it('the migration allows exactly what packages/client allows', () => {
    const literal = /-- diag-schema:begin\n'([^']*)'\n-- diag-schema:end/.exec(sql)?.[1];
    expect(literal).toBeDefined();
    expect(JSON.parse(literal!)).toEqual(JSON.parse(JSON.stringify({ kinds: DIAG_SCHEMA, context: DIAG_CONTEXT })));
  });

  it('the token pattern is the same on both sides', () => {
    const pattern = /p ~ '(\^\[[^']*\$)'/.exec(sql)?.[1];
    expect(pattern).toBe(DIAG_TOKEN.source);
  });
});
