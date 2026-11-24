import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { chosenOnIntake, filmName, filmProblem, heldFilmName, heldStillName, readManifest, takeInFilms, type Film, type IntakeReport } from '../../../server/tutorialIntakeModel';
import type { ChannelLanguage } from '../../../server/youtube';

/** The intake job (server/tutorialIntakeModel.ts) against a release and an R2 kept in memory. */

const fresh = (): IntakeReport => ({ languages: 0, films: 0, brought: 0, listed: 0, failed: 0, firstError: null });
const bytesOf = (text: string) => new TextEncoder().encode(text);
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const film = (tutorial: string, text: string, over: Partial<Film> = {}): Film => ({
  tutorial, sha256: sha(text), bytes: bytesOf(text).length, seconds: 90, title: tutorial, description: 'Lo que dice el video.',
  playlist: 'Traductores', position: 3, look: sha(`look ${text}`), ...over
});

function world(manifests: Partial<Record<ChannelLanguage, unknown>>, files: Record<string, string>) {
  const r2 = new Map<string, Uint8Array>();
  const listed = new Set<string>();
  const downloads: string[] = [];
  const deps = {
    manifest: async (language: ChannelLanguage) => manifests[language] ?? null,
    stored: async (language: ChannelLanguage, f: Film) => r2.has(`${language}/${f.tutorial}/${f.sha256}`),
    download: async (language: ChannelLanguage, f: Film) => {
      const name = filmName(language, f.tutorial, f.sha256);
      downloads.push(name);
      if (files[name] === undefined) throw Object.assign(new Error('download_404'), { name: 'download_404' });
      return bytesOf(files[name]!);
    },
    put: async (language: ChannelLanguage, f: Film, bytes: Uint8Array) => { r2.set(`${language}/${f.tutorial}/${f.sha256}`, bytes); },
    made: async (language: ChannelLanguage, f: Film) => {
      const key = `${language}/${f.tutorial}/${f.sha256}`;
      if (listed.has(key)) return false;
      listed.add(key);
      return true;
    },
    stopping: () => false,
    wait: async () => {}
  };
  return { deps, r2, listed, downloads };
}

describe('tutorial intake', () => {
  it('brings each film R2 lacks and lists it once; a second run changes nothing', async () => {
    const record = film('record-a-passage', 'grabar');
    const keyWords = film('key-words', 'palabras', { position: 30 });
    const w = world({ es: { language: 'es', films: [record, keyWords] } }, {
      [filmName('es', 'record-a-passage', record.sha256)]: 'grabar', [filmName('es', 'key-words', keyWords.sha256)]: 'palabras'
    });
    expect(await takeInFilms(w.deps, fresh())).toEqual({ languages: 1, films: 2, brought: 2, listed: 2, failed: 0, firstError: null });
    expect([...w.r2.keys()]).toEqual([`es/record-a-passage/${record.sha256}`, `es/key-words/${keyWords.sha256}`]);
    expect(await takeInFilms(w.deps, fresh())).toEqual({ languages: 1, films: 2, brought: 0, listed: 0, failed: 0, firstError: null });
    expect(w.downloads).toHaveLength(2);
  });

  it('brings a held film and its wrong stills for the dashboard, never lists them, and checks their hashes (2026-11-24)', async () => {
    const record = film('record-a-passage', 'grabar');
    const still = sha('still one');
    const statusJson = { language: 'es', videos: [
      { tutorial: 'record-a-passage', tonight: 'filmed' },
      { tutorial: 'key-words', tonight: 'held', heldFilm: { sha256: sha('held film'), bytes: bytesOf('held film').length, stills: [
        { t: 9, says: '', picture: `${still}.jpg`, bytes: bytesOf('still one').length, problems: ['Wrong.'], boxes: [null] },
        { t: 21, says: '', picture: `${sha('still two')}.jpg`, bytes: 9, problems: ['Also wrong.'], boxes: [null] }
      ] } }
    ] };
    const w = world({ es: { language: 'es', films: [record] } }, { [filmName('es', 'record-a-passage', record.sha256)]: 'grabar' });
    const assets: Record<string, string> = {
      [heldFilmName('es', 'key-words', sha('held film'))]: 'held film', [heldStillName('es', still)]: 'still one', [heldStillName('es', sha('still two'))]: 'not still two'
    };
    const pictures = new Map<string, Uint8Array>();
    const deps = { ...w.deps, held: {
      status: async (language: ChannelLanguage) => (language === 'es' ? statusJson : null),
      asset: async (name: string) => { if (assets[name] === undefined) throw Object.assign(new Error('x'), { name: 'held_download_404' }); return bytesOf(assets[name]!); },
      storedPicture: async (name: string) => pictures.has(name),
      putPicture: async (name: string, bytes: Uint8Array) => { pictures.set(name, bytes); }
    } };
    expect(await takeInFilms(deps, fresh())).toEqual({ languages: 1, films: 1, brought: 1, listed: 1, failed: 1, firstError: 'held_digest', held: 2 });
    expect(w.r2.has(`es/key-words/${sha('held film')}`)).toBe(true);
    expect([...pictures.keys()]).toEqual([`${still}.jpg`]);
    // A held film is in R2 to be played on the card, never listed for YouTube.
    expect([...w.listed]).toEqual([`es/record-a-passage/${record.sha256}`]);
    const again = await takeInFilms(deps, fresh());
    expect(again).toMatchObject({ brought: 0, failed: 1 });
    expect(again.held).toBeUndefined();
  });

  it('lists a film R2 already has without downloading it again', async () => {
    const record = film('record-a-passage', 'grabar');
    const w = world({ es: { language: 'es', films: [record] } }, {});
    w.r2.set(`es/record-a-passage/${record.sha256}`, bytesOf('grabar'));
    expect(await takeInFilms(w.deps, fresh())).toMatchObject({ brought: 0, listed: 1, failed: 0 });
    expect(w.downloads).toEqual([]);
  });

  it('never stores bytes that are not the hash the manifest names, and goes on with the rest', async () => {
    // Why: the release can be changed by hand; R2 checks again, but the job should not even send them.
    const wrong = film('record-a-passage', 'grabar');
    const right = film('key-words', 'palabras');
    const w = world({ es: { language: 'es', films: [wrong, right] } }, {
      [filmName('es', 'record-a-passage', wrong.sha256)]: 'something else', [filmName('es', 'key-words', right.sha256)]: 'palabras'
    });
    expect(await takeInFilms(w.deps, fresh())).toMatchObject({ films: 2, brought: 1, listed: 1, failed: 1, firstError: 'film_digest' });
    expect([...w.listed]).toEqual([`es/key-words/${right.sha256}`]);
  });

  it('counts a film missing from the release as failed, and lists nothing it could not store', async () => {
    const record = film('record-a-passage', 'grabar');
    const w = world({ es: { language: 'es', films: [record] } }, {});
    expect(await takeInFilms(w.deps, fresh())).toMatchObject({ brought: 0, listed: 0, failed: 1, firstError: 'download_404' });
    expect(w.listed.size).toBe(0);
  });

  it('skips languages with no manifest yet, and a manifest for another language', async () => {
    const record = film('record-a-passage', 'grabar');
    const w = world({ es: { language: 'fr', films: [record] } }, {});
    expect(await takeInFilms(w.deps, fresh())).toMatchObject({ languages: 1, films: 0, failed: 1, firstError: 'manifest_entry' });
  });

  it('stops between films when asked to', async () => {
    const films = ['a', 'b', 'c'].map((t) => film(`video-${t}`, t));
    const w = world({ es: { language: 'es', films } }, Object.fromEntries(films.map((f, i) => [filmName('es', f.tutorial, f.sha256), 'abc'[i]!])));
    let stop = false;
    const report = await takeInFilms({ ...w.deps, made: async (l, f) => { stop = true; return w.deps.made(l, f); }, stopping: () => stop }, fresh());
    expect(report).toMatchObject({ films: 1, brought: 1, listed: 1 });
  });

  it('tries a step the server failed once again, then stops the run, so a storage fault is not hundreds of failed requests (LAN-325)', async () => {
    const films = Array.from({ length: 20 }, (_, i) => film(`t${i}`, `video ${i}`));
    const server = () => Object.assign(new Error('stored 500'), { name: 'stored_500', server: true });
    // A fault that passes: the second try answers.
    let first = true;
    const w = world({ es: { language: 'es', films: films.slice(0, 1) } }, {});
    const report = await takeInFilms({ ...w.deps, stored: async () => { if (first) { first = false; throw server(); } return true; } }, fresh());
    expect(report).toMatchObject({ films: 1, failed: 0, listed: 1 });
    expect(report.stopped).toBeUndefined();
    // A fault that stays: 2 requests, then the run stops; the other films and languages wait for the next run.
    let asked = 0;
    const down = world({ es: { language: 'es', films }, fr: { language: 'fr', films } }, {});
    const stopped = await takeInFilms({ ...down.deps, stored: async () => { asked += 1; throw server(); } }, fresh());
    expect(asked).toBe(2);
    expect(stopped).toMatchObject({ films: 1, failed: 1, firstError: 'stored_500', stopped: true });
    // A film's own fault (not the server's) is not tried again, and the run goes on.
    let tries = 0;
    const own = world({ es: { language: 'es', films: films.slice(0, 3) } }, {});
    const going = await takeInFilms({ ...own.deps, stored: async () => { tries += 1; throw Object.assign(new Error('stored 403'), { name: 'stored_403', server: false }); } }, fresh());
    expect(tries).toBe(3);
    expect(going).toMatchObject({ films: 3, failed: 3 });
  });
});

describe('a film in a manifest', () => {
  const good = film('record-a-passage', 'grabar');

  it('holds to what the database and YouTube take', () => {
    expect(filmProblem(good)).toBeNull();
    expect(filmProblem({ ...good, tutorial: '../secret' })).toBe('tutorial');
    expect(filmProblem({ ...good, sha256: 'A'.repeat(64) })).toBe('sha256');
    expect(filmProblem({ ...good, bytes: 0 })).toBe('bytes');
    expect(filmProblem({ ...good, bytes: 101 * 1024 * 1024 })).toBe('bytes');
    expect(filmProblem({ ...good, seconds: 1.5 })).toBe('seconds');
    expect(filmProblem({ ...good, title: 'x'.repeat(101) })).toBe('title');
    expect(filmProblem({ ...good, title: 'a <b>' })).toBe('title');
    // YouTube counts a description in bytes: 2,000 three-byte letters are 6,000.
    expect(filmProblem({ ...good, description: 'ह'.repeat(2000) })).toBe('description');
    expect(filmProblem({ ...good, playlist: '' })).toBe('playlist');
    expect(filmProblem({ ...good, position: -1 })).toBe('position');
    expect(filmProblem({ ...good, look: 'x' })).toBe('look');
    expect(filmProblem(null)).toBe('not_a_film');
  });

  it('is read from a manifest only for the manifest\'s own language', () => {
    expect(readManifest('es', { language: 'es', films: [good, { ...good, bytes: -1 }] })).toEqual({ films: [good], refused: 1 });
    expect(readManifest('es', { language: 'es' })).toEqual({ films: [], refused: 1 });
    expect(readManifest('es', 'not json')).toEqual({ films: [], refused: 1 });
  });

  it('is chosen for YouTube as it comes in when it was made wide, and a tall one left from before waits for a person (decision 192)', () => {
    expect(chosenOnIntake({ ...good, frame: 'wide' })).toBe(true);
    expect(chosenOnIntake(good)).toBe(false);
  });

  it('is named in the release by its language, video and hash, so a newer one never takes an older one\'s name', () => {
    expect(filmName('zh-Hans', 'record-a-passage', 'ab'.repeat(32))).toBe('zh-Hans.record-a-passage.abababababababab.mp4');
  });
});
