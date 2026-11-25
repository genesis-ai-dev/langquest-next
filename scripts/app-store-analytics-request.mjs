// Asks App Store Connect once to make its analytics reports for LangQuest
// Next, among them "App Crashes": crashes on people's iPhones by day, app
// version, device and iOS version (docs/production-reads.md, "Provider APIs";
// docs/decisions/2026-11-24-agents-read-everything-but-personal-data.md).
// Caleb chose this on 2026-11-24. Apple makes the reports only after one
// ONGOING report request, which only an Admin's key may make. After it, the
// log gate's `app-store-report` reads them with the read key it already has.
//
// Run on the Mac, once:
//   npx dotenvx run -f .env.production -fk .env.keys --quiet -- node scripts/app-store-analytics-request.mjs
//
// It uses APP_STORE_REVIEW_KEY (Caleb's own key, his Admin role). It prints
// no key. A second run finds the request already there and changes nothing.
import { fileURLToPath } from 'node:url';
import { reviewKey, token } from './app-store-review.mjs';

export const APP_ID = '6812492008';
const API = 'https://api.appstoreconnect.apple.com/v1';

export async function ensureRequest(key, fetcher = fetch, now = Date.now()) {
  const headers = { authorization: `Bearer ${token(key, now)}`, 'content-type': 'application/json' };
  const listed = await fetcher(`${API}/apps/${APP_ID}/analyticsReportRequests?filter[accessType]=ONGOING`, { headers });
  if (!listed.ok) throw new Error(`App Store Connect listed no report requests: HTTP ${listed.status} ${(await listed.text()).slice(0, 300)}`);
  const ongoing = ((await listed.json()).data ?? []).find((r) => r.attributes?.accessType === 'ONGOING' && !r.attributes?.stoppedDueToInactivity);
  if (ongoing) return { made: false, id: ongoing.id };
  const made = await fetcher(`${API}/analyticsReportRequests`, {
    method: 'POST', headers,
    body: JSON.stringify({ data: { type: 'analyticsReportRequests', attributes: { accessType: 'ONGOING' }, relationships: { app: { data: { type: 'apps', id: APP_ID } } } } })
  });
  if (!made.ok) {
    const text = (await made.text()).slice(0, 400);
    const hint = made.status === 403 ? ' The key is not an Admin\'s, or it is an individual key that Apple does not let make report requests: make a team key with Access Admin and run again with it as APP_STORE_REVIEW_KEY.' : '';
    throw new Error(`App Store Connect refused the report request: HTTP ${made.status} ${text}.${hint}`);
  }
  return { made: true, id: (await made.json()).data?.id ?? null };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const key = reviewKey(process.env);
  if (!key) { console.error('No APP_STORE_REVIEW_KEY: run it with dotenvx and .env.production, as the comment at the top says.'); process.exit(1); }
  ensureRequest(key).then(({ made, id }) => {
    console.log(made ? `Made the report request ${id}. Apple makes the first reports in 1 to 2 days.` : `The report request ${id} is there already. Nothing changed.`);
  }, (e) => { console.error(e.message); process.exit(1); });
}
