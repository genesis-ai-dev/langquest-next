import { describe, expect, it } from 'vitest';
import type { FlowDoc, LibraryItemView } from '@langquest-next/core';
import { choiceOrigin, collapseFlowSets, flowLanguage, offeredFlows } from '../src/admin/flowSetsModel';
import type { LibraryChoice } from '../src/templates/contentTemplates';
import type { SharedItem } from '../src/library/model';

/**
 * Ready-made flows published once per language (src/admin/flowSetsModel.ts):
 * one organization's flows of one pattern are one choice, in the team's
 * language first, switched to another as a guide set is.
 */

const flow = (language?: string, pattern?: string): FlowDoc =>
  ({ format: 'flow@1', name: 'f', description: '', kinds: [], steps: [], deps: [], ...(pattern ? { pattern } : {}), ...(language ? { language } : {}) }) as FlowDoc;
const shared = (key: string, org = 'langquest'): LibraryChoice =>
  ({ key, source: 'shared', name: key, hash: key, shared: { org_id: org, item_id: key } as SharedItem });
const ours = (key: string, from?: string): LibraryChoice =>
  ({ key, source: 'ours', name: key, hash: key, item: { subscription: from ? { sourceOrgId: from } : null, copiedFrom: null } as unknown as LibraryItemView });

describe('flows in several languages', () => {
  it('reads a flow\'s language and where a choice comes from', () => {
    expect(flowLanguage(flow('hin'))).toBe('hin');
    expect(flowLanguage(flow())).toBeUndefined();
    expect(choiceOrigin(shared('a', 'org9'))).toBe('org9');
    expect(choiceOrigin(ours('b', 'langquest'))).toBe('langquest');
    expect(choiceOrigin(ours('c'))).toBe('');
  });

  it('makes a set one choice, in the team\'s language, then English, and keeps the rest as they are', () => {
    const entries = [
      { c: shared('standard'), doc: flow() },
      { c: shared('cm.fra'), doc: flow('fra', 'door43-checking') },
      { c: shared('cm.eng'), doc: flow('eng', 'door43-checking') },
      { c: shared('cm.hin'), doc: flow('hin', 'door43-checking') },
      { c: shared('obs.eng'), doc: flow('eng', 'door43-checking-obs') },
      { c: shared('other.eng', 'org2'), doc: flow('eng', 'door43-checking') }
    ];
    const hin = collapseFlowSets(entries, ['hin']);
    expect(hin.map((e) => e.c.key)).toEqual(['standard', 'cm.hin', 'obs.eng', 'other.eng']);
    expect(hin[1]!.set!.members.map((m) => m.language)).toEqual(['hin', 'eng', 'fra']);
    expect(hin[2]!.set).toBeUndefined();
    expect(collapseFlowSets(entries, ['swa']).map((e) => e.c.key)).toEqual(['standard', 'cm.eng', 'obs.eng', 'other.eng']);
    // Switched to another of its languages.
    const key = hin[1]!.set!.key;
    expect(collapseFlowSets(entries, ['hin'], { [key]: 'cm.fra' })[1]!.c.key).toBe('cm.fra');
  });

  it('offers a team the flows in its languages, a set while any of its languages is one, so it can still be switched', () => {
    const entries = [
      { c: shared('standard'), doc: flow() },
      { c: shared('cm.fra'), doc: flow('fra', 'door43-checking') },
      { c: shared('cm.eng'), doc: flow('eng', 'door43-checking') },
      { c: shared('solo.fra'), doc: flow('fra') },
      { c: shared('obs.hin'), doc: flow('hin', 'door43-checking-obs') },
      { c: shared('obs.ory'), doc: flow('ory', 'door43-checking-obs') }
    ];
    const none = () => false;
    const eng = offeredFlows(entries, ['eng'], {}, ['eng'], none);
    expect(eng.map((e) => e.c.key)).toEqual(['standard', 'cm.eng']);
    expect(eng[1]!.set!.members.map((m) => m.language)).toEqual(['eng', 'fra']);
    // Switched to French, the set is still offered; a lone French flow, or a set in neither language, is not.
    const key = eng[1]!.set!.key;
    expect(offeredFlows(entries, ['eng'], { [key]: 'cm.fra' }, ['eng'], none).map((e) => e.c.key)).toEqual(['standard', 'cm.fra']);
    // The one in use is always offered; with no languages given, everything is.
    expect(offeredFlows(entries, ['eng'], {}, ['eng'], (e) => e.c.key === 'solo.fra').map((e) => e.c.key)).toEqual(['standard', 'cm.eng', 'solo.fra']);
    expect(offeredFlows(entries, ['eng'], {}, undefined, none)).toHaveLength(4);
  });
});
