import KEPT from '../../expiry.json';
import { jsonSecret } from '../jwt';
import { appStoreToken } from './appstore';
import { getJson, ok, type Alert, type Section } from '../section';

/**
 * What stops working on a date, soonest first (docs/ops-dashboard-plan.md
 * 5.10): each provider token the dashboard holds, with the end date its
 * provider reports, Apple's signing certificates and provisioning profiles,
 * and, where no provider says, a date kept by hand in apps/admin/expiry.json
 * so it is reviewed like code. Names of things only; never a token.
 */

export interface Expiring { what: string; expires: string | null; source: string; note?: string }
export interface Expiry { items: Expiring[]; notes: string[] }

export const WARN_DAYS = 30;
export const PROBLEM_DAYS = 7;

const days = (iso: string, now: number) => (Date.parse(iso) - now) / 86_400_000;

export function expiryAlerts(e: Expiry, now = Date.now()): Alert[] {
  const out: Alert[] = [];
  for (const item of e.items) {
    if (!item.expires) continue;
    const left = days(item.expires, now);
    if (left < 0) out.push({ level: 'urgent', text: `${item.what} expired on ${item.expires.slice(0, 10)}.` });
    else if (left <= PROBLEM_DAYS) out.push({ level: 'problem', text: `${item.what} expires in ${Math.ceil(left)} days (${item.expires.slice(0, 10)}).` });
    else if (left <= WARN_DAYS) out.push({ level: 'watch', text: `${item.what} expires in ${Math.ceil(left)} days (${item.expires.slice(0, 10)}).` });
  }
  return out;
}

/** The file's rows, checked: a row without a date or with one that does not parse is shown as such, not dropped. */
export function keptByHand(rows: unknown): Expiring[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((r) => {
    if (typeof r !== 'object' || r === null) return [];
    const { what, expires, note } = r as { what?: unknown; expires?: unknown; note?: unknown };
    if (typeof what !== 'string') return [];
    const date = typeof expires === 'string' && !Number.isNaN(Date.parse(expires)) ? new Date(expires).toISOString() : null;
    return [{ what, expires: date, source: 'apps/admin/expiry.json', ...(typeof note === 'string' ? { note } : {}) }];
  });
}

type Env = {
  ADMIN_CLOUDFLARE_TOKEN?: string; CLOUDFLARE_ACCOUNT_ID: string; ADMIN_GITHUB_TOKEN?: string; GITHUB_REPO: string; ADMIN_APP_STORE_KEY?: string;
};

interface AscList<A> { data?: { id: string; attributes: A }[] }

export async function expirySection(env: Env, fetcher: typeof fetch = fetch, now = Date.now()): Promise<Section<Expiry>> {
  const items: Expiring[] = [];
  const notes: string[] = [];
  const tries: Promise<void>[] = [];

  if (env.ADMIN_CLOUDFLARE_TOKEN) {
    // A user's token is checked at /user, an account's at its account; the answer says which it is.
    const headers = { authorization: `Bearer ${env.ADMIN_CLOUDFLARE_TOKEN}` };
    type Verify = { result?: { expires_on?: string | null } };
    tries.push(getJson<Verify>(fetcher, 'https://api.cloudflare.com/client/v4/user/tokens/verify', { headers }, 'Cloudflare token')
      .then((r) => ({ r, owner: 'user' }))
      .catch(() => getJson<Verify>(fetcher, `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/tokens/verify`, { headers }, 'Cloudflare token')
        .then((r) => ({ r, owner: 'account' })))
      .then(({ r, owner }) => {
        items.push({ what: 'ADMIN_CLOUDFLARE_TOKEN', expires: r.result?.expires_on ?? null, source: 'Cloudflare',
          ...(owner === 'account' ? { note: 'An account token: Workers Builds needs a token on a user\'s profile (docs/admin.md).' } : {}) });
      }));
  }
  if (env.ADMIN_GITHUB_TOKEN) {
    // A fine-grained token's end date comes back on every answer.
    tries.push(fetcher(`https://api.github.com/repos/${env.GITHUB_REPO}`, {
      headers: { authorization: `Bearer ${env.ADMIN_GITHUB_TOKEN}`, 'user-agent': 'langquest-ops-dashboard', accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(10_000)
    }).then((r) => {
      const header = r.headers.get('github-authentication-token-expiration');
      items.push({ what: 'ADMIN_GITHUB_TOKEN', expires: header && !Number.isNaN(Date.parse(header)) ? new Date(header).toISOString() : null, source: 'GitHub' });
    }));
  }
  if (env.ADMIN_APP_STORE_KEY) {
    tries.push((async () => {
      const token = await appStoreToken(jsonSecret<Parameters<typeof appStoreToken>[0]>(env.ADMIN_APP_STORE_KEY!, 'ADMIN_APP_STORE_KEY', ['issuerId', 'keyId', 'privateKey']), now);
      const headers = { authorization: `Bearer ${token}` };
      const [certs, profiles] = await Promise.all([
        getJson<AscList<{ name?: string; certificateType?: string; expirationDate?: string }>>(fetcher, 'https://api.appstoreconnect.apple.com/v1/certificates?limit=50', { headers }, 'App Store certificates'),
        getJson<AscList<{ name?: string; profileState?: string; expirationDate?: string }>>(fetcher, 'https://api.appstoreconnect.apple.com/v1/profiles?limit=50', { headers }, 'App Store profiles')
      ]);
      for (const c of certs.data ?? []) items.push({ what: `Apple certificate ${c.attributes.certificateType ?? ''} ${c.attributes.name ?? c.id}`.replace(/\s+/g, ' ').trim(), expires: c.attributes.expirationDate ?? null, source: 'App Store Connect' });
      for (const p of profiles.data ?? []) if (p.attributes.profileState !== 'INVALID') items.push({ what: `Provisioning profile ${p.attributes.name ?? p.id}`, expires: p.attributes.expirationDate ?? null, source: 'App Store Connect' });
    })());
  }
  for (const t of await Promise.allSettled(tries)) if (t.status === 'rejected') notes.push(t.reason instanceof Error ? t.reason.message : String(t.reason));
  items.push(...keptByHand(KEPT));
  items.sort((a, b) => (a.expires ? Date.parse(a.expires) : Infinity) - (b.expires ? Date.parse(b.expires) : Infinity));
  const e = { items, notes };
  return ok(e, expiryAlerts(e, now));
}
