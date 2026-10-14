/**
 * Steps a phone flow cannot take itself, for the coordinator to run beside
 * it (docs/ui-test-suite/12-sync-and-offline.md):
 *
 *   npx tsx smart-tests/ui/sync-wrap.ts rev-voice-note <world.json>
 *     SYNC-026: REV records a 30-second voice note on P-SUBMITTED on their
 *     own device. Run it once SYNC-026's flow shows TRANS's Sync screen
 *     (the flow waits up to three minutes for it).
 *
 * <world.json> is the run's world (scripts/maestro-ui.mjs writes it to
 * smart-tests/results/maestro/<platform>/world.json).
 */
import { readFileSync } from 'node:fs';
import type { UiWorld } from './fixture';
import { voiceNoteAs } from './sync-helpers';

async function main(argv: string[]) {
  const [what, file] = argv;
  if (!file) throw new Error('usage: sync-wrap.ts rev-voice-note <world.json>');
  const world = JSON.parse(readFileSync(file, 'utf8')) as UiWorld;
  if (what === 'rev-voice-note') {
    const hash = await voiceNoteAs(world, 'REV', 'P-SUBMITTED', 30);
    console.log(`REV's 30-second voice note on ${world.passages['P-SUBMITTED'].label}: ${hash}`);
    return;
  }
  throw new Error(`unknown step ${what}`);
}

main(process.argv.slice(2)).catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
