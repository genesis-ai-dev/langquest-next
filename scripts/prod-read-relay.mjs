#!/usr/bin/env node
// Production reads for Claude in an agent team's job (docs/production-reads.md,
// "Reads while Claude runs"). claude-code-action takes the job's OIDC request
// variables out of Claude's shell, so Claude cannot ask GitHub for a token. This
// relay, started in a step before Claude, keeps them in its own process and
// passes Claude's statements and log reads to the read gate, with a token for
// the gate's audience only. Claude gets the gate's answers, never a token, and
// the gate still holds every read to agent_reader.
//
//   node prod-read-relay.mjs start    starts it in the background; prints its address
//   node prod-read-relay.mjs stop     stops it (a step after Claude, before any Claude with the web)
//
// It listens on 127.0.0.1 only, takes POST /read and POST /read/logs and
// nothing else, and stops itself after RELAY_MINUTES (60).
import { spawn } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { LOGS_URL, READ_AUDIENCE, READ_URL } from './prod-read.mjs';

export const RELAY_PORT = 47615;
export const RELAY_URL = `http://127.0.0.1:${RELAY_PORT}`;
const MAX_BODY = 64 * 1024;
const pidFile = () => join(process.env.RUNNER_TEMP ?? tmpdir(), 'prod-read-relay.pid');

/** The gate's address for a path of the relay, or null for any other path. */
export function gateUrl(path) {
  return path === '/read' ? READ_URL : path === '/read/logs' ? LOGS_URL : null;
}

/** The job's OIDC token for the read gate, from GitHub, kept until a minute before it ends. */
export function tokenSource(env = process.env, fetcher = fetch, now = () => Date.now()) {
  let kept = null;
  return async () => {
    if (kept && kept.until > now()) return kept.token;
    if (!env.ACTIONS_ID_TOKEN_REQUEST_URL || !env.ACTIONS_ID_TOKEN_REQUEST_TOKEN) throw new Error('the relay has no OIDC request variables: the job needs permissions: id-token: write');
    const res = await fetcher(`${env.ACTIONS_ID_TOKEN_REQUEST_URL}&audience=${encodeURIComponent(READ_AUDIENCE)}`, {
      headers: { authorization: `bearer ${env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` }
    });
    if (!res.ok) throw new Error(`GitHub gave no OIDC token (${res.status})`);
    const token = (await res.json()).value;
    const exp = Number(JSON.parse(Buffer.from(String(token).split('.')[1] ?? '', 'base64url').toString() || '{}').exp) * 1000;
    kept = { token, until: Number.isFinite(exp) ? exp - 60_000 : now() + 60_000 };
    return token;
  };
}

/** One request to the relay as { status, body }: the gate's answer, or the relay's refusal. */
export async function relay(method, path, body, token, fetcher = fetch) {
  const url = gateUrl(path);
  if (method !== 'POST' || !url) return { status: 404, body: JSON.stringify({ error: 'The relay takes POST /read and POST /read/logs only.' }) };
  if (body.length > MAX_BODY) return { status: 413, body: JSON.stringify({ error: 'Too large' }) };
  let bearer;
  try { bearer = await token(); } catch (e) { return { status: 502, body: JSON.stringify({ error: e instanceof Error ? e.message : String(e) }) }; }
  const res = await fetcher(url, { method: 'POST', headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' }, body });
  return { status: res.status, body: await res.text() };
}

function serve() {
  const token = tokenSource();
  const server = createServer((req, res) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => { size += c.length; if (size <= MAX_BODY + 1) chunks.push(c); });
    req.on('end', () => {
      relay(req.method ?? '', (req.url ?? '').split('?')[0], Buffer.concat(chunks).toString('utf8'), token)
        .catch((e) => ({ status: 502, body: JSON.stringify({ error: `the gate did not answer: ${e instanceof Error ? e.message : e}` }) }))
        .then(({ status, body }) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(body); });
    });
  });
  server.listen(RELAY_PORT, '127.0.0.1');
  setTimeout(() => process.exit(0), Number(process.env.RELAY_MINUTES ?? 60) * 60_000).unref();
}

async function start() {
  const child = spawn(process.execPath, [new URL(import.meta.url).pathname, 'serve'], { detached: true, stdio: 'ignore', env: process.env });
  child.unref();
  writeFileSync(pidFile(), String(child.pid));
  // Ready when it answers: a GET is refused with 404 without asking GitHub.
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`${RELAY_URL}/`)).status === 404) { console.log(`Production reads for Claude: ${RELAY_URL}`); return; } } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('the relay did not start');
}

function stop() {
  try { process.kill(Number(readFileSync(pidFile(), 'utf8'))); } catch { /* already stopped */ }
  rmSync(pidFile(), { force: true });
  console.log('Production reads for Claude: stopped');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const cmd = process.argv[2];
  if (cmd === 'serve') serve();
  else if (cmd === 'stop') stop();
  else if (cmd === 'start') start().catch((e) => { console.error(`x ${e.message}`); process.exit(1); });
  else { console.error('usage: node prod-read-relay.mjs start|stop'); process.exit(2); }
}
