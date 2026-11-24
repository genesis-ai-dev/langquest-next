import { studyEvictions, type StudyFileHere } from '../src/study/studyFilesModel';

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
