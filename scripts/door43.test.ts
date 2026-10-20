import { deflateRawSync } from 'node:zlib';
import { validateDoc } from '@langquest-next/core';
import { catalogEntry, choose, creditOf, iso639_3, itemIdOf, itemName, languageLabel, licenseOf, plainTitle, publisherName, type CatalogEntry } from './door43-catalog';
import { affirmationStatements, checkingFlow, checkingManual, evaluationQuestions, formQuestions, OWN_TEAM_CHECK } from './door43-flows';
import { findQuote, headingPairs, links, manualArticle, markdownHelps, parseTsv, storyQuestionFiles, tocOrder, tsvField, tsvNotes, tsvQuestions, tsvWordLinks, wordArticle, wordKey } from './door43-helps';
import { folderStories, formationStory, markdownStory, rstTitle, rstToctree, rstToMarkdown } from './door43-reading';
import { parseUsfm, verseWords } from './door43-usfm';
import { readZip } from './door43-zip';
import { partsByChapter, pictureUrl } from './door43-seed';

/**
 * unfoldingWord's published Door43 material into the library
 * (scripts/door43-seed.ts): the readers, the choice of what comes in, names,
 * licenses and credits, and the flows from the Checking Manual.
 */

describe('USFM', () => {
  const aligned = [
    '\\id TIT EN_ULT en_English_ltr', '\\usfm 3.0', '\\h Titus', '\\mt1 Titus', '\\ip An introduction that is not text.',
    '\\c 1', '\\p',
    '\\v 1 \\zaln-s |x-strong="G39720" x-content="Παῦλος" x-occurrence="1" x-occurrences="1"\\*\\w Paul|x-occurrence="1"\\w*\\zaln-e\\*,',
    '\\zaln-s |x-content="δοῦλος" x-occurrence="1"\\*\\w a|x-occurrence="1"\\w*',
    '\\w servant|x-occurrence="1"\\w*\\zaln-e\\*',
    '\\zaln-s |x-content="Θεοῦ" x-occurrence="1"\\*\\zaln-s |x-content="τοῦ" x-occurrence="1"\\*\\w of|x-occurrence="1"\\w*',
    '\\w God|x-occurrence="1"\\w*\\zaln-e\\*\\zaln-e\\*\\f + \\ft a footnote\\f*.',
    '\\ts\\*',
    '\\v 2-3 \\w Hope|x-occurrence="1"\\w* \\nd Yahweh\\nd* \\qs Selah\\qs*',
    '\\c 3', '\\d \\w A|x\\w* \\w psalm|x\\w*', '\\q1', '\\v 1 \\w Yahweh|x\\w*'
  ].join('\n');

  it('reads verses without markup, with each word\'s place and the original words it stands for', () => {
    const b = parseUsfm(aligned);
    expect(b.book).toBe('TIT');
    expect(b.name).toBe('Titus');
    const [v1, v2] = b.chapters[0]!.verses;
    expect(v1!.text).toBe('Paul, a servant of God.');
    expect(verseWords(v1!)).toEqual(['Paul', 'a', 'servant', 'of', 'God']);
    expect(v1!.groups).toEqual([[['Παῦλος:1'], [0]], [['δοῦλος:1'], [1, 2]], [['Θεοῦ:1', 'τοῦ:1'], [3, 4]]]);
    expect(v2).toMatchObject({ verse: 2, end: 3, text: 'Hope Yahweh Selah', groups: [] });
    // A psalm's title is the chapter's verse 0.
    expect(b.chapters[1]!.verses.map((v) => [v.verse, v.text])).toEqual([[0, 'A psalm'], [1, 'Yahweh']]);
  });

  it('needs an \\id', () => {
    expect(() => parseUsfm('\\c 1\n\\v 1 text')).toThrow(/id/);
  });
});

describe('TSV', () => {
  it('unquotes fields and reads line breaks', () => {
    expect(tsvField('"a ""quote"" here"')).toBe('a "quote" here');
    expect(tsvField('one\\ntwo<br>three')).toBe('one\ntwo\nthree');
    expect(parseTsv('A\tB\n\n1\n')).toEqual([{ A: '1', B: '' }]);
  });

  it('reads notes in both layouts, questions and key-word links', () => {
    const notes = tsvNotes([
      'Reference\tID\tTags\tSupportReference\tQuote\tOccurrence\tNote',
      'front:intro\tm2jl\t\t\t\t0\t# Introduction',
      '1:1\trtc9\t\trc://*/ta/man/translate/figs-abstractnouns\tκατὰ πίστιν\t1\tSee [[rc://*/ta/man/translate/figs-explicit]]',
      '2:3,5\tx\t\t\t\t\tA list',
      '1:1\tnone\t\t\t\t\t'
    ].join('\n'));
    expect(notes).toEqual([
      { id: 'm2jl', ref: 'front:intro', occurrence: 0, text: '# Introduction' },
      { id: 'rtc9', ref: '1:1', quote: 'κατὰ πίστιν', occurrence: 1, text: 'See [translate/figs-explicit](ta:translate/figs-explicit)', support: 'translate/figs-abstractnouns' },
      { id: 'x', ref: '2:3', text: 'A list' }
    ]);
    // A psalm's title, a quoted "intro", and the word for introduction in another language.
    expect(tsvNotes('Reference\tID\tNote\n3:front\ta\tTitle\n1:"intro"\tb\tIntro\n5:परीचय\tc\tIntro').map((r) => r.ref)).toEqual(['3:0', '1:intro', '5:intro']);
    const old = tsvNotes('Book\tChapter\tVerse\tID\tSupportReference\tOrigQuote\tOccurrence\tGLQuote\tOccurrenceNote\nTIT\t1\t2\tab\tfigs-metaphor\tἐλπίδι\t1\thope\tA note');
    expect(old).toEqual([{ id: 'ab', ref: '1:2', quote: 'ἐλπίδι', occurrence: 1, text: 'A note', support: 'translate/figs-metaphor' }]);
    expect(tsvQuestions('Reference\tID\tTags\tQuote\tOccurrence\tQuestion\tResponse\n1:1\ty5pp\t\t\t0\tWhy?\tBecause.\nfront\tq\tintro\t\t\t\t# Guide')).toEqual([
      { id: 'y5pp', ref: '1:1', occurrence: 0, text: 'Why?', answer: 'Because.' }
    ]);
    expect(tsvWordLinks('Reference\tID\tTags\tOrigWords\tOccurrence\tTWLink\n1:1\ttrr8\tname\tΠαῦλος\t1\trc://*/tw/dict/bible/names/paul\n1:2\tbad\t\tx\t1\tnot a link')).toEqual([
      { id: 'trr8', ref: '1:1', quote: 'Παῦλος', occurrence: 1, text: '', article: 'names/paul', tags: 'name' }
    ]);
  });
});

describe('markdown helps', () => {
  it('reads notes and questions one file per chunk, with introductions', () => {
    const files = [
      { path: 'content/tit/01/01.md', text: '# Paul\n\nThe writer.\n\n# servant\n\nOne who serves.' },
      { path: 'tit/front/intro.md', text: '# Titus\n\nAbout the book.' },
      { path: 'tit/01/00.md', text: 'Chapter one.' },
      { path: 'README.md', text: '# Readme' }
    ];
    const notes = markdownHelps(files, 'notes');
    expect(notes.get('TIT')).toEqual([
      { id: '1:1#0', ref: '1:1', quote: 'Paul', text: 'The writer.' },
      { id: '1:1#1', ref: '1:1', quote: 'servant', text: 'One who serves.' },
      { id: '1:intro#2', ref: '1:intro', text: 'Chapter one.' },
      { id: 'front:intro#3', ref: 'front:intro', text: '# Titus\n\nAbout the book.' }
    ]);
    const qs = markdownHelps([{ path: 'tit/01/02.md', text: '# Does God lie?\n\nNo.' }], 'questions');
    expect(qs.get('TIT')).toEqual([{ id: '1:2#0', ref: '1:2', text: 'Does God lie?', answer: 'No.' }]);
    const story = markdownHelps([{ path: 'content/01/00.md', text: 'Title note' }, { path: 'content/01/02.md', text: '# light\n\nIt was good.' }], 'notes', { stories: true });
    expect(story.get('OBS')).toEqual([{ id: '1:0#0', ref: '1:0', text: 'Title note' }, { id: '1:2#1', ref: '1:2', quote: 'light', text: 'It was good.' }]);
    expect(headingPairs('before\n# A\nx\n# B')).toEqual([{ heading: 'A', body: 'x' }, { heading: 'B', body: '' }]);
  });

  it('reads study questions written a story to a file', () => {
    expect(storyQuestionFiles([{ path: 'content/01.md', text: '# 01. Creation\n\n## What it says\n\n1. What did God make?\n\nEverything.\n\n2. How?\n\nBy speaking.' }])).toEqual([
      { id: '1#0', ref: '1', text: 'What did God make?', answer: 'Everything.' },
      { id: '1#1', ref: '1', text: 'How?', answer: 'By speaking.' }
    ]);
  });

  it('makes Door43\'s links the app\'s, and leaves pictures out', () => {
    expect(links('[God](../kt/god.md) and [names](rc://en/ta/man/translate/translate-names) at [1 John 1:7](rc://en/tn/help/1jn/01/07) ![p](x.jpg) [x](https://a.b)'))
      .toBe('[God](tw:kt/god) and [names](ta:translate/translate-names) at [1 John 1:7](bible:1JN 1:7)  x');
    expect(links('[next](../figs-metaphor/01.md) [other](../../checking/peer-check/01.md)')).toBe('[next](ta:figs-metaphor) [other](ta:checking/peer-check)');
  });
});

describe('articles', () => {
  it('reads a key word\'s title and body, and a manual\'s article from its files', () => {
    expect(wordArticle('bible/kt/god.md', '# God\n\n## Definition:\n\nThe one.')).toEqual({ id: 'kt/god', title: 'God', body: '## Definition:\n\nThe one.', section: 'kt' });
    expect(wordArticle('README.md', '# x')).toBeNull();
    expect(manualArticle('translate', 'figs-metaphor', { title: 'Metaphor', subTitle: 'What is a metaphor?', body: 'A body.' }))
      .toEqual({ id: 'translate/figs-metaphor', title: 'Metaphor', body: '*What is a metaphor?*\n\nA body.', section: 'translate' });
    expect(manualArticle('translate', 'x', { body: 'no title' })).toBeNull();
    expect(tocOrder({ sections: [{ title: 'A', sections: [{ title: 'B', link: 'b' }, { title: 'C', link: 'c' }] }, { title: 'D', link: 'b' }] })).toEqual(['b', 'c']);
  });
});

describe('finding a quote in the original words', () => {
  const verse = ['κατὰ', 'πίστιν', 'ἐκλεκτῶν', 'Θεοῦ', 'καὶ', 'ἐπίγνωσιν', 'ἀληθείας', 'καὶ', 'Θεοῦ'];

  it('finds a phrase, its occurrence, and parts joined by &', () => {
    expect(findQuote('κατὰ πίστιν ἐκλεκτῶν Θεοῦ,', 1, verse)).toEqual(['κατὰ:1', 'πίστιν:1', 'ἐκλεκτῶν:1', 'Θεοῦ:1']);
    expect(findQuote('καὶ Θεοῦ', 1, verse)).toEqual(['καὶ:2', 'Θεοῦ:2']);
    expect(findQuote('Θεοῦ', 2, verse)).toEqual(['Θεοῦ:2']);
    expect(findQuote('κατὰ & ἀληθείας', 1, verse)).toEqual(['κατὰ:1', 'ἀληθείας:1']);
    expect(findQuote('οὐδέν', 1, verse)).toBeNull();
    expect(findQuote('κατὰ & οὐδέν', 1, verse)).toBeNull();
    expect(findQuote('', 1, verse)).toBeNull();
  });

  it('reads Hebrew written with or without its word joiners, maqaf and accents', () => {
    const heb = ['בְּ⁠רֵאשִׁ֖ית', 'בָּרָ֣א', 'אֱלֹהִ֑ים'];
    expect(findQuote('בְּרֵאשִׁית', 1, heb)).toEqual(['בְּ⁠רֵאשִׁ֖ית:1']);
    expect(findQuote('בָּרָ֣א־אֱלֹהִ֑ים', 1, heb)).toEqual(['בָּרָ֣א:1', 'אֱלֹהִ֑ים:1']);
    expect(wordKey('Θεοῦ,')).toBe('θεοῦ');
  });
});

describe('the catalog', () => {
  const entry = (o: Partial<CatalogEntry>): CatalogEntry => ({
    owner: 'unfoldingWord', name: 'en_tn', language: 'en', subject: 'TSV Translation Notes', tag: 'v91', zipball: 'z', title: 'unfoldingWord® Translation Notes',
    ownerName: 'unfoldingWord®', ownerType: 'Organization', metadataType: 'rc', released: '', url: 'https://git.door43.org/unfoldingWord/en_tn', ...o
  });

  it('maps codes to ISO 639-3 and names languages in English', () => {
    expect(['en', 'es-419', 'pt-br', 'el-x-koine', 'ur-deva', 'mr-x-junu', 'ha', 'hbo', 'und-x-chopali', '', 'x-y'].map(iso639_3))
      .toEqual(['eng', 'spa', 'por', 'grc', 'urd', 'mar', 'hau', 'hbo', null, null, null]);
    expect(languageLabel({ language: 'hi' }, 'hin')).toBe('Hindi');
    expect(languageLabel({ language: 'lbm-x-sabar', languageTitle: 'Sabar' }, 'lbm')).toMatch(/Sabar$/);
  });

  it('takes the published helps and versions of unfoldingWord\'s Bibles, and says why it skips the rest', () => {
    const got = choose([
      entry({}),
      entry({ owner: 'joel', ownerType: 'User', name: 'en_twl', subject: 'TSV Translation Words Links', title: 'unfoldingWord® Translation Words Links' }),
      entry({ name: 'en_twl', subject: 'TSV Translation Words Links', title: 'unfoldingWord® Translation Words Links' }),
      entry({ owner: 'ru_gt', name: 'en_ult', subject: 'Aligned Bible', title: 'unfoldingWord® Literal Text' }),
      entry({ name: 'en_ult', subject: 'Aligned Bible', title: 'unfoldingWord® Literal Text' }),
      entry({ owner: 'translationCore-Create-BCS', ownerName: 'translationCore-Create-BCS', name: 'hi_glt', language: 'hi', subject: 'Aligned Bible', title: 'Literal Text' }),
      entry({ owner: 'Door43-Catalog', name: 'hi_irv', language: 'hi', subject: 'Aligned Bible', title: 'Indian Revised Version - Hindi' }),
      entry({ owner: 'bahtraku', name: 'PB-Adang', language: 'adn', subject: 'Bible', title: 'Perjanjian Baru', metadataType: 'sb' }),
      entry({ owner: 'BSOJ', ownerName: 'Bible Society', name: 'ar_tn', language: 'ar', title: 'Arabic Notes' }),
      entry({ owner: 'ar_gt', ownerName: '', name: 'ar_tn', language: 'ar', title: 'Translation Notes in Arabic' }),
      entry({ owner: 'test_user', name: 'x' }),
      entry({ name: 'en_sn' }),
      entry({ name: 'z', subject: 'Training Library' }),
      entry({ name: 'und', language: 'und-x-a' }),
      entry({ name: 'hbo_x', subject: 'Hebrew Old Testament' }),
      entry({ name: 'hbo_uhb', language: 'hbo', subject: 'Hebrew Old Testament', title: 'unfoldingWord® Hebrew Bible' })
    ]);
    const said = got.map((c) => ('skip' in c ? `${c.entry.owner}/${c.entry.name}: ${c.skip}` : `${c.entry.owner}/${c.entry.name} ${c.role}${c.competing ? ' competing' : ''}`));
    expect(said).toEqual([
      'unfoldingWord/en_tn notes',
      'joel/en_twl: a copy of unfoldingWord/en_twl',
      'unfoldingWord/en_twl wordLinks',
      'ru_gt/en_ult: a copy of unfoldingWord/en_ult',
      'unfoldingWord/en_ult bible',
      'translationCore-Create-BCS/hi_glt bible',
      "Door43-Catalog/hi_irv: not a version of unfoldingWord's Bibles",
      "bahtraku/PB-Adang: not a version of unfoldingWord's Bibles",
      'BSOJ/ar_tn notes competing',
      'ar_gt/ar_tn notes competing',
      'test_user/x: a test repository',
      'unfoldingWord/en_sn: never released for use',
      'unfoldingWord/z: subject Training Library is not taken',
      'unfoldingWord/und: language und-x-a is not a language in the table',
      "unfoldingWord/hbo_x: a Hebrew or Greek text unfoldingWord's Bibles are not aligned to",
      'unfoldingWord/hbo_uhb original'
    ]);
  });

  it('names items plainly, never with the trademark, and credits the original', () => {
    expect(plainTitle('unfoldingWord® Literal Text')).toBe('Literal Text');
    expect(publisherName({ owner: 'x', ownerName: 'unfoldingWord®' }, 'unfoldingWord')).toBe('x');
    expect(publisherName({ owner: 'x', ownerName: 'X org' }, 'BCS')).toBe('BCS');
    const taken = { entry: entry({}), role: 'notes' as const, language: 'eng' };
    expect(itemName(taken, 'English')).toBe('Translation Notes (English)');
    expect(itemName({ ...taken, competing: true }, 'Arabic', 'BSOJ')).toBe('Translation Notes (Arabic, BSOJ)');
    expect(itemName({ ...taken, role: 'bible', entry: entry({ title: 'unfoldingWord® Literal Text' }) }, 'English')).toBe('Literal Text');
    expect(itemIdOf({ owner: 'translationCore-Create-BCS', name: 'hi_tn' })).toBe('langquest.door43.translationcore-create-bcs.hi_tn');
    expect(['CC BY-SA 4.0', 'Attribution-ShareAlike 4.0 International', 'CC BY 4.0', 'CC0', 'Public Domain', 'CC BY-ND 4.0', undefined].map(licenseOf))
      .toEqual(['CC-BY-SA-4.0', 'CC-BY-SA-4.0', 'CC-BY-4.0', 'CC0-1.0', 'CC0-1.0', null, null]);
    const uw = 'On the derivative work, you must attribute the work as follows: “The original work by unfoldingWord is available from [unfoldingword.org/utn](https://www.unfoldingword.org/utn)”.';
    expect(creditOf(uw, { owner: 'unfoldingWord', ownerName: 'unfoldingWord', url: 'u' })).toBe('The original work by unfoldingWord is available from https://www.unfoldingword.org/utn. Converted for LangQuest.');
    expect(creditOf('This work is a translation. The original work by unfoldingWord is available from [https://openbiblestories.org](https://openbiblestories.org).', { owner: 'fa_gl', ownerName: 'Transform Iran', url: 'https://git.door43.org/fa_gl/azb_obs' }))
      .toBe('The original work by unfoldingWord is available from https://openbiblestories.org. This edition by Transform Iran: https://git.door43.org/fa_gl/azb_obs. Converted for LangQuest.');
    expect(creditOf(undefined, { owner: 'BSOJ', ownerName: 'Bible Society', url: 'https://g/BSOJ/ar_tn' })).toBe('The original work by Bible Society is available from https://g/BSOJ/ar_tn. Converted for LangQuest.');
  });

  it('reads a catalog row', () => {
    const e = catalogEntry({ owner: 'unfoldingWord', name: 'en_ta', language: 'en', subject: 'Translation Academy', branch_or_tag_name: 'v91', zipball_url: 'z', released: 'r',
      repo: { title: 'unfoldingWord® Translation Academy', metadata_type: 'rc', html_url: 'h', language_title: 'English', owner: { full_name: 'unfoldingWord®', type: 'Organization' } } });
    expect(e).toMatchObject({ tag: 'v91', title: 'unfoldingWord® Translation Academy', ownerName: 'unfoldingWord®', url: 'h', languageTitle: 'English' });
  });
});

describe('flows from the Checking Manual', () => {
  const toc = { sections: [
    { title: 'The Checking Process', sections: [
      { title: 'Oral Partner Check', link: 'peer-check' },
      { title: 'Team Oral Chunk Check', link: 'team-oral-chunk-check' },
      { title: 'Language Community Check', sections: [{ title: 'Checking for Clarity', link: 'language-community-check' }, { title: 'Other Methods', link: 'other-methods' }] },
      { title: 'Church Leader Check', sections: [{ title: 'Accuracy Checking by Church Leaders', link: 'church-leader-check' }] },
      { title: 'Quality Checkers', sections: [{ title: 'Steps for Quality Checkers', link: 'vol2-steps' }] },
      { title: 'Back Translation', link: 'vol2-backtranslation', sections: [] }
    ] }
  ] };
  const articles: Record<string, { title?: string; body?: string }> = {
    'peer-check': { body: 'x' }, 'team-oral-chunk-check': { body: 'x' }, 'language-community-check': { body: 'x' }, 'church-leader-check': { body: 'x' },
    'vol2-steps': { body: 'x' }, 'vol2-backtranslation': { body: 'x' },
    'community-evaluation': { title: 'Language Community Evaluation Questions', body: 'We affirm:\n\n* We checked with old and young.\n* We used the questions.\n\nPlease answer:\n\n* List a few passages.\n\n<br>\n\n* Does it flow?' },
    good: { title: 'Affirmation of Accuracy', body: 'We affirm:\n\n1. It conforms.\n1. It is accurate.\n\nNames:\n\n* Name:' }
  };
  const manual = checkingManual(toc, (slug) => articles[slug] ?? {});

  it('names each check as the manual does, and reads its two forms', () => {
    expect(manual.names).toEqual({ peer: 'Oral Partner Check', team: 'Team Oral Chunk Check', community: 'Language Community Check', leader: 'Church Leader Check', bt: 'Back Translation', quality: 'Quality Checkers' });
    expect(manual.evaluation).toEqual({ title: 'Language Community Evaluation Questions', affirm: ['We checked with old and young.', 'We used the questions.'], answer: ['List a few passages.', 'Does it flow?'] });
    expect(manual.affirmation).toEqual({ title: 'Affirmation of Accuracy', affirm: ['It conforms.', 'It is accurate.'] });
    expect(evaluationQuestions('* a\n* b')).toEqual({ affirm: ['a', 'b'], answer: [] });
    expect(affirmationStatements('nothing')).toEqual([]);
  });

  it('builds the flow Caleb chose: six checks, two must pass, questions and helps on their checks, no Bible on the community check', () => {
    const { doc, fromEnglish } = checkingFlow({ name: 'Checking Manual (English)', description: 'd', language: 'eng', languageName: 'English', manual, fallback: {},
      helps: { notes: 'tn', wordLinks: 'twl', words: 'tw', questions: 'tq', evaluation: 'ev', affirmation: 'af' }, pattern: 'door43-checking' });
    expect(fromEnglish).toEqual([]);
    expect(validateDoc(doc)).toBeNull();
    const d = doc as { kinds: { id: string; name: string }[]; steps: { kindIds: string[]; checkpoint?: boolean }[]; helps: { kindId: string; itemId: string }[]; shows: unknown[]; language: string };
    expect(d.kinds.map((k) => k.name)).toEqual(['Oral Partner Check', 'Team Oral Chunk Check', 'Language Community Check', 'Church Leader Check', 'Back Translation', 'Quality Checkers']);
    expect(d.steps.filter((s) => s.checkpoint).map((s) => s.kindIds[0])).toEqual(['door43-leader', 'door43-quality']);
    expect(d.helps.filter((h) => h.kindId === 'door43-community').map((h) => h.itemId)).toEqual(['tq', 'ev']);
    expect(d.helps.filter((h) => h.kindId === 'door43-leader').map((h) => h.itemId)).toEqual(['tn', 'twl', 'tw', 'af']);
    expect(d.shows).toEqual([{ kindId: 'door43-community', what: 'bibleText', shown: false }, { kindId: 'door43-community', what: 'bibleAudio', shown: false }]);
    expect(d.language).toBe('eng');
  });

  it('names a check an older manual lacks in LangQuest\'s own words, else in English', () => {
    const older = checkingManual({ sections: [{ title: 'Types', sections: [{ title: 'समकक्ष जाँच', link: 'peer-check' }] }] }, (slug) => (slug === 'peer-check' ? { body: 'x' } : {}));
    const hin = checkingFlow({ name: 'n', description: 'd.', language: 'hin', languageName: 'Hindi', manual: older, fallback: manual.names, helps: {}, pattern: 'p' });
    const kinds = (hin.doc as { kinds: { id: string; name: string; description: string }[] }).kinds;
    expect(kinds.find((k) => k.id === 'door43-team')).toMatchObject(OWN_TEAM_CHECK['hin']!);
    expect(kinds.find((k) => k.id === 'door43-peer')!.name).toBe('समकक्ष जाँच');
    expect(hin.fromEnglish).toEqual(['community', 'leader', 'bt', 'quality']);
    expect((hin.doc as { description: string }).description).toMatch(/LangQuest's own words/);
    const q = formQuestions({ title: 'T', language: 'eng', kindId: 'community', affirm: ['a'], answer: ['b'] });
    expect(validateDoc(q)).toBeNull();
    expect(q['questions']).toEqual([{ id: 'a1', text: 'a', type: 'yesno' }, { id: 'q1', text: 'b', type: 'text' }]);
  });
});

describe('reading material', () => {
  it('reads a story with its frames and pictures, or with no pictures', () => {
    const s = markdownStory(1, '# 1. The Creation\n\n![OBS Image](https://cdn.door43.org/obs/jpg/360px/obs-en-01-01.jpg)\n\nIn the beginning.\n\n![OBS Image](https://cdn.door43.org/obs/jpg/360px/obs-en-01-02.jpg?direct&)\n\nLight.\n\n_A Bible story from: Genesis 1-2_');
    expect(s).toEqual({ story: 1, title: 'The Creation', reference: 'A Bible story from: Genesis 1-2', frames: [
      { id: '01-01', image: 'https://cdn.door43.org/obs/jpg/360px/obs-en-01-01.jpg', text: 'In the beginning.' },
      { id: '01-02', image: 'https://cdn.door43.org/obs/jpg/360px/obs-en-01-02.jpg?direct&', text: 'Light.' }
    ] });
    expect(markdownStory(2, '# Two\n\nFirst.\n\nSecond.')!.frames.map((f) => f.id)).toEqual(['02-01', '02-02']);
    expect(markdownStory(3, 'no title')).toBeNull();
    expect(pictureUrl('https://cdn.door43.org/obs/jpg/360px/obs-en-4-2.jpg?direct&')).toBe('https://cdn.door43.org/obs/jpg/360px/obs-en-04-02.jpg');
    expect(pictureUrl('https://x/y.png?z')).toBe('https://x/y.png');
  });

  it('reads stories in translationStudio\'s folders', () => {
    expect(folderStories([{ path: '01/title.txt', text: '1. Creation' }, { path: '01/02.txt', text: 'Light.' }, { path: '01/01.txt', text: 'Beginning.' }, { path: '01/reference.txt', text: 'Gen 1' }, { path: '60/01.txt', text: 'x' }])).toEqual([{
      story: 1, title: 'Creation', reference: 'Gen 1', frames: [
        { id: '01-01', image: 'https://cdn.door43.org/obs/jpg/360px/obs-en-01-01.jpg', text: 'Beginning.' },
        { id: '01-02', image: 'https://cdn.door43.org/obs/jpg/360px/obs-en-01-02.jpg', text: 'Light.' }
      ]
    }]);
  });

  it('reads a Theological Formation story with its pictures', () => {
    const f = formationStory('---\ntitle: Open Bible Stories\nsubtitle: The Creation\nstory_num: 1\n---\n## Key Idea\n\nGod made all.\n\n######### 01-01\n![[image2.jpeg]]\n\nText.<!-- page break -->');
    expect(f).toEqual({ story: 1, title: 'The Creation', images: ['image2.jpeg'], body: '## Key Idea\n\nGod made all.\n\n**01-01**\n\n\nText.' });
    expect(formationStory('no front matter')).toBeNull();
  });

  it('reads the grammars\' reStructuredText as markdown', () => {
    const rst = ':github_url: x\n.. _adjective:\nAdjective\n=========\nSummary\n-------\n.. include:: inc.rst\nSee :ref:`noun<noun>` and ``word``.\n\n.. csv-table:: Paradigm\n  :header-rows: 1\n\n  Parsing,Hebrew\n  ms,טוֹב\n\n.. note:: Mind this\n   indented\n';
    const md = rstToMarkdown(rst, (p) => (p === 'inc.rst' ? 'Included text.' : undefined));
    expect(md).toBe('# Adjective\n\n## Summary\n\nIncluded text.\nSee noun and `word`.\n\n**Paradigm**\n\n| Parsing | Hebrew |\n| --- | --- |\n| ms | טוֹב |\n\n**Mind this**\nindented');
    expect(rstTitle(rst)).toBe('Adjective');
    expect(rstToctree('.. toctree::\n   :maxdepth: 2\n\n   front\n   adjective\nAfter')).toEqual(['front', 'adjective']);
  });
});

describe('releases and parts', () => {
  /** A zip of these files, stored and deflated, as git archives write them. */
  function zip(files: Record<string, string>): Buffer {
    const locals: Buffer[] = [];
    const central: Buffer[] = [];
    let at = 0;
    Object.entries(files).forEach(([name, text], i) => {
      const raw = Buffer.from(text);
      const method = i % 2 ? 8 : 0;
      const data = method === 8 ? deflateRawSync(raw) : raw;
      const n = Buffer.from(name);
      const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(method, 8); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(n.length, 26);
      const head = Buffer.alloc(46); head.writeUInt32LE(0x02014b50, 0); head.writeUInt16LE(method, 10); head.writeUInt32LE(data.length, 20); head.writeUInt32LE(raw.length, 24); head.writeUInt16LE(n.length, 28); head.writeUInt32LE(at, 42);
      locals.push(local, n, data);
      central.push(head, n);
      at += 30 + n.length + data.length;
    });
    const dir = Buffer.concat(central);
    const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(at, 16);
    return Buffer.concat([...locals, dir, end]);
  }

  it('reads a zip\'s files by name, UTF-8 names too', () => {
    const z = readZip(zip({ 'en_tn/manifest.yaml': 'a: 1', 'en_tn/১.md': 'বাংলা' }));
    expect(z.names).toEqual(['en_tn/manifest.yaml', 'en_tn/১.md']);
    expect(z.bytes('en_tn/১.md')!.toString('utf8')).toBe('বাংলা');
    expect(z.bytes('en_tn/manifest.yaml')!.toString('utf8')).toBe('a: 1');
    expect(z.bytes('missing')).toBeUndefined();
    expect(() => readZip(Buffer.from('not a zip at all, and long enough to look for an end record'))).toThrow(/not a zip/);
  });

  it('splits a big book of helps by whole chapters, its introduction with the first', () => {
    const big = 'x'.repeat(700 * 1024);
    const rows = [
      { id: 'f', ref: 'front:intro', text: 'intro' }, { id: 'a', ref: '1:1', text: big }, { id: 'b', ref: '2:1', text: big }, { id: 'c', ref: '2:2', text: 'small' }, { id: 'd', ref: '3:1', text: 'small' }
    ];
    expect(partsByChapter(rows).map((p) => [p.chapters, p.rows.map((r) => r.id)])).toEqual([[[0, 1], ['f', 'a']], [[2, 3], ['b', 'c', 'd']]]);
    expect(partsByChapter(rows.slice(2)).map((p) => p.chapters)).toEqual([[2, 3]]);
  });
});
