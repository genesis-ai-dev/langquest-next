import { asText, bearer, parseArgs, PROXY_STAND_IN } from './prod-read.mjs';

/** The read gate's command (scripts/prod-read.mjs, docs/production-reads.md). */

describe('npm run prod:read', () => {
  it('takes the statement, its parameters and --json', () => {
    expect(parseArgs(['--json', 'select $1', 'x'])).toEqual({ json: true, sql: 'select $1', params: ['x'] });
    expect(parseArgs([])).toEqual({ json: false, sql: '', params: [] });
  });

  it('sends CLAUDE_READ_TOKEN, else the GitHub job\'s OIDC token for the gate\'s audience, else says what is missing', async () => {
    expect(await bearer({ CLAUDE_READ_TOKEN: 't' }, async () => { throw new Error('no fetch'); })).toBe('t');
    const asked: string[] = [];
    const token = await bearer({ ACTIONS_ID_TOKEN_REQUEST_URL: 'https://gh/token?x=1', ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'r' }, async (url: string) => {
      asked.push(url);
      return new Response(JSON.stringify({ value: 'jwt' }));
    });
    expect(token).toBe('jwt');
    expect(asked).toEqual(['https://gh/token?x=1&audience=https%3A%2F%2Fapp.langquest.org%2Fops%2Fapi%2Fread']);
    await expect(bearer({}, fetch)).rejects.toThrow(/No CLAUDE_READ_TOKEN/);
    // A cloud thread whose proxy adds the token: a stand-in the gate would never take as one.
    expect(await bearer({ CLAUDE_CODE_REMOTE: 'true' }, fetch)).toBe(PROXY_STAND_IN);
    expect(PROXY_STAND_IN.length).toBeLessThan(32);
  });

  it('prints rows under their column names, and says when the gate cut them', () => {
    expect(asText({ login: 'claude_reader', columns: ['a', 'b'], rows: [[1, null], ['x\ty', { k: 1 }]], truncated: true, ms: 4 }))
      .toBe('a\tb\n1\t\nx y\t{"k":1}\n(2 rows, cut at 1000: add a limit or a where, 4 ms, as claude_reader)');
  });
});
