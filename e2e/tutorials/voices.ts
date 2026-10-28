// Real speech for the recordings the filmed world already holds, so a video
// that plays one plays a person reading rather than the UI tests' tone. Keyed
// as the fixture names each recording (buildWorld's `voices`); the files are
// in TUTORIAL_SPEECH. French (Louis Segond 1910) stands in for the made-up
// language; Ruth's note is in English.
export const WORLD_VOICES: Record<string, string> = {
  // Luke 15:11-16, Version 1, the Peer check Ruth is asked to do.
  'P-SUBMITTED#1': 'submitted-1.wav', 'P-SUBMITTED#2': 'submitted-2.wav', 'P-SUBMITTED#3': 'submitted-3.wav',
  // Luke 14:15-20, with verses 17 and 18 said too fast, and Ruth's feedback.
  'P-NEEDS#1': 'needs-1.wav', 'P-NEEDS#2': 'needs-2.wav', 'P-NEEDS#3': 'needs-3.wav', 'note:P-NEEDS': 'needs-note.wav',
  // Luke 14:1-4, two parts kept as a draft.
  'P-DRAFT#1': 'draft-1.wav', 'P-DRAFT#2': 'draft-2.wav'
};
