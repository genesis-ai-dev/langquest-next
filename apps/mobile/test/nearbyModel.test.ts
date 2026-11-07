import { applyOrgEvent, emptyOrgState, type OrgState } from '@langquest-next/core';
import {
  ASK_EVERY_MS, askReason, certificateAnswerOf, chainsForOrgs, findKeysAfterAnswer, findKeysForOrgs, holdByDefault, holdChoiceOf, isKey32, languagesToName,
  MAX_LANGUAGES, membershipMarkOf, nearbyOrgsOf, orgFeaturesOf, parseAskRecord, parseCertKeys, parseChains, parseFindKeys, revokedSeqsOf,
  type AskFacts, type FindKeys
} from '../src/nearby/nearbyModel';

/**
 * What a phone keeps of its nearby identity and when it asks for more
 * (src/nearby/nearbyModel.ts; docs/nearby-sync-plan.md 5.5, 5.10, 5.12).
 */

const K1 = 'iojj3XQJ8ZX9UtstPLpdcspnCb8dlBIb83SIAbQPb1w';
const K2 = '7UkoxijRwsbq6QM4kFmVYSlZJzpcY_k2NsFGFKyHN9E';

describe('the flag, from get_user_state', () => {
  it('reads orgFeatures, and nothing from a server before the field', () => {
    expect(orgFeaturesOf({ orgFeatures: { o1: ['nearby', 'nearby_join'], o2: ['nearby_join', 3], o3: 'x' } })).toEqual({ o1: ['nearby', 'nearby_join'], o2: ['nearby_join'] });
    expect(orgFeaturesOf({ termsVersion: '1' })).toBeNull();
    expect(orgFeaturesOf(null)).toBeNull();
    expect(orgFeaturesOf({ orgFeatures: [] })).toBeNull();
    expect(nearbyOrgsOf({ o1: ['nearby'], o2: ['nearby_join'] })).toEqual(new Set(['o1']));
  });

  it('reads nearbyRevokedSeq, leaving out anything that is not a seq', () => {
    expect(revokedSeqsOf({ nearbyRevokedSeq: { o1: 4, o2: 0, o3: '5', o4: 1.5 } })).toEqual({ o1: 4 });
    expect(revokedSeqsOf({})).toEqual({});
    expect(revokedSeqsOf({ nearbyRevokedSeq: [1] })).toEqual({});
  });
});

describe('the Worker\'s public keys', () => {
  it('reads kid:key pairs, and any bad entry empties the list, as the Worker does', () => {
    expect(parseCertKeys(`k1:${K1}, k2:${K2}`)).toEqual(new Map([['k1', K1], ['k2', K2]]));
    expect(parseCertKeys(undefined)).toEqual(new Map());
    expect(parseCertKeys('')).toEqual(new Map());
    expect(parseCertKeys(`k1:${K1},k2:short`).size).toBe(0);
    expect(parseCertKeys(`k1:${K1},k1:${K2}`).size).toBe(0);
    expect(parseCertKeys(`:${K1}`).size).toBe(0);
    expect(parseCertKeys(`k 1:${K1}`).size).toBe(0);
    // A 43rd character with stray low bits is not a canonical 32-byte key.
    expect(isKey32(K1.slice(0, 42) + 'x')).toBe(false);
    expect(isKey32(K1)).toBe(true);
  });
});

describe('discovery keys', () => {
  const held: FindKeys = {
    'o1/L1': { gen: 3, key: K1, floor: 1, direct: true },
    'o1/L2': { gen: 2, key: K2, floor: 2, direct: false },
    'o2/L9': { gen: 1, key: K1, floor: 1, direct: true }
  };

  it('reads what was stored, leaving out what cannot be read', () => {
    expect(parseFindKeys(JSON.stringify(held))).toEqual(held);
    expect(parseFindKeys(JSON.stringify({ ...held, bad: held['o1/L1'], 'o3/x': { gen: 1, key: K1, floor: 2, direct: true }, 'o3/y': { gen: 1, key: 'k', floor: 1, direct: true } }))).toEqual(held);
    expect(parseFindKeys(null)).toEqual({});
    expect(parseFindKeys('not json')).toEqual({});
    expect(parseFindKeys('[1]')).toEqual({});
  });

  it('drops an organization no longer on, with no call', () => {
    expect(Object.keys(findKeysForOrgs(held, new Set(['o1'])))).toEqual(['o1/L1', 'o1/L2']);
  });

  it('after an answer: replaced as direct, named and unanswered gone, unnamed kept, no chain no key', () => {
    const next = findKeysAfterAnswer(held, ['o1/L1', 'o1/L2', 'o1/L3'], [
      { orgId: 'o1', languageId: 'L1', gen: 4, floor: 2, key: K2 },
      { orgId: 'o1', languageId: 'L3', gen: 1, floor: 1, key: K1 },
      { orgId: 'o4', languageId: 'L1', gen: 1, floor: 1, key: K1 }
    ], new Set(['o1', 'o2']));
    expect(next).toEqual({
      'o1/L1': { gen: 4, key: K2, floor: 2, direct: true },
      'o1/L3': { gen: 1, key: K1, floor: 1, direct: true },
      'o2/L9': held['o2/L9']
    });
    expect(findKeysAfterAnswer(held, [], [], new Set())).toEqual({});
  });

  it('after an answer whose chain for an organization could not be checked: that organization\'s keys stay as held, whatever it answered', () => {
    const next = findKeysAfterAnswer(held, ['o1/L1', 'o1/L2', 'o2/L9'], [
      { orgId: 'o1', languageId: 'L1', gen: 4, floor: 2, key: K2 },
      { orgId: 'o2', languageId: 'L9', gen: 9, floor: 2, key: K2 }
    ], new Set(['o1', 'o2']), new Set(['o2']));
    expect(next).toEqual({ 'o1/L1': { gen: 4, key: K2, floor: 2, direct: true }, 'o2/L9': held['o2/L9'] });
  });

  it('names held languages and the open organization\'s opened ones, of organizations on', () => {
    expect(languagesToName(held, 'o1', ['L5', 'L1', ''], new Set(['o1']))).toEqual(['o1/L1', 'o1/L2', 'o1/L5']);
    expect(languagesToName(held, 'o3', ['L5'], new Set(['o2']))).toEqual(['o2/L9']);
    expect(languagesToName({}, 'o1', Array.from({ length: 600 }, (_, i) => `L${i}`), new Set(['o1'])).length).toBe(MAX_LANGUAGES);
  });
});

describe('the certificate answer', () => {
  const ok = {
    chains: [{ orgId: 'o1', chain: [{ kind: 'worker@1' }] }],
    discoveryKeys: [{ orgId: 'o1', languageId: 'L1', gen: 2, floor: 1, key: K1 }],
    passes: [],
    revocations: [{ orgId: 'o1', text: '{}', kid: 'k1', sig: 's' }]
  };

  it('reads a revoked key, and an issued answer', () => {
    expect(certificateAnswerOf({ revoked: true })).toEqual({ revoked: true });
    expect(certificateAnswerOf(ok)).toEqual({ revoked: false, chains: ok.chains, discoveryKeys: ok.discoveryKeys, revocations: ok.revocations });
    expect(certificateAnswerOf({ chains: [], discoveryKeys: [], passes: [], revocations: [] })).toEqual({ revoked: false, chains: [], discoveryKeys: [], revocations: [] });
  });

  it('takes nothing from an answer the Worker would not send', () => {
    expect(certificateAnswerOf(null)).toBeNull();
    expect(certificateAnswerOf({ chains: [] })).toBeNull();
    expect(certificateAnswerOf({ ...ok, chains: [{ orgId: 'o1' }] })).toBeNull();
    expect(certificateAnswerOf({ ...ok, discoveryKeys: [{ ...ok.discoveryKeys[0], floor: 3 }] })).toBeNull();
    expect(certificateAnswerOf({ ...ok, discoveryKeys: [{ ...ok.discoveryKeys[0], key: 'short' }] })).toBeNull();
    expect(certificateAnswerOf({ ...ok, revocations: [{ orgId: 'o1', text: 1, kid: 'k1', sig: 's' }] })).toBeNull();
  });
});

describe('chains as stored', () => {
  it('reads organization to chain, and drops organizations no longer on', () => {
    const held = { o1: [{ kind: 'worker@1' }], o2: [] };
    expect(parseChains(JSON.stringify({ ...held, o3: 'x' }))).toEqual(held);
    expect(parseChains(undefined)).toEqual({});
    expect(parseChains('{')).toEqual({});
    expect(parseChains('[]')).toEqual({});
    expect(chainsForOrgs(held, new Set(['o2']))).toEqual({ o2: [] });
  });
});

describe('when to ask', () => {
  const NOW = 1_800_000_000_000;
  const base: AskFacts = {
    now: NOW, last: { at: NOW - 1000, memberships: { o1: 'm' } }, orgId: 'o1', membership: 'm', orgsOn: new Set(['o1']), chainOrgs: new Set(['o1']),
    revokedSeqs: {}, heldRevokedSeqs: {}, languageWithoutKey: false
  };

  it('asks nothing while no organization of theirs is on', () => {
    expect(askReason({ ...base, orgsOn: new Set(), last: null })).toBeNull();
  });

  it('asks the first time, then once a day, and a clock set back counts as a day gone', () => {
    expect(askReason(base)).toBeNull();
    expect(askReason({ ...base, last: null })).toBe('first');
    expect(askReason({ ...base, now: NOW - 1000 + ASK_EVERY_MS })).toBe('day');
    expect(askReason({ ...base, now: NOW - 2000 })).toBe('day');
  });

  it('asks on a membership change here, and not for an organization that is off', () => {
    expect(askReason({ ...base, membership: 'm2' })).toBe('membership');
    expect(askReason({ ...base, orgId: 'o9', membership: 'x' })).toBeNull();
  });

  it('asks when a newer revocation list waits for an organization on', () => {
    expect(askReason({ ...base, revokedSeqs: { o1: 2 }, heldRevokedSeqs: { o1: 1 } })).toBe('revoked');
    expect(askReason({ ...base, revokedSeqs: { o1: 2 }, heldRevokedSeqs: { o1: 2 } })).toBeNull();
    expect(askReason({ ...base, revokedSeqs: { o2: 5 } })).toBeNull();
  });

  it('asks when an organization on has no chain, or a language opens with no key', () => {
    expect(askReason({ ...base, orgsOn: new Set(['o1', 'o2']) })).toBe('noChain');
    expect(askReason({ ...base, languageWithoutKey: true })).toBe('language');
  });

  it('reads the record of the last answer, and nothing from a torn one', () => {
    expect(parseAskRecord(JSON.stringify({ at: 5, memberships: { o1: 'm', o2: 3 } }))).toEqual({ at: 5, memberships: { o1: 'm' } });
    expect(parseAskRecord(null)).toBeNull();
    expect(parseAskRecord('{')).toBeNull();
    expect(parseAskRecord(JSON.stringify({ at: '5', memberships: {} }))).toBeNull();
  });
});

describe('a membership as one string', () => {
  const at = (n: number) => `00170000000${String(n).padStart(4, '0')}:000000:dev`;
  const apply = (state: OrgState, n: number, type: string, payload: Record<string, unknown>) =>
    applyOrgEvent(state, { id: `e${n}`, type, orgId: 'o1', streamId: '_org', actorId: 'admin', deviceId: 'dev', hlc: at(n), payload } as never);

  it('changes with a role, its privileges or a removal, and is empty for someone not in', () => {
    let org = emptyOrgState();
    org = apply(org, 1, 'v1.RoleDefined', { roleId: 'tr', name: 'Translator', privileges: ['translate'] });
    org = apply(org, 2, 'v1.MemberAdded', { profileId: 'p1', roleId: 'tr', scope: { level: 'language', languageId: 'L1' } });
    const first = membershipMarkOf(org, 'p1');
    expect(first).toContain('tr');
    expect(membershipMarkOf(org, 'p2')).toBe('');
    expect(membershipMarkOf(null, 'p1')).toBe('');
    const widened = apply(org, 3, 'v1.RoleDefined', { roleId: 'tr', name: 'Translator', privileges: ['translate', 'review'] });
    expect(membershipMarkOf(widened, 'p1')).not.toBe(first);
    const removed = apply(widened, 4, 'v1.MemberRemoved', { profileId: 'p1', scope: { level: 'language', languageId: 'L1' } });
    expect(membershipMarkOf(removed, 'p1')).toBe('');
  });
});

describe('holding teammates\' recordings', () => {
  it('holds by default, not on a disguised phone, and a pressed choice stays', () => {
    expect(holdByDefault(false)).toBe(true);
    expect(holdByDefault(true)).toBe(false);
    expect(holdChoiceOf(null, false)).toEqual({ hold: true });
    expect(holdChoiceOf(undefined, true)).toEqual({ hold: false, reviewWindow: 5 });
    expect(holdChoiceOf('true', true)).toEqual({ hold: true });
    expect(holdChoiceOf('false', false, 3)).toEqual({ hold: false, reviewWindow: 3 });
  });
});
