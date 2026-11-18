# A carrier's phone gives the app to a new phone over its own Wi-Fi: two QR codes and a download page, from a checked copy of the install file

Date: 2026-11-18 · By: Carl Sauder · Status: accepted

Reason: Carl's own offline install test of the carried build worked, but it
took too many steps for people who are not technical:

- the browser's warning on an app file;
- finding the file in Downloads;
- sending it by Quick Share from a files app, which needs Google Play
  services on both phones, which phones in China do not have.

Carl chose the third of three ways (docs/nearby-sync-plan.md 14.5, answers
29 to 31).

**How it works.** Give the app, a screen of its own from Share nearby's A new
person and Let someone in:

- **The carrier's phone** forms a Wi-Fi Direct group, with a name and a short
  passphrase native draws from `SecureRandom`, and serves a small page and the
  install file on the group's own address. That address is known, where a
  local-only hotspot's is not (`Hosted.kt`).
- **Code 1 is the Wi-Fi login.** The new phone's camera joins with it, or
  its person types the name and password shown under it.
- **Code 2 is the page's address.** The page has one Download button and
  three pictures of the install steps, in the carrier's app language (answer
  30). It holds no script and no outside resource, and names nothing of the
  team.
- **Why two codes:** a QR code holds a login or an address, not both. The
  page a phone opens by itself on joining a network would need a name server
  on port 53, which an app cannot open.
- **The server** is HTTP/1.1, bound to the group's address, and closes
  unanswered any caller outside the group's subnet. It answers only `/` and
  the file's own path, logs nothing, and sends the page with a strict
  Content-Security-Policy (`InstallFileServer.kt`).
  - **Resuming:** it honours one byte range, with an ETag and If-Range, so a
    cut-off download resumes.
  - **Limits:** four connections at once, with a 503 past them; a 20-second
    request head; 15 minutes per connection; at least 16 KiB/s while the file
    is sent.
- **When it stops:**
  - On Stop, on leaving the screen, when a screen is pushed over it, when the
    app goes to the background, or when a cover comes down.
  - After 15 minutes with nothing asked and nothing sent.
  - When the group goes, and after 30 minutes in any case.

  It never runs while Share nearby holds a group.

**The file.** The app still downloads nothing, so decision 246 and Google
Play's Device and Network Abuse policy ("may not download executable code ...
from a source other than Google Play") hold:

- **Where it comes from:** the carrier got the file with the browser, and
  chose it under Check my file.
- **The copy:** a right name is copied into the app's own folder, from the
  picker's content URI only, at most 1 GiB. Native keeps it only if it is
  this app's own: the same package and the same signing certificates as the
  running app (`PackageManager.getPackageArchiveInfo`).
- **The name must tell the truth:** the build's runtime version, read as
  expo-updates reads it (the fingerprint asset), must start with the name's
  fingerprint. A real but older build under today's name is refused. A build
  whose version cannot be read is kept.
- **That settles** the security review's question of a check by name alone.
- **Why a copy, not a lasting grant on the chosen file:** the module sends
  files only from the app's own folders, and the check needs a real path.
- **How long:** the copy stays until this phone needs other versions (answer
  31).

**No new permission.** Wi-Fi Direct uses what Share nearby already declares,
`REQUEST_INSTALL_PACKAGES` stays out (the new phone installs through its own
system dialog), and nothing is sent to the server or anyone else.

**Older binaries.** One under this update has the native module without
these functions. It says to update from the store, and never calls them.

Amends decision 246, which named Quick Share, an SD card and a USB cable as
the ways the file travels. Those stay as other ways.

Reverse if: any of these holds.

- the real-phone test finds phones that cannot join a Wi-Fi Direct group from
  a QR code, or browsers that will not download the file from the page, often
  enough that Quick Share is the simpler way after all;
- Android starts asking a permission for a server on the group;
- Google Play reads serving the app's own install file to a nearby phone as
  distributing apps.
