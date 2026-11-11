#!/usr/bin/env node
/**
 * How the nightly iPhone run reaches its test server (decision 206). A Mac
 * runner on GitHub cannot run Docker, so the local stack (Supabase and the
 * app's Worker) runs on a Linux runner of the same workflow run, and the
 * Mac reaches it through a Cloudflare quick tunnel, which needs no account:
 *
 *   node scripts/phone-tunnel.mjs serve [--port 9000]
 *       on the Linux runner, in front of the stack; cloudflared points at it
 *   node scripts/phone-tunnel.mjs connect --url https://<name>.trycloudflare.com
 *       on the Mac, on 127.0.0.1:54421 and :8787, where the test build
 *       (.env.development) looks for Supabase and the Worker
 *
 * The tunnel's address is public for the run, so `serve` refuses every
 * request that does not carry the run's token: a random value the Linux job
 * makes and keeps (PHONE_TUNNEL_TOKEN, in that step alone: never in a job's
 * env, an output or an artifact, which a public repository's logs and
 * artifacts would show). The Mac asks for it once, at TOKEN_PATH, with an
 * OIDC token GitHub signs for that job (`id-token: write`): `serve` hands it
 * over only for a token GitHub signed for this repository, this workflow and
 * this run. `connect` then adds it to each request, and says which of the two
 * servers the request is for; `serve` sends it there with the Host the server
 * expects. Plain requests and WebSocket upgrades (Supabase Realtime) both
 * pass. `connect` returns once the far side answers.
 */
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { createPublicKey, timingSafeEqual, verify } from 'node:crypto';
import { fileURLToPath } from 'node:url';

/** Where the test build looks for each server, and where the stack serves it. */
export const TARGETS = {
  supabase: { port: 54421, host: '127.0.0.1:54421' },
  worker: { port: 8787, host: 'localhost:8787' }
};
export const TOKEN_HEADER = 'x-phone-tunnel';
export const TARGET_HEADER = 'x-phone-target';
export const HEALTH_PATH = '/__phone-tunnel';
export const TOKEN_PATH = '/__phone-tunnel/token';
export const OIDC_ISSUER = 'https://token.actions.githubusercontent.com';
export const AUDIENCE = 'phone-tunnel';
export const WORKFLOW = '.github/workflows/phone-tests.yml';

/**
 * Why a GitHub Actions OIDC token is refused, or null when it passes: signed
 * (RS256) by one of GitHub's `keys`, for this audience, and for `expect`'s
 * repository and run, from this workflow, and not expired.
 */
export function idTokenProblem(jwt, keys, expect, now = Date.now() / 1000) {
  const parts = typeof jwt === 'string' ? jwt.split('.') : [];
  if (parts.length !== 3) return 'not a JWT';
  let header, claims;
  try {
    header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
    claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
  } catch {
    return 'unreadable';
  }
  if (header.alg !== 'RS256') return 'not RS256';
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) return 'unknown key';
  let signed = false;
  try {
    signed = verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(parts[2], 'base64url'));
  } catch {
    signed = false;
  }
  if (!signed) return 'bad signature';
  if (claims.iss !== OIDC_ISSUER) return 'wrong issuer';
  if (![].concat(claims.aud).includes(AUDIENCE)) return 'wrong audience';
  if (typeof claims.exp !== 'number' || claims.exp < now) return 'expired';
  if (typeof claims.nbf === 'number' && claims.nbf > now + 60) return 'not yet valid';
  if (claims.repository !== expect.repository) return 'another repository';
  if (String(claims.run_id) !== String(expect.runId)) return 'another run';
  if (!String(claims.workflow_ref ?? '').startsWith(`${expect.repository}/${WORKFLOW}@`)) return 'another workflow';
  return null;
}

/** GitHub's signing keys for OIDC tokens, asked again when a token names a key not seen yet. */
export function githubKeys(fetcher = fetch) {
  let keys = [];
  return async (kid) => {
    if (!keys.some((k) => k.kid === kid)) {
      const r = await fetcher(`${OIDC_ISSUER}/.well-known/jwks`, { signal: AbortSignal.timeout(15_000) });
      if (!r.ok) throw new Error(`GitHub's OIDC keys: HTTP ${r.status}`);
      keys = (await r.json()).keys ?? [];
    }
    return keys;
  };
}

const kidOf = (jwt) => {
  try {
    return JSON.parse(Buffer.from(String(jwt).split('.')[0], 'base64url').toString()).kid;
  } catch {
    return undefined;
  }
};

/** Whether a request carries the run's token. */
export function allowed(header, token) {
  if (!token || typeof header !== 'string') return false;
  const a = Buffer.from(header);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * A request's raw headers with the tunnel's own taken out and Host set: what
 * is passed on. `raw` is Node's rawHeaders (name, value, name, value...).
 */
export function passOn(raw, host, extra = {}) {
  const out = [];
  for (let i = 0; i < raw.length; i += 2) {
    const name = raw[i].toLowerCase();
    if (name === 'host' || name === TOKEN_HEADER || name === TARGET_HEADER) continue;
    out.push([raw[i], raw[i + 1]]);
  }
  out.unshift(['Host', host]);
  for (const [k, v] of Object.entries(extra)) out.push([k, v]);
  return out;
}

const asObject = (pairs) => {
  const o = {};
  for (const [k, v] of pairs) {
    const key = k.toLowerCase();
    o[key] = key in o ? [].concat(o[key], v) : v;
  }
  return o;
};
const upgradeHead = (req, pairs) =>
  `${req.method} ${req.url} HTTP/1.1\r\n${pairs.map(([k, v]) => `${k}: ${v}`).join('\r\n')}\r\n\r\n`;

/**
 * In front of the stack: hands the run's token to a job GitHub vouches for
 * (`auth`: `keys(kid)` gives GitHub's keys, `repository` and `runId` say
 * which run), checks the token on everything else, then passes the request
 * to the server it names.
 */
export function serve(port, token, targets = TARGETS, auth = null) {
  const target = (req) => (Object.hasOwn(targets, req.headers[TARGET_HEADER] ?? '') ? targets[req.headers[TARGET_HEADER]] : undefined);
  const server = http.createServer((req, res) => {
    if (req.url === TOKEN_PATH && req.method === 'POST') {
      const jwt = /^Bearer (\S+)$/i.exec(req.headers.authorization ?? '')?.[1];
      req.resume();
      (async () => {
        const why = !auth ? 'no OIDC check here' : !jwt ? 'no token' : idTokenProblem(jwt, await auth.keys(kidOf(jwt)), auth);
        if (why) {
          console.error(`phone-tunnel: refused a token request: ${why}`);
          res.writeHead(403, { 'content-type': 'text/plain' }).end(why);
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify({ token }));
      })().catch(() => { if (!res.headersSent) res.writeHead(502); res.end(); });
      return;
    }
    if (!allowed(req.headers[TOKEN_HEADER], token)) {
      res.writeHead(403).end();
      return;
    }
    if (req.url === HEALTH_PATH) {
      res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
      return;
    }
    const to = target(req);
    if (!to) {
      res.writeHead(400).end();
      return;
    }
    const up = http.request({ host: '127.0.0.1', port: to.port, method: req.method, path: req.url, headers: asObject(passOn(req.rawHeaders, to.host)) }, (r) => {
      res.writeHead(r.statusCode ?? 502, r.rawHeaders);
      r.pipe(res);
    });
    up.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
    req.pipe(up);
  });
  server.on('upgrade', (req, socket, head) => {
    const to = target(req);
    if (!allowed(req.headers[TOKEN_HEADER], token) || !to) {
      socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      return;
    }
    const up = net.connect(to.port, '127.0.0.1', () => {
      up.write(upgradeHead(req, passOn(req.rawHeaders, to.host)));
      if (head.length) up.write(head);
      up.pipe(socket).pipe(up);
    });
    up.on('error', () => socket.destroy());
    socket.on('error', () => up.destroy());
  });
  server.listen(port, '127.0.0.1');
  return server;
}

/**
 * On the Mac: a server on each port the test build uses, passing every
 * request through the tunnel. `ports` says where each listens (the test
 * build's own ports unless a test says otherwise); an http:// url is for tests.
 */
export function connect(url, token, ports = { supabase: TARGETS.supabase.port, worker: TARGETS.worker.port }) {
  const tunnel = new URL(url);
  const secure = tunnel.protocol === 'https:';
  const port = Number(tunnel.port || (secure ? 443 : 80));
  const servers = Object.entries(ports).map(([name, listen]) => {
    const extra = { [TOKEN_HEADER]: token, [TARGET_HEADER]: name };
    const server = http.createServer((req, res) => {
      const up = (secure ? https : http).request({ host: tunnel.hostname, port, method: req.method, path: req.url, headers: asObject(passOn(req.rawHeaders, tunnel.host, extra)) }, (r) => {
        res.writeHead(r.statusCode ?? 502, r.rawHeaders);
        r.pipe(res);
      });
      up.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
      req.pipe(up);
    });
    server.on('upgrade', (req, socket, head) => {
      const opened = () => {
        up.write(upgradeHead(req, passOn(req.rawHeaders, tunnel.host, extra)));
        if (head.length) up.write(head);
        up.pipe(socket).pipe(up);
      };
      const up = secure ? tls.connect({ host: tunnel.hostname, port, servername: tunnel.hostname }, opened) : net.connect(port, tunnel.hostname, opened);
      up.on('error', () => socket.destroy());
      socket.on('error', () => up.destroy());
    });
    // Both address families: the simulator may look up "localhost" as ::1.
    // A machine without IPv6 gets IPv4 alone.
    server.once('error', (e) => {
      if (e.code !== 'EAFNOSUPPORT' && e.code !== 'EADDRNOTAVAIL') throw e;
      server.listen({ port: listen, host: '127.0.0.1' });
    });
    server.listen({ port: listen, host: '::', ipv6Only: false });
    return server;
  });
  return servers;
}

/** An OIDC token GitHub signs for this job, for the tunnel's audience (the job needs `id-token: write`). */
export async function idToken(env = process.env, fetcher = fetch) {
  const url = env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const bearer = env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!url || !bearer) throw new Error('no OIDC token: the job needs permissions: id-token: write');
  const r = await fetcher(`${url}&audience=${AUDIENCE}`, { headers: { authorization: `bearer ${bearer}` }, signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`GitHub's OIDC token: HTTP ${r.status}`);
  const value = (await r.json()).value;
  if (typeof value !== 'string') throw new Error('GitHub gave no OIDC token');
  return value;
}

/** The run's token, from the test server, for this job's OIDC token; tries until the tunnel answers, at most `ms`. */
export async function obtainToken(url, getIdToken = () => idToken(), ms = 300_000, fetcher = fetch) {
  const until = Date.now() + ms;
  let last = 'no answer';
  while (Date.now() < until) {
    try {
      const r = await fetcher(new URL(TOKEN_PATH, url), { method: 'POST', headers: { authorization: `Bearer ${await getIdToken()}` }, signal: AbortSignal.timeout(15_000) });
      if (r.ok) {
        const { token } = await r.json();
        if (typeof token === 'string' && token.length >= 32) return token;
        last = 'no token in the answer';
      } else {
        last = `HTTP ${r.status}${r.status === 403 ? `: ${await r.text()}` : ''}`;
        // Refused by the gate itself: asking again will not change its mind.
        if (r.status === 403) break;
      }
    } catch (e) {
      last = e instanceof Error ? e.message : String(e);
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(`the test server gave no token (${last})`);
}

/** Waits until the far side answers through the tunnel, at most `ms`. */
export async function reachable(url, token, ms = 300_000) {
  const until = Date.now() + ms;
  let last = 'no answer';
  while (Date.now() < until) {
    try {
      const r = await fetch(new URL(HEALTH_PATH, url), { headers: { [TOKEN_HEADER]: token }, signal: AbortSignal.timeout(10_000) });
      if (r.ok) return;
      last = `HTTP ${r.status}`;
    } catch (e) {
      last = e instanceof Error ? e.message : String(e);
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(`the test server did not answer through the tunnel in ${ms / 1000} s (${last})`);
}

async function main() {
  const [mode, ...rest] = process.argv.slice(2);
  const opt = (name, fallback) => {
    const i = rest.indexOf(`--${name}`);
    return i >= 0 && rest[i + 1] ? rest[i + 1] : fallback;
  };
  if (mode === 'serve') {
    const token = process.env.PHONE_TUNNEL_TOKEN;
    if (!token || token.length < 32) throw new Error('PHONE_TUNNEL_TOKEN is missing or too short');
    const { GITHUB_REPOSITORY: repository, GITHUB_RUN_ID: runId } = process.env;
    if (!repository || !runId) throw new Error('GITHUB_REPOSITORY and GITHUB_RUN_ID say whose jobs may have the token');
    const port = Number(opt('port', '9000'));
    serve(port, token, TARGETS, { keys: githubKeys(), repository, runId });
    console.log(`phone-tunnel: serving on 127.0.0.1:${port}, for jobs of ${repository} run ${runId}`);
  } else if (mode === 'connect') {
    const url = opt('url', '');
    if (!/^https:\/\/[a-z0-9-]+\.trycloudflare\.com\/?$/.test(url)) throw new Error('--url is the tunnel\'s https://<name>.trycloudflare.com address');
    const token = await obtainToken(url);
    await reachable(url, token);
    connect(url, token);
    console.log(`phone-tunnel: 127.0.0.1:${TARGETS.supabase.port} and :${TARGETS.worker.port} go through ${url}`);
  } else {
    console.error('usage: phone-tunnel.mjs serve [--port 9000] | connect --url https://<name>.trycloudflare.com');
    process.exit(2);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
