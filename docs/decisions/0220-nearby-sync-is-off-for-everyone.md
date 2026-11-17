# 220. Nearby sync is off for everyone and turned on per organization, in `org_features`, and the phone learns it from `get_user_state`

Date: 2026-11-12 · By: Carl Sauder · Status: accepted

Reason: Carl chose (2026-11-06) that nearby sync starts experimental and off
for everyone, and staff turn it on one organization at a time, beginning
with a test organization (plan 5.10). The record is `org_features`, copying
`org_importers` (174): who turned it on and when, kept once revoked so the
history stays, with the features `nearby` and `nearby_join` (Carl's answer
11) and staff's `npm run org-feature`. The certificate carries it to the
phone: the Worker hands certificates and discovery keys out only for
organizations that are on, and holding them is what makes Share nearby
appear, so it works offline; a teammate checks the certificate at Hello, so
unhiding the screen gets nobody in. A phone learns through a call it already
makes: `get_user_state` gains `orgFeatures` and `nearbyRevokedSeq`, read by
`useGlobalViewer` on every `OrgWork` mount and token refresh and handed to
`useNearbyIdentity` (`apps/mobile/src/nearby/nearbyFlag.ts`), so someone in
an organization that is off makes no new server call; `my_organizations`
runs on too few screens to carry it. Turning an organization off reaches a
phone the next time it reaches the server: it drops that person's chain and
discovery keys with no call, and Share nearby disappears. The flag gates the
way in and nothing else: the sweep, uploads, delivery and freeing space keep
running, so nearby work already on a phone still settles. It cannot contain
the shared sync path's changes or the native module, which ship to everyone
in a build (157), so those rest on tests and the real-phone test. This
amends 53.
Reverse if: an admin toggle is wanted while it is still experimental, or
the default becomes on (then the records list the organizations that turned
it off).
