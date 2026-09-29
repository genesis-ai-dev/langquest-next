import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { fold, privilegesOfFixedRole, type AnyEvent, type Privilege, type Role } from '@langquest-next/core';
import { SCREEN_IDS, EDGES, TAB_SCREENS, type ScreenId, type NodeId } from '../src/flow';
import { SCREEN_CONTRACTS, screenMayEmit } from '../src/screenContracts';
import { deriveSession, edgeAllowed } from '../src/session';
import { buildFixture } from '../../../packages/core/test/fixtures';

const root = path.resolve('apps/mobile');
const app = fs.readFileSync(path.join(root,'App.tsx'),'utf8');
const componentScreen = new Map([...app.matchAll(/(\w+): (?:Entry|Onboarding|Org|Config|Content|Account|Work|MapScreens|Passage|Review|Translate|Study)\.(\w+)/g)]
  .map((m) => [m[2]!,m[1]! as ScreenId]));

describe('screen action contracts', () => {
  it('every rendered screen declares the events in its implementation', () => {
    const seen = new Set<string>();
    for (const filename of fs.readdirSync(path.join(root,'src/screens'))) {
      if (!filename.endsWith('.tsx')) continue;
      const source = fs.readFileSync(path.join(root,'src/screens',filename),'utf8');
      expect(source).toContain('export const contracts = contractsFor(');
      const file = ts.createSourceFile(filename,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
      for (const stmt of file.statements) {
        if (!ts.isFunctionDeclaration(stmt) || !stmt.name) continue;
        const screen = componentScreen.get(stmt.name.text);
        if (!screen) continue;
        seen.add(screen);
        const visit = (node: ts.Node) => {
          if (ts.isStringLiteral(node) && /^v\d\./.test(node.text)) {
            expect(SCREEN_CONTRACTS[screen].emits, `${filename}:${screen}:${node.text}`).toContain(node.text);
          }
          ts.forEachChild(node,visit);
        };
        visit(stmt);
      }
    }
    expect([...seen].sort()).toEqual([...SCREEN_IDS].sort());
  });

  it('walks every persona through allowed edges and checks emitted fixture actions', () => {
    const fixture = buildFixture();
    const project = fold(fixture);
    const roles: Role[] = ['owner','coordinator','translator','reviewer','viewer'];
    let checked = 0;
    for (const role of roles) {
      const session = deriveSession('persona',null,{ ...project, members:{
        ...project.members,persona:{ role:{value:role,hlc:'',eventId:''},removed:{value:false,hlc:'',eventId:''} }
      } },true);
      const seen = new Set<NodeId>(['sign_in']);
      const queue: NodeId[] = ['sign_in'];
      while (queue.length) {
        const from = queue.shift()!;
        for (const edge of EDGES.filter((e) => e.from === from && edgeAllowed(e,session))) {
          if (!seen.has(edge.to)) { seen.add(edge.to); queue.push(edge.to); }
        }
        for (const tab of TAB_SCREENS) if (!seen.has(tab)) { seen.add(tab); queue.push(tab); }
      }
      for (const screen of SCREEN_IDS.filter((s) => seen.has(s))) {
        for (const event of fixture.filter((e) => SCREEN_CONTRACTS[screen].emits.includes(e.type))) {
          const allowed = screenMayEmit(screen,session,event);
          if (role === 'viewer' && screen !== 'create_org') expect(allowed).toBe(false);
          if (allowed) checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(40);
  });

  it('asking, reviewing and logging follow permissions, never the method', () => {
    const state = fold(buildFixture());
    const as = (role: Role) => deriveSession('persona', null, { ...state, members: {
      ...state.members, persona: { role: { value: role, hlc: '', eventId: '' }, removed: { value: false, hlc: '', eventId: '' } }
    } }, true);
    const ask = { type: 'v1.RequestMade', payload: { requestId: 'q', unitId: 'luke1', laneId: 'L1', what: 'review', kindId: 'peer', profileId: 'r1' } } as AnyEvent;
    expect(screenMayEmit('ask_someone', as('translator'), ask)).toBe(true);
    expect(screenMayEmit('ask_someone', as('viewer'), ask)).toBe(false);
    const review = { type: 'v1.ReviewRecorded', payload: { reviewId: 'r', takeId: 'take2', kindId: 'peer', outcome: 'looks_good', via: 'app' } } as AnyEvent;
    expect(screenMayEmit('review_capture', as('reviewer'), review)).toBe(true);
    // A translator may log a check they ran themselves (design principles 5), not review in the app.
    expect(screenMayEmit('review_capture', as('translator'), review)).toBe(false);
    const logged = { ...review, payload: { ...review.payload, via: 'logged' } } as AnyEvent;
    expect(screenMayEmit('add_record', as('translator'), logged)).toBe(true);
    // A back translator records source-language cards with only Review.
    const card = { type: 'v1.RecordingAdded', payload: { recordingId: 'c', unitId: 'luke1', laneId: 'L1', kind: 'source', cards: [{ hash: 'h', durationMs: 1 }] } } as AnyEvent;
    expect(screenMayEmit('back_translation', as('reviewer'), card)).toBe(true);
    expect(screenMayEmit('workspace', as('reviewer'), { ...card, payload: { ...card.payload, kind: 'target' } } as AnyEvent)).toBe(false);
  });
});
