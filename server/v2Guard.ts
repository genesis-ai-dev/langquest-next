import { timingSafeEqual } from 'node:crypto';

/**
 * Who may talk to the v2 dashboard (server/v2.ts). It holds the service key
 * and answers on this machine, which a web page the developer has open can
 * also reach: a POST with a plain content type needs no permission from the
 * browser. So every `/api/*` request must carry this run's random token,
 * which only the page the server itself served has (it is written into it),
 * must come from the page's own origin if the browser says where from, and
 * a POST must say it is JSON, which a form or a bare fetch cannot send
 * without asking first.
 */
export type BoardRequest = {
  method: string;
  pathname: string;
  host: string | undefined;
  origin: string | undefined;
  contentType: string | undefined;
  token: string | undefined;
};

export const TOKEN_HEADER = 'x-board-token';

/** Null when the request may go on; otherwise the status and the reason. */
export function refuseBoardRequest(req: BoardRequest, port: number, token: string): { status: number; error: string } | null {
  const own = [`127.0.0.1:${port}`, `localhost:${port}`];
  if (!req.host || !own.includes(req.host)) return { status: 403, error: 'local only' };
  if (req.origin !== undefined && !own.some((h) => req.origin === `http://${h}`)) return { status: 403, error: 'local only' };
  if (!req.pathname.startsWith('/api/')) return null;
  if (!sameToken(req.token, token)) return { status: 403, error: 'Open the dashboard from the address the command printed.' };
  if (req.method === 'POST' && !/^application\/json\s*(;|$)/i.test(req.contentType ?? '')) return { status: 415, error: 'JSON only' };
  return null;
}

function sameToken(given: string | undefined, expected: string): boolean {
  const a = Buffer.from(given ?? '');
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
