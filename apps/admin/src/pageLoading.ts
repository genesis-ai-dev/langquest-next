/**
 * What a box shows before its answer comes, and after its answer fails: a
 * grey shape that shimmers where the answer will go, and the error with a
 * Try again button. No page or section stands empty while it loads
 * (docs/decisions/2026-11-21-ops-dashboard-shows-loading-and-retry.md).
 */
import { OPS_IDS } from './pageOps';

export const LOADING_CSS = `
.skel { display: flex; flex-direction: column; gap: 10px; padding: 6px 0; width: 100%; flex: 1 1 100%; }
.skel.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(300px, 100%), 1fr)); gap: 12px; }
.skel.tiles { display: contents; }
.sk { display: block; height: 12px; border-radius: 6px; background: linear-gradient(90deg, var(--soft) 0%, var(--line) 40%, var(--soft) 80%); background-size: 300% 100%; animation: sk-shine 1.4s ease-in-out infinite; }
.sk.tall { height: 16px; } .sk.big { height: 26px; margin-top: 6px; } .sk.chart { height: 120px; border-radius: 10px; }
.sk.w30 { width: 30%; } .sk.w40 { width: 40%; } .sk.w55 { width: 55%; } .sk.w70 { width: 70%; } .sk.w80 { width: 80%; } .sk.w90 { width: 90%; }
.skcard { border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; display: flex; flex-direction: column; gap: 10px; background: var(--card); }
.stile.skt { display: flex; flex-direction: column; gap: 8px; }
.vh { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
@keyframes sk-shine { 0% { background-position: 100% 0; } 100% { background-position: -100% 0; } }
.pill.wait::before { content: ''; display: inline-block; width: 7px; height: 7px; margin-inline-end: 6px; border-radius: 50%; border: 2px solid currentColor; border-inline-end-color: transparent; vertical-align: -1px; animation: sk-turn .8s linear infinite; }
@keyframes sk-turn { to { transform: rotate(360deg); } }
.vmark.wait { background: transparent; border: 3px solid var(--line); border-top-color: var(--primary); animation: sk-turn .9s linear infinite; }
.failed { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: center; margin: 6px 0; }
.failed .bad { margin: 0; }
@media (prefers-reduced-motion: reduce) { .sk, .pill.wait::before, .vmark.wait { animation: none; } }
`;

export const LOADING_SCRIPT = `
/** A shape that shimmers where an answer will go: 'lines', 'cards', 'chart' or 'tiles' (n of them). Screen readers hear "Loading". */
function skel(kind, n) {
  const shapes = {
    lines: '<span class="sk tall w55"></span><span class="sk w90"></span><span class="sk w80"></span><span class="sk w70"></span>',
    cards: [1, 2].map(() => '<div class="skcard"><span class="sk tall w40"></span><span class="sk w90"></span><span class="sk w70"></span><span class="sk w30"></span></div>').join(''),
    chart: '<span class="sk tall w40"></span><span class="sk chart"></span>',
    tiles: Array.from({ length: n || 1 }, () => '<div class="stile skt"><span class="sk w70"></span><span class="sk big w40"></span><span class="sk w55"></span></div>').join('')
  };
  return '<div class="skel ' + kind + '" role="status" aria-busy="true"><span class="vh">Loading</span>' + (shapes[kind] || shapes.lines) + '</div>';
}

/** What a part read again after a failure asks for: the parts read together come back together. */
const READ_TOGETHER = { diag: ['jobs', 'clients', 'database', 'v2', 'feedback'], ops: ${JSON.stringify(OPS_IDS)} };
function readOf(part) { return Object.keys(READ_TOGETHER).find((k) => READ_TOGETHER[k].includes(part)) || part; }

/** Why a part failed, with a button that reads it again at once. */
function failed(words, attrs) {
  return '<div class="failed"><p class="bad">' + esc(words) + '</p><button type="button" ' + attrs + '>Try again</button></div>';
}
const retryPart = (part) => 'data-retry="' + esc(part) + '"';

document.addEventListener('click', async (e) => {
  const b = e.target.closest && e.target.closest('[data-retry]');
  if (!b || b.disabled) return;
  b.disabled = true;
  b.textContent = 'Trying again…';
  await reread([readOf(b.dataset.retry)]);
  // A part that fails again keeps its error: the same box, so the button is ready for the next try.
  if (b.isConnected) { b.disabled = false; b.textContent = 'Try again'; }
});
// A page's 14 days of numbers (pageSummary.ts sumHistory), read again.
document.addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('[data-retry-hist]');
  if (!b || b.disabled) return;
  b.disabled = true;
  b.textContent = 'Trying again…';
  delete sumHist[b.dataset.retryHist];
  sumHistory(b.dataset.retryHist, true);
  drawSummary();
});
// A page's charts under All the details (pageStart.ts renderHist), read again.
document.addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('[data-retry-charts]');
  if (b) renderHist(b.dataset.retryCharts);
});
`;
