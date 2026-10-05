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
const componentScreen = new Map([...app.matchAll(/(\w+): (?:Entry|Onboarding|Org|Config|Content|Account|Work|MapScreens|Passage|Review|Translate|Study|Reports|Reference)\.(\w+)/g)]
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

  it('every declared event is one its screen can emit', () => {
    // The reverse of the test above, for what can be checked from source: an
    // event no core command builds must be named by the screen's code (its
    // own function, the file's helpers, or an app module the file imports)
    // or come from a ctx method known to append it. Events a core command
    // builds are left out: which command a screen calls is not a literal.
    const core = path.resolve('packages/core/src');
    const commandEvents = new Set(['commands.ts', 'materials.ts', 'libraryApply.ts'].flatMap((f) =>
      [...fs.readFileSync(path.join(core, f), 'utf8').matchAll(/'(v\d\.\w+)'/g)].map((m) => m[1]!)));
    const viaCtx: Record<string, string> = { 'v1.VisionSeen': '.markWelcomed(', 'v1.TermsAccepted': '.acceptTerms(' };
    const src = path.join(root, 'src');
    const skip = new Set(['screenContracts.ts', 'flow.ts']);
    const imported = (file: ts.SourceFile, dir: string) => file.statements.flatMap((stmt) => {
      if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) return [];
      const spec = stmt.moduleSpecifier.text;
      if (!spec.startsWith('.')) return [];
      const base = path.resolve(dir, spec);
      const hit = ['.ts', '.tsx'].map((ext) => base + ext).find((f) => fs.existsSync(f));
      return hit && hit.startsWith(src) && !skip.has(path.basename(hit)) ? [fs.readFileSync(hit, 'utf8')] : [];
    });
    let checked = 0;
    for (const filename of fs.readdirSync(path.join(root, 'src/screens'))) {
      if (!filename.endsWith('.tsx')) continue;
      const source = fs.readFileSync(path.join(root, 'src/screens', filename), 'utf8');
      const file = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const screens = file.statements.filter((s): s is ts.FunctionDeclaration =>
        ts.isFunctionDeclaration(s) && !!s.name && componentScreen.has(s.name.text));
      const shared = file.statements.filter((s) => !screens.includes(s as ts.FunctionDeclaration) && !ts.isImportDeclaration(s))
        .map((s) => s.getText(file)).join('\n') + imported(file, path.join(root, 'src/screens')).join('\n');
      for (const fn of screens) {
        const screen = componentScreen.get(fn.name!.text)!;
        const scope = `${fn.getText(file)}\n${shared}`;
        for (const event of SCREEN_CONTRACTS[screen].emits) {
          if (commandEvents.has(event)) continue;
          const named = scope.includes(`'${event}'`) || (viaCtx[event] !== undefined && fn.getText(file).includes(viaCtx[event]!));
          expect(named, `${filename}:${screen} declares ${event} but never emits it`).toBe(true);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(10);
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
    // Contracts name only what screens emit, so this counts real pairs, not padding.
    expect(checked).toBeGreaterThan(30);
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
  });
});
