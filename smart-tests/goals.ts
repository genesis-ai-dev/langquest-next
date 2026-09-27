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

export const buildFlow = () =>
  'You manage review flows for one language. On the Manage tab, open the project, then its only language, and from ' +
  'that language\'s own page open its review flow (a flow for the whole organization or project cannot be edited). ' +
  'Edit the flow. Remove any steps already there. Add a first step with Peer Review, and alongside it, in the same step, Back Translation. ' +
  'Then add a second step with Consultant Check and make that step a checkpoint. Save the flow. Stop when the flow is saved.';

export const checkKindLooksGood = (label: string) =>
  `You are a reviewer. From My Work, review the version of "${label}" you were asked to review. ` +
  'Play the recording first. Answer the required question (it is accurate, so rate it high) and leave the optional ones. ' +
  'It looks good: send it as looking good. Stop when it is sent.';

export const setAsideStep = (label: string) =>
  `You are the translator of "${label}". From My Work, open that passage's page. Its version is saved and waiting for Peer Review, ` +
  'but no peer will be available for this passage. On the passage page, tap the Peer Review step on the path and set it aside. ' +
  'When asked why, choose the reason "Not needed for this passage" and confirm. Stop when it is set aside.';

export const keepAfterFeedback = (label: string) =>
  `You are a translator. A reviewer asked for changes to your passage "${label}", but your listeners preferred the current wording. ` +
  'Open the passage from My Work. Do not record anything: keep the version as it is and say why, choosing the reason ' +
  '"Listeners preferred the current wording", then send the reason. Stop when it is sent.';

export const askForKindCheck = (label: string, person: string) =>
  `You are the translator of "${label}". From My Work, open that passage's page (your Version 1 is saved). ` +
  'On a passage page you tap a step on its path to ask someone to do it. Tap the Peer Review step and ask someone for Peer Review: ' +
  `ask ${person}, due in a week, and send the ask. Stop when the ask is sent.`;

// ---- Phase 2b slice C: logged checks, back translation, study notes ----------

export const logCommunityCheck = (label: string, alsoLabel: string, place: string) =>
  `You are a translator. Yesterday you played your recordings of "${label}" and "${alsoLabel}" to 12 people at ${place}, ` +
  `and they understood both well. Open the passage "${label}" and log what happened as a Community Check, ` +
  `adding it to "${alsoLabel}" too, since both were covered in the same session. Say 12 people listened, at ${place}, ` +
  'and that it looks good. Stop when it is saved to the record.';

export const backTranslatePassage = (label: string) =>
  `You are a bilingual speaker asked to make the back translation of "${label}". Open the passage, go to its Back Translation, ` +
  'listen to the version, then record the back translation in your own words. Your microphone is already hearing you speak: ' +
  'hold the record button while you speak, then release it. Then save the back translation. Stop when it is saved.';

export const addStudyNoteAtMoment = (label: string, note: string) =>
  `You are a translator studying "${label}". Open its study and go to the "Setting the Stage" step. Play the step's audio, ` +
  `pause it after a second or two, and add a note at that moment that says exactly: ${note}. Save the note. Stop when it is saved.`;
