# Agent skills

Which skills this repo gives coding agents, where they come from, and what was
considered and left out. The index agents read is in `AGENTS.md`; this file is
the record behind it. Reviewed 2026-09-28.

## Layout

- `.agents/skills/<name>/SKILL.md` is the canonical copy. Cursor, Codex and
  other tools read it directly.
- `.claude/skills/<name>` and `.hermes/skills/<name>` are symlinks to it.
- `CLAUDE.md` imports `AGENTS.md`, so Claude Code and Cursor read the same rules.
- Third-party skills are installed with the `skills` CLI and pinned by hash in
  `skills-lock.json`. Do not edit them; put overrides in `AGENTS.md`.

Add or update a third-party skill:

```sh
npx skills add <owner/repo> --skill <name> -a cursor -a claude-code -y
ln -s ../../.agents/skills/<name> .hermes/skills/<name>   # new skills only
npx skills update -p                                       # update all project skills
```

Read the diff before committing an update: skills run with the agent's full
permissions.

## Project skills

Written for this app because no reputable general skill covered the ground
without contradicting PLAN.md.

| Skill | Why |
| --- | --- |
| `event-sourced-sync` | Published event-sourcing skills prescribe expected-version checks and ordered projections, which break commutative offline events. This one encodes PLAN.md and lists the advice to reject. |
| `architecture-tradeoffs` | Mark Richards and Neal Ford have published no skill, and community versions reproduce their book's rating tables without the right to. Written from their public material, applied to this app's quanta and fitness functions. |
| `error-tracking` | Vendor skills are setup wizards that default to sending PII. This one is vendor-neutral: classification, boundaries, scrubbing, weeks-long offline delivery, EAS Update source maps. |
| `field-diagnosis` | Written for this app's own diagnostics (decisions.md 39): the steps from "a translator in this language is slow" to a cause, reading only the content-free `diag` records. No published skill knows this data. |
| `run-app` | Worked out by running report and block on both simulators against production (2026-09-30). Every step in it failed first: shared Metro and simulators, password AutoFill, the Play Store emulator image, emulator DNS, Maestro selectors. Expo's own run docs assume one developer and one device. |
| `infrastructure-as-code` | Published IaC and GitOps skills target Terraform and Kubernetes. This one covers the tools used here: Supabase CLI (`config.toml`, migrations, secrets), Wrangler, EAS, and dotenvx for encrypted env files. |
| `laws-of-ux` | No reputable Laws of UX skill exists; the ones found are web and Tailwind oriented. Written for field use and deferring to the partner demo. |

## Third-party skills

| Skill | Source | Licence | Why |
| --- | --- | --- | --- |
| `react-native-best-practices` | callstackincubator/agent-skills | MIT | Callstack's measure-first performance guide; covers low-end Android, lists, memory, TTI. |
| `react-navigation` | callstackincubator/agent-skills | MIT | The only skill for React Navigation 7 without Expo Router. |
| `expo-design-system` | expo/skills | MIT | Official Expo. "Extend the existing theme" fits `theme.ts` and `kit.tsx`. |
| `expo-module` | expo/skills | MIT | Official Expo Modules API guide; applies to `modules/microphone-energy`. |
| `expo-upgrade` | expo/skills | MIT | Official SDK upgrade guide. |
| `ux-heuristics` | wondelai/skills | MIT | Nielsen's heuristics, Krug, WCAG checklist, cultural UX (RTL, localization). |
| `react-native-accessibility` | rushatgabhane/react-native-accessibility-skill | MIT | The only React Native-specific accessibility skill found (labels, roles, TalkBack, font scaling). Small author, content checked line by line. Its 44pt target is overridden to 48pt in `AGENTS.md`. |
| `codebase-design` | mattpocock/skills | MIT | Deep modules and seams; matches the `EventStore` / `Transport` ports. |
| `domain-modeling` | mattpocock/skills | MIT | Ubiquitous language and sparing decision records. ADRs go in `docs/decisions.md` here. |
| `clean-code`, `clean-architecture`, `refactoring`, `domain-driven-design-distilled`, `designing-data-intensive-applications` | ciembor/agent-rules-books | MIT | Concise rule sets drawn from Martin, Fowler, Vernon and Kleppmann. The Kleppmann set requires duplicate, replay and reorder safety, which this app depends on. |
| `test-driven-development`, `systematic-debugging`, `verification-before-completion` | obra/superpowers | MIT | Widely used process skills; verification enforces "run `npm test` and `npm run typecheck`". Cross-references to other superpowers skills that are not installed can be ignored. |
| `property-based-testing` | trailofbits/skills | CC BY-SA 4.0 | Property catalogue (idempotence, commutativity, invariants) matching the reducer tests. |
| `security-review` | getsentry/skills | CC BY-SA 4.0 (folder LICENSE) | High-confidence security review derived from the OWASP Cheat Sheet Series. |
| `supabase`, `supabase-postgres-best-practices` | supabase/agent-skills | MIT | Installed before this review; official. |

### Attribution

- `property-based-testing`: © Trail of Bits, licensed CC BY-SA 4.0
  (https://github.com/trailofbits/skills). Unmodified.
- `security-review`: © Sentry, licensed CC BY-SA 4.0, derived from the OWASP
  Cheat Sheet Series (https://github.com/getsentry/skills). Unmodified; the
  licence is in the skill folder.

## Considered and left out

| Candidate | Reason |
| --- | --- |
| getsentry/agent-plugin (`sentry-instrument`, `sentry-setup-releases`) | Setup wizards that assume Sentry is chosen and default `sendDefaultPii: true`. Revisit once a tracker is chosen; `error-tracking` lists what to correct. |
| wshobson/agents (`event-store-design`, `projection-patterns`, `cqrs-implementation`, `architecture-patterns`, `saga-orchestration`, `error-handling-patterns`) | Prescribe optimistic concurrency and in-order projection, which contradict order-independent events; mostly Python templates. |
| expo/skills `expo-native-ui`, `expo-router`, `expo-ui`, `expo-overview`, `eas-observe` | Assume Expo Router and `@expo/ui`; EAS Observe has no crash reporting. |
| vercel-labs/agent-skills `react-native-skills`, `react-best-practices`, `web-design-guidelines` | Overlaps with Callstack, recommends NativeWind; the others are web-only. |
| software-mansion-labs `react-native-best-practices` | Targets Reanimated and react-native-audio-api rather than expo-audio; same name as Callstack's skill. |
| anthropics/skills `frontend-design`, ibelick/ui-skills, ui-ux-pro-max | Web visual design and Tailwind. |
| Laws of UX community skills | Very small authors, web-only code patterns. |
| bookforge-ai Richards and Ford skills | Draft status; reproduces the book's rating tables. |
| NeoLabHQ context-engineering-kit DDD rules | GPL-3.0; duplicates the ciembor rules. |
| fast-check `javascript-testing-expert` | Good, but overlaps `property-based-testing` and imposes a file layout. |
| mattpocock `tdd`, `diagnosing-bugs` | Overlap with the superpowers skills; `tdd` needs the user present to agree seams. |
