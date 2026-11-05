import { describe, expect, it } from 'vitest';
import { email, parseArgs, quoted, rowsOf } from './global-viewer';

// The script only builds SQL; what it may grant is held by server/globalViewerSmoke.sql.
describe('global-viewer arguments', () => {
  it('reads the command, the email and the note in any order', () => {
    expect(parseArgs(['grant', 'a@b.org', '--note', 'LAN-1, asked by Mary', '--hosted'])).toEqual({
      command: 'grant', email: 'a@b.org', note: 'LAN-1, asked by Mary', hosted: true, json: false
    });
    expect(parseArgs(['--note=x', 'grant', 'a@b.org']).note).toBe('x');
    expect(parseArgs([]).command).toBe('list');
  });

  it('quotes a note as one SQL string, quotes and all', () => {
    expect(quoted("Mary's case", 'a note')).toBe("'Mary''s case'");
    expect(() => quoted('', 'a note')).toThrow('Give a note.');
    expect(() => quoted('two\nlines', 'a note')).toThrow();
    expect(() => quoted('x'.repeat(501), 'a note')).toThrow();
  });

  it('takes an email on any domain, and nothing that could leave the string', () => {
    expect(email('carl+viewer@example.org')).toBe("'carl+viewer@example.org'");
    expect(() => email("x'; drop table x;--@a.org")).toThrow();
    expect(() => email('not an email')).toThrow();
    expect(() => email(undefined)).toThrow();
  });
});

describe('reading the Supabase CLI', () => {
  const answer = '{\n  "boundary": "b",\n  "rows": [\n    {\n      "answer": "granted"\n    }\n  ],\n  "warning": "w"\n}\n';

  it('finds the rows, wrapped for an agent or bare in a terminal', () => {
    expect(rowsOf<{ answer: string }>(answer)).toEqual([{ answer: 'granted' }]);
    // As a person's terminal gets it (the revoke that reached the database but read as no rows).
    expect(rowsOf<{ answer: string }>('[\n  {\n    "answer": "revoked"\n  }\n]\n')).toEqual([{ answer: 'revoked' }]);
    expect(rowsOf('[]\n')).toEqual([]);
  });

  it('finds them among other JSON the CLI prints, before or after', () => {
    const notice = '{\n  "message": "Starting services"\n}\n';
    expect(rowsOf<{ answer: string }>(notice + answer)).toEqual([{ answer: 'granted' }]);
    expect(rowsOf<{ answer: string }>(answer + notice)).toEqual([{ answer: 'granted' }]);
    expect(rowsOf<{ answer: string }>(notice + '[\n  {\n    "answer": "reset"\n  }\n]\n')).toEqual([{ answer: 'reset' }]);
  });

  it('says what it got when there are no rows', () => {
    expect(() => rowsOf('Connecting to local database...')).toThrow(/gave no rows[\s\S]*Connecting/);
  });
});
