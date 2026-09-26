// Goals are in the user's words: what they want, never which control to press.

export const recordPassage = (label: string) =>
  `You are a translator. Open your assigned passage "${label}" and record your spoken translation of it. ` +
  'Your microphone is already hearing you speak. Once recording, keep it running and wait until the app shows ' +
  'a saved take of this passage; only then stop recording. Stop when the saved take is visible.';

export const saveFirstVersion = (label: string) =>
  `You are a translator. From My Work, open your passage "${label}" and record your spoken translation of it. ` +
  'Your microphone is already hearing you speak. Once recording, keep it running until the app shows a saved take, ' +
  'then stop recording. Then save it as Version 1 so reviewers can hear it. Stop when you are back on the passage page.';

export const reviewNeedsChanges = (label: string, feedback: string) =>
  `You are a reviewer. From My Work, review the version of "${label}" you were asked to review. ` +
  'Play the recording first. Answer the required question (it is not accurate yet, so rate it low) and leave the optional ones. ' +
  `It needs changes: type your feedback (what worked, what didn't) as exactly: ${feedback}. Then send it as needing changes. ` +
  'Stop when the feedback is sent.';

export const answerFeedback = (label: string, note: string) =>
  `You are a translator. A reviewer asked for changes to your passage "${label}". Open the feedback and record a fix. ` +
  'Your microphone is already hearing you speak. Once recording, keep it running until a new part appears, then stop recording. ' +
  `Keep the take, then save it as Version 2. When asked what changed, type: "${note}". Stop when you are back on the passage page.`;

export const askToRecord = (label: string, person: string) =>
  `You coordinate this project. Find the passage "${label}" on the Map (open the project's only language, then its book) ` +
  'and open that passage\'s page. Nobody has recorded it yet, and you will not record it yourself. ' +
  'On a passage page you tap a step on its path (starting with Recorded) to ask someone to do it. ' +
  `Ask ${person} to do the recording, due in a week, and send the ask. Stop when the ask is sent.`;

export const searchMap = (query: string) =>
  `Go to the Map. In its search box, type exactly "${query}", then open the first passage that the search shows. ` +
  'Stop when that passage is open.';
