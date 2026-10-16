import { refuseBoardRequest, TOKEN_HEADER, type BoardRequest } from '../server/v2Guard';

/** The v2 dashboard holds the service key on this machine; a web page the developer visits must not be able to drive it. */

const port = 8079;
const token = 'f'.repeat(64);
const ok: BoardRequest = { method: 'POST', pathname: '/api/link', host: `127.0.0.1:${port}`, origin: `http://127.0.0.1:${port}`, contentType: 'application/json', token };
const refuse = (over: Partial<BoardRequest>) => refuseBoardRequest({ ...ok, ...over }, port, token);

describe('v2 dashboard request check', () => {
  it('lets the served page through, with or without an Origin (a same-origin GET sends none)', () => {
    expect(refuse({})).toBeNull();
    expect(refuse({ method: 'GET', pathname: '/api/board', origin: undefined, contentType: undefined })).toBeNull();
    expect(refuse({ host: `localhost:${port}`, origin: `http://localhost:${port}` })).toBeNull();
  });

  it('serves the page itself without a token, since that is where the token comes from', () => {
    expect(refuse({ method: 'GET', pathname: '/', token: undefined, contentType: undefined })).toBeNull();
  });

  it('refuses a call with no token or the wrong one', () => {
    expect(refuse({ token: undefined })?.status).toBe(403);
    expect(refuse({ token: 'a'.repeat(64) })?.status).toBe(403);
    expect(refuse({ token: token.slice(1) })?.status).toBe(403);
    expect(refuse({ method: 'GET', pathname: '/api/people', token: undefined })?.status).toBe(403);
  });

  it('refuses another origin, even with the token', () => {
    expect(refuse({ origin: 'https://evil.example' })?.status).toBe(403);
    expect(refuse({ origin: 'null' })?.status).toBe(403);
    expect(refuse({ origin: `http://127.0.0.1:${port + 1}` })?.status).toBe(403);
    expect(refuse({ method: 'GET', pathname: '/', origin: 'https://evil.example' })?.status).toBe(403);
  });

  it('refuses another host (DNS rebinding)', () => {
    expect(refuse({ host: `evil.example:${port}` })?.status).toBe(403);
    expect(refuse({ host: undefined })?.status).toBe(403);
  });

  it('wants a POST to say it is JSON', () => {
    expect(refuse({ contentType: 'text/plain' })?.status).toBe(415);
    expect(refuse({ contentType: 'application/x-www-form-urlencoded' })?.status).toBe(415);
    expect(refuse({ contentType: undefined })?.status).toBe(415);
    expect(refuse({ contentType: 'application/json; charset=utf-8' })).toBeNull();
  });

  it('names the header the page sends', () => {
    expect(TOKEN_HEADER).toBe('x-board-token');
  });
});
