# 248. Dependabot opens upgrade pull requests weekly, three days after a release; majors and the Expo SDK move by hand

Date: 2026-11-12 · By: Carl Sauder · Status: accepted

Reason: the review of 2026-11-06 found no version updates configured, only
GitHub's security alerts (37 open), so every upgrade waited for someone to
look. `.github/dependabot.yml` now opens grouped pull requests every Monday
for npm (development tools and the app's libraries, minor and patch), the
GitHub Actions (by commit, with the release in a comment, as 247 asks) and
the job image's Node. Version updates wait three days after a release
(`cooldown`), the window in which a hijacked or broken release has usually
been pulled; security updates come at once. Carl's upgrades on 2026-11-11
kept the same rule by hand (`npm install --before`). Majors are ignored,
and so are the Expo SDK's packages, React and React Native, which move
together with `npx expo install --fix` on an SDK upgrade and need a store
build; `onnxruntime-web` moves with the speech model (135). A new Node image
fails `scripts/toolchain.test.ts` until `.node-version`, `eas.json` and the
EAS workflows name the same version, so that pull request is finished by
hand. Every pull request passes the guardrails like any other.
Reverse if: the pull requests go unmerged for weeks, which says the team
would rather upgrade in batches, or a release that broke the app reached a
pull request after three days.

Amended (2026-11-12, Carl Sauder): a tool that pins a dependency with a
known flaw has it lifted by `overrides` to a fixed release in the same
major, so `npm audit` shows nothing high or critical. eas-cli 27 pins
`node-forge` 1.4.0 (certificates it parses with our signing credentials),
`joi` 17.11.0, `tar` 7.5.19, `nanoid` 3.3.8 and `minimatch` 5.1.2; they are
1.4.3, 17.13.9, 7.5.22, 3.3.20 and 5.1.9, and keyed by major
(`minimatch@5`) where another copy of another major lives in the same
subtree. An override goes when the tool's own pin passes `npm audit`, and
none crosses a major: the remaining moderate findings (`minimatch` 9 and
10 under Expo's tooling) wait for their packages.
