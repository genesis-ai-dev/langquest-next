# Common rules for every screen port

You are porting one domain of the partner UX demo (`/Users/caleb/dev/ng-langquest-ux`, React web + Tailwind) into the real React Native (Expo 57) app at `/Users/caleb/dev/langquest-next/apps/mobile`. Git branch `demo-parity`. Do NOT commit, switch branches, stash, or push.

Other agents edit other screen files in this same working tree at the same time. ONLY edit the files your brief says you own. If you need a change in a shared file (apps/mobile/src/kit.tsx, passageView.ts, ctx.ts, voiceNote.tsx, App.tsx, flow.ts, session.ts, screenContracts.ts, study/*, scripture.ts, useRecorder.ts, audioClip.tsx, DevMenu.tsx, anything under packages/), do NOT edit it: work around it in your own files and put the exact change you need in your final report.

## Read first
1. `docs/ux/demo-parity.md` (mapping and conventions; mandatory).
2. `apps/mobile/src/kit.tsx`, `passageView.ts`, `ctx.ts`, `voiceNote.tsx`, `flow.ts` (edges from your screens and their gates), `session.ts`, `theme.ts`.
3. The core API your screens need (`packages/core/src/passage.ts`, `record.ts`, `commands.ts` — record commands are at the bottom — `materials.ts`, `org.ts`).
4. The demo files, requirement sections and ADRs your brief lists (`/Users/caleb/dev/ng-langquest-ux/docs/requirements.md`, `docs/decisions.md`, `docs/design-principles.md`). Port behaviour, wording and look, not code verbatim.

## Rules
- Only kit.tsx primitives and `C`/`TINT` tokens. 48pt minimum targets, 56pt primary actions, 13pt minimum text, no rows of tiny pills. The demo's wording.
- Everything is derived from the event log via core (`ctx.project.state` + `indexesFor(state)`); writes go through core `commands(state, indexesFor(state))` and `ctx.act(specs, 'What changed.', undo?)`, with Undo where the demo offers it. No mock data in screens; when real data does not exist yet, show the demo's empty state honestly.
- Navigate only via `ctx.go(screen, params)` along edges declared in `flow.ts` FROM YOUR SCREEN (check from/to exist and the gate), `ctx.back()`, `ctx.openPassage(unitId, laneId)`. Params are strings (see demo-parity.md).
- Each screen file ends with `export const contracts = contractsFor(...)` (import `{ contractsFor }` from '../screenContracts') naming its screens. Avoid event-type string literals ('v1.X') in screen code; use commands. If one is unavoidable it must already be in that screen's contract in `src/screenContracts.ts` (report it if missing).
- A comment at the top of each file naming the demo screens it ports and the requirement IDs.
- Whole-Bible scale (~1,200 passages per language): memoize derivations on `ctx.project.state`; cap long lists with `ShowMore`.
- Do not add npm dependencies.

## Verify before finishing
- `cd /Users/caleb/dev/langquest-next/apps/mobile && npx tsc --noEmit 2>&1 | grep -E "<your files>"` shows nothing (ignore other agents' files; they are mid-edit).
- `cd /Users/caleb/dev/langquest-next && npx vitest run apps/mobile/test/screenContracts.test.ts` has no failure naming your files.
- Pure helpers you write get a vitest under `apps/mobile/test/` in a file you own.

## Final report
What each screen does; any demo capability not ported and why; any shared-file change you need (exact diff).
