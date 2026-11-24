# 232. Share nearby is a screen of its own, labelled experimental, opened from Sync on an Android phone whose organization has it on

Date: 2026-11-12 · By: Carl Sauder · Status: partly superseded by 2026-11-23-share-while-langquest-is-open

Reason: both people opt in by opening the screen, and the radios run only
while it is open, so no personal switch for the radios is needed (Carl's
choices of 2026-11-06, plan 2, 5.8 and 5.10). It is `share_nearby`
(`apps/mobile/src/screens/nearby.tsx`), loaded when first opened, from a row
under Sync that shows only with a certificate for the organization and a
discovery key for the language (220), with an `APP_ONLY` edge since the
partner demo has no such flow, and an amber experimental badge until the
experiment ends, which is Carl's call later. Below Android 10, or without
Bluetooth LE or Wi-Fi Direct, the row is disabled with a line saying why
(Carl's answer 7) and keeps its `onPress` for help mode; Bluetooth, Wi-Fi or
Location off each have a state, because an app generally cannot turn them
on. Progress lives in the hook's state, read by this screen alone, because
anything ticking in `ctx` would redraw every mounted screen. The screen
stays awake from Find on, the upload bar is hidden on it, and the room stops
by itself after an idle limit (five minutes as a starting guess) that only a
verified session's work restarts, so a stranger cannot hold the radios on.
On the web and on iPhones it is absent through plain stubs beside `.android`
files, so those builds carry none of it. Sync gains "Holding N for
teammates", and a record's History one line for a row still nearby.
Reverse if: the experiment ends (then the badge goes, and admins may get the
toggle), or people miss teammates because the screen stopped (then the idle
limit moves).

Amended (2026-11-16, Carl Sauder): it shows on iPhones too (256); only the
web is without it. On an iPhone it is disabled only without the module or
Bluetooth LE: no Android version is compared with an iPhone's iOS version,
and an iPhone has no Wi-Fi Direct and needs none. Bluetooth is the one
prompt an iPhone can ask ahead, after the screen's line saying why, which
also names the Local Network prompt and the Wi-Fi join that come when the
phones connect; a refusal sends the person to the app's settings, since iOS
asks once. Bluetooth off counts only once Bluetooth is allowed, and
Location never does. A system prompt leaves an iPhone app `inactive`, which
is not leaving the screen, so the radios stop only in the background. The
screen's words name neither Android nor the install file on an iPhone, and A
new person never shows there.
