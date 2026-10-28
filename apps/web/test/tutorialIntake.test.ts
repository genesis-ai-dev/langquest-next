import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { filmName, filmProblem, readManifest, takeInFilms, type Film, type IntakeReport } from '../../../server/tutorialIntakeModel';
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
    stopping: () => false
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

  it('is named in the release by its language, video and hash, so a newer one never takes an older one\'s name', () => {
    expect(filmName('zh-Hans', 'record-a-passage', 'ab'.repeat(32))).toBe('zh-Hans.record-a-passage.abababababababab.mp4');
  });
});
