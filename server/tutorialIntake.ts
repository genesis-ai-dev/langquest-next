/**
 * The films the nightly filming made on GitHub, brought into R2 and listed
 * on the ops dashboard (docs/tutorial-videos.md): server/tutorialIntakeModel.ts
 * run by the job container each day at 23:10 UTC, after the filming
 * (apps/web/worker/jobsModel.ts; scripts/build-jobs.mjs bundles this file).
 * It reads the manifests from the repository's public `tutorials` release,
 * puts each film R2 lacks through the Worker (API_URL) and records a
 * `tutorial_intake` job run: `languages`, `films`, `brought`, `listed` and
 * `failed`, `partial` when any failed. The log prints counts, never titles.
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... API_URL=... npx tsx server/tutorialIntake.ts
 * Run by hand it leaves no job run.
 */
import { createClient } from '@supabase/supabase-js';
import { errorClassOf, jobRunSink, noJobRuns } from './jobRuns';
import { filmName, intakeCode, manifestName, takeInFilms, TUTORIALS_RELEASE, type Film, type IntakeReport } from './tutorialIntakeModel';

const url = process.env['SUPABASE_URL'] ?? 'http://127.0.0.1:54421';
const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
const apiUrl = process.env['API_URL']?.replace(/\/+$/, '');
const release = process.env['TUTORIALS_RELEASE'] ?? TUTORIALS_RELEASE;
if (!key || !apiUrl) {
  console.error('SUPABASE_SERVICE_ROLE_KEY and API_URL are required');
  process.exit(1);
}
const record = process.env['LANGQUEST_JOB'] === 'tutorial-intake' ? jobRunSink(url, key) : noJobRuns;
const service = createClient(url, key, { auth: { persistSession: false } });

const started = Date.now();
let stopping = false;
process.once('SIGTERM', () => {
  stopping = true;
  console.error('SIGTERM: finishing the film in hand');
});
// Counted as it goes, so a run cut short still reports what it did.
const report: IntakeReport = { languages: 0, films: 0, brought: 0, listed: 0, failed: 0, firstError: null };

const failed = (name: string, status: number) => Object.assign(new Error(`${name} ${status}`), { name: `${name}_${status}` });
const video = (language: string, film: Film) => `${apiUrl}/api/tutorials/${language}/${film.tutorial}/${film.sha256}.mp4`;

let error: unknown;
try {
  await takeInFilms({
    manifest: async (language) => {
      const response = await fetch(`${release}/${manifestName(language)}`);
      if (response.status === 404) return null;
      if (!response.ok) throw failed('manifest', response.status);
      return response.json();
    },
    stored: async (language, film) => {
      const response = await fetch(video(language, film), { method: 'HEAD' });
      if (response.status === 404) return false;
      if (!response.ok) throw failed('stored', response.status);
      return true;
    },
    download: async (language, film) => {
      const response = await fetch(`${release}/${filmName(language, film.tutorial, film.sha256)}`);
      if (!response.ok) throw failed('download', response.status);
      return new Uint8Array(await response.arrayBuffer());
    },
    put: async (language, film, bytes) => {
      const response = await fetch(video(language, film), {
        method: 'PUT', body: bytes, headers: { authorization: `Bearer ${key}`, 'content-type': 'video/mp4' }
      });
      if (!response.ok) throw failed('put', response.status);
    },
    made: async (language, film) => {
      const { data, error: e } = await service.rpc('ops_tutorial_made', {
        p_tutorial: film.tutorial, p_language: language, p_sha256: film.sha256, p_title: film.title, p_description: film.description,
        p_playlist: film.playlist, p_position: film.position, p_seconds: film.seconds, p_bytes: film.bytes
      });
      if (e) throw Object.assign(new Error(`ops_tutorial_made: ${e.message}`), { name: `made_${e.code ?? 'error'}` });
      return data === true;
    },
    stopping: () => stopping
  }, report);
} catch (e) {
  error = e;
}
const errorClass = error !== undefined ? errorClassOf(error) : report.firstError ?? (stopping ? 'sigterm' : null);
await record({
  job: 'tutorial_intake', startedAt: started, ms: Date.now() - started,
  outcome: error !== undefined && report.films === 0 ? 'error' : error !== undefined || stopping || report.failed > 0 ? 'partial' : 'ok',
  n: { languages: report.languages, films: report.films, brought: report.brought, listed: report.listed, failed: report.failed },
  ...(errorClass ? { errorClass } : {})
});
console.log(`intake: ${report.films} films in ${report.languages} languages, ${report.brought} brought, ${report.listed} newly listed, ${report.failed} failed, ${Math.round((Date.now() - started) / 1000)} s`);
if (error !== undefined) {
  console.error(`failed: ${intakeCode(error)}`);
  process.exit(1);
}
if (stopping) process.exit(75);
