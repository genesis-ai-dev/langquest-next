import { describe, expect, it } from 'vitest';
import { languageLines } from '@langquest-next/core';
import { askDoneText, askInput, askModel, TEAM, type AskPicks } from '../src/passage/askModel';
import { askCandidates } from '../src/passage/record';
import { passageView } from '../src/passage/passageView';
import { t } from '../src/i18n';
import { ID, NAMES, passageWorld, unitOf, type WorldPassage, type WorldRole } from './passageWorld';

const w = passageWorld();
const picks = (over: Partial<AskPicks> = {}): AskPicks => ({
  mode: 'team', who: null, guestName: '', contact: '', ...over
});

/** The ask screen's model as `who` sees it on passage `k`. */
function ask(who: WorldRole, k: WorldPassage, what: 'record' | 'review', kindId: string | undefined, p: AskPicks) {
  const v = passageView(w.state, unitOf(k), w.languageId, 'Alpha');
  const me = ID[who];
  const lines = languageLines(w.state);
  const candidates = askCandidates(w.state, w.org, { languageId: w.languageId, what, ...(kindId ? { kindId } : {}), me, lines });
  return { v, model: askModel({ v, org: w.org, me, name: w.nameFor(who), what, kindId, candidates, picks: p, lines }) };
}

describe('Someone else: who is listed and what Ask says (askModel.ts)', () => {
  it('titles asking for a first recording and for a new version differently', () => {
    expect(ask('COORD', 'P-NEW', 'record', undefined, picks()).model.title).toBe(t('passage.ask.titleRecord'));
    expect(ask('COORD', 'P-SUBMITTED', 'record', undefined, picks()).model.title).toBe(t('passage.ask.titleNewVersion'));
    expect(ask('COORD', 'P-SUBMITTED', 'review', 'peer', picks()).model.title).toBe(t('passage.ask.titleKind', { kind: 'Peer check' }));
  });

  it('puts the check\'s people first, and sorts the rest by name', () => {
    const { model } = ask('COORD', 'P-SUBMITTED', 'review', 'peer', picks());
    expect(model.usual.map((c) => c.profileId).sort()).toEqual([ID.REV, ID.TREV].sort());
    expect(model.usual.every((c) => c.onCheck)).toBe(true);
    const names = model.others.map((c) => NAMES[c.profileId as never] ?? c.profileId);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    expect([...model.usual, ...model.others].map((c) => c.profileId)).not.toContain(ID.COORD);
  });

  it('makes the check\'s team the first choice when it has one, and asks it by name', () => {
    const { model } = ask('COORD', 'P-SUBMITTED', 'review', 'peer', picks());
    expect(model.team).toBeDefined();
    expect(model.teamPeople.sort()).toEqual([ID.REV, ID.TREV].sort());
    expect(model.chosen).toBe(TEAM);
    expect(model.target).toBe(t('passage.record.theTeam', { team: model.team!.name }));
    expect(model.ready).toBe(true);
    expect(model.buttonLabel).toBe(t('passage.published.askTarget', { target: model.target }));
    // A person picked beats the team.
    expect(ask('COORD', 'P-SUBMITTED', 'review', 'peer', picks({ who: ID.REV })).model.chosen).toBe(ID.REV);
  });

  it('has no team and nobody chosen for a check nobody is set to do; Ask is then off', () => {
    const { model } = ask('COORD', 'P-SUBMITTED', 'review', 'community', picks());
    expect(model.team).toBeUndefined();
    expect(model.teamPeople).toEqual([]);
    expect(model.chosen).toBeNull();
    expect(model.target).toBe('');
    expect(model.ready).toBe(false);
    expect(model.buttonLabel).toBe(t('passage.ask.chooseSomeone'));
  });

  it('asks the person picked by their first name', () => {
    const { model } = ask('COORD', 'P-SUBMITTED', 'review', 'peer', picks({ who: ID.REV }));
    expect(model.chosen).toBe(ID.REV);
    expect(model.target).toBe(NAMES.REV);
    expect(model.ready).toBe(true);
    expect(model.buttonLabel).toBe(t('passage.ask.askName', { name: 'Rita' }));
    expect(askDoneText(model)).toBe(t('passage.ask.doneTeam', { name: NAMES.REV }));
  });

  it('asks nobody about a recording as an outsider, and wants a phone number longer than three characters for a guest', () => {
    expect(ask('COORD', 'P-NEW', 'record', undefined, picks({ mode: 'outside', guestName: 'Joe' })).model.outside).toBe(false);
    const guest = (contact: string) => ask('COORD', 'P-SUBMITTED', 'review', 'peer', picks({ mode: 'outside', guestName: ' Joe Guest ', contact })).model;
    expect(guest('555').outside).toBe(true);
    expect(guest('555').ready).toBe(false);
    expect(guest('5551').ready).toBe(true);
    expect(guest('5551').target).toBe('Joe Guest');
    expect(askDoneText(guest('5551'))).toBe(t('passage.ask.doneOutside', { name: 'Joe Guest' }));
    expect(ask('COORD', 'P-SUBMITTED', 'review', 'peer', picks({ mode: 'outside', contact: '5551' })).model.ready).toBe(false);
  });

  it('carries the check\'s own questions, none for a recording', () => {
    expect(ask('COORD', 'P-DONE', 'review', 'consultant', picks()).model.asked.map((q) => q.q.text)).toContain('Does it carry the meaning of the original?');
    expect(ask('COORD', 'P-NEW', 'record', undefined, picks()).model.asked).toEqual([]);
  });
});

describe('the ask command it builds', () => {
  const build = (who: WorldRole, p: AskPicks, extra: Partial<Parameters<typeof askInput>[0]> = {}) => {
    const { model } = ask(who, 'P-SUBMITTED', 'review', 'peer', p);
    return askInput({ commandId: 'c', unitId: 'u', what: 'review', model, picks: p, channel: 'sms', note: '', noteHash: null, questions: [], ...extra });
  };

  it('sends to the person picked, with a trimmed note and no due date', () => {
    const p = picks({ who: ID.REV });
    expect(build('COORD', p, { note: ' listen for verse 3 ', noteHash: 'nh' })).toEqual({
      commandId: 'c', unitId: 'u', what: 'review', kindId: 'peer', profileId: ID.REV, note: 'listen for verse 3', noteBlobHash: 'nh'
    });
  });

  it('sends to a guest by the channel and contact, trimmed', () => {
    const p = picks({ mode: 'outside', guestName: ' Joe ', contact: ' 5551234 ' });
    expect(build('COORD', p)).toMatchObject({ guest: { name: 'Joe', channel: 'sms', contact: '5551234' } });
    expect('profileId' in build('COORD', p)).toBe(false);
  });

  it('adds the questions to a check and leaves them off a recording', () => {
    const questions = [{ id: 'ask:1', text: 'Clear?', type: 'yesno' as const }];
    expect(build('COORD', picks({ who: ID.REV }), { questions })).toMatchObject({ questions });
    const { model } = ask('COORD', 'P-NEW', 'record', undefined, picks({ who: ID.TRANS }));
    const rec = askInput({ commandId: 'c', unitId: 'u', what: 'record', model, picks: picks({ who: ID.TRANS }), channel: 'sms', note: '', noteHash: null, questions });
    expect(rec).toEqual({ commandId: 'c', unitId: 'u', what: 'record', profileId: ID.TRANS });
  });

  it('has a team marker that no profile id can equal', () => {
    expect(Object.values(ID)).not.toContain(TEAM);
  });
});
