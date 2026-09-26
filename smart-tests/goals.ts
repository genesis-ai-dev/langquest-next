// Goals are in the user's words: what they want, never which control to press.

export const recordPassage = (label: string) =>
  `You are a translator. Open your assigned passage "${label}" and record your spoken translation of it. ` +
  'Your microphone is already hearing you speak. Once recording, keep it running and wait until the app shows ' +
  'a saved take of this passage; only then stop recording. Stop when the saved take is visible.';
