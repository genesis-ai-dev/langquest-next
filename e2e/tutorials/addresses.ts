// Addresses a viewer can read. The tests' accounts have run-numbered addresses
// ("ui-mvrfl11c287b-admin@example.test"), which show on Edit Profile and More
// settings; a filmed world gives each person "<first name>@example.com"
// instead. Every film uses the same addresses, so whoever had one in an
// earlier film's world gives it up first.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { localServer, signIn, type AccountKey, type UiWorld } from '../ui/fixture';

function admin(): SupabaseClient {
  const s = localServer();
  return createClient(s.url, s.service, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Moves each address off any account that has it now, to a run-numbered one. */
export async function freeAddresses(emails: string[]): Promise<void> {
  const sb = admin();
  const wanted = new Set(emails);
  for (let page = 1; ; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`listing accounts: ${error.message}`);
    for (const u of data.users.filter((x) => x.email && wanted.has(x.email))) {
      const moved = await sb.auth.admin.updateUserById(u.id, { email: `left-${u.id}@example.test`, email_confirm: true });
      if (moved.error) throw new Error(`freeing ${u.email}: ${moved.error.message}`);
    }
    if (data.users.length < 1000) return;
  }
}

/** Gives every account that signs in with a password its readable address, and a session that carries it. */
export async function giveAddresses(world: UiWorld): Promise<void> {
  const keys = (Object.keys(world.accounts) as AccountKey[]).filter((k) => world.accounts[k].password);
  const taken = new Set<string>();
  const address = new Map<AccountKey, string>();
  for (const k of keys) {
    const first = world.accounts[k].name.split(/\s+/)[0]!.toLowerCase().normalize('NFD').replace(/[^a-z]/g, '') || k.toLowerCase();
    const email = taken.has(`${first}@example.com`) ? `${first}.${k.toLowerCase()}@example.com` : `${first}@example.com`;
    taken.add(email);
    address.set(k, email);
  }
  await freeAddresses([...address.values()]);
  const sb = admin();
  await Promise.all(keys.map(async (k) => {
    const who = world.accounts[k];
    const changed = await sb.auth.admin.updateUserById(who.id, { email: address.get(k)!, email_confirm: true });
    if (changed.error) throw new Error(`address for ${k}: ${changed.error.message}`);
    who.email = address.get(k)!;
    who.session = (await signIn(world, k)).session;
  }));
}
