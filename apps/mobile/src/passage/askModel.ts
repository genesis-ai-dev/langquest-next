// What "Someone else" (screens/passage.tsx `AskSomeone`, ASK-1..5) shows and
// sends for what the person has picked so far: the title, who is listed first,
// who the request goes to, whether Ask is enabled, and the ask
// command's input. Pure, so the choices are held by tests
// (test/askModel.test.ts) and the screen only draws and collects them.
import { checkPeople, questionsForKind, type Commands, type OrgState, type QuestionSpec } from '@langquest-next/core';
import { checkName } from '../admin/adminModel';
import { t } from '../i18n';
import type { PassageView } from './passageView';
import { sendTargetLabel, type NameFn } from './record';
import { usualTargetFor, type UsualTarget } from './sendTarget';

/** The ask screen's choice of a check's whole team (decision 91), beside one person's id. */
export const TEAM = '\u0000team';

/** A teammate who may be asked, as `askCandidates` gives them. */
export interface Candidate { profileId: string; sub: string; usual: boolean; onCheck: boolean }

export interface AskPicks {
  /** A teammate, or an outsider reached by WhatsApp or SMS. */
  mode: 'team' | 'outside';
  /** The teammate picked, or null (the check's team is then the choice, when it has one). */
  who: string | null;
  guestName: string;
  contact: string;
}

export interface AskModel {
  isRecord: boolean;
  kindId: string | undefined;
  /** The check's one name (decision 91); empty when asking for a recording. */
  check: string;
  title: string;
  /** Teammates usually asked, the check's people first, then by name. */
  usual: Candidate[];
  /** Everyone else who may be asked, by name. */
  others: Candidate[];
  /** The check's team, when the check has one (decision 91): everyone on it gets the request. */
  team: Extract<UsualTarget, { teamId: string }> | undefined;
  teamPeople: string[];
  /** What is chosen: a person's id, or TEAM, or null. */
  chosen: string | null;
  /** The check's own questions, which the people asked will answer. */
  asked: ReturnType<typeof questionsForKind>;
  /** Asking someone without the app. */
  outside: boolean;
  /** Who the request goes to, as the button says it; empty when nobody is chosen. */
  target: string;
  /** May Ask be pressed. */
  ready: boolean;
  /** The Ask button's label. */
  buttonLabel: string;
}

/** Everything the screen derives from the passage, the people and the picks so far. */
export function askModel(o: {
  v: PassageView; org: OrgState | null; me: string; name: NameFn; what: 'record' | 'review'; kindId: string | undefined;
  candidates: Candidate[]; picks: AskPicks;
}): AskModel {
  const { v, kindId, picks } = o;
  const isRecord = o.what === 'record';
  const check = kindId ? checkName(kindId, v.kinds) : '';
  const kind = kindId ? v.kind(kindId) : undefined;
  const title = isRecord ? (v.p.recorded ? t('passage.ask.titleNewVersion') : t('passage.ask.titleRecord'))
    : kind ? t('passage.ask.titleKind', { kind: check }) : t('passage.ask.titleReview');
  const byName = (a: { profileId: string }, b: { profileId: string }) => o.name(a.profileId).localeCompare(o.name(b.profileId));
  const usual = o.candidates.filter((c) => c.usual).sort((a, b) => Number(b.onCheck) - Number(a.onCheck) || byName(a, b));
  const others = o.candidates.filter((c) => !c.usual).sort(byName);
  const usualTo = !isRecord && kindId ? usualTargetFor(v.state, o.org, { languageId: v.languageId, kindId, me: o.me }) : undefined;
  const team = usualTo && 'teamId' in usualTo ? usualTo : undefined;
  const teamPeople = team && kindId ? checkPeople(v.state, kindId).filter((id) => id !== o.me) : [];
  const chosen = picks.who ?? (team ? TEAM : null);
  const asked = kindId ? questionsForKind(v.state, kindId) : [];
  const outside = picks.mode === 'outside' && !isRecord;
  const target = outside ? picks.guestName.trim() : chosen === TEAM && team ? sendTargetLabel(team, o.name) : chosen ? o.name(chosen) : '';
  const ready = !!target && (!outside || picks.contact.trim().length > 3);
  const buttonLabel = chosen === TEAM && team && !outside ? t('passage.published.askTarget', { target })
    : target ? t('passage.ask.askName', { name: target.split(' ')[0] }) : t('passage.ask.chooseSomeone');
  return { isRecord, kindId, check, title, usual, others, team, teamPeople, chosen, asked, outside, target, ready, buttonLabel };
}

/** The toast after asking: who it went to, with Undo to withdraw it. */
export function askDoneText(m: Pick<AskModel, 'outside' | 'target'>): string {
  return m.outside ? t('passage.ask.doneOutside', { name: m.target }) : t('passage.ask.doneTeam', { name: m.target });
}

/** The ask command's input: to the outsider, the check's team or one person; the questions only on a check. */
export function askInput(o: {
  commandId: string; unitId: string; what: 'record' | 'review'; model: AskModel; picks: AskPicks;
  channel: 'whatsapp' | 'sms'; note: string; noteHash: string | null; questions: QuestionSpec[];
}): Parameters<Commands['ask']>[0] {
  const { model: m, picks } = o;
  return {
    commandId: o.commandId, unitId: o.unitId, what: o.what,
    ...(m.kindId ? { kindId: m.kindId } : {}),
    ...(m.outside ? { guest: { name: picks.guestName.trim(), channel: o.channel, contact: picks.contact.trim() } }
      : m.chosen === TEAM && m.team ? { teamId: m.team.teamId } : m.chosen ? { profileId: m.chosen } : {}),
    ...(o.note.trim() ? { note: o.note.trim() } : {}),
    ...(o.noteHash ? { noteBlobHash: o.noteHash } : {}),
    ...(!m.isRecord && o.questions.length ? { questions: o.questions } : {})
  };
}
