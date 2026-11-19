import { lookOf, saving, steadyLine, steadyStep, tryAgain } from './look';
import { existsSync, readFileSync } from 'node:fs';
import { APP_LINK, firstSentence, NAMED_VIDEOS, OTHER_LANGUAGES, PLAYLISTS, watchLink, youtubeText } from './playlists';
import { videosNamed } from './tutorial';
import { TUNE, tuneChain } from './tune';
import { TUTORIALS } from './all';
import { UI_LANGUAGES } from '@langquest-next/core';
import { CHANNELS, downloadLink, WORDS } from '../../server/youtube';

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
    // Me counting what the phone keeps reads as it settles: one dry run read it at "Checking this device…" (2026-11-13).
    expect(saving('- button "Sync and offline Checking this device…":')).toBe(true);
    expect(saving('- button "جاهز للعمل بدون اتصال جارٍ فحص هذا الجهاز…":', 'ar')).toBe(true);
    // An English film that shows the app in Arabic for a while (choose-the-app-language).
    expect(saving('- button "جاهز للعمل بدون اتصال جارٍ فحص هذا الجهاز…":')).toBe(true);
    expect(saving('- button "Sync and offline 12 passages on this device":')).toBe(false);
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
  it('has a playlist for each group and a channel in every app language', () => {
    expect(Object.keys(PLAYLISTS).sort()).toEqual(UI_LANGUAGES.map((l) => l.code).sort());
    expect(UI_LANGUAGES.map((l) => l.code).filter((c) => !Object.hasOwn(CHANNELS, c))).toEqual([]);
    for (const titles of Object.values(PLAYLISTS)) for (const t of Object.values(titles)) expect(t.length).toBeLessThanOrEqual(150);
    expect(Object.keys(OTHER_LANGUAGES).sort()).toEqual(Object.keys(PLAYLISTS).sort());
  });

  it('says in one line what it shows, then its links, each group apart, never what its voice says line by line (decisions.md 191)', () => {
    expect(youtubeText('Record a passage', "Here's how to record a passage.")).toEqual({
      title: 'Record a passage', description: `Here's how to record a passage.\n\nLangQuest: ${APP_LINK}`
    });
    const { description } = youtubeText('Grabar un pasaje', 'Así se graba un pasaje.', { language: 'es', tutorial: 'record-a-passage' });
    const [summary, links, others] = description.split('\n\n');
    expect(summary).toBe('Así se graba un pasaje.');
    expect(links!.split('\n')).toEqual([
      `${WORDS.es.download} ${APP_LINK}/v/es/record-a-passage.mp4`, `${WORDS.es.allVideos} ${APP_LINK}/videos?lang=es`, `LangQuest: ${APP_LINK}`
    ]);
    expect(others!.split('\n')[0]).toBe(OTHER_LANGUAGES['es']);
    // Every link starts with https://, or YouTube does not make it one.
    for (const line of description.split('\n').filter((l) => l.includes('langquest.org'))) expect(line).toMatch(/ https:\/\/next\.langquest\.org\S*$/);
  });

  it("takes the first sentence of the voice's first line, in every script", () => {
    expect(firstSentence("Here's how to record a passage. My Work shows what's next for you.")).toBe("Here's how to record a passage.");
    expect(firstSentence('这是录制段落的方法。“我的工作”显示接下来要做什么。')).toBe('这是录制段落的方法。');
    expect(firstSentence('किसी अंश को रिकॉर्ड करने का तरीका यह है। मेरा काम दिखाता है।')).toBe('किसी अंश को रिकॉर्ड करने का तरीका यह है।');
    expect(firstSentence('ክፍልን እንዴት እንደሚቀዱ እነሆ። ሥራዬ ቀጣዩን ያሳያል።')).toBe('ክፍልን እንዴት እንደሚቀዱ እነሆ።');
    // Thai marks no sentence's end: the line is given whole.
    expect(firstSentence('วิธีบันทึกเสียงข้อพระคัมภีร์ งานของฉันแสดงสิ่งที่ต้องทำต่อ')).toBe('วิธีบันทึกเสียงข้อพระคัมภีร์ งานของฉันแสดงสิ่งที่ต้องทำต่อ');
    expect(firstSentence('Version 1.2 is out.')).toBe('Version 1.2 is out.');
  });

  it('links to the same video in every other language it is made in, by a link that outlives each version', () => {
    const { description } = youtubeText('Grabar un pasaje', 'Toca Iniciar.', { language: 'es', tutorial: 'record-a-passage', notIn: ['ar'] });
    const links = description.split('\n\n')[2]!.split('\n');
    expect(links[0]).toBe(OTHER_LANGUAGES['es']);
    expect(links.slice(1)).toEqual(UI_LANGUAGES.filter((l) => l.code !== 'es' && l.code !== 'ar').map((l) => `${l.name}: ${watchLink(l.code, 'record-a-passage')}`));
    expect(links[1]).toBe(`English: ${APP_LINK}/v/en/record-a-passage`);
    expect(downloadLink('zh-Hans', 'record-a-passage')).toBe(`${APP_LINK}/v/zh-Hans/record-a-passage.mp4`);
    expect(Object.keys(WORDS).sort()).toEqual(Object.keys(PLAYLISTS).sort());
  });

  it('credits the tune last, only in a video that has it (docs/decisions/2026-11-18-tune-on-introductory-videos.md)', () => {
    const credited = youtubeText('How LangQuest works', 'This is LangQuest.', { language: 'en', tutorial: 'how-langquest-works' }, TUNE.credit).description.split('\n\n');
    expect(credited[credited.length - 1]).toBe(TUNE.credit);
    expect(credited.slice(0, -1).join('\n\n')).toBe(youtubeText('How LangQuest works', 'This is LangQuest.', { language: 'en', tutorial: 'how-langquest-works' }).description);
    // The licence asks for the tune's name, its author, its source and the licence.
    for (const part of ['Carefree', 'Kevin MacLeod', 'incompetech.com', 'https://creativecommons.org/licenses/by/4.0/']) expect(TUNE.credit).toContain(part);
    expect(existsSync(TUNE.file)).toBe(true);
    // A general, introductory video has the tune. A video of one task or one setting has none.
    expect(Object.values(TUTORIALS).filter((t) => t.tune).map((t) => t.id)).toEqual(['how-langquest-works', 'the-path-of-a-passage']);
  });

  it('never says that passages all take the same path or the same checks: each language chooses its own', () => {
    // Why: Caleb, 2026-11-18, on "The path of a passage" as first written: it gave "the impression that every single passage
    // that's submitted in LangQuest by every language and every organization goes through the exact same checks, and that's
    // the exact opposite of what we're trying to communicate".
    const said = Object.values(TUTORIALS).flatMap((t) => t.steps.flatMap((s) => (s.say ? [s.say] : [])));
    expect(said.filter((line) => /\bthe same (path|checks?|steps)\b/i.test(line))).toEqual([]);
    // A video that shows a passage's checks says whose they are.
    for (const id of ['how-langquest-works', 'the-path-of-a-passage']) {
      expect(TUTORIALS[id]!.steps.some((s) => /its language chose|Each language in LangQuest chooses/.test(s.say ?? ''))).toBe(true);
    }
  });

  it('links each video that its voice names, straight after its first line (docs/decisions/2026-11-19-a-video-links-the-videos-it-names.md)', () => {
    const names = [{ tutorial: 'record-a-passage', title: 'Grabar un pasaje' }, { tutorial: 'do-a-check', title: 'Hacer una revisión' }];
    const groups = youtubeText('Crea tu cuenta', 'Así se empieza.', { language: 'es', tutorial: 'create-your-account-and-look-around', names }).description.split('\n\n');
    expect(groups[0]).toBe('Así se empieza.');
    expect(groups[1]!.split('\n')).toEqual([NAMED_VIDEOS['es'], `Grabar un pasaje: ${APP_LINK}/v/es/record-a-passage`, `Hacer una revisión: ${APP_LINK}/v/es/do-a-check`]);
    expect(groups[2]).toContain(`LangQuest: ${APP_LINK}`);
    // A video that names none has no such group.
    expect(youtubeText('Grabar un pasaje', 'Toca Iniciar.', { language: 'es', tutorial: 'record-a-passage', names: [] }).description).not.toContain(NAMED_VIDEOS['es']);
    expect(Object.keys(NAMED_VIDEOS).sort()).toEqual(Object.keys(PLAYLISTS).sort());
  });

  it('never sends the viewer to "another video": a line that speaks of a video names it, says where its link is, and the script links it', () => {
    // Why: Caleb, 2026-11-19: "Our videos need to say more than just look at how to do this in another video [...] the video
    // should say, "This video is linked in the description below," and then the video creation pipeline should actually put
    // a link to that video in the description for that video."
    for (const tutorial of Object.values(TUTORIALS)) {
      for (const step of tutorial.steps) {
        const where = `${tutorial.id}: "${step.say}"`;
        if (/\bvideos?\b/i.test(step.say ?? '')) {
          expect(step.videos?.length, where).toBeGreaterThan(0);
          expect(step.say, where).toMatch(/linked in the description below\.$/);
          expect(step.say, where).not.toMatch(/\b(another|next|other) videos?\b/i);
        }
        if (!step.videos) continue;
        expect(step.say, where).toMatch(/linked in the description below\.$/);
        // One or two videos are named by their titles. More are counted, not listed: the description lists them.
        if (step.videos.length <= 2) for (const id of step.videos) expect(step.say, where).toContain(`'${TUTORIALS[id]?.title}'`);
        for (const id of step.videos) {
          const named = TUTORIALS[id];
          // It is a video on YouTube, another one, made in every language this one is made in.
          expect(named, `${where} names ${id}`).toBeDefined();
          expect(id, where).not.toBe(tutorial.id);
          expect(named!.staff, `${where} names ${id}`).toBeUndefined();
          expect((named!.notIn ?? []).filter((l) => !tutorial.notIn?.includes(l)), `${where} names ${id}`).toEqual([]);
        }
      }
    }
    // In each language the line says the named video's title as that language's title has it (translate-lines.ts tells Gemini the titles).
    for (const { code } of UI_LANGUAGES) {
      const file = `e2e/tutorials/lines/${code}.json`;
      if (code === 'en' || !existsSync(file)) continue;
      const lines = JSON.parse(readFileSync(file, 'utf8')) as Record<string, string>;
      for (const step of Object.values(TUTORIALS).flatMap((t) => t.steps)) {
        if (!step.videos || step.videos.length > 2 || !lines[step.say!]) continue;
        for (const id of step.videos) if (lines[TUTORIALS[id]!.title]) expect(lines[step.say!], `${code}: "${step.say}"`).toContain(lines[TUTORIALS[id]!.title]);
      }
    }
    expect(videosNamed(TUTORIALS['the-path-of-a-passage']!)).toEqual(['record-a-passage', 'finish-and-ask-for-a-check', 'do-a-check', 'answer-feedback']);
    expect(videosNamed(TUTORIALS['create-your-account-and-look-around']!)).toEqual(['start-an-organization', 'record-a-passage', 'do-a-check']);
    expect(videosNamed(TUTORIALS['do-a-check']!)).toEqual([]);
  });

  it('plays the tune quietly under the voice, and takes it out as the film ends', () => {
    expect(TUNE.decibels).toBeLessThanOrEqual(-12);
    expect(tuneChain(27, 155.5, 'tune')).toBe('[27:a]aresample=48000,volume=-12dB,afade=t=in:st=0:d=1.2,afade=t=out:st=151.90:d=3.6[tune]');
    expect(tuneChain(3, 2, 'tune')).toContain('afade=t=out:st=0.00:d=3.6');
  });

  it('keeps within what YouTube takes', () => {
    const long = youtubeText(`<${'x'.repeat(120)}>`, 'ह'.repeat(3000), { language: 'hi', tutorial: 'record-a-passage' });
    expect(long.title).toBe('x'.repeat(100));
    expect(new TextEncoder().encode(long.description).length).toBeLessThanOrEqual(5000);
    expect(long.description.startsWith('ह')).toBe(true);
    expect(long.description).toContain(`LangQuest: ${APP_LINK}`);
    expect(long.description).toContain(downloadLink('hi', 'record-a-passage'));
    expect(long.description.endsWith(watchLink('tl', 'record-a-passage'))).toBe(true);
  });
});
