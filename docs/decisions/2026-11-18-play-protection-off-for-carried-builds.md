# Play's automatic protection is off for the whole app, because a carried build must open when installed from a file

Date: 2026-11-18 · By: Carl Sauder · Status: accepted

Reason: Play's automatic protection was on for this app, so every APK Play
made from its bundles held an installer check, the carried build's
Play-signed universal APK included (decision 246). On 2026-11-17 an Android
16 phone installed carried build 56 (`r21-l1-p1-401de22e.apk`) from Files,
offline and again online. The install finished both times, and online
Android's developer verifier passed it. On opening, the app started
`com.pairip.licensecheck.LicenseActivity`, which opened the Play Store and
closed the app. A newcomer with no Play Store, or with no internet, could
never get past it, and the carried build exists for those phones (plan 14.4).

Play has no switch for carried builds alone:

- **By hand, per release.** Play Console can turn protection off for one
  release, by hand while preparing it, before its bundle is uploaded. EAS's
  upload creates the carried release on the alpha track by itself, and
  neither EAS nor the Android Publisher API has a setting for it.
- **The API's unprotected APKs.** `generatedApks` gives only split and
  standalone APKs. Files cannot install a set of splits. Joining them into
  one APK would mean signing it again, which breaks Play's updates.
- **A carrier app installing splits.** That needs `REQUEST_INSTALL_PACKAGES`,
  which 246 keeps out.

What protection gave this app was the installer check alone, since
anti-tamper and the device check are for partners Play selects. The app is
free and its code is public. Carl chose to turn protection off for the whole
app (2026-11-18).

How it is held:

- **In Play Console.** Protection is off there, with no API.
  `docs/environments.md` ("The carried build") records the setting.
- **In the publish step.** `scripts/carried-build.mjs` refuses an APK whose
  manifest, code (`classes*.dex`) or file names hold `com.pairip` (PairIP,
  Play's protection), and an APK it cannot read. It refuses before writing,
  so a protected file never reaches the bucket again.
- **The two files made before.** The files made while protection was on
  (version codes 54 and 56) are deleted from the bucket by a person. The
  next merge then makes the current one again.

Turning protection off changes no Play Console declaration
(`docs/play-store-declarations.md`).

Reverse if: Play or EAS gives a way to leave one upload or one track
unprotected, or Play gives an unprotected universal APK; a newcomer's phone
stops installing the carried build from a file; or Play requires
protection.
