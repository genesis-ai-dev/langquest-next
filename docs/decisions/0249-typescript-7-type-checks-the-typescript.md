# 249. TypeScript 7 type-checks; the TypeScript 6 API stays for the tools that need one

Date: 2026-11-12 · By: Carl Sauder · Status: accepted

Reason: TypeScript 7 (Go) checked all ten projects with no error on
2026-11-06, `apps/mobile` in 6.6 s instead of 38.5 s, but it ships no API
until 7.1, and typescript-eslint, eas-cli's Expo config and Expo's CLI
`require('typescript')`. Following Microsoft's side-by-side setup,
`@typescript/native` is TypeScript 7 and gives `tsc` (`npm run typecheck`,
the pre-push hook, `admin:deploy`, `email:typecheck`), and `typescript` is
`@typescript/typescript6`, which re-exports TypeScript 6 and gives `tsc6`
and the editors' `tsserver`; `apps/mobile` names the same. Both packages
install a `tsc`, and npm links the direct dependency's, so
`scripts/toolchain.test.ts` checks that `tsc` is 7 and `typescript` is 6.
The `overrides` entry still hands eas-cli that TypeScript 6. On Carl's
machine the ten projects took 55 s with TypeScript 6 and 11 s with 7.
Reverse if: TypeScript 7 reports an error that TypeScript 6 does not, or the
reverse, in code both should accept; or 7.1 ships an API that
typescript-eslint uses, when `typescript` becomes 7 alone.
