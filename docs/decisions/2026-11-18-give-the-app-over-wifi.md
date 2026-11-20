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

Amended (2026-11-19, Carl Sauder): the screen's words and steps, after a review Carl took whole. Its first line says what is coming (this phone makes its own Wi-Fi network, and the new phone scans two codes with its camera), and Start is Show the first code. There are three numbered steps, the third being to install the file once it is sent; step 1 says to tap Next once the new phone has joined, which nothing on screen said. Both codes come back under Give it to another phone after a file is sent, where before the second code stayed up with a Back to the first code link that did nothing once the file had started. "This phone's own Wi-Fi" meant both the network it makes and the Wi-Fi switch, so the first is now "this phone's Wi-Fi network". A busy Wi-Fi Direct says to wait and try again, not that Share nearby is using it, which is one cause among several and had nothing to stop. A phone that cannot give the app is told why (Android before 10, or an older build of the app). How it works is unchanged.

Amended (2026-11-20, Carl Sauder): fewer steps on the new phone, for people who are not technical (Carl's choice of three of five suggestions, and of the new phone finding the carrier by itself for the third).
- **Code 2 shows by itself.** Give the app's status counts the phones in the group (`joined`, from Android's client list), and once one joins, code 2 replaces code 1. A phone that joins as plain Wi-Fi from code 1 is listed: in AOSP, the supplicant reports every authorized station and the framework adds one with no Wi-Fi Direct address by its interface address. Next stays for a maker whose Android leaves it out.
- **The download starts by itself.** The page asks for the file a second after it opens, with a meta refresh, which is not script, so the strict CSP stands. The refresh asks for `/<file>?auto=1`, which the server answers with 204 for a phone that has already asked for the file. In Chrome 113, a Download tapped in that first second started a second download, whose "multiple files" question can block the address for good, and a reload downloaded again. The Download button stays for a browser that does not follow the refresh.
- **Send with Quick Share** is a second way on the screen, before a group runs. It opens Android's share sheet with the kept file, through a FileProvider of the module's own that shows that folder alone and is not exported. It is the module's one manifest component, and it runs nothing. Both phones need Google Play services.
- **No third code.** Let them in no longer stops the group: it hands it to Let someone in, which hosts its link on Give the app's group and has the server answer `/join` with the join link.
  - **How the new phone finds it.** Once LangQuest is installed and opened on the new phone, still on that Wi-Fi, it asks its Wi-Fi's gateway for `/join` on port 8080 (Give the app's usual port) every few seconds. It asks only a gateway at 192.168.49.1 (Android's usual group owner) or a private address on a network with no internet (the first tethering module of Android 11 gives the owner a random `192.168.x.1`), never a router with working internet. It asks only while nobody is on the phone and a newcomer's screen shows. It then goes on as a scanned code would, and joins over the Wi-Fi it is already on. In the app's code the link's scheme is named only in JavaScript, which checks it; native checks its shape. The page's fourth step links to `/join` for when it does not find it, and the code is still shown.
  - **What this amends.** The server no longer answers only the page and the file: it also answers `/join`, and `/<file>?auto=1`. It never runs beside a nearby group of its own, but a let-in link may run on its group. The group then stays up while that link lives, after the page has stopped.
  - **Why it is safe enough.** Anyone on that Wi-Fi, which needs code 1, can read the join link, as anyone could photograph the code before. The inviter's one tap, with the two pictures on both phones, still decides (plan 14.1, 3). The link's pin makes the new phone refuse any phone but the one whose link it holds. A server on some other network with no internet could hand a new phone a link of its own, and learn the name typed into it, but it can grant nothing, since a grant needs an inviter's chain to the root keys. So the new phone opens one found link a run, never more, and none behind a cover. The code lives 15 minutes there, Give the app's own idle limit, not two.
  - **What an independent review found and changed** (2026-11-20, before merging). Let someone in takes the hand-over each time it comes into view, since opened from there, Give the app goes back to it. Joining on the Wi-Fi a phone is already on happens only when that network's gateway answers `/join` with a link naming the same Wi-Fi, so no other join, a teammate's sync included, is caught by a captive portal. A group that goes takes its let-in hosts down with it. The let-in listener on the group answers only the group's subnet. `/join` keeps the session alive only once it has a link to give.
- **Still true.** The app downloads and installs nothing, no permission is added, and nothing goes to the server. None of this is tried on two real phones yet: emulators have no Wi-Fi Direct.

Reverse if: the real-phone test finds that phones do not list a plain-Wi-Fi client, browsers refuse the automatic download, or the new phone fails to find the carrier often enough that the code is the simpler way; or a security review finds the join link on the group a risk the tap and pictures do not cover.

Amended (2026-11-20, Carl Sauder): the two ways are one choice. Send with Quick Share sat under Show the first code with one line of what the new phone does, and did not read as one of two ways, nor say what to do on which phone in what order. Before a group runs, the screen now asks "Choose one way to send it" with two radio rows, This phone's Wi-Fi (chosen first, since it works on any phone) and Quick Share, and shows only the chosen way's steps and its one main button. Quick Share's steps are numbered right through, under the phone that does them: the new phone first, then this one, then the new phone, then letting them in. The words no longer name China (plan 14.5).
