// Every tutorial video, by id, in the order the plan lists them by who
// watches (the plan: "Tutorial videos: what to make and how to keep them current").
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
import { somethingElse } from './something-else';
import { startAnOrganization } from './start-an-organization';
import { studyAPassage } from './study-a-passage';
import { takeBackAReview } from './take-back-a-review';
import { useTheHelp } from './use-the-help';
import { versionsAndHistory } from './versions-and-history';
import { workWithoutInternet } from './work-without-internet';
import { yourAccount } from './your-account';
import { reportOrBlockSomeone } from './report-or-block-someone';

export const TUTORIALS: Record<string, Tutorial> = Object.fromEntries([
  // Everyone
  joinYourTeam, createAnAccount, findYourWayAround, useTheHelp, workWithoutInternet, chooseTheAppLanguage, yourAccount, reportOrBlockSomeone,
  // Organization heads and admins
  startAnOrganization, addALanguage, getALanguageReady, inviteYourTeam, letPeopleIn, changeARole, makeARole, showALanguageToThePublic, groupLanguagesIntoACluster, getTheBlueCheck, shareTemplatesAndFlows,
  // Team coordinators and language leads
  setUpTheReviewChecks, askSomeone, moveAPassageAlong, chooseReferenceMaterial, chooseAContentTemplate, writeAStudyGuide,
  // Translators
  studyAPassage, recordAPassage, hearMoveDeleteParts, giveEachPartItsVerse, finishAndAskForACheck, answerFeedback, keyWords, readBiblesBesideAPassage, versionsAndHistory, somethingElse,
  // Reviewers and consultants
  doACheck, backTranslateAPassage, consultantCheck, takeBackAReview
].map((t) => [t.id, t]));
