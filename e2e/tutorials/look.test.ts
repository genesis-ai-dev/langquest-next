import { lookOf, saving, steadyLine, steadyStep, tryAgain } from './look';
import { APP_LINK, OTHER_LANGUAGES, PLAYLISTS, watchLink, youtubeText } from './playlists';
import { UI_LANGUAGES } from '@langquest-next/core';
import { CHANNELS } from '../../server/youtube';

/** What the nightly filming compares (look.ts) and what it gives YouTube (playlists.ts). */

describe('a video\'s look', () => {
  it('leaves out saving and uploading, and reads a passage kept or not alike, in the film\'s language', () => {
    // Why: two dry runs on 2026-10-28, after Clean up, differed in these and nothing else (do-a-check, hear-move-delete-parts).
    expect(steadyLine('- text: 2 changes waiting to upload')).toBeNull();
    expect(steadyLine('- button "All uploaded":')).toBeNull();
    expect(steadyLine('- img "Saved":')).toBeNull();
    expect(steadyLine('- text: Todo subido', 'es')).toBeNull();
    expect(steadyLine('- img "已保存"', 'zh-Hans')).toBeNull();
    expect(steadyLine('- button "Download for offline":')).toBe(steadyLine('- button "On this device":'));
    expect(steadyLine('- button "Luke 1:1–4. Not started. For you. On this device":')).toBe(steadyLine('- button "Luke 1:1–4. Not started. For you. Download for offline":'));
    expect(steadyLine('- button "En este dispositivo":', 'es')).toBe(steadyLine('- button "Descargar para usar sin conexión":', 'es'));
    expect(steadyLine('- button "Record Part 1 again"')).not.toBeNull();
    expect(steadyStep('- img "Saving":\n  - progressbar\n- text: Lumari')).toBe(steadyStep('- text: Lumari'));
    expect(saving('- text: Lumari\n- img "Saving":\n  - progressbar')).toBe(true);
    expect(saving('- img "Saved"')).toBe(false);
    expect(saving('- img "Guardando"', 'es')).toBe(true);
  });

  it('stays the same through what changes each run though the app did not', () => {
    // Why: two dry runs of the same scripts on 2026-10-28 differed in these and nothing else.
    expect(steadyLine('- text: Email ui-mvs8gaqvc05a-admin@example.test')).toBe(steadyLine('- text: Email ui-mvs7c2889c78-admin@example.test'));
    expect(steadyLine('- radio "Peer check Ruth, Peter" [checked]:')).toBe(steadyLine('- radio "Peer check Peter, Ruth" [checked]:'));
    expect(steadyLine('  - text: Saved 2 min ago')).toBe(steadyLine('  - text: Saved Just now'));
    expect(steadyLine('- text: K3QZ 8RTM X2PL 9WQA')).toBe(steadyLine('- text: AB12 CD34 EF56 GH78'));
    expect(steadyLine('- img: 0 10 20 Sep 28 Oct 4 Oct 10')).toBe(steadyLine('- img: 0 10 20 Oct 5 Oct 11 Oct 17'));
    expect(steadyLine('- text: 3 rec Oct 28')).toBe(steadyLine('- text: 3 rec November 2'));
    // In the film's language: months and digits as that language writes them.
    expect(steadyLine('- text: ٢٨ أكتوبر', 'ar')).toBe(steadyLine('- text: ٣ نوفمبر', 'ar'));
    expect(steadyLine('- text: 28 oct.', 'fr')).toBe(steadyLine('- text: 3 nov.', 'fr'));
    expect(steadyLine('- text: Octopus', 'en')).not.toBe(steadyLine('- text: Novopus', 'en'));
    expect(steadyLine('- status: 3 waiting to upload')).toBeNull();
    expect(lookOf(['- heading "Record"\n- status: 1 waiting to upload'])).toBe(lookOf(['- heading "Record"\n- status: All uploaded']));
    // People who joined in the same second, listed either way round; and an unsteady line with what sits in it.
    const ruth = '- button "Ruth · joined Just now":\n  - text: Ruth · joined Just now\n  - img';
    const peter = '- button "Peter · joined 2 min ago":\n  - img\n  - text: Peter · joined 2 min ago';
    expect(lookOf([`${ruth}\n${peter}`])).toBe(lookOf([`${peter}\n${ruth}`]));
    expect(lookOf(['- heading "Record"\n- status: Uploading\n  - progressbar'])).toBe(lookOf(['- heading "Record"']));
  });

  it('changes with what the app shows', () => {
    expect(lookOf(['- button "Start"'])).not.toBe(lookOf(['- button "Begin"']));
    expect(lookOf(['- button "Start"', '- button "Done"'])).not.toBe(lookOf(['- button "Start"']));
    // A part moved into another holds the same words at another depth.
    expect(lookOf(['- list:\n  - listitem: Luke'])).not.toBe(lookOf(['- list:\n- listitem: Luke']));
    expect(lookOf(['- list:\n  - listitem: Luke\n- listitem: John'])).not.toBe(lookOf(['- list:\n  - listitem: John\n- listitem: Luke']));
  });

  it('is filmed again only when two tries agree it changed, or a third still differs', () => {
    // Why: on 2026-10-28 one try in three of "Record a passage" looked different, and the next two did not.
    expect(tryAgain(['film'], 'film')).toBe(false);
    expect(tryAgain(['new'], undefined)).toBe(false);
    expect(tryAgain(['new'], 'film')).toBe(true);
    expect(tryAgain(['new', 'film'], 'film')).toBe(false);
    expect(tryAgain(['new', 'new'], 'film')).toBe(false);
    expect(tryAgain(['new', 'other'], 'film')).toBe(true);
    expect(tryAgain(['new', 'other', 'third'], 'film')).toBe(false);
  });
});

describe('a video on YouTube', () => {
  it('has a playlist for each group in every app language, and a channel', () => {
    expect(Object.keys(PLAYLISTS).sort()).toEqual(UI_LANGUAGES.map((l) => l.code).sort());
    expect(Object.keys(CHANNELS).sort()).toEqual(Object.keys(PLAYLISTS).sort());
    for (const titles of Object.values(PLAYLISTS)) for (const t of Object.values(titles)) expect(t.length).toBeLessThanOrEqual(150);
    expect(Object.keys(OTHER_LANGUAGES).sort()).toEqual(Object.keys(PLAYLISTS).sort());
  });

  it('says what its voice says, each line once, then the app\'s address', () => {
    expect(youtubeText('Record a passage', ['Tap Start.', 'Speak.', 'Tap Start.'])).toEqual({
      title: 'Record a passage', description: `Tap Start.\nSpeak.\n\nLangQuest: ${APP_LINK}`
    });
  });

  it('links to the same video in every other language it is made in, by a link that outlives each version', () => {
    const { description } = youtubeText('Grabar un pasaje', ['Toca Iniciar.'], { language: 'es', tutorial: 'record-a-passage', notIn: ['ar'] });
    const links = description.split('\n\n')[2]!.split('\n');
    expect(links[0]).toBe(OTHER_LANGUAGES['es']);
    expect(links.slice(1)).toEqual(UI_LANGUAGES.filter((l) => l.code !== 'es' && l.code !== 'ar').map((l) => `${l.name}: ${watchLink(l.code, 'record-a-passage')}`));
    expect(links[1]).toBe(`English: ${APP_LINK}/v/en/record-a-passage`);
  });

  it('keeps within what YouTube takes', () => {
    const long = youtubeText(`<${'x'.repeat(120)}>`, Array.from({ length: 200 }, (_, i) => `Line ${i}: ${'ह'.repeat(20)}`), { language: 'hi', tutorial: 'record-a-passage' });
    expect(long.title).toBe('x'.repeat(100));
    expect(new TextEncoder().encode(long.description).length).toBeLessThanOrEqual(5000);
    expect(long.description).toContain(`LangQuest: ${APP_LINK}`);
    expect(long.description.endsWith(watchLink('my', 'record-a-passage'))).toBe(true);
    expect(long.description).toContain('Line 0:');
  });
});
