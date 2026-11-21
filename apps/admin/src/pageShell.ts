/**
 * The ops dashboard's frame (docs/decisions/2026-11-18-ops-dashboard-menu-and-overview.md):
 * a menu on the left with one line for each section, in three groups, and a
 * top line with the page's title, Look up and Refresh. Each menu line says
 * how many of its section's lines need a person and shows a dot for its most
 * urgent level, so the state of every section is on every page. Plain
 * JavaScript run inside page.ts's script, like pageStart.ts; everything shown
 * is escaped.
 */
import { GROUPS } from './pageOps';

type GroupId = (typeof GROUPS)[number]['id'];

/** The menu's groups, in order. Every section but Look up (the top line has it) is in exactly one (test/shell.test.ts). */
export const NAV: readonly { title: string; ids: readonly GroupId[] }[] = [
  { title: 'The product', ids: ['releases', 'phones', 'people', 'safety', 'stores'] },
  { title: 'Care', ids: ['userissues', 'research', 'support', 'tutorials', 'nightly'] },
  { title: 'Behind the scenes', ids: ['jobs', 'database', 'traffic', 'storage', 'access'] }
];

/** One small line drawing for each menu line and map box: the inside of an svg, 24 by 24. */
export const ICONS: Readonly<Record<string, string>> = {
  overview: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  releases: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/>',
  phones: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
  people: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5M16 4.6a3.5 3.5 0 010 6.8M18.5 14.8c1.6.8 2.6 2.4 3 5.2"/>',
  safety: '<path d="M12 3l8 3v6c0 4.5-3.2 7.8-8 9-4.8-1.2-8-4.5-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  stores: '<path d="M5 8h14l-1 12H6z"/><path d="M9 8V6a3 3 0 016 0v2"/>',
  userissues: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5v.01"/>',
  research: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21"/>',
  support: '<path d="M4 5h16v11H9l-5 4z"/>',
  tutorials: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M10 9.5v5l4.5-2.5z"/>',
  nightly: '<path d="M20 14.5A8 8 0 019.5 4 8 8 0 1020 14.5z"/>',
  jobs: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  database: '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  traffic: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.8 3 2.8 15 0 18M12 3c-2.8 3-2.8 15 0 18"/>',
  storage: '<rect x="3" y="4" width="18" height="6" rx="1.5"/><rect x="3" y="14" width="18" height="6" rx="1.5"/><path d="M7 7h.01M7 17h.01"/>',
  access: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M16 7l3 3"/>',
  all: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  web: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/>',
  go: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  alert: '<path d="M12 3l10 17H2z"/><path d="M12 10v4M12 17v.01"/>',
  look: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.01"/>',
  refresh: '<path d="M20 12a8 8 0 11-2.6-5.9M20 4v4h-4"/>',
  merge: '<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="9" r="2.5"/><path d="M6 8.5v7M18 11.5c0 3-6 2-9 4.5"/>'
};

/** The frame's look, inside page.ts's style element. */
export const SHELL_CSS = String.raw`
.shell { display: grid; grid-template-columns: 264px minmax(0, 1fr); min-height: 100vh; }
.shell:has(#board[hidden]) { grid-template-columns: minmax(0, 1fr); }
.shell:has(#board[hidden]) .menu, .shell:has(#board[hidden]) #start-look { display: none; }
.menu { position: sticky; top: 0; height: 100vh; overflow-y: auto; padding: 18px 12px 14px; background: var(--card); border-inline-end: 1px solid var(--line); display: flex; flex-direction: column; gap: 12px; }
.brand { display: flex; align-items: center; gap: 10px; padding: 0 8px; text-decoration: none; color: var(--ink); }
.brand .mark { width: 30px; height: 30px; border-radius: 8px; flex: none; background: var(--primary); color: #fff; display: grid; place-items: center; font-weight: 700; font-size: 13px; }
.brand b { font-size: 16px; display: block; line-height: 1.15; } .brand small { display: block; font-size: 12px; }
.nav { display: grid; gap: 2px; }
.nav .group { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .09em; color: var(--muted); padding: 12px 10px 4px; }
.nav a { display: flex; align-items: center; gap: 10px; min-height: 36px; padding: 5px 10px; border-radius: 9px; text-decoration: none; color: var(--ink2); font-weight: 500; font-size: 13.5px; line-height: 1.25; }
.nav a:hover, .nav a:focus-visible { background: var(--soft); color: var(--ink); }
.nav a[aria-current="page"] { background: var(--ink); color: var(--card); }
.nav a > span:first-of-type { flex: 1; min-width: 0; }
.nav a .count { font-size: 11.5px; font-weight: 600; font-variant-numeric: tabular-nums; padding: 1px 7px; border-radius: 999px; background: var(--line); color: var(--ink); }
.nav a[aria-current="page"] .count { background: rgb(255 255 255 / .2); color: var(--card); }
.nav a .dot { margin-top: 0; width: 8px; height: 8px; }
.nav a .dot.off { background: transparent; border: 1.5px solid var(--grey); }
svg.i { width: 16px; height: 16px; flex: none; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
.mainw { min-width: 0; }
.top { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 12px; max-width: 1280px; margin: 0 auto; padding: 24px clamp(16px, 3vw, 40px) 0; }
.top h1 { font-size: 26px; line-height: 1.15; margin: 0; letter-spacing: -.01em; flex: 1; min-width: 160px; }
.top form.look { margin: 0; flex: 0 1 340px; } .top form.look input { min-height: 40px; background: var(--raised); }
.top #refresh { display: inline-flex; align-items: center; gap: 8px; } .top #refresh small { font-weight: 400; }
main { padding: 20px clamp(16px, 3vw, 40px) 72px; }
/* A section's own page: the top line has its title, so the card keeps only its source line and its state. */
.view-group .card > .head h2 { display: none; } .view-group .card > .head { cursor: default; }
@media (max-width: 900px) {
  .shell { grid-template-columns: minmax(0, 1fr); }
  .menu { position: static; height: auto; flex-direction: row; flex-wrap: wrap; align-items: center; gap: 8px; padding: 10px 12px 6px; border-inline-end: 0; border-bottom: 1px solid var(--line); }
  .brand small { display: none; }
  .nav { grid-auto-flow: column; grid-auto-columns: max-content; overflow-x: auto; width: 100%; padding-bottom: 4px; scrollbar-width: none; }
  .nav .group { display: none; }
  .nav a { min-height: 48px; padding: 6px 12px; }
  .top { padding-top: 16px; } .top h1 { flex-basis: 100%; font-size: 22px; }
  .top form.look { flex: 1 1 100%; }
  main { padding: 12px 8px 48px; }
}
`;

/** The menu, inside page.ts's .shell before the main column. */
export const SHELL_HTML = String.raw`
<aside class="menu" id="menu">
  <a class="brand" href="#" aria-label="LangQuest Next operations, overview"><span class="mark" aria-hidden="true">LQ</span><span><b>LangQuest Next</b><small>Operations</small></span></a>
  <nav class="nav" id="nav" aria-label="Pages"></nav>
</aside>`;

/** Pure: apps/admin/test/shell.test.ts runs it with new Function. */
export const SHELL_LOGIC = String.raw`
/**
 * What each section's menu line says: 'need' counts its lines that need a
 * person (Act now and Fix soon, less those whose fix merged and waits for its
 * check, which 'waits' counts), and 'dot' is its most urgent level, else
 * 'off' when no part is connected, 'wait' while a part has not answered, or
 * 'ok'. A part that could not be read is a line to watch, as on the Overview.
 */
function navState(sections, results, levels, waits) {
  const out = {};
  for (const g of sections) {
    if (!g.parts.length) continue;
    const got = g.parts.map((p) => results[p]).filter(Boolean);
    const alerts = got.flatMap((s) => s.alerts || []);
    const needs = alerts.filter((a) => a.level === 'urgent' || a.level === 'problem');
    const need = Math.max(0, needs.length - (waits ? waits(needs) : 0));
    const unread = got.some((s) => s.state === 'error');
    const top = levels.find((l) => alerts.some((a) => (levels.includes(a.level) ? a.level : 'watch') === l)) || (unread ? 'watch' : null);
    out[g.id] = { need, dot: top || (got.length < g.parts.length ? 'wait' : got.every((s) => s.state === 'off') ? 'off' : 'ok') };
  }
  return out;
}
`;

/** The menu and the top line's title, drawn again whenever a part answers or the view changes. */
export const SHELL_SCRIPT = String.raw`
const svgIcon = (name) => '<svg class="i" viewBox="0 0 24 24" aria-hidden="true">' + (SHAPES[name] || '') + '</svg>';
const DOT_SAID = { urgent: 'Act now', problem: 'Fix soon', watch: 'Watch', off: 'Not connected' };

function navLine(href, icon, title, here, st) {
  const need = st && st.need ? '<span class="count" aria-label="' + st.need + (st.need === 1 ? ' line needs you' : ' lines need you') + '">' + num(st.need) + '</span>' : '';
  const dot = st && DOT_SAID[st.dot] ? '<span class="dot ' + st.dot + '" role="img" aria-label="' + DOT_SAID[st.dot] + '"></span>' : '';
  return '<a href="' + href + '"' + (here ? ' aria-current="page"' : '') + '>' + svgIcon(icon) + '<span>' + esc(title) + '</span>' + need + dot + '</a>';
}

function drawNav() {
  const v = view();
  const st = navState(SECTIONS, results, LEVELS, waitingFixes);
  $('nav').innerHTML = navLine('#', 'overview', 'Overview', v.name === 'start') +
    NAV.map((grp) => '<div class="group">' + esc(grp.title) + '</div>' +
      grp.ids.map((id) => navLine('#g/' + id, id, titleOf(id), v.name === 'group' && v.id === id, st[id])).join('')).join('') +
    '<div class="group">Everything</div>' + navLine('#all', 'all', 'All sections', v.name === 'all');
  const title = v.name === 'start' ? 'Overview' : v.name === 'all' ? 'All sections' : titleOf(v.id);
  $('view-title').textContent = title;
  document.title = title + ' · LangQuest operations';
  document.body.classList.toggle('view-group', v.name === 'group');
}
`;
