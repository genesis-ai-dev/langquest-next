import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fiaStudyDoc } from '../../../scripts/fia-adapter';
import { guideFromDoc } from '../src/study/guideMatch';
import type { StudyResource } from '../src/study/guides';
import { guidePictures } from '../src/study/picturesModel';
import { inlineParts, studySections } from '../src/study/text';

// LAN-222: "it says to stop and look at a map or a boat; there is no place
// to do that on the page". A step showed a picture or map only under the
// part whose text links it, and FIA's text often only names it.

const pic = (ref: string, title: string, kind: StudyResource['kind'] = 'media', url = `https://fia.example/${ref}.jpg`): StudyResource => ({
  ref, kind, title, media: [{ id: ref, kind: kind === 'map' ? 'map' : 'photo', title, caption: '', url }]
});
const BOAT = pic('m4', 'Boat');
const LAKE = pic('m93', 'Sea of Galilee');
const MAP = pic('c195', 'Sea of Galilee with Capernaum and Decapolis', 'map');
const NET = pic('m19', 'Fishing Net');
const OX = { ref: 'm331', kind: 'media', title: 'Ox', media: [] } satisfies StudyResource;
const TERM = { ref: 't17', kind: 'term', title: 'disciple' } satisfies StudyResource;

/** The titles of the cards under each section of a step, by the section's first four words, and after the step's text. */
function cards(guide: { steps: { id: string; text: string }[]; resources: StudyResource[] }, stepId: string, read = true) {
  const g = guidePictures(guide);
  const sp = g.step(stepId, read);
  const step = guide.steps.find((s) => s.id === stepId)!;
  const under = Object.fromEntries(studySections(step.text).filter((sec) => sp.bySection[sec.id])
    .map((sec) => [inlineParts(sec.text).map((p) => p.text).join('').split(/\s+/).slice(0, 4).join(' '), sp.bySection[sec.id]!.map((r) => r.title)]));
  return { under, end: sp.end.map((r) => r.title) };
}

describe('pictures and maps in a study step (LAN-222)', () => {
  const resources = [BOAT, LAKE, MAP, NET, OX, TERM];

  it('shows a picture or map under the part that asks to look at it, when the part names it without a link', () => {
    // Mark 4:35-41 in FIA's English, step 2: no links.
    const guide = {
      resources,
      steps: [{
        id: 'stage',
        text: [
          'Jesus is already sitting in the boat, where he has been sitting all day.',
          '',
          'Stop and show your translation team a map of the lake. Show them Capernaum and the Decapolis. Show a picture of the boat. Pause the recording here.',
          '',
          'Stop and show a picture of the Sea of Galilee showing the high mountains. Pause the recording here.',
          '',
          'Stop and discuss: Show a picture of the boat again.'
        ].join('\n')
      }]
    };
    expect(cards(guide, 'stage')).toEqual({
      under: {
        // The part that asks, not the story's first mention of a boat; the boat once in the step.
        'Stop and show your': ['Boat', 'Sea of Galilee with Capernaum and Decapolis'],
        'Stop and show a': ['Sea of Galilee']
      },
      // The net is in no step and asked for by none: it comes after the text. The ox has no picture to show.
      end: ['Fishing Net']
    });
  });

  it('keeps linked pictures under the part that links them, and does not show them again by name in that step', () => {
    const guide = {
      resources,
      steps: [{ id: 'scenes', text: '> [!action]\n> Stop and show your translators the photo of the [boat](#m4) again. Look at the boat and the fishing net.\n\nStop here and look at the boat.' }]
    };
    expect(cards(guide, 'scenes').under).toEqual({ 'Stop and show your': ['Boat', 'Fishing Net'] });
  });

  it('finds what a link means when its id is padded or missing, and reads a link to nothing as plain words', () => {
    const fig = pic('m129', 'Fig Tree');
    const g = guidePictures({ resources: [fig, TERM, MAP], steps: [] });
    expect(g.resolve('t017', 'disciples')).toBe(TERM);
    // FIA's Genesis 3 links its fig tree by an id the passage does not carry.
    expect(g.resolve('m446', 'fig tree and a fig leaf')).toBe(fig);
    expect(g.resolve('c323', 'Galilee')).toBe(MAP);
    expect(g.resolve('c537', 'the kingdom of Israel and western Aram')).toBeNull();
    expect(g.resolve('t283', 'defile')).toBeNull();
  });

  it('after the text: what no step shows, or, when a part asks for something it cannot be matched to, all the step does not show', () => {
    const guide = {
      resources: [BOAT, NET, MAP],
      steps: [
        { id: 'hear', text: 'Listen to the passage.' },
        { id: 'stage', text: 'Stop here and look at a picture of a boat.\n\nStop here and look at a map of the lake.' },
        { id: 'gaps', text: 'Stop here and look at a picture of the [boat](#m4).' }
      ]
    };
    // The net and the map are named nowhere: every step has them after its text.
    expect(cards(guide, 'hear')).toEqual({ under: {}, end: ['Fishing Net', 'Sea of Galilee with Capernaum and Decapolis'] });
    // "a map of the lake" names no map the app can find, so the step has every picture it does not show.
    expect(cards(guide, 'stage')).toEqual({ under: { 'Stop here and look': ['Boat'] }, end: ['Fishing Net', 'Sea of Galilee with Capernaum and Decapolis'] });
    expect(cards(guide, 'gaps').end).toEqual(['Fishing Net', 'Sea of Galilee with Capernaum and Decapolis']);
  });

  it('shows a step that is heard but not read its own pictures after it, since its text does not show', () => {
    const guide = { resources: [BOAT, NET], steps: [{ id: 'stage', text: 'Stop here and look at a picture of a boat.' }] };
    expect(cards(guide, 'stage', false)).toEqual({ under: {}, end: ['Boat', 'Fishing Net'] });
  });

  it("names pictures in FIA's other languages, and words that start like a look word do not ask to look", () => {
    const hindi = { resources: [pic('m4', 'नाव')], steps: [{ id: 's', text: 'यहाँ रुकें और नाव की तस्वीर देखें।' }] };
    expect(cards(hindi, 's').under).toEqual({ 'यहाँ रुकें और नाव': ['नाव'] });
    const chinese = { resources: [pic('m4', '渔船')], steps: [{ id: 's', text: '请在这里暂停，并展示一张渔船的图片。' }] };
    expect(cards(chinese, 's').under).toEqual({ '请在这里暂停，并展示一张渔船的图片。': ['渔船'] });
    const imagine = { resources: [BOAT], steps: [{ id: 's', text: 'Imagine you are in the boat.' }] };
    expect(cards(imagine, 's')).toEqual({ under: {}, end: ['Boat'] });
  });

  it("gives FIA's Portuguese Genesis 2, which links nothing, a place to see each picture and the map", () => {
    const json = JSON.parse(readFileSync(join(import.meta.dirname, '../../../library/fia/pericope_gen-p2.json'), 'utf8'));
    const doc = fiaStudyDoc(json, 'por', 'eng-versification')!;
    const guide = guideFromDoc('gen', doc);
    const pictureLinks = guide.steps.flatMap((s) => studySections(s.text)).flatMap((sec) => inlineParts(sec.text)).filter((p) => p.type === 'link' && !p.ref.startsWith('t'));
    expect(pictureLinks).toEqual([]);
    const stage = cards(guide, 'stage');
    const visual = guide.resources.filter((r) => r.kind !== 'term' && r.media?.some((m) => m.url));
    expect(visual.length).toBeGreaterThan(0);
    expect(new Set([...Object.values(stage.under).flat(), ...stage.end])).toEqual(new Set(visual.map((r) => r.title)));
    // English links all of them: nothing is added after its steps.
    const english = guideFromDoc('gen', fiaStudyDoc(json, 'eng', 'eng-versification')!);
    expect(cards(english, 'stage').end).toEqual([]);
  });
});
