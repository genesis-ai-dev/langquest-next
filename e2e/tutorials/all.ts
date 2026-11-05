// Every tutorial video, by id, in the order the plan lists them by who
// watches (the plan: "Tutorial videos: what to make and how to keep them current").
import type { Who } from './playlists';
import type { Tutorial } from './tutorial';
import { addALanguage } from './add-a-language';
import { backTranslateAPassage } from './back-translate-a-passage';
import { chooseTheAppLanguage } from './choose-the-app-language';
import { consultantCheck } from './consultant-check';
import { createAnAccount } from './create-an-account';
import { answerFeedback } from './answer-feedback';
import { doACheck } from './do-a-check';
import { findYourWayAround } from './find-your-way-around';
import { finishAndAskForACheck } from './finish-and-ask-for-a-check';
import { giveEachPartItsVerse } from './give-each-part-its-verse';
import { hearMoveDeleteParts } from './hear-move-delete-parts';
import { inviteYourTeam } from './invite-your-team';
import { letPeopleIn } from './let-people-in';
import { changeARole } from './change-a-role';
import { makeARole } from './make-a-role';
import { getALanguageReady } from './get-a-language-ready';
import { showALanguageToThePublic } from './show-a-language-to-the-public';
import { groupLanguagesIntoACluster } from './group-languages-into-a-cluster';
import { getTheBlueCheck } from './get-the-blue-check';
import { shareTemplatesAndFlows } from './share-templates-and-flows';
import { removeFromTheRecord } from './remove-from-the-record';
import { joinYourTeam } from './join-your-team';
import { keyWords } from './key-words';
import { readBiblesBesideAPassage } from './read-bibles-beside-a-passage';
import { recordAPassage } from './record-a-passage';
import { setUpTheReviewChecks } from './set-up-the-review-checks';
import { askSomeone } from './ask-someone';
import { moveAPassageAlong } from './move-a-passage-along';
import { chooseReferenceMaterial } from './choose-reference-material';
import { writeAStudyGuide } from './write-a-study-guide';
import { chooseAContentTemplate } from './choose-a-content-template';
import { divideBooksIntoPassages } from './divide-books-into-passages';
import { followALanguage } from './follow-a-language';
import { somethingElse } from './something-else';
import { startAnOrganization } from './start-an-organization';
import { studyAPassage } from './study-a-passage';
import { takeBackAReview } from './take-back-a-review';
import { useTheHelp } from './use-the-help';
import { versionsAndHistory } from './versions-and-history';
import { workWithoutInternet } from './work-without-internet';
import { yourAccount } from './your-account';
import { reportOrBlockSomeone } from './report-or-block-someone';
import { lookAroundWithoutAnAccount } from './look-around-without-an-account';
import { followProgressAsAViewer } from './follow-progress-as-a-viewer';
import { reportsOnTheWeb } from './reports-on-the-web';
import { bringInYourOwnMaterial } from './bring-in-your-own-material';
import { readAnyOrganization } from './read-any-organization';

/** Who each video is for, which is its playlist on YouTube (playlists.ts), each in the plan's order. */
export const GROUPS: { who: Who; videos: Tutorial[] }[] = [
  { who: 'everyone', videos: [joinYourTeam, createAnAccount, findYourWayAround, useTheHelp, workWithoutInternet, chooseTheAppLanguage, yourAccount, reportOrBlockSomeone] },
  {
    who: 'admins',
    videos: [startAnOrganization, addALanguage, getALanguageReady, inviteYourTeam, letPeopleIn, changeARole, makeARole, showALanguageToThePublic, groupLanguagesIntoACluster,
      getTheBlueCheck, shareTemplatesAndFlows, removeFromTheRecord]
  },
  { who: 'leads', videos: [setUpTheReviewChecks, askSomeone, moveAPassageAlong, chooseReferenceMaterial, chooseAContentTemplate, divideBooksIntoPassages, followALanguage, writeAStudyGuide] },
  {
    who: 'translators',
    videos: [studyAPassage, recordAPassage, hearMoveDeleteParts, giveEachPartItsVerse, finishAndAskForACheck, answerFeedback, keyWords, readBiblesBesideAPassage, versionsAndHistory, somethingElse]
  },
  { who: 'reviewers', videos: [doACheck, backTranslateAPassage, consultantCheck, takeBackAReview] },
  { who: 'followers', videos: [lookAroundWithoutAnAccount, followProgressAsAViewer, reportsOnTheWeb, bringInYourOwnMaterial, readAnyOrganization] }
];

export const TUTORIALS: Record<string, Tutorial> = Object.fromEntries(GROUPS.flatMap((g) => g.videos).map((t) => [t.id, t]));
