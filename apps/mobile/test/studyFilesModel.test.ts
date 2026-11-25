import { failedNow, guideFilesOf, studyEvictions, studySourceNow, type StudyFileHere } from '../src/study/studyFilesModel';

const MB = 1024 * 1024;
const file = (name: string, mb: number, at: number): StudyFileHere => ({ name, bytes: mb * MB, at });

// Study files were never cleared: a book let go kept its pictures and step audio for good (Carl, 2026-11-23).
describe('which study files a phone clears', () => {
  const files = [file('old.jpg', 40, 1), file('mid.mp3', 40, 2), file('new.jpg', 40, 3), file('kept.mp3', 500, 0)];
  const needed = new Set(['kept.mp3']);

  it('clears nothing while files no kept passage needs fit their spare room and the device is not short', () => {
    expect(studyEvictions(files, needed, { spareBytes: 120 * MB, shortBytes: 0, since: 0 })).toEqual([]);
    expect(studyEvictions(files, needed, { spareBytes: 200 * MB, shortBytes: -10 * MB, since: 0 })).toEqual([]);
  });

  it('clears files no kept passage needs, oldest first, until they fit their spare room', () => {
    expect(studyEvictions(files, needed, { spareBytes: 80 * MB, shortBytes: 0, since: 0 })).toEqual(['old.jpg']);
    expect(studyEvictions(files, needed, { spareBytes: 0, shortBytes: 0, since: 0 })).toEqual(['old.jpg', 'mid.mp3', 'new.jpg']);
  });

  it('clears them too when the device is short of the room it keeps for recording, however little they are', () => {
    expect(studyEvictions(files, needed, { spareBytes: 1000 * MB, shortBytes: 50 * MB, since: 0 })).toEqual(['old.jpg', 'mid.mp3']);
  });

  it('never clears a file a kept passage needs, however short the device is', () => {
    expect(studyEvictions(files, needed, { spareBytes: 0, shortBytes: 10_000 * MB, since: 0 })).not.toContain('kept.mp3');
    expect(studyEvictions([file('kept.mp3', 500, 0)], needed, { spareBytes: 0, shortBytes: 10_000 * MB, since: 0 })).toEqual([]);
  });

  it('never clears a file written before the build that keeps each language\'s list: a language not opened since may need it', () => {
    expect(studyEvictions(files, needed, { spareBytes: 0, shortBytes: 10_000 * MB, since: 2 })).toEqual(['mid.mp3', 'new.jpg']);
    expect(studyEvictions(files, needed, { spareBytes: 0, shortBytes: 0, since: 10 })).toEqual([]);
  });
});

// The 2026-11-24 review (item 25): a picture or audio that arrives while a guide is open is used without reopening it.
describe('an open guide takes up a study file that arrives', () => {
  const web = 'https://fia.bible/a.mp3';
  const here = 'file:///documents/study/abc.mp3';

  it('the audio switches to the phone\'s copy once it is not playing, and another step starts over at once', () => {
    const src = { address: web, url: web };
    expect(studySourceNow(src, web, web, false)).toBe(src);
    // Arrived while playing: the clip from the web is not cut off.
    expect(studySourceNow(src, web, here, true)).toBe(src);
    expect(studySourceNow(src, web, here, false)).toEqual({ address: web, url: here });
    // Another step's audio, even while playing.
    expect(studySourceNow(src, 'https://fia.bible/b.mp3', 'https://fia.bible/b.mp3', true)).toEqual({ address: 'https://fia.bible/b.mp3', url: 'https://fia.bible/b.mp3' });
  });

  it('a picture that failed is tried again once a copy arrives', () => {
    expect(failedNow(undefined, web)).toBe(false);
    expect(failedNow(web, web)).toBe(true);
    expect(failedNow(web, here)).toBe(false);
  });
});

describe('the files a team\'s own guide names by hash', () => {
  it('lists step audio, pictures, maps and glossary audio once each, never a film', () => {
    const f = (c: string, format = 'jpg') => ({ hash: c.repeat(64), format });
    const guide = {
      steps: [{ audio: { file: f('1', 'm4a') } }, { audio: {} }, { audio: { file: f('1', 'm4a') } }],
      resources: [{ media: [{ kind: 'photo', file: f('2') }, { kind: 'video', file: f('3', 'mp4') }, { kind: 'map', file: f('4') }] }, {}],
      glossary: { t1: { audioFile: f('5', 'webm') }, t2: {} }
    };
    expect(guideFilesOf(guide).map((x) => x.hash[0])).toEqual(['1', '2', '4', '5']);
  });
});
