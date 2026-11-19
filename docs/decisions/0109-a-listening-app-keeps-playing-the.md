# 109. A listening app keeps playing the approved version, hears changes by webhook, and the team sees its listeners on the passage

Date: 2026-10-14 · By: Ryder Wishart · Status: partly superseded by 131

Reason: Ryder asked for the whole EveryBible loop for a stakeholder demo:
a recorded passage goes out for review, reviewers hear it in EveryBible,
approved and published chapters reach every listener, listener feedback
keeps flowing back to the team after publication, and listeners see when a
chapter was updated and its history (meetings of 2026-10-12 and 13 with
Skyler, Caleb and Carl). Changes in one app should show in the other as
fast as possible. The pieces, none of them a new event:
- **The approved version's audio.** The passage API's `approvedAudio`
  include (`view.ts`, needs `read`) gives `approvedVersion`'s cards beside
  `version`'s. A listening app that published version 2 keeps playing it
  while version 3 is in review, instead of dropping the chapter. This is
  the "explicit version read" the unmerged prototype entry of 2026-10-08
  named as its reverse condition. With `read:published` alone, `audio` is
  already the approved version, so the include is refused there.
- **The listening side, in EveryBible's repository.** Its bridge Worker
  registers a webhook (101) when its studio opens, reads the change feed
  after its own cursor and re-reads only the passages named, keeping each
  language in its Durable Object. Phones and the studio hold a WebSocket
  and re-read the catalog when told something changed: about 300 ms from a
  LangQuest change to a phone in the local round trip. Publishing stays
  the team's explicit choice per chapter in the studio (James asked for
  confirmation before publishing). Once a chapter is published, a newer
  version LangQuest approves replaces it on every phone, and the bridge
  reports both releases (`v1.VersionReleased` live and taken down, 72).
- **The team's view.** A passage's Listeners section (`passage.tsx`) lists
  where a version is live (`releasesOf`) and each listener review, newest
  first. Feedback given by link or partner app shows the listener's typed
  name (`feedbackSource`), and its voice clips play where the translator
  answers it.
- **Testing it.** `server/listeningDemo.ts` (`npm run listening:demo`)
  serves the partner API, reducer, change digests (`digestOf`) and webhook
  signatures over a local append-only log, with `/demo/record` and
  `/demo/approve` for the translator's side. EveryBible's
  `scripts/listening-roundtrip.mjs` drives the whole loop against it.
Reviewers in EveryBible still unlock with one shared code; listener
feedback is `listener` kind and never clears a step (72).
Reverse if: teams want approval alone to publish a chapter (then the bridge
publishes on approval, per language), reviewers need their own accounts
(then tie EveryBible sign-in to a LangQuest review link or role), or the
change feed and webhooks prove too slow for live listening (then push from
the organization's Durable Object directly).
