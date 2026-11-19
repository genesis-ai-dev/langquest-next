# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v58.0.0/ before writing any code.

# Screens follow the UX demo

Screens port the partner demo in `ng-langquest-ux` (flow, look,
capabilities). Every screen file names the demo screens and requirement IDs
it ports in a top comment. Before building or changing a screen read
`docs/ux/principles.md` and `docs/ux/demo-parity.md` (conventions: `kit.tsx`
primitives, core commands through `ctx.act`, navigation only along `flow.ts`
edges). `src/shell/flow.ts` is generated from the demo's flow
(`test/spec-flow.json`); the parity test holds it edge by edge.

# What goes where in this app

The app decides what to do, what to write and what to show; what the data
means is `packages/core`, and keeping it and moving it is `packages/sync`
(decisions.md 104), which the app never reimplements.

- Every Supabase call lives in `src/server/` (decisions.md 105, its README,
  `test/serverBoundary.test.ts`); screens and hooks call its functions.
- A file's name says its role: components in `.tsx`, hooks in
  `use<Thing>.ts`, pure logic in `model.ts` or `<thing>Model.ts`, everything
  else a module in `.ts`. Lint holds what may import what, and a rule's
  message says where the code belongs.
- The web app is this app's web export (decisions.md 58), served with the
  reports API by the Worker in `apps/web` (decision 44). Report screens are
  the Reports section (`src/screens/reports.tsx`, parts in `src/reports/`);
  report logic is `packages/core/src/portfolio.ts`. Web-only code goes behind
  `Platform.OS === 'web'` or in a `.web.tsx` file, and
  `npm run test:web-smoke` (e2e/web-smoke) must pass.
