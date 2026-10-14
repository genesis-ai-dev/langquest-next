/**
 * The UI test suite's fixture world (smart-tests/ui/fixture.ts, decision 93),
 * built fresh on the local server:
 *
 *   npm run ui:fixture -- --out world.json [--unwelcomed]
 *
 * Writes the world (ids, passages, accounts with their passwords and
 * sessions; never a service key) to --out, or prints it when there is none,
 * and says what it made. --unwelcomed leaves every account's Welcome unseen
 * (AUTH-056). Refuses any Supabase or Worker that is not on this machine.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildWorld, localServer, PASSAGE_KEYS } from '../smart-tests/ui/fixture';

async function main(argv: string[]) {
  const i = argv.indexOf('--out');
  const out = i >= 0 ? argv[i + 1] : undefined;
  if (i >= 0 && !out) throw new Error('--out needs a file name');
  const server = localServer();
  const world = await buildWorld({ welcomed: !argv.includes('--unwelcomed') });
  const json = JSON.stringify(world, null, 2);
  if (out) {
    mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    writeFileSync(out, json);
  } else {
    console.log(json);
  }
  const log = out ? console.log : console.error;
  log(`${world.orgName} (${world.orgId}) on ${server.url}, built in ${(world.buildMs / 1000).toFixed(1)} s`);
  log(`  Alpha ${world.languages.A.languageId} (ready, listed), Bravo ${world.languages.B.languageId} (not ready)`);
  log(`  ${world.org2Name} (${world.org2Id}): Charlie ${world.languages.C.languageId}`);
  log(`  Passages: ${PASSAGE_KEYS.map((k) => `${k} ${world.passages[k].ref}`).join(', ')}`);
  log(`  Accounts: ${Object.entries(world.accounts).map(([k, a]) => `${k} ${a.signInName ?? a.email}`).join(', ')}`);
  log(`  Welcome ${world.welcomed ? 'seen' : 'not yet seen'} by every account${out ? `; written to ${out}` : ''}`);
}

main(process.argv.slice(2)).catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
