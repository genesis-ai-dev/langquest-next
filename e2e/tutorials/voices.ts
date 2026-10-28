// Real speech for the recordings the filmed world already holds, so a video
// that plays one plays a person reading rather than the UI tests' tone. Keyed
// as the fixture names each recording (buildWorld's `voices`); the files are
// in TUTORIAL_SPEECH. French (Louis Segond 1910) stands in for the made-up
// language; Ruth's notes and back translations are in English.
export const WORLD_VOICES: Record<string, string> = {
  // Luke 15:11-16, Version 1, the Peer check Ruth is asked to do.
  'P-SUBMITTED#1': 'submitted-1.wav', 'P-SUBMITTED#2': 'submitted-2.wav', 'P-SUBMITTED#3': 'submitted-3.wav',
  // Luke 14:15-20, with verses 17 and 18 said too fast, and Ruth's feedback.
  'P-NEEDS#1': 'needs-1.wav', 'P-NEEDS#2': 'needs-2.wav', 'P-NEEDS#3': 'needs-3.wav', 'note:P-NEEDS': 'needs-note.wav',
  // Luke 14:1-4, two parts kept as a draft.
  'P-DRAFT#1': 'draft-1.wav', 'P-DRAFT#2': 'draft-2.wav',
  // Luke 14:25-35, Version 1, which Ruth is asked to back-translate.
  'P-BT#1': 'bt-src-1.wav', 'P-BT#2': 'bt-src-2.wav', 'P-BT#3': 'bt-src-3.wav',
  // Luke 15:1-10, at the Consultant check, and Ruth's back translation of it.
  'P-CHECK#1': 'check-1.wav', 'P-CHECK#2': 'check-2.wav', 'P-CHECK#3': 'check-3.wav',
  'bt:P-CHECK#1': 'check-bt-1.wav', 'bt:P-CHECK#2': 'check-bt-2.wav'
};
