import { encodeHlc, foldOrg, type AnyEvent } from '@langquest-next/core';
import { clusterEvents, clusterNamed, filterByCluster, inCluster, languagesOutsideClusters, newClusterId, ungroupEvents } from '../src/clusters/model';

// Clusters (decision 108, demo ADR-045): a name on some of an organization's
// languages. The screens append what these return; nothing else changes.

let seq = 0;
const ev = (type: string, payload: unknown): AnyEvent => {
  seq += 1;
  return { id: `e${seq}`, type, orgId: 'org1', streamId: '_org', actorId: 'lead', deviceId: 'dA', hlc: encodeHlc(1_700_000_000_000 + seq, 0, 'dA'), payload } as AnyEvent;
};
const base = [
  ev('v1.LanguageAdded', { languageId: 'dip', name: 'Northeastern Dinka', code: 'dip', sourceCode: 'eng' }),
  ev('v1.LanguageAdded', { languageId: 'diw', name: 'Northwestern Dinka', code: 'diw', sourceCode: 'eng' }),
  ev('v1.LanguageAdded', { languageId: 'nus', name: 'Nuer', code: 'nus', sourceCode: 'eng' }),
  ev('v1.ClusterNamed', { clusterId: 'dinka', name: 'Dinka cluster' }),
  ev('v1.LanguageClusterSet', { languageId: 'dip', clusterId: 'dinka', inCluster: true })
];
const org = foldOrg(base);

describe('clusters', () => {
  it('names a new cluster once and tags only what changes', () => {
    // Why: every tap appends events everyone pulls; re-saving the same choice must add nothing.
    expect(clusterEvents(org, { clusterId: 'dinka', name: 'Dinka cluster', add: ['dip'] })).toEqual([]);
    expect(clusterEvents(org, { clusterId: 'dinka', add: ['dip', 'diw', 'diw'], remove: ['nus'] })).toEqual([
      { type: 'v1.LanguageClusterSet', payload: { languageId: 'diw', clusterId: 'dinka', inCluster: true } }
    ]);
    expect(clusterEvents(org, { clusterId: 'dinka', name: ' Jieng ', remove: ['dip'] })).toEqual([
      { type: 'v1.ClusterNamed', payload: { clusterId: 'dinka', name: 'Jieng' } },
      { type: 'v1.LanguageClusterSet', payload: { languageId: 'dip', clusterId: 'dinka', inCluster: false } }
    ]);
  });

  it('ungrouping takes every language out, and the languages stay', () => {
    const after = foldOrg([...base, ...ungroupEvents(org, 'dinka').map((e) => ev(e.type, e.payload))]);
    expect(inCluster(after, 'dinka', 'dip')).toBe(false);
    expect(languagesOutsideClusters(after, ['dip', 'diw', 'nus'])).toEqual(['dip', 'diw', 'nus']);
    expect(Object.keys(after.languages).sort()).toEqual(['dip', 'diw', 'nus']);
  });

  it('lists the languages in no cluster, and filters progress by cluster', () => {
    const ids = ['dip', 'diw', 'nus'];
    expect(languagesOutsideClusters(org, ids)).toEqual(['diw', 'nus']);
    expect(filterByCluster(org, ids, { kind: 'all' })).toEqual(ids);
    expect(filterByCluster(org, ids, { kind: 'cluster', clusterId: 'dinka' })).toEqual(['dip']);
    expect(filterByCluster(org, ids, { kind: 'none' })).toEqual(['diw', 'nus']);
  });

  it('a name already used joins that cluster, and new ids are valid and distinct', () => {
    // Why: two admins typing the same cluster name should not make two clusters of it.
    expect(clusterNamed(org, '  dinka CLUSTER ')?.clusterId).toBe('dinka');
    expect(clusterNamed(org, 'Nilotic')).toBeNull();
    expect(clusterNamed(org, ' ')).toBeNull();
    const a = newClusterId('Dar Khamsa (Ḥ)', '0f8e3c2a-1111-4000-8000-000000000001');
    expect(a).toBe('cl-dar-khamsa-h-0f8e3c2a');
    expect(a).toMatch(/^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$/);
    expect(newClusterId('ⵜⴰⵎⴰⵣⵉⵖⵜ', 'abcdef12-0000')).toBe('cl-cluster-abcdef12');
    expect(newClusterId('x'.repeat(200), 'abcdef12-0000').length).toBeLessThanOrEqual(81);
  });
});
