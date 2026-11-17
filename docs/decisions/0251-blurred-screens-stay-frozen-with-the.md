# 251. Blurred screens stay frozen, with the app's own `Freeze` in place of react-freeze's until react-freeze fixes its loop on React 19.1 and later

Date: 2026-11-12 · By: Carl Sauder · Status: accepted

Reason: with Expo SDK 58 (250) the nightly phone tests failed JRN-006 and
MAP-031 on Android in two runs out of two, and passed them on nearby sync
alone (React 19.2.3): a passage opened from a book's list stayed a blank
page. On an emulator the JavaScript thread ran at 98% with the page idle,
re-committing screens nobody could see, until timers and the new screen
starved. It is software-mansion/react-freeze#44: react-native-screens
freezes the screens under the top one (`freezeOnBlur`, 119) with
react-freeze 1.0.4, which throws a thenable that never settles, and on
React 19.1 and later two frozen boundaries hand React's retries to each other
without end. A passage opened from a book has three frozen screens under
it (home, map, book). With `freezeOnBlur` off the page opened and the
thread went quiet, but 119's reason stands: frozen screens skip the renders
that downloads cause. So the stack keeps freezing, and Metro gives
react-native-screens the app's `Freeze` when it asks for `react-freeze`
(`apps/mobile/metro.config.js`, `src/shell/freeze.tsx`). That `Freeze`
suspends through `use()` on a promise of its own, resolved on thaw, as the
fix proposed in that issue does, and schedules no retry while frozen.
Turned down: patching the package on install (a new tool for one file),
and `<Activity mode="hidden">` (it unmounts the frozen screens' effects,
which the screens' audio and subscriptions are not written for).
`apps/mobile/test/freezeShim.test.ts` holds the redirect and fails once
react-freeze moves past 1.0.4.
Reverse if: react-freeze or react-native-screens publishes the fix (remove
the file and the redirect); or a frozen screen comes back without its
content, or late, which says the mended thaw is wrong.
