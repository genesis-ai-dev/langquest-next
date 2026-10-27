import { DurableObject } from 'cloudflare:workers';
import { invitationContent, parseCodeMessage, parseMessage, verificationCodeContent, type CodeMessage, type InviteMessage } from './message';

const reply = (body: unknown, status = 200) => Response.json(body, { status });
type Delivery = { fingerprint: string; status: string; messageId: string | null };

/** One object per invite makes simultaneous phone retries share one send. */
export class InviteDelivery extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS delivery (
      id INTEGER PRIMARY KEY CHECK(id=1), fingerprint TEXT NOT NULL,
      status TEXT NOT NULL, messageId TEXT
    )`);
  }

  async send(p: InviteMessage): Promise<Response> {
    // The language is left out: a retry in another language is the same invitation.
    const { locale: _language, ...details } = p;
    const bytes = await crypto.subtle.digest('SHA-256',
      new TextEncoder().encode(JSON.stringify(details)));
    const fingerprint = Array.from(new Uint8Array(bytes),
      b => b.toString(16).padStart(2, '0')).join('');
    // No await between lookup and reservation. Only hashes and delivery
    // receipts persist; the raw invitation token remains transient.
    const existing = this.ctx.storage.sql.exec<Delivery>(
      'SELECT fingerprint,status,messageId FROM delivery WHERE id=1'
    ).toArray()[0];
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        return reply({ error: 'This invitation already has different delivery details.' }, 409);
      }
      if (existing.status === 'sent') return reply({ sent: true });
      return reply({ error: 'Delivery is pending or could not be confirmed. '
        + 'Check the recipient inbox or share the invite link.' }, 409);
    }
    this.ctx.storage.sql.exec(
      "INSERT INTO delivery(id,fingerprint,status) VALUES(1,?,'pending')",
      fingerprint
    );
    await this.ctx.storage.setAlarm(Date.parse(p.expiresAt) + 86_400_000);
    await this.ctx.storage.sync();
    try {
      const result = await this.env.EMAIL.send({
        to: p.email,
        from: { email: this.env.INVITE_FROM, name: 'LangQuest' },
        ...invitationContent(p, this.env.APP_URL)
      });
      this.ctx.storage.sql.exec(
        "UPDATE delivery SET status='sent',messageId=? WHERE id=1",
        result.messageId
      );
      return reply({ sent: true });
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error
        ? String(error.code) : 'unknown';
      // These errors explicitly reject before accepting delivery. Other
      // failures remain pending: retrying an uncertain send can duplicate it.
      if (['E_SENDER_NOT_VERIFIED', 'E_SENDER_DOMAIN_NOT_AVAILABLE',
        'E_RATE_LIMIT_EXCEEDED', 'E_DAILY_LIMIT_EXCEEDED',
        'E_RECIPIENT_NOT_ALLOWED', 'E_RECIPIENT_SUPPRESSED',
        'E_VALIDATION_ERROR'].includes(code)) {
        this.ctx.storage.sql.exec('DELETE FROM delivery WHERE id=1');
      }
      console.error(JSON.stringify({ event: 'invite_email_failed', code }));
      // The code (Cloudflare's E_*) goes back to send-invite, which records the
      // run for field diagnostics; this Worker holds no database key.
      return reply({ error: 'Email delivery failed. Share the QR or invite link instead.', code: /^[A-Za-z0-9_.:-]{1,80}$/.test(code) ? code : 'unknown' }, 502);
    }
  }

  async alarm() { await this.ctx.storage.deleteAll(); }
}

/** A request body read with its size held to 4 KB, chunked requests included; null when it is larger. */
async function readSmallBody(request: Request): Promise<Uint8Array | null | 'none'> {
  const reader = request.body?.getReader();
  if (!reader) return 'none';
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 4096) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const buffer = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.length; }
  return buffer;
}

/**
 * A blue check's code (decisions.md 172). No delivery object: each code is
 * new, and the database limits how many are sent, so a retry is one more
 * code, not a second copy of one.
 */
async function sendCode(p: CodeMessage, env: Env): Promise<Response> {
  try {
    await env.EMAIL.send({ to: p.email, from: { email: env.INVITE_FROM, name: 'LangQuest' }, ...verificationCodeContent(p) });
    return reply({ sent: true });
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'unknown';
    console.error(JSON.stringify({ event: 'verification_email_failed', code }));
    return reply({ error: 'Email delivery failed.', code: /^[A-Za-z0-9_.:-]{1,80}$/.test(code) ? code : 'unknown' }, 502);
  }
}

export default {
  async fetch(request, env): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path !== '/send-invite' && path !== '/send-code') return new Response('Not found', { status: 404 });
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
    const actual = new TextEncoder().encode(request.headers.get('Authorization') ?? '');
    const expected = new TextEncoder().encode(`Bearer ${env.INVITE_RELAY_SECRET}`);
    if (!env.INVITE_RELAY_SECRET || actual.length !== expected.length
      || !crypto.subtle.timingSafeEqual(actual, expected)) return reply({ error: 'Unauthorized' }, 401);
    const buffer = await readSmallBody(request);
    if (buffer === null) return reply({ error: 'Request too large' }, 413);
    if (buffer === 'none') return reply({ error: 'Invalid details' }, 400);
    let body: unknown;
    try { body = JSON.parse(new TextDecoder().decode(buffer)); }
    catch { return reply({ error: 'Invalid details' }, 400); }
    if (path === '/send-code') {
      const c = parseCodeMessage(body);
      return c ? sendCode(c, env) : reply({ error: 'Invalid details' }, 400);
    }
    const p: InviteMessage | null = parseMessage(body);
    if (!p) return reply({ error: 'Invalid invitation details' }, 400);
    return env.DELIVERIES.getByName(p.inviteId).send(p);
  }
} satisfies ExportedHandler<Env>;
