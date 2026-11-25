import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every key this app saves on the phone, and whether a phone that joined offline has what it holds
 * (the 2026-11-24 review, T1). Why: shared Bibles, the names library items go by, the names of
 * people let in offline and the revocation list were each read by a screen from a saved key that
 * neither the join wrote nor nearby carried, so the new phone showed less than its inviter's until
 * first contact. A key added without saying here what a newcomer gets of it fails this test.
 *
 * - `join`: the join writes it on the new phone.
 * - `nearby`: a teammate's phone carries it (a starting copy, a top-up, step 7's files, Hello).
 * - `own`: the person's or the phone's own, which a newcomer starts without, as on any new phone.
 * - `server`: comes only from the server, with the reason it stays out until first contact.
 * - `no-key`: not a saved key at all, but an id or a part of one the search finds.
 */
const INVENTORY: Record<string, 'join' | 'nearby' | 'own' | 'no-key' | { server: string }> = {
  // What screens read about the team and its library.
  'profile-directory': 'join',
  'chain-names:': 'nearby',
  'library-shared:material': 'nearby',
  'library-shared-teammate:': 'nearby',
  'library-labels:': 'nearby',
  'library-labels-teammate:': 'nearby',
  'library-doc:': 'nearby',
  'library-outbox:': 'own',
  'library-unreadable': 'own',
  'nearbyRevoked:': 'join',
  'help-audio:': { server: 'help recordings stay out until first sync (Carl, 2026-11-24, review item 10)' },
  'join-requests:': { server: 'requests to join wait on the server for an admin; a newcomer has none to answer' },
  'org-badges-v1': { server: 'organization verification is the server\'s word, shown once it is heard' },
  'source-audio:index': 'nearby',
  'source-audio:wants:': 'own',
  'study-files:nearby': 'own',
  'study-files:since': 'own',
  'study-files:wants:': 'own',
  'guide-files:wants:': 'own',
  'text:': { server: 'Bible Brain text is streamed under its licence and never passed on' },
  'biblebrain:': { server: 'Bible Brain\'s answers are its own and never passed on' },
  // The person's own, which every new phone starts without.
  'my-bibles:': 'own', 'source-choice:': 'own', 'home:': 'own', 'recent:': 'own', 'inbox-read:': 'own', 'language:': 'own',
  'hand-overs': 'own', 'hand-over-session:': 'own', 'held-ask': 'own', 'held-invite': 'own', 'feedback-before-sign-in': 'own',
  'guide-draft:v1:': 'own', 'locked-find-keys:': 'own', 'app-lock-people': 'own', 'disguise-code': 'own', 'disguise-look': 'own',
  'disguise-notes': 'own', 'ui-language:v1': 'own', 'key-words:ours-in-bible': 'own', 'loudness:v1:': 'own', 'bars:v1:': 'own',
  'mic-heard:v1': 'own', 'recording:silence-parts:v1': 'own', 'hint:hold-verse:v1': 'own', 'hint:pinch-waveform:v1': 'own',
  'hint:swipe-part:v1': 'own',
  // This phone's own nearby and app state.
  'nearby-install-key': 'own', 'nearby-local-person': 'join', 'nearbyHold': 'own', 'nearbyOpen': 'own', 'nearbyCertAsked:': 'own',
  'nearbyChain:': 'join', 'nearbyFindKeys:': 'join', 'nearbyOpenOrgs:': 'join', 'nearbyPasses:': 'own', 'diag:off': 'own',
  'app-versions:dismissed': 'own', 'app-versions:last': 'own', 'first-launch-update:looked': 'own', 'carriedApkKeptUnder': 'own',
  'carriedApkOpened': 'own', 'carriedApkRight': 'own', 'langquest-moved': 'own', 'langquest-reopen': 'own', '__langquestTabLock': 'own',
  'lq.': 'own',
  // Ids and parts of keys the search finds, not saved keys.
  'bb:': 'no-key', 'lib:': 'no-key'
};

const SRC = join(__dirname, '..', 'src');
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

/** The keys the source names in a constant whose name says it is a key, by the part before any value in them. */
function keysNamed(): Set<string> {
  const out = new Set<string>();
  const pattern = /(?:KEY|Key|PREFIX|Prefix)[A-Za-z_]* = (?:\([^)]*\) => )?(['`])([^'`]+)\1/g;
  for (const file of files(SRC)) {
    for (const m of readFileSync(file, 'utf8').matchAll(pattern)) {
      const text = m[2]!;
      if (text.startsWith('${')) continue;
      const head = text.split('${')[0]!;
      // A key with values in it is named by the part before them, up to its last colon.
      out.add(text.includes('${') ? head.slice(0, head.lastIndexOf(':') + 1) || head : head);
    }
  }
  return out;
}

describe('the keys this app saves, and what a phone that joined offline has of each', () => {
  it('names every key the source keeps, and says how a newcomer gets it or why it does not', () => {
    const unsaid = [...keysNamed()].filter((k) => k && !(k in INVENTORY));
    expect(unsaid, 'add each to INVENTORY with what a newcomer gets of it').toEqual([]);
  });

  it('what screens read about the team and its library reaches a newcomer, or says why not', () => {
    for (const key of ['library-shared:material', 'library-labels:', 'chain-names:', 'nearbyRevoked:', 'profile-directory', 'library-doc:', 'help-audio:']) {
      const how = INVENTORY[key];
      expect(how, key).toBeDefined();
      if (typeof how === 'object') expect(how.server.length).toBeGreaterThan(20);
      else expect(['join', 'nearby']).toContain(how);
    }
  });
});
