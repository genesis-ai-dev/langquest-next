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
const componentScreen = new Map([...app.matchAll(/(\w+): (?:Entry|Org|Config|Account|Work|Review|Translate|Status|PassageSlides|Recordings|Obt|ObtCapture|ObtManage|DynamicBible|Record|Study)\.(\w+)/g)]
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

  it('permits picking up your own work without permitting assignment to others', () => {
    const session = deriveSession('t1',null,fold(buildFixture()),true);
    const event = { type:'v1.AssignmentMade',payload:{ unitId:'u',laneId:'L1',profileId:'t1',role:'translator' } } as AnyEvent;
    expect(screenMayEmit('pickup_home',session,event)).toBe(true);
    expect(screenMayEmit('pickup_home',session,{ ...event,payload:{ ...event.payload,profileId:'someone-else' } } as AnyEvent)).toBe(false);
    expect(screenMayEmit('review_passage',session,event)).toBe(false);
  });
});
