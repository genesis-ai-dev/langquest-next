import { readFileSync } from 'node:fs';
import { LOGS_URL, post, READ_URL, viaRelay } from './prod-read.mjs';
import { gateUrl, relay, RELAY_URL, tokenSource } from './prod-read-relay.mjs';

/** Production reads while Claude runs in an agent team's job (scripts/prod-read-relay.mjs, docs/production-reads.md). */

const jwt = (exp: number) => `h.${Buffer.from(JSON.stringify({ exp })).toString('base64url')}.s`;

describe('the relay for production reads', () => {
  it('passes only POST /read and POST /read/logs to the gate', async () => {
    expect(gateUrl('/read')).toBe(READ_URL);
    expect(gateUrl('/read/logs')).toBe(LOGS_URL);
    expect(gateUrl('/token')).toBeNull();
    const never = async () => { throw new Error('no token for a refused request'); };
    expect((await relay('GET', '/read', '', never)).status).toBe(404);
    expect((await relay('POST', '/', '{}', never)).status).toBe(404);
    expect((await relay('POST', '/read', 'x'.repeat(70_000), never)).status).toBe(413);
  });

  it('sends the statement with the job token, and gives back the gate\'s answer, never the token', async () => {
    const sent: { url: string; auth: string | null; body: string }[] = [];
    const answer = await relay('POST', '/read', '{"sql":"select 1"}', async () => 'jwt', async (url: string, init: RequestInit) => {
      sent.push({ url, auth: new Headers(init.headers).get('authorization'), body: String(init.body) });
      return new Response('{"login":"agent_reader","rows":[[1]]}', { status: 200 });
    });
    expect(sent).toEqual([{ url: READ_URL, auth: 'Bearer jwt', body: '{"sql":"select 1"}' }]);
    expect(answer).toEqual({ status: 200, body: '{"login":"agent_reader","rows":[[1]]}' });
    expect(answer.body).not.toContain('jwt');
  });

  it('asks GitHub for a token for the gate\'s audience only, and keeps it until a minute before it ends', async () => {
    let now = 1_000_000;
    const asked: string[] = [];
    const token = tokenSource({ ACTIONS_ID_TOKEN_REQUEST_URL: 'https://gh/t?x=1', ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'r' }, async (url: string) => {
      asked.push(url);
      return new Response(JSON.stringify({ value: jwt(now / 1000 + 300) }));
    }, () => now);
    await token();
    await token();
    expect(asked).toEqual(['https://gh/t?x=1&audience=https%3A%2F%2Fapp.langquest.org%2Fops%2Fapi%2Fread']);
    now += 250_000;
    await token();
    expect(asked).toHaveLength(2);
    await expect(tokenSource({}, fetch)()).rejects.toThrow('id-token: write');
  });
});

describe('prod-read.mjs in Claude\'s shell', () => {
  it('reads through the relay when the shell has no token of its own', async () => {
    const env = { PROD_READ_RELAY: RELAY_URL };
    expect(viaRelay(READ_URL, env)).toBe(`${RELAY_URL}/read`);
    expect(viaRelay(LOGS_URL, env)).toBe(`${RELAY_URL}/read/logs`);
    expect(viaRelay(READ_URL, { ...env, CLAUDE_READ_TOKEN: 't' })).toBeNull();
    expect(viaRelay(READ_URL, { ...env, ACTIONS_ID_TOKEN_REQUEST_URL: 'u' })).toBeNull();
    expect(viaRelay(READ_URL, {})).toBeNull();
    const seen: { url: string; auth: string | null }[] = [];
    const res = await post(READ_URL, { sql: 'select 1', params: [] }, env, async (url: string, init: RequestInit) => {
      seen.push({ url, auth: new Headers(init.headers).get('authorization') });
      return new Response('{"login":"agent_reader","columns":["x"],"rows":[[1]]}');
    });
    expect(seen).toEqual([{ url: `${RELAY_URL}/read`, auth: null }]);
    expect(res.ok).toBe(true);
    await expect(post(READ_URL, { sql: 'select 1' }, env, async () => { throw new Error('refused'); })).rejects.toThrow('does not answer');
  });
});

describe('the workflows', () => {
  const steps = (file: string) => readFileSync(file, 'utf8').split(/\n {6}- /);
  const claudes = (s: string[]) => s.filter((x) => x.includes('anthropics/claude-code-action'));

  it('start the relay before each Claude that may read, and give that Claude its address', () => {
    for (const file of ['.github/workflows/user-issues.yml', '.github/workflows/card-questions.yml']) {
      const all = steps(file);
      for (const claude of claudes(all).filter((c) => c.includes('prod-read.mjs:*)'))) {
        const at = all.indexOf(claude);
        const started = all.slice(0, at).map((x, i) => (x.includes('prod-read-relay.mjs" start') ? i : x.includes('prod-read-relay.mjs" stop') ? -i - 1 : null)).filter((i) => i !== null).pop();
        expect(started, `${file}: ${claude.slice(0, 60)}`).toBeGreaterThanOrEqual(0);
        expect(claude, file).toContain(`PROD_READ_RELAY: ${RELAY_URL}`);
      }
    }
  });

  it('stop the relay before any Claude with the web: what it reads must not reach a page', () => {
    for (const file of ['.github/workflows/user-issues.yml', '.github/workflows/card-questions.yml']) {
      const all = steps(file);
      let running = false;
      for (const s of all) {
        if (/^ {2}[\w-]+:$/m.test(s)) running = false; // a new job: a new runner
        if (s.includes('prod-read-relay.mjs" start')) running = true;
        if (s.includes('prod-read-relay.mjs" stop')) running = false;
        if (s.includes('anthropics/claude-code-action') && /WebFetch|WebSearch/.test(s)) expect(running, `${file}: ${s.slice(0, 60)}`).toBe(false);
      }
    }
  });
});
