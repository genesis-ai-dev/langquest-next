import { validateDoc } from '@langquest-next/core';
import { describe, expect, it } from 'vitest';
import {
  aquiferRef, audioUrls, contentFiles, FIA_ATTRIBUTION as AQUIFER_ATTRIBUTION, FIA_STEP_ORDER, fiaCollection, fiaGuide, guideArticles, guideIds, htmlToMarkdown,
  languageNameOf, picturesFrom, sourceChanges, termRef, termsFrom, type AquiferArticle
} from '../../../server/fiaAquifer';
import { FIA_ATTRIBUTION, FIA_STEPS } from '../../../scripts/fia-adapter';

const V11N = 'a'.repeat(64);
const STEPS = ['Hear and Heart', 'Setting the Stage', 'Defining the Scenes', 'Embodying the Text', 'Filling the Gaps', 'Speaking the Word'];

const text: AquiferArticle = {
  content_id: 'eng-jhn-p1-v1', title: 'John 1:1–5', media_type: 'Text', index_reference: '43001001-43001005',
  associations: { passage: [{ start_ref_usfm: 'JHN 1:1', end_ref_usfm: 'JHN 1:5' }] },
  content: STEPS.map((s, i) => `<h2>${s}</h2>\n<p>Step ${i + 1} about the <data class="resource-ref" data-content-id="eng-t148-v1" data-resource-code="FIAKeyTerms">Word</data>.</p>`).join('') +
    '<div data-type="callout" data-callout-style="action"><div data-callout-section="header">Pause the drama.</div><div data-callout-section="container"><p>Ask, "How do you feel?"</p><ul><li>Happy;</li><li>Glad.</li></ul></div></div>' +
    '<p>See the <data class="resource-ref" data-content-id="a203" data-resource-code="FIAImages">sandal</data> and the <data class="resource-ref" data-content-id="c169" data-resource-code="FIAMaps">Jordan</data>, not <data class="resource-ref" data-content-id="eng-t999-v1" data-resource-code="FIAKeyTerms">this</data>.</p>'
};
const audio: AquiferArticle = {
  content_id: 'eng-jhn-p1-v1-audio', title: 'John 1:1–5', media_type: 'Audio', index_reference: '43001001-43001005',
  content: `<h3>Audio Content</h3><ul>${STEPS.map((s, i) => `<li><a href='https://s3.example/jhn/p1/s${i + 1}/v1/vbr4.mp3'>${s}</a> (1 MB)</li>`).join('')}</ul>`
};
const res = {
  terms: termsFrom([{ content_id: 'eng-t148-v1', title: 'word of God', media_type: 'Text', content: '<p><b>Word</b> usually means the word of God.</p>' }]),
  pictures: picturesFrom([{ content_id: 'a203', title: 'Sandal', media_type: 'Image', content: "<block><p><img src='https://s3.example/photos/a203/1000.jpg' alt='Image' /></p></block>" }]),
  maps: picturesFrom([{ content_id: 'c169', title: 'Jordan River', media_type: 'Image', content: "<p><img src='https://s3.example/maps/c169/2000.png' /></p>" }])
};

describe('FIA from Bible Aquifer', () => {
  it('names the steps as fia.bible\'s adapter does, so study records point at the same ids', () => {
    expect(AQUIFER_ATTRIBUTION).toBe(FIA_ATTRIBUTION);
    expect(FIA_STEP_ORDER.map((s) => ({ ...s }))).toEqual(Object.values(FIA_STEPS));
  });

  it('turns the HTML into the markdown study text reads: bold, lists, quotes, callouts and links', () => {
    expect(htmlToMarkdown('<p>One &amp; <b>two</b>.</p><p>Three</p>')).toBe('One & **two**.\n\nThree');
    expect(htmlToMarkdown('<ol><li>First</li><li><p>Second</p></li></ol><ul><li>Dot</li></ul>')).toBe('1. First\n2. Second\n\n- Dot');
    expect(htmlToMarkdown('<blockquote><p>Ask them.</p><p>Wait.</p></blockquote>')).toBe('> Ask them.\n>\n> Wait.');
    expect(htmlToMarkdown('<div data-type="callout" data-callout-style="action"><p>Stop here and discuss.</p></div>')).toBe('> [!action] Stop here and discuss.');
    expect(htmlToMarkdown('<p><data class="resource-ref" data-content-id="x1" data-resource-code="FIAKeyTerms">faith</data></p>', () => 't1')).toBe('[faith](#t1)');
    expect(htmlToMarkdown('<p><data class="resource-ref" data-content-id="x1" data-resource-code="FIAKeyTerms">faith</data></p>')).toBe('faith');
    expect(htmlToMarkdown('<p>an <em>unclosed <b>tag</p><p>next</p>')).toBe('an unclosed **tag**\n\nnext');
  });

  it('reads a passage from its association, else from its index', () => {
    expect(aquiferRef(text)).toBe('JHN 1:1-5');
    expect(aquiferRef({ ...text, associations: { passage: [{ start_ref_usfm: 'GEN 1:1', end_ref_usfm: 'GEN 2:3' }] } })).toBe('GEN 1:1-2:3');
    expect(aquiferRef({ ...text, associations: undefined, index_reference: '01012010-01012020' })).toBe('GEN 12:10-20');
    expect(aquiferRef({ ...text, associations: undefined, index_reference: '19023001' })).toBe('PSA 23:1');
    expect(aquiferRef({ ...text, associations: undefined, index_reference: 'abba' })).toBeNull();
  });

  it('makes a study@1 guide with FIA\'s six steps, their audio, and only the resources the text points at', () => {
    const doc = fiaGuide(text, audio, res, 'eng', 'English', V11N)!;
    expect(validateDoc(doc)).toBeNull();
    expect(doc).toMatchObject({ format: 'study@1', title: 'John 1:1–5', pattern: 'FIA', ref: 'JHN 1:1-5', language: 'eng', versification: V11N, deps: [V11N] });
    expect(doc.source).toBe(`FIA · English · ${FIA_ATTRIBUTION}`);
    expect(doc.steps.map((s) => [s.id, s.title, s.phase])).toEqual(FIA_STEP_ORDER.map((s, i) => [s.id, STEPS[i], s.phase]));
    expect(doc.steps.map((s) => s.audio?.url)).toEqual(STEPS.map((_, i) => `https://s3.example/jhn/p1/s${i + 1}/v1/vbr4.mp3`));
    expect(doc.steps[0]!.text).toBe('Step 1 about the [Word](#t148).');
    expect(doc.steps[5]!.text).toContain('> [!action] Pause the drama.\n>\n> Ask, "How do you feel?"\n>\n> - Happy;\n> - Glad.');
    expect(doc.steps[5]!.text).toContain('See the [sandal](#a203) and the [Jordan](#c169), not this.');
    expect(doc.resources).toEqual([
      { ref: 'a203', kind: 'media', title: 'Sandal', media: [{ id: 'a203', kind: 'photo', title: 'Sandal', caption: '', url: 'https://s3.example/photos/a203/500.jpg' }] },
      { ref: 'c169', kind: 'map', title: 'Jordan River', media: [{ id: 'c169', kind: 'map', title: 'Jordan River', caption: '', url: 'https://s3.example/maps/c169/500.png' }] },
      { ref: 't148', kind: 'term', title: 'word of God' }
    ]);
    expect(doc.terms).toEqual([{ id: 't148', term: 'word of God', body: 'Word usually means the word of God.' }]);
  });

  it('credits the adaptation in every language but English', () => {
    expect(fiaGuide({ ...text, content_id: 'fra-jhn-p1-v1' }, undefined, res, 'fra', 'Français', V11N)!.source).toBe(`FIA · Français · ${FIA_ATTRIBUTION} · adapted by Mission Mutual (Bible Aquifer)`);
  });

  it('pairs each guide with its audio, and lists them in Bible order in one collection per language', () => {
    expect(guideArticles([audio, text])).toEqual([{ text, audio }]);
    const c = fiaCollection('eng', 'English', V11N, [
      { ref: 'JHN 1:6-8', title: 'John 1:6–8', doc: 'c'.repeat(64) },
      { ref: 'GEN 1:1-2:3', title: 'Genesis 1:1–2:3', doc: 'b'.repeat(64) }
    ]);
    expect(c.itemId).toBe('fia.eng');
    expect(c.name).toBe('FIA study guides (English)');
    expect(c.doc.entries.map((e) => e.ref)).toEqual(['GEN 1:1-2:3', 'JHN 1:6-8']);
    expect(validateDoc(c.doc)).toBeNull();
  });

  it('reads a folder\'s files and its language\'s name', () => {
    const meta = { scripture_burrito: { languages: [{ tag: 'fr', name: { fr: 'Français' } }], ingredients: { 'json/02.content.json': {}, 'md/01.md': {}, 'json/01.content.json': {} } } };
    expect(contentFiles(meta)).toEqual(['json/01.content.json', 'json/02.content.json']);
    expect(languageNameOf(meta, 'fra')).toBe('Français');
    expect(languageNameOf({}, 'fra')).toBe('fra');
    expect(termRef('swh-t61-v2')).toBe('t61');
    expect(termRef('a203')).toBeNull();
    expect(audioUrls(undefined)).toEqual([]);
  });

  it('names a folder\'s guides from its metadata, without their audio', () => {
    expect(guideIds({ article_metadata: { 'eng-jhn-p2-v1': {}, 'eng-jhn-p1-v1.1': {}, 'eng-jhn-p1-v1.1-audio': {} } })).toEqual(['eng-jhn-p1-v1.1', 'eng-jhn-p2-v1']);
    expect(guideIds({})).toEqual([]);
  });

  it('counts guides for new passages and guides at a new version; dropped guides are not news', () => {
    const before = ['eng-jhn-p1-v1', 'eng-jhn-p2-v1', 'eng-jhn-p3-v2'];
    expect(sourceChanges(before, before)).toEqual({ added: 0, updated: 0 });
    expect(sourceChanges(before, ['eng-jhn-p1-v1.1', 'eng-jhn-p2-v1', 'eng-jhn-p4-v1', 'eng-jhn-p5-v1'])).toEqual({ added: 2, updated: 1 });
    expect(sourceChanges([], ['eng-jhn-p1-v1'])).toEqual({ added: 1, updated: 0 });
  });
});
