import { describe, expect, it } from 'vitest';
import { brokenCalls, callsAt, callsIn, missing, schemaAfter, serverHere } from './server-calls.mjs';

/**
 * Every server call that a supported store build makes, in its own code or
 * in an OTA update sent to it, has to still be there (scripts/server-calls.mjs,
 * decisions.md 151). These hold the parts of that check: what counts as a
 * call, what the migrations leave, and how a broken call is named.
 */

describe('the calls in some code', () => {
  it('reads database functions, tables, Edge Functions and Worker routes', () => {
    const code = `
      supabase.rpc('pull_events', { p_stream: s });
      supabase.from('profiles').select('id');
      supabase.storage.from('audio').upload(x);
      Array.from({ length: 3 });
      supabase.functions.invoke('send-invite', { body });
      invokeFunction('join', body);
      fetch(\`\${api()}/api/blob-urls/\${key}\`);
    `;
    expect([...callsIn(code)].sort()).toEqual(['from:profiles', 'invoke:join', 'invoke:send-invite', 'route:blob-urls', 'rpc:pull_events']);
  });

  it('finds about as many in the code on this branch as the app makes today', () => {
    const calls = [...callsAt('HEAD')];
    expect(calls.filter((c) => c.startsWith('rpc:')).length).toBeGreaterThan(40);
    expect(calls).toContain('route:blobs');
  });

  it('finds every call in the code on this branch on the server on this branch', () => {
    expect(missing(callsAt('HEAD'), serverHere())).toEqual([]);
  });
});

describe('what the migrations leave', () => {
  it('adds what is created and takes away what is dropped or renamed', () => {
    const have = schemaAfter([
      `create table public.a (id int); create table if not exists b (id int);
       create or replace function public.f(p int) returns int as $$ select 1 $$ language sql;
       create function g() returns int as $$ select 1 $$ language sql;
       create view v as select 1; create materialized view mv as select 1;`,
      `-- drop function f(int);  (a comment, not a drop)
       drop function if exists public.g();
       alter table a rename to a2;
       drop view if exists v, mv;`,
    ]);
    expect([...have.function].sort()).toEqual(['f']);
    expect([...have.relation].sort()).toEqual(['a2', 'b']);
  });

  it('reads the migrations on this branch', () => {
    const { schema } = serverHere();
    expect(schema.function.has('pull_events') || schema.function.size > 40).toBe(true);
    expect(schema.relation.has('profiles')).toBe(true);
  });
});

describe('a broken call', () => {
  const server = {
    schema: { function: new Set(['kept']), relation: new Set(['profiles']) },
    edgeFunction: (name: string) => name === 'join',
    route: (name: string) => name === 'blobs',
  };
  const builds = [
    { platform: 'android', build: 25, commit: 'c25' },
    { platform: 'android', build: 23, commit: 'c23' },
  ];

  it('is named with the newest store build whose own code makes it', () => {
    const byBuild = new Map([
      ['c25', new Set(['rpc:kept', 'rpc:gone'])],
      ['c23', new Set(['rpc:gone', 'route:bible'])],
    ]);
    expect(brokenCalls({ byBuild, added: new Map() }, builds, server)).toEqual([
      { call: 'rpc:gone', build: builds[0], commit: undefined },
      { call: 'route:bible', build: builds[1], commit: undefined },
    ]);
  });

  it('is named with its OTA update when no build has it in its own code', () => {
    const byBuild = new Map([['c25', new Set<string>()], ['c23', new Set<string>()]]);
    expect(brokenCalls({ byBuild, added: new Map([['from:old_view', 'abc']]) }, builds, server)).toEqual([
      { call: 'from:old_view', build: undefined, commit: 'abc' },
    ]);
  });
});
