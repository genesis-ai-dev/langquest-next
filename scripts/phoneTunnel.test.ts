import http from 'node:http';
import net, { type AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { allowed, connect, HEALTH_PATH, passOn, serve, TARGET_HEADER, TOKEN_HEADER } from './phone-tunnel.mjs';

// The nightly iPhone run reaches its test server through a public tunnel
// (decision 207). These tests hold what keeps that safe and working: nothing
// passes without the run's token, the token never reaches the servers, each
// request reaches the server it names with the Host that server expects, and
// WebSocket upgrades (Supabase Realtime) pass both ways.

const TOKEN = 'a'.repeat(48);
const port = (s: { address(): AddressInfo | string | null }) => (s.address() as AddressInfo).port;
const listening = (s: http.Server | net.Server) => new Promise<void>((r) => (s.listening ? r() : s.once('listening', () => r())));

let upstream: http.Server;
let gate: http.Server;
let sides: http.Server[];

beforeAll(async () => {
  // Stands in for Supabase and the Worker: says what it got; an upgrade echoes.
  upstream = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d)).on('end', () => res.end(JSON.stringify({ url: req.url, method: req.method, headers: req.headers, body })));
  });
  upstream.on('upgrade', (req, socket, head) => {
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
    socket.write(`host=${req.headers.host};token=${req.headers[TOKEN_HEADER] ?? ''}\n`);
    if (head.length) socket.write(head);
    socket.pipe(socket);
  });
  upstream.listen(0, '127.0.0.1');
  await listening(upstream);
  const up = port(upstream);
  gate = serve(0, TOKEN, { supabase: { port: up, host: '127.0.0.1:54421' }, worker: { port: up, host: 'localhost:8787' } });
  await listening(gate);
  sides = connect(`http://127.0.0.1:${port(gate)}`, TOKEN, { supabase: 0, worker: 0 });
  await Promise.all(sides.map(listening));
});

afterAll(() => {
  for (const s of [upstream, gate, ...sides]) s.close();
});

describe('phone tunnel', () => {
  it('takes only the exact token', () => {
    expect(allowed(TOKEN, TOKEN)).toBe(true);
    expect(allowed(TOKEN.slice(1), TOKEN)).toBe(false);
    expect(allowed(undefined, TOKEN)).toBe(false);
    expect(allowed('', '')).toBe(false);
  });

  it('passes on everything but its own headers, with the Host the server expects', () => {
    const out = passOn(['Host', 'x.trycloudflare.com', 'Authorization', 'Bearer t', TOKEN_HEADER, TOKEN, TARGET_HEADER, 'worker', 'apikey', 'k'], 'localhost:8787');
    expect(out).toEqual([['Host', 'localhost:8787'], ['Authorization', 'Bearer t'], ['apikey', 'k']]);
  });

  it('refuses a request without the token, or for no server', async () => {
    const gatePort = port(gate);
    expect((await fetch(`http://127.0.0.1:${gatePort}/rest/v1/x`)).status).toBe(403);
    expect((await fetch(`http://127.0.0.1:${gatePort}${HEALTH_PATH}`, { headers: { [TOKEN_HEADER]: TOKEN } })).status).toBe(200);
    expect((await fetch(`http://127.0.0.1:${gatePort}/x`, { headers: { [TOKEN_HEADER]: TOKEN, [TARGET_HEADER]: 'toString' } })).status).toBe(400);
  });

  it('brings each request to its server, without the token', async () => {
    const [supabase, worker] = sides.map((s) => port(s));
    const a = await (await fetch(`http://127.0.0.1:${supabase}/auth/v1/token?grant_type=password`, { method: 'POST', body: '{"a":1}', headers: { apikey: 'anon' } })).json();
    expect(a).toMatchObject({ url: '/auth/v1/token?grant_type=password', method: 'POST', body: '{"a":1}' });
    expect(a.headers).toMatchObject({ host: '127.0.0.1:54421', apikey: 'anon' });
    expect(a.headers[TOKEN_HEADER]).toBeUndefined();
    const b = await (await fetch(`http://127.0.0.1:${worker}/api/blobs`)).json();
    expect(b.headers.host).toBe('localhost:8787');
  });

  it('passes a WebSocket upgrade both ways', async () => {
    const supabase = port(sides[0]!);
    const got = await new Promise<string>((resolve, reject) => {
      const socket = net.connect(supabase, '127.0.0.1', () => {
        socket.write('GET /realtime/v1/websocket HTTP/1.1\r\nHost: 127.0.0.1:54421\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
        socket.write('ping');
      });
      let text = '';
      socket.on('data', (d) => {
        text += d;
        if (text.endsWith('ping')) {
          socket.destroy();
          resolve(text);
        }
      });
      socket.on('error', reject);
    });
    expect(got).toContain('101 Switching Protocols');
    expect(got).toContain('host=127.0.0.1:54421;token=\n');
  });
});
