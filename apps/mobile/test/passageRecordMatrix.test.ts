import { describe, expect, it } from 'vitest';
import { askCandidates, currentStepId } from '../src/passage/record';
import { pathSteps, teamSteps } from '../src/passage/pathModel';
import {
  currentCheck, elseOptions, recordCan, recordModel, recordPathInput, rowButtons, stepSheet, teamStepsOpen, usualTargets, waitingOnAnswer
} from '../src/passage/recordModel';
import { requestIsMine, teamNameIn } from '../src/passage/sendTarget';
import { kindInSentence, passageView } from '../src/passageView';
import { checkName } from '../src/simple/adminModel';
import { t } from '../src/i18n';
import { ID, labelOf, NAMES, passageWorld, unitOf, type WorldPassage, type WorldRole } from './passageWorld';

/**
 * The passage record's role-by-passage matrices (docs/ui-test-suite/05-passage-record.md),
 * held at the screen-model layer (docs/testing.md, decision 102): what each
 * role sees on each of the fixture world's passages, read from the models
 * the record draws (recordModel.ts, pathModel.ts). The strings are the ones
 * the end-to-end tests read off the screen; e2e/ui/05-passage-record.spec.ts
 * keeps one role per spec to prove the model reaches the glass.
 */

const w = passageWorld();
const name = (who: WorldRole) => NAMES[who];

/** Everything the record shows `who` on passage `k`, as the screen builds it. */
function record(who: WorldRole, k: WorldPassage) {
  const v = passageView(w.state, unitOf(k), w.languageId, 'Alpha');
  const { p, kinds } = v;
  const s = w.session(who);
  const me = s.actorId;
  const nameFn = w.nameFor(who);
  const can = recordCan(s);
  const mine = requestIsMine(w.state, me);
  const teamName = teamNameIn(w.state);
  const isAuthor = !!p.latest && p.latest.by === me;
  const targets = usualTargets(w.state, w.org, { p, languageId: w.languageId, me, asker: isAuthor });
  const input = recordPathInput({ p, kinds, me, name: nameFn, teamName });
  const steps = pathSteps(input);
  const model = recordModel({ p, kinds, kind: v.kind, me, can, steps, mine, asker: isAuthor, isAuthor });
  const lit = steps.find((st) => st.state === 'current');
  const sheetOf = (kindId: string) => {
    const step = p.steps.find((st) => st.kinds.some((x) => x.kindId === kindId))!;
    const sh = stepSheet({ p, kinds, kind: v.kind, step, can, isAuthor, me, mine, name: nameFn, teamName, targets });
    const buttons = [...sh.rows.flatMap((r) => rowButtons(r.acts).map((a) => a.label)), ...(sh.movePast ? [t('passage.page.movePastThis')] : [])];
    const text = [sh.title, sh.sub, ...sh.rows.flatMap((r) => [r.name, r.sub, ...rowButtons(r.acts).map((a) => a.label)]), ...(sh.movePast ? [t('passage.page.movePastThis')] : [])]
      .filter(Boolean).join(' ');
    return { text, buttons };
  };
  const options = elseOptions({ p, kinds, can, current: currentCheck(p, currentStepId(p)), answersMine: model.answersMine, myDraft: model.myDraft });
  return {
    can,
    main: model.main?.label ?? null,
    /** Each path step as it is spoken: "1. Record. …". */
    path: steps.map((st, i) => `${i + 1}. ${st.title}. ${st.sub}`),
    /** Each "Then the team" row as it is spoken: "Peer check, looks good". */
    team: teamSteps(input).map((st) => `${st.name}, ${st.status}`),
    teamOpens: teamStepsOpen(can),
    waiting: waitingOnAnswer({ p, kinds, answersMine: model.answersMine, name: nameFn }),
    sheet: sheetOf,
    /** "Something else?": its sub-title, each way forward as "label sub", and the note tiles. */
    else: {
      sub: [v.title, lit?.title ?? ''].filter(Boolean).join(' · '),
      options: options.map((o) => `${o.label} ${o.sub}`),
      ids: options.map((o) => o.id),
      note: can.note
    },
    /** The Versions page: may record (New version, Edit), and the latest version's ask button. */
    versions: { records: can.record, ask: model.nextKind && can.ask ? t('passage.page.askFor', { check: kindInSentence(checkName(model.nextKind.kindId, kinds)) }) : null }
  };
}

const each = <K extends string, T>(roles: readonly K[], f: (who: K) => T): Record<K, T> => Object.fromEntries(roles.map((r) => [r, f(r)])) as Record<K, T>;

describe('the passage record, per role (05-passage-record.md)', () => {
  it('PASS-001 P-NEW: not started, asked of TRANS', () => {
    const roles = ['TRANS', 'REV', 'TREV', 'COORD', 'LADMIN', 'VIEW'] as const;
    for (const who of roles) {
      const r = record(who, 'P-NEW');
      const asked = who === 'TRANS' ? `${name('COORD')} asked you` : who === 'COORD' ? `You asked ${name('TRANS')}` : `${name('COORD')} asked ${name('TRANS')}`;
      const rec = r.path[0]!;
      expect(rec, who).toMatch(/^1\. Record\. /);
      expect(rec, who).toContain(`${asked} · `);
      expect(rec, who).toMatch(/due [A-Z][a-z]{2} \d{1,2}/);
      expect(rec, who).toContain('Tell it in your language. The Bible, key words and notes are beside you while you record.');
      expect(r.path[1], who).toBe('2. Publish. Then ask for the peer check');
      expect(r.team, who).toEqual([
        'Peer check, after you publish', 'Back translation, same time', 'Community check, after the peer check',
        'Consultant check, after the community check', 'Final approval, after the consultant check'
      ]);
    }
    expect(each(roles, (who) => record(who, 'P-NEW').main)).toEqual({
      TRANS: 'Record', REV: null, TREV: 'Record', COORD: 'Record', LADMIN: 'Record', VIEW: null
    });
  });

  it('PASS-002 P-DRAFT: TRANS\'s unpublished takes', () => {
    const roles = ['TRANS', 'REV', 'TREV', 'COORD', 'LADMIN', 'VIEW'] as const;
    expect(each(roles, (who) => {
      const r = record(who, 'P-DRAFT');
      const sub = who === 'TRANS' ? 'Your parts are recorded, not published yet.' : 'Some parts are recorded, not published yet.';
      return [r.main, r.path[0] === `1. Record. ${sub}`];
    })).toEqual({
      TRANS: ['Continue recording', true], TREV: ['Record', true], COORD: ['Record', true], LADMIN: ['Record', true],
      REV: [null, true], VIEW: [null, true]
    });
  });

  it('PASS-003 P-SUBMITTED: Version 1, Peer check asked of REV', () => {
    const trans = record('TRANS', 'P-SUBMITTED');
    expect(trans.path[0]).toMatch(/^1\. Record\. Version 1/);
    expect(trans.path[1]).toMatch(new RegExp(`^2\\. Publish\\. Published .+ · asked ${name('REV')}$`));
    expect(trans.team).toEqual([
      `Peer check, asked ${name('REV')}`, 'Back translation, same time', 'Community check, after the peer check',
      'Consultant check, after the community check', 'Final approval, after the consultant check'
    ]);
    expect(each(['TRANS', 'REV', 'TREV', 'COORD', 'LADMIN', 'KEPT', 'VIEW'] as const, (who) => record(who, 'P-SUBMITTED').main)).toEqual({
      TRANS: 'Ask for the back translation', REV: 'Do the peer check', TREV: 'Do the peer check', COORD: 'Do the peer check',
      LADMIN: 'Do the peer check', KEPT: 'Do the peer check', VIEW: null
    });
  });

  it('PASS-004 P-NEEDS: feedback waiting for TRANS', () => {
    const trans = record('TRANS', 'P-NEEDS');
    expect(trans.path[2]).toBe('3. Hear the feedback. Peer check · needs changes');
    expect(trans.path[3]).toBe('4. Fix it, or keep it and say why. Then it goes back to the check');
    expect(trans.team[0]).toBe('Peer check, needs changes');
    expect(trans.main).toBe('Hear the feedback');
    expect(trans.waiting).toBeNull();
    for (const who of ['REV', 'TREV', 'COORD', 'LADMIN', 'VIEW'] as const) {
      const r = record(who, 'P-NEEDS');
      expect(r.path.join('\n'), who).not.toContain('Hear the feedback');
      expect(r.path.join('\n'), who).not.toContain('Fix it, or keep it and say why');
      expect(r.waiting, who).toBe(`Waiting on ${name('TRANS')} to answer the Peer check feedback.`);
      expect(r.team[0], who).toBe('Peer check, needs changes');
      // Fixed (2026-10-12): no check is offered while the feedback waits on the translator.
      expect(r.main, who).toBeNull();
    }
  });

  it('PASS-005 P-BT: Back translation asked of REV', () => {
    expect(record('TRANS', 'P-BT').team.slice(0, 2)).toEqual(['Peer check, looks good', `Back translation, asked ${name('REV')}`]);
    expect(each(['TRANS', 'REV', 'TREV', 'COORD', 'LADMIN', 'KEPT', 'VIEW'] as const, (who) => record(who, 'P-BT').main)).toEqual({
      TRANS: null, REV: 'Back-translate it', TREV: 'Back-translate it', COORD: 'Back-translate it', LADMIN: 'Back-translate it',
      KEPT: 'Back-translate it', VIEW: null
    });
  });

  it('PASS-006 P-CHECK: at the Consultant check checkpoint', () => {
    expect(record('TRANS', 'P-CHECK').team).toEqual([
      'Peer check, looks good', 'Back translation, looks good', 'Community check, looks good', 'Consultant check, next',
      'Final approval, after the consultant check'
    ]);
    expect(each(['TRANS', 'REV', 'TREV', 'COORD', 'LADMIN', 'KEPT', 'VIEW'] as const, (who) => record(who, 'P-CHECK').main)).toEqual({
      TRANS: 'Ask for the consultant check', REV: 'Do the consultant check', TREV: 'Do the consultant check', COORD: 'Do the consultant check',
      LADMIN: 'Do the consultant check', KEPT: 'Do the consultant check', VIEW: null
    });
  });

  it('PASS-007 P-ASIDE: Community check set aside', () => {
    for (const who of ['TRANS', 'REV', 'COORD', 'LADMIN', 'VIEW'] as const) {
      const r = record(who, 'P-ASIDE');
      expect(r.team[2], who).toBe('Community check, set aside');
      // The viewer's row is not a button: it cannot open the sheet.
      expect(r.teamOpens, who).toBe(who !== 'VIEW');
      if (who !== 'VIEW') {
        const sheet = r.sheet('community');
        expect(sheet.text, who).toBe('Community check This step is done. Community check Set aside: No community meeting this month');
        expect(sheet.buttons, who).toEqual([]);
      }
    }
    expect(each(['TRANS', 'REV', 'COORD', 'LADMIN', 'VIEW'] as const, (who) => record(who, 'P-ASIDE').main)).toEqual({
      TRANS: 'Ask for the peer check', REV: 'Do the peer check', COORD: 'Do the peer check', LADMIN: 'Do the peer check', VIEW: null
    });
  });

  it('PASS-008 P-DONE: every check complete', () => {
    for (const who of ['TRANS', 'REV', 'COORD', 'LADMIN', 'VIEW'] as const) {
      const r = record(who, 'P-DONE');
      expect(r.team, who).toEqual([
        'Peer check, looks good', 'Back translation, looks good', 'Community check, looks good', 'Consultant check, looks good', 'Final approval, looks good'
      ]);
      expect(r.main, who).toBeNull();
      const all = r.else.options.join('\n');
      for (const gone of ['Someone else should do this', 'We already did this', 'Not now']) expect(all, `${who}: ${gone}`).not.toContain(gone);
      expect(all.includes('Record a new version'), who).toBe(['TRANS', 'COORD', 'LADMIN'].includes(who));
    }
  });

  it('PASS-009 The viewer\'s record is read-only', () => {
    for (const k of ['P-SUBMITTED', 'P-NEEDS', 'P-ASIDE'] as const) {
      const r = record('VIEW', k);
      expect(r.main, k).toBeNull();
      expect(r.teamOpens, k).toBe(false);
      // Something else? offers no note; Versions offers no New version or Edit; History no Undo or Withdraw.
      expect(r.else.note, k).toBe(false);
      expect(r.else.options, k).toEqual([]);
      expect(r.versions.records, k).toBe(false);
      expect([r.can.undo, r.can.withdraw], k).toEqual([false, false]);
    }
  });

  it('PASS-021 What a step offers, per role', () => {
    const bt = 'Back translation A bilingual speaker records it in English — new content, not a verdict · the Consultant check reviews it';
    const rev = name('REV');
    const want: Record<string, string> = {
      TRANS: `Peer check and back translation Peer check Waiting on ${rev} Already happened Set aside ${bt} Send to the Back translation team Send to someone else Already happened Set aside`,
      KEPT: `Peer check and back translation Peer check Waiting on ${rev} Review it now Already happened Set aside ${bt} Back-translate it Already happened Ask someone Set aside`,
      REV: `Peer check and back translation Peer check ${name('TRANS')} asked you Review it now Already happened Set aside ${bt} Back-translate it Already happened Set aside`,
      TREV: `Peer check and back translation Peer check Waiting on ${rev} Review it now Already happened Set aside ${bt} Back-translate it Already happened Ask someone Set aside`
    };
    want['COORD'] = want['TREV']!;
    want['LADMIN'] = want['TREV']!;
    const roles = ['TRANS', 'REV', 'TREV', 'COORD', 'LADMIN', 'KEPT'] as const;
    expect(each(roles, (who) => record(who, 'P-SUBMITTED').sheet('peer').text)).toEqual(want);
    for (const who of roles) expect(record(who, 'P-SUBMITTED').sheet('peer').buttons, who).not.toContain('Move past this checkpoint…');
    expect(record('VIEW', 'P-SUBMITTED').teamOpens).toBe(false);
  });

  it('PASS-026 Something else? on a passage nobody has recorded', () => {
    for (const who of ['TRANS', 'REV', 'TREV', 'COORD', 'LADMIN', 'VIEW'] as const) {
      const r = record(who, 'P-NEW');
      expect(r.else.sub, who).toBe(`${labelOf('P-NEW')} · Record`);
      const all = r.else.options.join('\n');
      const asks = !['REV', 'VIEW'].includes(who);
      expect(all.includes('Someone else should do this Ask a person on the team, or someone outside by WhatsApp or text'), who).toBe(asks);
      for (const gone of ['We already did this', 'Not now', 'Record a new version']) expect(all, `${who}: ${gone}`).not.toContain(gone);
      // Add a note and Say it instead come with the note privilege.
      expect(r.else.note, who).toBe(who !== 'VIEW');
    }
  });

  it('PASS-027 Something else? on a recorded passage', () => {
    const got = { someone: [] as string[], already: [] as string[], notNow: [] as string[], newVersion: [] as string[], movePast: [] as string[] };
    for (const who of ['TRANS', 'KEPT', 'REV', 'TREV', 'COORD', 'LADMIN', 'VIEW'] as const) {
      const r = record(who, 'P-BT');
      // No lit step: the sub-title is the passage alone.
      expect(r.else.sub, who).toBe(labelOf('P-BT'));
      const all = r.else.options.join('\n');
      // Fixed (2026-10-12): the Back translation is already asked of REV, so nobody is offered a second request.
      if (all.includes('Someone else should do this')) got.someone.push(who);
      if (all.includes('We already did this Say when and how the back translation happened')) got.already.push(who);
      if (all.includes('Not now Set the back translation aside. Say why')) got.notNow.push(who);
      if (all.includes('Record a new version Reviews so far stay with the version they heard')) got.newVersion.push(who);
      if (all.includes('Move past a checkpoint')) got.movePast.push(who);
    }
    expect(got).toEqual({
      someone: [],
      already: ['TRANS', 'KEPT', 'REV', 'TREV', 'COORD', 'LADMIN'],
      notNow: ['TRANS', 'KEPT', 'REV', 'TREV', 'COORD', 'LADMIN'],
      newVersion: ['TRANS', 'KEPT', 'TREV', 'COORD', 'LADMIN'],
      movePast: []
    });
  });

  it('PASS-028 Someone else should record it', () => {
    for (const who of ['COORD', 'TRANS'] as const) {
      expect(record(who, 'P-S').else.ids, who).toContain('recordSomeone');
      const people = askCandidates(w.state, w.org, { languageId: w.languageId, what: 'record', me: ID[who] }).map((c) => NAMES[(Object.keys(ID) as WorldRole[]).find((r) => ID[r] === c.profileId)!]);
      const can = (['ADMIN', 'COORD', 'LADMIN', 'TRANS', 'TREV', 'KEPT'] as WorldRole[]).filter((k) => k !== who).map(name).sort();
      expect([...people].sort(), who).toEqual(can);
    }
  });

  it('PASS-029 We already did this', () => {
    for (const who of ['TRANS', 'REV'] as const) {
      expect(record(who, 'P-BT').else.options, who).toContain('We already did this Say when and how the back translation happened');
    }
  });

  it('PASS-034 What helps here: only whoever manages reference adds or hides a help', () => {
    expect(each(['TRANS', 'VIEW', 'COORD', 'LADMIN'] as const, (who) => w.session(who).can('manage_reference'))).toEqual({
      TRANS: false, VIEW: false, COORD: true, LADMIN: true
    });
  });

  it('PASS-043 Who may ask', () => {
    const asks = (who: WorldRole) => {
      const seen: string[] = [];
      seen.push(...record(who, 'P-NEW').else.options);
      const r = record(who, 'P-BT');
      seen.push(`MAIN ${r.main}`);
      if (r.teamOpens) for (const kindId of ['peer', 'community']) seen.push(r.sheet(kindId).buttons.join(' | '));
      seen.push(...r.else.options);
      return /Ask someone|Send to |Someone else should do this|MAIN Ask for/.test(seen.join('\n'));
    };
    expect(each(['TRANS', 'REV', 'TREV', 'COORD', 'LADMIN', 'KEPT', 'VIEW'] as const, asks)).toEqual({
      TRANS: true, REV: false, TREV: true, COORD: true, LADMIN: true, KEPT: true, VIEW: false
    });
  });

  it('PASS-052 A checkpoint is a hard stop', () => {
    for (const who of ['TRANS', 'REV', 'TREV', 'KEPT'] as const) {
      const r = record(who, 'P-CHECK');
      expect(r.team[4], who).toBe('Final approval, after the consultant check');
      const final = r.sheet('final');
      expect(final.text, who).toBe('Final approval Waits for the Consultant check checkpoint. Final approval Starts after the Consultant check checkpoint');
      expect(final.buttons, who).toEqual([]);
      const consultant = r.sheet('consultant');
      expect(consultant.text, who).toMatch(/^Consultant check Checkpoint — later steps wait for this one\. /);
      expect(consultant.buttons, who).not.toContain('Set aside');
      expect(consultant.buttons, who).not.toContain('Move past this checkpoint…');
      expect(r.else.options.join('\n'), who).not.toContain('Move past a checkpoint');
    }
  });

  it('PASS-055 A language lead may not move past a checkpoint', () => {
    const r = record('LADMIN', 'P-CHECK');
    expect(r.main).toBe('Do the consultant check');
    expect(r.sheet('consultant').buttons).toEqual(['Review it now', 'Already happened', 'Ask someone']);
    expect(r.team[4]).toBe('Final approval, after the consultant check');
    expect(r.else.ids).not.toContain('movePast');
    // Whoever may override is offered it, on the sheet and on Something else?.
    const coord = record('COORD', 'P-CHECK');
    expect(coord.sheet('consultant').buttons).toContain('Move past this checkpoint…');
    expect(coord.else.ids).toContain('movePast');
  });

  it('PASS-058 The Versions page, per role', () => {
    expect(each(['TRANS', 'REV', 'COORD', 'VIEW'] as const, (who) => record(who, 'P-NEEDS').versions)).toEqual({
      // TRANS may ask for the next check not waiting on the feedback (the Back translation, "best after" it); nobody else asks here.
      TRANS: { records: true, ask: 'Ask for the back translation' },
      REV: { records: false, ask: null },
      COORD: { records: true, ask: null },
      VIEW: { records: false, ask: null }
    });
  });
});
