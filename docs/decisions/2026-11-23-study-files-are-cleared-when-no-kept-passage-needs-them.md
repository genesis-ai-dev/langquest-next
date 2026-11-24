# A study file no kept passage needs is cleared when the device needs room, and one a kept passage needs never is

Date: 2026-11-23 · By: Carl Sauder · Status: accepted

Reason: the pictures, maps and step audio of a kept passage's study guide
(decision 61, `study/studyFiles.ts`) were never deleted. Recordings are
cleared once a device is short of the 500 MB kept for recording or over the
2 GB cache (`evictableBlobs`, docs/blobs.md), and reference audio once its
1 GB is full (`sourceEvictions`), but a book of study files stayed on the
phone after it was let go, and the sheet that lets a book go says "Its
recordings and reference material are cleared when this device needs room."
(`docs/decisions/2026-11-20-a-book-has-its-own-download-button.md`, amended
2026-11-23). Checking that sentence found the gap.

Study files get the recordings' rule, with what is particular to them:

- **What may go.** Only files no kept passage needs, in any language on the
  phone (`studyEvictions`, `study/studyFilesModel.ts`). A file a kept passage
  needs is never deleted, however short the device is, as kept recordings
  are not. Files are named by their web address, so two languages that keep
  the same passage share them: each language saves its own list of the files
  its kept passages need (AsyncStorage `study-files:wants:<org>/<language>`),
  and a file any list names stays.
- **Only from a whole list.** A language's list is saved, and anything is
  cleared, only once the language has counted what it keeps and every kept
  passage's guide has been looked up (`wishListWhole`,
  `study/prefetchModel.ts`). Before the count the kept list and scope are
  empty, so the language would look as if it kept nothing; a guide not yet
  looked up may name files no list does yet.
- **Not from before this build.** A file written before the phone first ran
  a build that saves the lists (`study-files:since`) is never cleared: a
  language not opened since may need it, and nothing on the phone says
  which. Files left over from before stay; every file downloaded since can
  go once no list names it.
- **When.** When the device is short of the room kept for recording, or when
  files no kept passage needs come to more than 256 MB, the oldest first.
  The spare room lets a passage let go and kept again soon find its files
  here; it is a quarter of reference audio's 1 GB, since these are
  low-resolution pictures and short step audio, and they come back with a
  connection. The phone looks after each change to a language's list and
  after each batch of downloads (`sweep`).

Considered: a store method listing every language held on the phone, so
that a file could be cleared once every held language had saved its list,
including files from before this build. It needs every event store to
answer it, for files that are a one-time leftover. Clearing by a fixed cap
alone, as reference audio does, which takes another language's kept files
when the cap is reached.

Reverse if: study files left over from before this build take room people
notice (then list the held languages, as considered), or phones in the field
are short of room with study files of let-go passages still on them (then
the spare room is too large, or the phone does not look often enough).

Amended (2026-11-24, Carl Sauder): a teammate's phone can hand over study
files by address over Share nearby or while LangQuest is open
(2026-11-24-library-files-move-between-teammates-as-reference-files). They
land in this folder and are cleared by the same rule. A phone takes those no
kept passage needs only while the spare room lasts, so clearing never throws
away what a teammate just gave, to be asked for again. Each is written down,
and once online the phone fetches it again from its address and forgets it;
one its source refuses is deleted.
