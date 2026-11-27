/**
 * Where problems can happen: the Overview's map of LangQuest, one box for each
 * part that the ops dashboard checks, laid out so the work flows from left to
 * right (docs/decisions/2026-11-24-overview-map-of-where-problems-happen.md).
 * Build and ship, then the phones, Cloudflare, the Supabase server, and the
 * watch that files and fixes problems; two loops come back along the bottom.
 * Each box holds the kinds of line its parts can raise (alertKinds.ts), shows
 * the state of those lines now (from the parts the page already loads, after
 * the admin's resolves), and opens a panel with each kind, the lines open now
 * and the section's page. The map zooms (buttons, or a pinch or Ctrl and the
 * wheel) and moves (drag, or scroll). Two walk-throughs follow a recording
 * and a fix through the parts, and a search box finds the parts of a problem.
 * Plain JavaScript inside page.ts's script, after pageOverview.ts and KINDS;
 * no inline style (the page's policy allows only its own style element), so
 * places and sizes are set from the script. Everything shown is escaped.
 */

/** The look, inside page.ts's style element. Every class starts with "sm". */
export const SYSMAP_CSS = String.raw`
.smwrap { --sm-ship: #4f52c9; --sm-field: #0e7f86; --sm-cf: #c96a12; --sm-supa: #2f8a52; --sm-care: #b83b6f; --sm-video: #a8641a; --sm-access: #6d4fa0;
  --sm-edge: #9aa7b5; --sm-spine: #46525e; --sm-hi: #1d4ed8; --sm-canvas: #fbfcfd; }
@media (prefers-color-scheme: dark) { .smwrap { --sm-ship: #9a9cff; --sm-field: #3cc3c9; --sm-cf: #f0a24f; --sm-supa: #5fc786; --sm-care: #f07aa9; --sm-video: #e2a65a; --sm-access: #b597ea;
  --sm-edge: #566676; --sm-spine: #aab6c2; --sm-hi: #7aa2ff; --sm-canvas: #141413; } }
.smz-ship { --zc: var(--sm-ship); } .smz-field { --zc: var(--sm-field); } .smz-cf { --zc: var(--sm-cf); } .smz-supa { --zc: var(--sm-supa); }
.smz-care { --zc: var(--sm-care); } .smz-video { --zc: var(--sm-video); } .smz-access { --zc: var(--sm-access); }
.smbar { display: flex; flex-wrap: wrap; gap: 8px 10px; align-items: center; margin: 0 0 10px; }
.smbar .smtour { display: inline-flex; gap: 7px; align-items: center; min-height: 40px; padding: 0 13px; border-radius: 10px; border: 1px solid var(--sm-hi); color: var(--sm-hi); background: var(--card); font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; }
.smbar .smtour[aria-pressed="true"] { background: var(--sm-hi); color: var(--card); }
.smbar .smtour svg { width: 14px; height: 14px; }
.smfind { display: inline-flex; align-items: center; gap: 8px; background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 0 10px; min-height: 40px; }
.smfind svg { width: 16px; height: 16px; fill: none; stroke: var(--muted); stroke-width: 2; stroke-linecap: round; }
.smfind input { border: 0; outline: 0; background: transparent; color: var(--ink); font: inherit; font-size: 14px; width: 220px; max-width: 46vw; }
.smfind:focus-within { border-color: var(--sm-hi); }
.smfind .smn { font-size: 12px; color: var(--muted); white-space: nowrap; }
.smzoom { margin-inline-start: auto; display: inline-flex; border: 1px solid var(--line); border-radius: 10px; overflow: hidden; background: var(--card); }
.smzoom button { font: inherit; font-size: 14px; font-weight: 600; border: 0; background: transparent; color: var(--ink); min-height: 40px; min-width: 44px; padding: 0 12px; cursor: pointer; }
.smzoom button + button { border-inline-start: 1px solid var(--line); }
.smframe { position: relative; border: 1px solid var(--line); border-radius: 16px; background: var(--sm-canvas); overflow: hidden; box-shadow: var(--sh); }
.smvp { overflow: auto; cursor: grab; overscroll-behavior: contain; }
.smvp.smdrag { cursor: grabbing; user-select: none; }
.smsizer { position: relative; }
.smcanvas { position: absolute; left: 0; top: 0; transform-origin: 0 0; background-image: radial-gradient(color-mix(in srgb, var(--line) 85%, transparent) 1.2px, transparent 1.2px); background-size: 28px 28px; }
.smcanvas > svg { position: absolute; inset: 0; overflow: visible; }
.smband { fill: color-mix(in srgb, var(--zc) 5%, var(--sm-canvas)); stroke: color-mix(in srgb, var(--zc) 30%, var(--line)); stroke-width: 1.2; }
.smlane { fill: color-mix(in srgb, var(--zc) 5%, var(--sm-canvas)); stroke: color-mix(in srgb, var(--zc) 30%, var(--line)); stroke-width: 1.2; stroke-dasharray: 5 5; }
.smbl { font: 800 17px system-ui, sans-serif; letter-spacing: .12em; text-transform: uppercase; fill: var(--zc); }
.smbs { font: 500 15px system-ui, sans-serif; fill: var(--muted); }
.smedge { fill: none; stroke: var(--sm-edge); stroke-width: 1.6; opacity: .6; }
.smedge.spine { stroke: var(--sm-spine); stroke-width: 3.2; opacity: .8; }
.smedge.loop { stroke-dasharray: 8 6; opacity: .8; }
.smedge.on { stroke: var(--sm-hi); opacity: 1; stroke-width: 2.8; }
.smedge.faint { opacity: .12; }
.smedge.tour { stroke: var(--sm-hi); opacity: 1; stroke-width: 3.6; stroke-dasharray: 9 7; animation: smflow .9s linear infinite; }
@keyframes smflow { to { stroke-dashoffset: -16; } }
.smmk { fill: var(--sm-edge); } .smmk-spine { fill: var(--sm-spine); } .smmk-hi { fill: var(--sm-hi); }
.smlbl rect { fill: var(--card); stroke: var(--line); } .smlbl text { font: 500 14px system-ui, sans-serif; fill: var(--ink); }
.smlbl.loopl text { fill: var(--muted); font-weight: 600; } .smlbl.hi rect { stroke: var(--sm-hi); }
.smdot { fill: var(--sm-hi); } .smflowdot { fill: var(--sm-spine); } .smflowdot.loopd { fill: var(--muted); }
.smcanvas.smdim .smflowdot, .smcanvas.smbusy .smflowdot { display: none; }
.smkey text { font: 500 15px system-ui, sans-serif; fill: var(--muted); } .smkey .smkt { font: 700 13px system-ui, sans-serif; letter-spacing: .12em; text-transform: uppercase; }
.smkey .ok { fill: var(--green); } .smkey .watch { fill: var(--yellow); } .smkey .problem { fill: var(--red); } .smkey .off { fill: none; stroke: var(--grey); stroke-width: 2; }
.smnode { position: absolute; display: flex; align-items: center; gap: 10px; text-align: start; font: 600 17px/1.18 system-ui, -apple-system, "Segoe UI", sans-serif; color: var(--ink);
  background: var(--raised); border: 1.5px solid color-mix(in srgb, var(--zc) 35%, var(--line)); border-radius: 15px; padding: 0 14px 0 11px; cursor: pointer; box-shadow: var(--sh);
  transition: opacity .2s, border-color .15s, box-shadow .15s; }
.smnode .smic { flex: none; width: 34px; height: 34px; border-radius: 10px; display: grid; place-items: center; background: color-mix(in srgb, var(--zc) 15%, var(--raised)); }
.smnode .smic svg { width: 20px; height: 20px; fill: none; stroke: var(--zc); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.smnode .smnm { flex: 1; min-width: 0; }
.smnode .smst { flex: none; width: 11px; height: 11px; border-radius: 50%; background: var(--line); }
.smnode.ok .smst { background: var(--green); } .smnode.watch .smst { background: var(--yellow); } .smnode.problem .smst { background: var(--red); }
.smnode.off .smst { background: transparent; border: 2px solid var(--grey); } .smnode.error .smst { background: transparent; border: 2.5px solid var(--red); } .smnode.none .smst { display: none; }
.smnode.problem { border-color: var(--red); } .smnode.watch { border-color: var(--yellow); } .smnode.off { border-style: dashed; }
.smnode .smct { position: absolute; top: -11px; right: -9px; min-width: 28px; height: 26px; padding: 0 8px; border-radius: 999px; display: grid; place-items: center; border: 2.5px solid var(--sm-canvas);
  font-size: 14px; font-weight: 700; font-variant-numeric: tabular-nums; color: #fff; background: var(--red); }
.smnode.watch .smct { background: var(--amber); }
.smnode:hover { border-color: var(--zc); }
.smnode:focus-visible, .smbar button:focus-visible, .smpanel button:focus-visible, .smpanel a:focus-visible { outline: 3px solid var(--sm-hi); outline-offset: 2px; }
.smnode[aria-pressed="true"] { box-shadow: 0 0 0 5px color-mix(in srgb, var(--zc) 28%, transparent), var(--sh); }
.smnode.smmatch { border-color: var(--sm-hi); box-shadow: 0 0 0 4px color-mix(in srgb, var(--sm-hi) 25%, transparent), var(--sh); }
.smcanvas.smdim .smnode:not(.smlit) { opacity: .25; }
.smnode.smstep { border-color: var(--sm-hi); animation: smpulse 1.6s ease-in-out infinite; }
@keyframes smpulse { 0%,100% { box-shadow: 0 0 0 4px color-mix(in srgb, var(--sm-hi) 35%, transparent); } 50% { box-shadow: 0 0 0 11px color-mix(in srgb, var(--sm-hi) 8%, transparent); } }
.smpeek { position: absolute; z-index: 6; width: 300px; pointer-events: none; background: var(--raised); border: 1px solid var(--line); border-radius: 12px; box-shadow: 0 10px 30px rgb(0 0 0 / .16); padding: 12px 14px; font-size: 13px; }
.smpeek b { display: block; font-size: 14px; margin-bottom: 4px; } .smpeek .smsaid { color: var(--muted); margin: 0 0 6px; }
.smpeek ul { margin: 0; padding: 0 0 0 16px; } .smpeek li { margin: 2px 0; } .smpeek li.open { color: var(--red); font-weight: 600; } .smpeek li.openw { color: var(--amber); font-weight: 600; }
.smpeek .smmore { color: var(--muted); margin-top: 6px; font-size: 12px; }
.smpanel { position: absolute; top: 12px; right: 12px; bottom: 12px; width: 380px; max-width: calc(100% - 24px); background: var(--raised); border: 1px solid var(--line); border-radius: 16px;
  box-shadow: 0 10px 40px rgb(0 0 0 / .16); padding: 18px 18px 20px; overflow: auto; z-index: 5; font-size: 14px; }
.smpanel.smtourp { top: auto; max-height: calc(100% - 24px); }
.smpanel .smx { position: absolute; top: 10px; right: 10px; width: 40px; height: 40px; border-radius: 10px; border: 1px solid var(--line); background: var(--raised); color: var(--ink); cursor: pointer; font-size: 18px; }
.smpanel .smeb { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .1em; color: var(--zc); padding-inline-end: 44px; }
.smpanel h3 { font-size: 21px; color: var(--ink); margin: 6px 0 6px; padding-inline-end: 30px; }
.smpanel .smwhat { margin: 0 0 10px; color: var(--muted); }
.smpanel .smnow { font-weight: 600; margin: 0 0 10px; } .smpanel .smnow.problem { color: var(--red); } .smpanel .smnow.watch { color: var(--amber); } .smpanel .smnow.ok { color: var(--green); }
.smpanel h4 { margin: 16px 0 8px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .09em; color: var(--muted); }
.smpanel .smgo { display: inline-flex; align-items: center; min-height: 40px; font-weight: 600; color: var(--primary); text-decoration: none; margin-inline-end: 14px; }
.smpanel ul.smkinds, .smpanel ul.smlinks { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.smkinds li { padding: 8px 10px; border-radius: 9px; background: var(--soft); border-inline-start: 4px solid var(--line); }
.smkinds li.open { border-inline-start-color: var(--red); } .smkinds li.openw { border-inline-start-color: var(--yellow); }
.smkinds .smkt { font-weight: 600; display: block; } .smkinds .smkw { font-size: 12px; color: var(--muted); display: flex; flex-wrap: wrap; gap: 2px 10px; margin-top: 2px; }
.smkinds a { color: var(--primary); font-weight: 600; text-decoration: none; }
.smlinks button { all: unset; box-sizing: border-box; cursor: pointer; display: grid; grid-template-columns: 10px minmax(0, 1fr); gap: 2px 10px; width: 100%; padding: 8px 10px; border-radius: 9px; border: 1px solid var(--line); }
.smlinks button:hover { border-color: var(--grey); }
.smlinks i { grid-row: span 2; width: 10px; height: 10px; border-radius: 3px; background: var(--zc); margin-top: 5px; }
.smlinks span { color: var(--muted); font-size: 12.5px; }
.smpanel .smstepno { font-size: 12px; color: var(--sm-hi); font-weight: 600; }
.smpanel .smsay { font-size: 15px; margin: 8px 0 14px; }
.smpanel .smnav { display: flex; gap: 8px; }
.smpanel .smnav button { font: inherit; font-size: 13px; font-weight: 600; min-height: 40px; padding: 0 14px; border-radius: 10px; border: 1px solid var(--line); background: var(--raised); color: var(--ink); cursor: pointer; }
.smpanel .smnav button.smpri { background: var(--sm-hi); color: var(--card); border-color: var(--sm-hi); }
.smpanel .smnav button:disabled { opacity: .4; cursor: default; }
.smhint { font-size: 12.5px; color: var(--muted); margin: 8px 2px 0; }
mark.smm { background: color-mix(in srgb, var(--sm-hi) 22%, transparent); color: inherit; border-radius: 3px; }
@media (max-width: 760px) { .smpanel { position: static; width: auto; max-width: none; margin: 12px; box-shadow: none; } .smzoom { margin-inline-start: 0; } }
@media (prefers-reduced-motion: reduce) { .smnode { transition: none; } .smnode.smstep, .smedge.tour { animation: none; } }
`;

/** The map's place on the Overview, inside OVERVIEW_HTML. */
export const SYSMAP_HTML = String.raw`<section class="smwrap" aria-labelledby="ov-map"><h2 class="oh" id="ov-map">Where problems can happen</h2>
        <div class="smbar">
          <button type="button" class="smtour" id="sm-t-rec" aria-pressed="false"><svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="currentColor"/></svg>Follow a recording</button>
          <button type="button" class="smtour" id="sm-t-fix" aria-pressed="false"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3 3 7-7" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>Follow a fix</button>
          <label class="smfind" for="sm-q"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg><input id="sm-q" type="search" placeholder="Find a problem: crash, sync…" autocomplete="off" aria-label="Find a problem"><span class="smn" id="sm-qn"></span></label>
          <div class="smzoom" role="group" aria-label="Zoom"><button type="button" id="sm-z-out" aria-label="Zoom out">−</button><button type="button" id="sm-z-fit">Fit</button><button type="button" id="sm-z-in" aria-label="Zoom in">+</button></div>
        </div>
        <div class="smframe" id="sm-frame">
          <div class="smvp" id="sm-vp"><div class="smsizer" id="sm-sizer"><div class="smcanvas" id="sm-canvas"></div></div></div>
          <div class="smpeek" id="sm-peek" hidden></div>
          <aside class="smpanel" id="sm-panel" aria-live="polite" hidden></aside>
        </div>
        <p class="smhint">Each box is a part that the dashboard checks. The dot is its state now, and the number is how many of its lines are open now. Point at a box for its problems, or tap it for all of them. Drag to move the map; use + and −, or pinch, to zoom.</p>
      </section>`;

/** Pure: apps/admin/test/sysmap.test.ts runs these with new Function. */
export const SYSMAP_LOGIC = String.raw`
const SM_W = 2574, SM_H = 1196, SM_NW = 190, SM_NH = 64, SM_BAND_Y = 248, SM_BAND_H = 752;
const SM_ZONES = {
  ship: { name: 'Build and ship' }, field: { name: 'In the field' }, cf: { name: 'Cloudflare' }, supa: { name: 'Supabase server' }, care: { name: 'Watch and fix' },
  video: { name: 'Tutorial videos', lane: [48, 162], right: true }, access: { name: 'Keys and access', lane: [1060, 1176] }
};
/**
 * Each box: x, y its centre on the canvas; parts, the dashboard sources whose kinds of line it holds;
 * kinds, single kinds it adds (or, with "-", leaves to another box); group, the section page it opens.
 */
const SM_NODES = [
  { id: 'github', z: 'ship', x: 146, y: 560, name: 'GitHub main', icon: 'branch', group: 'releases', parts: [], kinds: ['workflow-failed', 'needs-you'], what: 'Each merge into main is a release. GitHub workflows run the checks and the automatic jobs.' },
  { id: 'shipped', z: 'ship', x: 383, y: 400, name: 'What shipped', icon: 'rocket', group: 'releases', parts: ['releases'], what: 'Merges, deploys and updates of the last two weeks, against the crashes that phones reported. Database migrations against main.' },
  { id: 'eas', z: 'ship', x: 383, y: 540, name: 'Expo builds and updates', icon: 'refresh', group: 'releases', parts: ['expo'], what: 'Expo (EAS) makes the phone builds and the over-the-air updates.' },
  { id: 'storepipe', z: 'ship', x: 383, y: 700, name: 'Store builds', icon: 'tray', group: 'releases', parts: ['pipeline'], what: 'Where each store build is now: built, in review or live. Copies of a fix for an older build.' },
  { id: 'nightly', z: 'ship', x: 383, y: 860, name: 'Nightly tests', icon: 'moon', group: 'nightly', parts: ['nightly'], what: 'Each night, tests run on main: the web suite, phone flows on an emulator and a simulator, and mutation tests.' },
  { id: 'appstore', z: 'ship', x: 616, y: 660, name: 'App Store', icon: 'bag', group: 'stores', parts: ['appstore'], what: 'App Review, TestFlight and reviews for the iPhone app.' },
  { id: 'googleplay', z: 'ship', x: 616, y: 790, name: 'Google Play', icon: 'play', group: 'stores', parts: ['googleplay'], what: 'Android crash and freeze rates, as Google Play measures them, and reviews.' },
  { id: 'people', z: 'field', x: 855, y: 430, name: 'People and organizations', icon: 'people', group: 'people', parts: ['people'], what: 'Accounts, organizations and requests to join. The dashboard counts people. It never names them.' },
  { id: 'fleet', z: 'field', x: 855, y: 660, name: 'Builds on phones', icon: 'pkg', group: 'phones', parts: ['fleet'], what: 'Which build and update each phone runs, and how stable each one is. Phones that are stuck or quiet.' },
  { id: 'nearby', z: 'field', x: 855, y: 820, name: 'Nearby sync', icon: 'signal', group: 'safety', parts: ['nearby'], what: 'Phones with no internet pass work to each other. One phone later carries the work to the server.' },
  { id: 'phones', z: 'field', x: 1069, y: 560, name: 'Phones and browsers', icon: 'phone', group: 'phones', parts: ['clients'], kinds: ['files-lost'], what: 'The LangQuest app on iPhone, Android and the web. Each phone keeps its work offline and sends field diagnostics: counts and codes, never content.' },
  { id: 'webapp', z: 'cf', x: 1309, y: 372, name: 'Web app', icon: 'globe', group: 'releases', parts: [], kinds: ['deploy-behind', 'version-json-down'], what: 'app.langquest.org. A merge into main deploys the web app. The dashboard checks that the web app answers and runs the newest merge.' },
  { id: 'workers', z: 'cf', x: 1309, y: 466, name: 'Cloudflare Workers', icon: 'cloud', group: 'traffic', parts: ['cloudflare'], kinds: ['usage-billed'], what: 'The Workers that serve the app, the dashboard and the jobs, with each latest build. This month\'s Cloudflare usage against the plan.' },
  { id: 'appworker', z: 'cf', x: 1309, y: 560, name: 'App Worker', icon: 'shield', group: 'traffic', parts: ['worker'], what: 'The door for every phone: sync, uploads, downloads and sign-in. Rate limits refuse requests that come too fast.' },
  { id: 'r2', z: 'cf', x: 1309, y: 720, name: 'Recordings bucket (R2)', icon: 'wave', group: 'storage', parts: [], kinds: ['r2-missing', 'r2-repaired'], what: 'Every recording, named by its hash. A recording never changes. A nightly check compares the bucket with the log.' },
  { id: 'supa', z: 'supa', x: 1549, y: 420, name: 'Supabase services', icon: 'key', group: 'database', parts: ['supabase'], what: 'Sign-in (Auth), the API, and the Edge Functions for invites, email and sign-in codes.' },
  { id: 'intake', z: 'supa', x: 1549, y: 560, name: 'Work arriving', icon: 'login', group: 'safety', parts: [], kinds: ['work-refused', 'events-invalid', 'upload-delay', 'clock-ahead'], what: 'The server checks each change at the door. The server refuses bad work and tells the phone why. The dashboard also sees late work and wrong phone clocks.' },
  { id: 'v2', z: 'supa', x: 1549, y: 690, name: 'LangQuest v2 import', icon: 'down', group: 'jobs', parts: ['v2'], kinds: ['v2-sign-in-failures'], what: 'Brings projects from LangQuest v2. People can sign in with a v2 account.' },
  { id: 'database', z: 'supa', x: 1763, y: 560, name: 'Database', icon: 'db', group: 'database', parts: ['database', 'dbdetail'], kinds: ['db-disk-full', 'db-disk-weeks'], what: 'Postgres on Supabase. The database keeps each organization\'s and each language\'s list of changes.' },
  { id: 'jobs', z: 'supa', x: 1763, y: 740, name: 'Server jobs', icon: 'cog', group: 'jobs', parts: ['jobs', 'container'], kinds: ['-push-delivery-low'], what: 'Scheduled work in containers: the projection pass, the v2 import, exports and more. Run now starts a job.' },
  { id: 'cron', z: 'supa', x: 1763, y: 880, name: 'Database timers', icon: 'clock', group: 'jobs', parts: ['cron'], what: 'Jobs that the database starts on a timer (pg_cron). For example, push delivery every minute.' },
  { id: 'backups', z: 'supa', x: 1977, y: 420, name: 'Backups', icon: 'archive', group: 'storage', parts: [], kinds: ['backup-old'], what: 'The database backup. The dashboard warns when the newest backup is old.' },
  { id: 'fold', z: 'supa', x: 1977, y: 560, name: 'Fold and snapshots', icon: 'layers', group: 'safety', parts: [], kinds: ['fold-canary-mismatch', 'projection-lag', 'snapshots-overdue', 'snapshots-old-reducer'], what: 'Server jobs read each language\'s changes and build what the dashboards show. Snapshots make first downloads quick. A nightly check compares the snapshots with a fresh fold.' },
  { id: 'push', z: 'supa', x: 1977, y: 880, name: 'Push notifications', icon: 'bell', group: 'jobs', parts: ['push'], kinds: ['push-delivery-low'], what: 'Notifications to a phone when a teammate needs that person.' },
  { id: 'support', z: 'care', x: 2216, y: 352, name: 'Support', icon: 'buoy', group: 'support', parts: ['support', 'feedback'], what: 'Content reports, suspensions, deletions and feedback that wait for staff.' },
  { id: 'userreports', z: 'care', x: 2216, y: 456, name: 'User reports', icon: 'chat', group: 'userreports', parts: ['userreports'], what: 'Problems and ideas that people send from help mode in the app.' },
  { id: 'watch', z: 'care', x: 2216, y: 560, name: 'Watch for user issues', icon: 'eye', group: 'userissues', parts: ['userissues'], kinds: ['-user-issues-open'], what: 'Every 15 minutes, Claude reads new problems from phones, server jobs and user reports. Claude files each real problem in Linear.' },
  { id: 'research', z: 'care', x: 2216, y: 770, name: 'Research team', icon: 'search', group: 'research', parts: ['research'], what: 'Each day, Claude looks for security holes, new versions and one more subject.' },
  { id: 'roadmap', z: 'care', x: 2441, y: 352, name: 'Public roadmap', icon: 'road', group: 'roadmap', parts: ['roadmap'], what: 'The roadmap page on the website. Anyone can say how important an item is, write why, and suggest a new item.' },
  { id: 'linear', z: 'care', x: 2441, y: 560, name: 'Linear', icon: 'list', group: 'userissues', parts: [], kinds: ['user-issues-open'], what: 'Linear keeps every issue and its state. The dashboard reads Linear.' },
  { id: 'fixteam', z: 'care', x: 2441, y: 770, name: 'Agent fix team', icon: 'wrench', group: 'userissues', parts: [], what: 'Claude writes a fix for each issue as a pull request, the most important issue first. The dashboard shows its work on User issues; it has no line of its own.' },
  { id: 'filming', z: 'video', x: 616, y: 105, name: 'Tutorial filming', icon: 'video', group: 'tutorials', parts: ['videos'], what: 'Each night, GitHub Actions film the how-to videos in each app language.' },
  { id: 'youtube', z: 'video', x: 1309, y: 105, name: 'YouTube channels', icon: 'yt', group: 'tutorials', parts: ['tutorials'], what: 'One channel for each app language. New films wait for Publish.' },
  { id: 'videofeedback', z: 'video', x: 2216, y: 105, name: 'Video comments and notes', icon: 'note', group: 'tutorials', parts: ['videofeedback'], what: 'Comments, suggestions and notes about the videos. Accepted changes go to Linear.' },
  { id: 'expiry', z: 'access', x: 616, y: 1118, name: 'Expiry dates', icon: 'cal', group: 'access', parts: ['expiry'], what: 'Keys, tokens and certificates that stop working on a date.' },
  { id: 'limits', z: 'access', x: 1309, y: 1118, name: 'Limits and Global Viewers', icon: 'gauge', group: 'access', parts: ['security'], kinds: ['-v2-sign-in-failures'], what: 'Rate limits that refused requests, the diagnostics cap, and the people who can see every organization.' },
  { id: 'integrations', z: 'access', x: 1549, y: 1118, name: 'Integrations', icon: 'link', group: 'access', parts: ['integrations'], what: 'Other apps that connect with tokens, webhooks and review links.' },
  { id: 'claudeplan', z: 'access', x: 2216, y: 1118, name: 'Frontier Claude plan', icon: 'battery', group: 'access', parts: ['claudeplan'], what: 'How much of this week\'s Claude plan the automatic jobs and the fix team used.' }
];
/** [from, to, what passes, options]: from and to are the sides (r l t b); orth routes at right angles along y; spine is the main path, loop goes back to the left. */
const SM_EDGES = [
  ['people', 'phones', 'People record, check and publish work', { cls: 'spine' }],
  ['phones', 'appworker', 'Sync: work and recordings go up and come down', { cls: 'spine' }],
  ['appworker', 'intake', 'Each change goes in through the door', { cls: 'spine' }],
  ['intake', 'database', 'Accepted work is kept', { cls: 'spine' }],
  ['database', 'fold', 'Each language\'s changes', { cls: 'spine' }],
  ['github', 'shipped', 'Merges and migrations'],
  ['github', 'eas', 'Phone builds and updates'],
  ['github', 'nightly', 'Tests on main each night'],
  ['github', 'webapp', 'A merge deploys the web app', { from: 'l', orth: 192 }],
  ['github', 'workers', 'A merge deploys the Workers', { from: 'l', orth: 192 }],
  ['github', 'filming', 'The film run each night', { from: 'l', orth: 105 }],
  ['shipped', 'database', 'Migrations', { from: 't', to: 't', orth: 322 }],
  ['eas', 'storepipe', 'Store builds', { from: 'b', to: 't' }],
  ['storepipe', 'appstore', 'iPhone builds to review'],
  ['storepipe', 'googleplay', 'Android builds to review'],
  ['eas', 'fleet', 'Over-the-air updates reach phones'],
  ['appstore', 'fleet', 'Store builds reach phones'],
  ['googleplay', 'fleet', 'Store builds reach phones'],
  ['fleet', 'phones', 'The build each phone runs'],
  ['nearby', 'phones', 'Work passes between phones with no internet'],
  ['phones', 'supa', 'Sign-in, invites and email codes'],
  ['appworker', 'r2', 'Recordings, named by hash', { from: 'b', to: 't' }],
  ['v2', 'database', 'Old projects come in', { to: 'b', toDx: -50 }],
  ['database', 'backups', 'Daily backup', { from: 't', to: 'l' }],
  ['jobs', 'fold', 'The projection pass and snapshots run as jobs', { to: 'b' }],
  ['jobs', 'r2', 'Nightly check of the bucket against the log', { from: 'b', to: 'b', orth: 812 }],
  ['cron', 'push', 'Starts push delivery each minute'],
  ['push', 'phones', 'Notifications back to phones', { from: 'b', to: 'b', orth: 968, cls: 'loop', always: true }],
  ['phones', 'support', 'Content reports and feedback', { from: 't', orth: 218 }],
  ['phones', 'userreports', 'Help mode: a problem or an idea', { from: 't', orth: 218 }],
  ['phones', 'watch', 'Field diagnostics: errors and crashes', { from: 't', orth: 218, always: true }],
  ['jobs', 'watch', 'Server jobs in trouble'],
  ['userreports', 'watch', 'Each problem a person sent', { from: 'b', to: 't' }],
  ['watch', 'linear', 'Files real problems'],
  ['nightly', 'linear', 'Failed tests', { from: 'b', orth: 938 }],
  ['linear', 'fixteam', 'Most important issue first', { from: 'b', to: 't' }],
  ['research', 'fixteam', 'Findings to fix'],
  ['fixteam', 'github', 'Fix merged into main', { from: 'b', to: 'b', orth: 1032, cls: 'loop', always: true }],
  ['filming', 'youtube', 'Films, after Publish'],
  ['youtube', 'videofeedback', 'Comments'],
  ['videofeedback', 'linear', 'Accepted changes', { to: 't' }],
  ['claudeplan', 'fixteam', 'The fix team uses the plan', { from: 't', to: 'b' }]
];
/** Two walk-throughs: [box, the box the step comes from, what happens there]. */
const SM_TOURS = {
  rec: { title: 'Follow a recording', steps: [
    ['people', null, 'A translator records a verse on a phone. The phone keeps the recording, also with no internet.'],
    ['phones', 'people', 'The phone saves the work at once. Problems here: recording fails, a full disk, lost files.'],
    ['appworker', 'phones', 'With internet, the phone sends the work to the App Worker. Problems here: slow routes, server errors, refused uploads.'],
    ['r2', 'appworker', 'The recording goes to the R2 bucket, named by its hash. Problems here: a recording is missing from R2.'],
    ['intake', 'appworker', 'The server checks the change at the door. Problems here: refused work, late work, a wrong phone clock.'],
    ['database', 'intake', 'The database keeps the change in the language\'s list. Problems here: connections, slow calls, a full disk.'],
    ['fold', 'database', 'Server jobs fold the list for the dashboards and the snapshots. Problems here: a language falls behind, old snapshots.'],
    ['push', 'cron', 'A database timer starts push delivery. The teammate gets a notification. Problems here: pushes fail or wait.'],
    ['phones', 'push', 'The teammate\'s phone pulls the new work and plays the recording.']
  ] },
  fix: { title: 'Follow a fix', steps: [
    ['phones', null, 'A phone meets an error. The phone sends a code in its field diagnostics, never the content.'],
    ['watch', 'phones', 'Every 15 minutes, the watch for user issues reads the new errors. Claude decides if the error is real.'],
    ['linear', 'watch', 'Claude files a real problem as a Linear issue, or adds it to an issue the team has.'],
    ['fixteam', 'linear', 'The agent fix team takes the most important issue first and writes a fix.'],
    ['github', 'fixteam', 'The fix goes to GitHub as a pull request. The checks run. A merge into main is a release.'],
    ['eas', 'github', 'A change in JavaScript goes out as an over-the-air update. A change in native code needs a new store build.'],
    ['fleet', 'eas', 'Phones get the update. The dashboard counts how many phones run the new build.'],
    ['phones', 'fleet', 'The error stops on new builds. The dashboard moves the line to Resolved after its next check.']
  ] }
};

/** Each box with its kinds of line (keys of KINDS) and the parts its state comes from. "unreadable" belongs to every part, so to no box. */
function smNodesOf(kinds) {
  return SM_NODES.map((n) => {
    const set = new Set();
    for (const k of Object.keys(kinds)) if (k !== 'unreadable' && n.parts.includes(kinds[k].part)) set.add(k);
    for (const k of n.kinds || []) { if (k.startsWith('-')) set.delete(k.slice(1)); else if (kinds[k]) set.add(k); }
    const list = [...set];
    const src = [...new Set(n.parts.concat(list.map((k) => kinds[k].part)))];
    return Object.assign({}, n, { list, src });
  });
}

const SM_SAID = { problem: 'Fix soon', watch: 'Watch', error: 'Could not read', wait: 'Loading…', off: 'Not connected', ok: 'Working', none: 'No check of its own' };

/** A box now: its open lines (the page's results, after resolves) of its own kinds, most urgent first, and one state. */
function smStateOf(node, results, levels) {
  const rank = (l) => { const i = levels.indexOf(l); return i < 0 ? levels.length : i; };
  const open = [];
  for (const p of node.src) {
    const s = results[p];
    for (const a of (s && s.alerts) || []) if (node.list.includes(a.key)) open.push(Object.assign({ part: p }, a));
  }
  open.sort((a, b) => rank(a.level) - rank(b.level));
  let state;
  if (!node.src.length) state = 'none';
  else if (open.some((a) => a.level !== 'watch' && levels.includes(a.level))) state = 'problem';
  else if (open.length) state = 'watch';
  else {
    const got = node.src.map((p) => results[p]);
    state = got.some((s) => s && s.state === 'error') ? 'error' : got.some((s) => !s) ? 'wait' : got.every((s) => s.state === 'off') ? 'off' : 'ok';
  }
  return { state, said: SM_SAID[state], open };
}

/** The words of a search, and whether a kind or a box holds all of them. */
function smWords(q) { return String(q || '').toLowerCase().split(/\s+/).filter(Boolean); }
function smKindMatch(kind, words) { const t = (kind.title + ' ' + (kind.part || '')).toLowerCase(); return words.length > 0 && words.every((w) => t.includes(w)); }
function smNodeMatch(node, kinds, words) {
  if (!words.length) return false;
  return node.list.some((k) => smKindMatch(kinds[k], words)) || words.every((w) => (node.name + ' ' + node.what).toLowerCase().includes(w));
}
`;

/** Drawing the map, zoom and move, the panel, the walk-throughs and the search. */
export const SYSMAP_SCRIPT = String.raw`
const SM_ICON = {
  road: 'M4 6h9M4 12h13M4 18h6M15 6a2 2 0 1 0 4 0 2 2 0 1 0-4 0M18 18a2 2 0 1 0 4 0 2 2 0 1 0-4 0',
  branch: 'M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9a9 9 0 0 1-9 9',
  rocket: 'M4.5 16.5c-1.5 1.3-2 5-2 5s3.7-.5 5-2c.7-.8.7-2.1-.1-2.9a2.2 2.2 0 0 0-2.9-.1zM12 15l-3-3a22 22 0 0 1 2-3.9A12.9 12.9 0 0 1 22 2c0 2.7-.8 7.5-6 11a22 22 0 0 1-4 2zM9 12H4s.6-3 2-4c1.6-1.1 5 0 5 0M12 15v5s3-.6 4-2c1.1-1.6 0-5 0-5',
  refresh: 'M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5',
  tray: 'M22 12h-6l-2 3h-4l-2-3H2M5.5 5h13L22 12v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
  bag: 'M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4zM3 6h18M16 10a4 4 0 0 1-8 0',
  play: 'M5 3l14 9-14 9z',
  people: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21v-1a6 6 0 0 1 12 0v1M16 3.5a4 4 0 0 1 0 7.5M22 21v-1a6 6 0 0 0-4-5.6',
  pkg: 'M12 2l9 5v10l-9 5-9-5V7zM3 7l9 5 9-5M12 12v10',
  signal: 'M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M2 9a15 15 0 0 1 20 0M12 19.5h.01',
  phone: 'M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM11 18h2',
  globe: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20',
  cloud: 'M18 10h-1.3A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM9 12l2 2 4-4',
  wave: 'M2 12h2M6 8v8M10 4v16M14 7v10M18 10v4M22 12h-1',
  key: 'M15.5 7.5L19 4M21 2l-2 2M18 5l3 3M11.4 11.6a5.5 5.5 0 1 1-7.8 7.8 5.5 5.5 0 0 1 7.8-7.8zm0 0l4.1-4.1',
  login: 'M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3',
  down: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  db: 'M12 8c5 0 9-1.3 9-3s-4-3-9-3-9 1.3-9 3 4 3 9 3zM3 5v14c0 1.7 4 3 9 3s9-1.3 9-3V5M3 12c0 1.7 4 3 9 3s9-1.3 9-3',
  cog: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1L7 17M17 7l2.1-2.1',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
  archive: 'M21 8v13H3V8M1 3h22v5H1zM10 12h4',
  layers: 'M12 2L2 7l10 5 10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
  bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0',
  buoy: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.9 4.9l4.3 4.3M14.8 14.8l4.3 4.3M14.8 9.2l4.3-4.3M4.9 19.1l4.3-4.3',
  chat: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  eye: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
  list: 'M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01',
  wrench: 'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9z',
  video: 'M23 7l-7 5 7 5zM3 5h11a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z',
  yt: 'M2.5 17a24 24 0 0 1 0-10 2 2 0 0 1 1.4-1.4 49 49 0 0 1 16.2 0A2 2 0 0 1 21.5 7a24 24 0 0 1 0 10 2 2 0 0 1-1.4 1.4 49 49 0 0 1-16.2 0A2 2 0 0 1 2.5 17zM10 15l5-3-5-3z',
  note: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2zM8 9h8M8 13h5',
  gauge: 'M12 14l4-4M3.3 19a10 10 0 1 1 17.4 0',
  link: 'M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7',
  cal: 'M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM16 2v4M8 2v4M3 10h18',
  battery: 'M3 7h14a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2zM23 13v-2M5 10v4M8 10v4'
};
const SM_NS = 'http://www.w3.org/2000/svg';
const sm = { built: false, nodes: [], byId: {}, live: {}, sel: null, hover: null, tour: null, step: 0, query: '', scale: 1, fitted: true, drag: null, moved: false, raf: 0, flows: [], labels: [] };

function smAnchor(n, side, dx) {
  const hw = SM_NW / 2, hh = SM_NH / 2;
  return { r: [n.x + hw, n.y], l: [n.x - hw, n.y], t: [n.x + (dx || 0), n.y - hh], b: [n.x + (dx || 0), n.y + hh] }[side];
}
const SM_NORM = { r: [1, 0], l: [-1, 0], t: [0, -1], b: [0, 1] };
function smRound(pts) {
  const p = pts.filter((q, i) => i === 0 || q[0] !== pts[i - 1][0] || q[1] !== pts[i - 1][1]);
  let d = 'M' + p[0][0] + ',' + p[0][1];
  for (let i = 1; i < p.length - 1; i++) {
    const a = p[i - 1], b = p[i], c = p[i + 1];
    const l1 = Math.hypot(b[0] - a[0], b[1] - a[1]), l2 = Math.hypot(c[0] - b[0], c[1] - b[1]), k = Math.min(16, l1 / 2, l2 / 2);
    d += ' L' + (b[0] - (b[0] - a[0]) / l1 * k) + ',' + (b[1] - (b[1] - a[1]) / l1 * k) + ' Q' + b[0] + ',' + b[1] + ' ' + (b[0] + (c[0] - b[0]) / l2 * k) + ',' + (b[1] + (c[1] - b[1]) / l2 * k);
  }
  const z = p[p.length - 1];
  return d + ' L' + z[0] + ',' + z[1];
}
function smPath(e) {
  const A = sm.byId[e[0]], B = sm.byId[e[1]], o = e[3] || {};
  const fs = o.from || 'r', ts = o.to || 'l', S = smAnchor(A, fs), T = smAnchor(B, ts, o.toDx);
  if (o.orth !== undefined) {
    const y = o.orth, pts = [S];
    if (fs === 'r') pts.push([S[0] + 18, S[1]], [S[0] + 18, y]);
    else if (fs === 'l') pts.push([S[0] - 28, S[1]], [S[0] - 28, y]);
    else pts.push([S[0], y]);
    if (ts === 'l') pts.push([T[0] - 18, y], [T[0] - 18, T[1]], T); else pts.push([T[0], y], T);
    return smRound(pts);
  }
  const d = Math.max(36, Math.hypot(T[0] - S[0], T[1] - S[1]) * 0.38);
  return 'M' + S[0] + ',' + S[1] + ' C' + (S[0] + SM_NORM[fs][0] * d) + ',' + (S[1] + SM_NORM[fs][1] * d) + ' ' + (T[0] + SM_NORM[ts][0] * d) + ',' + (T[1] + SM_NORM[ts][1] * d) + ' ' + T[0] + ',' + T[1];
}

/** Draws the canvas once; later answers only change each box's state (smLive). */
function smBuild() {
  const canvas = $('sm-canvas');
  if (!canvas || sm.built) return;
  sm.built = true;
  sm.nodes = smNodesOf(KINDS);
  sm.byId = Object.fromEntries(sm.nodes.map((n) => [n.id, n]));
  canvas.style.width = SM_W + 'px'; canvas.style.height = SM_H + 'px';
  const kindsIn = (z) => sm.nodes.filter((n) => n.z === z).reduce((a, n) => a + n.list.length, 0);
  let s = '<svg viewBox="0 0 ' + SM_W + ' ' + SM_H + '" width="' + SM_W + '" height="' + SM_H + '" aria-hidden="true"><defs>' +
    ['smmk', 'smmk-spine', 'smmk-hi'].map((m) => '<marker id="' + m + '" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="' + m + '" d="M0,1 L9,5 L0,9 z"/></marker>').join('') + '</defs>';
  for (const id of Object.keys(SM_ZONES)) {
    const z = SM_ZONES[id], kn = kindsIn(id) + ' kinds of problem';
    if (z.lane) {
      const lx = z.right ? SM_W - 36 : 36, an = z.right ? 'end' : 'start';
      s += '<rect class="smlane smz-' + id + '" x="14" y="' + z.lane[0] + '" width="' + (SM_W - 28) + '" height="' + (z.lane[1] - z.lane[0]) + '" rx="18"/>' +
        '<text class="smbl smz-' + id + '" text-anchor="' + an + '" x="' + lx + '" y="' + (z.lane[0] + 50) + '">' + esc(z.name) + '</text><text class="smbs" text-anchor="' + an + '" x="' + lx + '" y="' + (z.lane[0] + 76) + '">' + kn + '</text>';
    } else {
      const xs = sm.nodes.filter((n) => n.z === id).map((n) => n.x), x0 = Math.min(...xs) - SM_NW / 2 - 16, x1 = Math.max(...xs) + SM_NW / 2 + 16;
      s += '<rect class="smband smz-' + id + '" x="' + x0 + '" y="' + SM_BAND_Y + '" width="' + (x1 - x0) + '" height="' + SM_BAND_H + '" rx="22"/>' +
        '<text class="smbl smz-' + id + '" x="' + (x0 + 18) + '" y="' + (SM_BAND_Y + 34) + '">' + esc(z.name) + '</text><text class="smbs" x="' + (x0 + 18) + '" y="' + (SM_BAND_Y + 58) + '">' + kn + '</text>';
    }
  }
  // How to read the map, in the bottom lane.
  const lx = 262, ly = SM_ZONES.access.lane[0] + 20;
  s += '<g class="smkey"><text class="smkt" x="' + lx + '" y="' + (ly + 8) + '">How to read the map</text>' +
    '<path d="M' + lx + ',' + (ly + 30) + 'h44" fill="none" stroke-width="3.2" class="smedge spine" marker-end="url(#smmk-spine)"/><text x="' + (lx + 58) + '" y="' + (ly + 35) + '">Main path of the work</text>' +
    '<path d="M' + lx + ',' + (ly + 56) + 'h44" fill="none" class="smedge loop" marker-end="url(#smmk)"/><text x="' + (lx + 58) + '" y="' + (ly + 61) + '">Loop back to the left</text>' +
    '<circle class="ok" cx="' + (lx + 6) + '" cy="' + (ly + 82) + '" r="6"/><circle class="watch" cx="' + (lx + 22) + '" cy="' + (ly + 82) + '" r="6"/><circle class="problem" cx="' + (lx + 38) + '" cy="' + (ly + 82) + '" r="6"/>' +
    '<text x="' + (lx + 58) + '" y="' + (ly + 87) + '">Working, watch, fix soon</text></g>';
  s += '<g id="sm-edges"></g><g id="sm-flows"></g><g id="sm-labels"></g><circle id="sm-dot" class="smdot" r="8" display="none"/></svg>';
  canvas.innerHTML = s;
  const edges = $('sm-edges');
  SM_EDGES.forEach((e, i) => {
    const p = document.createElementNS(SM_NS, 'path');
    p.setAttribute('d', smPath(e)); p.setAttribute('class', 'smedge ' + ((e[3] && e[3].cls) || '')); p.dataset.i = String(i);
    edges.appendChild(p);
  });
  canvas.insertAdjacentHTML('beforeend', sm.nodes.map((n) => '<button type="button" class="smnode smz-' + n.z + '" data-sm="' + n.id + '" aria-pressed="false">' +
    '<span class="smic"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + SM_ICON[n.icon] + '"/></svg></span><span class="smnm">' + esc(n.name) + '</span>' +
    '<span class="smst" role="img"></span><span class="smct" hidden></span></button>').join(''));
  for (const el of canvas.querySelectorAll('.smnode')) {
    const n = sm.byId[el.dataset.sm];
    el.style.left = (n.x - SM_NW / 2) + 'px'; el.style.top = (n.y - SM_NH / 2) + 'px'; el.style.width = SM_NW + 'px'; el.style.height = SM_NH + 'px';
  }
  smFlows();
  smEvents();
  smFit();
}

/** Each box's state from the parts the page has now; the open panel follows. */
function smLive() {
  if (!sm.built) return;
  for (const n of sm.nodes) sm.live[n.id] = smStateOf(n, results, LEVELS);
  for (const el of $('sm-canvas').querySelectorAll('.smnode')) {
    const n = sm.byId[el.dataset.sm], l = sm.live[n.id];
    for (const c of ['ok', 'watch', 'problem', 'error', 'wait', 'off', 'none']) el.classList.toggle(c, c === l.state);
    el.querySelector('.smst').setAttribute('aria-label', l.said);
    const ct = el.querySelector('.smct');
    ct.hidden = !l.open.length; ct.textContent = String(l.open.length);
    el.setAttribute('aria-label', n.name + ': ' + l.said + (l.open.length ? ', ' + l.open.length + ' open' : '') + '. ' + n.list.length + ' kinds of problem.');
  }
  smPaint();
}

function smLabel(p, text, cls) {
  const len = p.getTotalLength();
  if (len < 90) return;
  const e = SM_EDGES[Number(p.dataset.i)], o = e[3] || {};
  const pt = p.getPointAtLength(o.orth === undefined ? len / 2 : o.cls === 'loop' ? len * 0.5 : len * 0.62);
  const g = document.createElementNS(SM_NS, 'g'); g.setAttribute('class', 'smlbl ' + cls);
  const t = document.createElementNS(SM_NS, 'text'); t.textContent = text; t.setAttribute('x', pt.x); t.setAttribute('y', pt.y + 5); t.setAttribute('text-anchor', 'middle');
  g.appendChild(t); $('sm-labels').appendChild(g);
  const bb = t.getBBox(), r = document.createElementNS(SM_NS, 'rect');
  r.setAttribute('x', bb.x - 9); r.setAttribute('y', bb.y - 5); r.setAttribute('width', bb.width + 18); r.setAttribute('height', bb.height + 10); r.setAttribute('rx', 8);
  g.insertBefore(r, t);
  // A label that would cover another one moves down.
  const hit = (b) => sm.labels.some((c) => b.x < c.x + c.w && c.x < b.x + b.w && b.y < c.y + c.h && c.y < b.y + b.h);
  const b0 = { x: bb.x - 9, y: bb.y - 5, w: bb.width + 18, h: bb.height + 10 };
  let dy = 0;
  while (hit({ x: b0.x, y: b0.y + dy, w: b0.w, h: b0.h }) && dy < 6 * (b0.h + 4)) dy += b0.h + 4;
  if (dy) g.setAttribute('transform', 'translate(0 ' + dy + ')');
  sm.labels.push({ x: b0.x, y: b0.y + dy, w: b0.w, h: b0.h });
}

function smPaint() {
  if (!sm.built) return;
  const focus = sm.tour ? null : (sm.hover || sm.sel), words = smWords(sm.query);
  const match = (id) => smNodeMatch(sm.byId[id], KINDS, words);
  const canvas = $('sm-canvas');
  for (const el of canvas.querySelectorAll('.smnode')) {
    const id = el.dataset.sm;
    el.setAttribute('aria-pressed', String(!sm.tour && id === sm.sel));
    el.classList.toggle('smstep', Boolean(sm.tour) && SM_TOURS[sm.tour].steps[sm.step][0] === id);
    el.classList.toggle('smlit', sm.tour ? SM_TOURS[sm.tour].steps.slice(0, sm.step + 1).some((x) => x[0] === id) : words.length ? match(id) : false);
    el.classList.toggle('smmatch', !sm.tour && words.length > 0 && match(id));
  }
  canvas.classList.toggle('smdim', Boolean(sm.tour || words.length));
  canvas.classList.toggle('smbusy', Boolean(focus));
  $('sm-qn').textContent = words.length ? sm.nodes.filter((n) => match(n.id)).length + ' boxes' : '';
  $('sm-t-rec').setAttribute('aria-pressed', String(sm.tour === 'rec'));
  $('sm-t-fix').setAttribute('aria-pressed', String(sm.tour === 'fix'));
  let tourEdge = null;
  if (sm.tour) { const st = SM_TOURS[sm.tour].steps[sm.step]; if (st[1]) tourEdge = [st[1], st[0]]; }
  $('sm-labels').textContent = ''; sm.labels = [];
  let tourPath = null;
  for (const p of $('sm-edges').querySelectorAll('.smedge')) {
    const e = SM_EDGES[Number(p.dataset.i)], a = e[0], b = e[1], o = e[3] || {};
    const isTour = Boolean(tourEdge) && ((a === tourEdge[0] && b === tourEdge[1]) || (a === tourEdge[1] && b === tourEdge[0]));
    const on = Boolean(focus) && (a === focus || b === focus);
    if (isTour) tourPath = p;
    p.classList.toggle('tour', isTour); p.classList.toggle('on', on);
    p.classList.toggle('faint', (Boolean(focus) && !on) || (Boolean(sm.tour) && !isTour) || (words.length > 0 && !(match(a) && match(b))));
    p.setAttribute('marker-end', 'url(#' + (isTour || on ? 'smmk-hi' : o.cls === 'spine' ? 'smmk-spine' : 'smmk') + ')');
    if (on || isTour) smLabel(p, e[2], 'hi');
    else if (o.always && !focus && !sm.tour && !words.length) smLabel(p, e[2], 'loopl');
  }
  smDot(tourPath, tourEdge);
  if (sm.tour) smPanelTour(); else if (sm.sel) smPanelNode(); else $('sm-panel').hidden = true;
  smSize();
}

function smDot(p, edge) {
  const dot = $('sm-dot');
  cancelAnimationFrame(sm.raf);
  if (!p || matchMedia('(prefers-reduced-motion: reduce)').matches) { dot.setAttribute('display', 'none'); return; }
  const fwd = SM_EDGES[Number(p.dataset.i)][0] === edge[0], len = p.getTotalLength(), t0 = performance.now();
  dot.setAttribute('display', 'inline');
  const tick = (now) => {
    const t = ((now - t0) % 1800) / 1800, k = t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2, pt = p.getPointAtLength((fwd ? k : 1 - k) * len);
    dot.setAttribute('cx', pt.x); dot.setAttribute('cy', pt.y);
    sm.raf = requestAnimationFrame(tick);
  };
  sm.raf = requestAnimationFrame(tick);
}

/** Small dots that move along the main path and the two loops, only while the map is on the screen. */
function smFlows() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  for (const p of $('sm-edges').querySelectorAll('.smedge.spine, .smedge.loop')) {
    const len = p.getTotalLength(), loop = p.classList.contains('loop'), k = loop ? 3 : 2;
    for (let j = 0; j < k; j++) {
      const c = document.createElementNS(SM_NS, 'circle'); c.setAttribute('r', loop ? 4.5 : 5.5); c.setAttribute('class', 'smflowdot' + (loop ? ' loopd' : ''));
      $('sm-flows').appendChild(c); sm.flows.push({ p, len, c, off: j / k, period: Math.max(2600, len * (loop ? 9 : 22)) });
    }
  }
  const run = (now) => {
    const f = $('sm-frame');
    if (f && f.offsetParent !== null && !document.hidden) for (const x of sm.flows) { const pt = x.p.getPointAtLength(((now / x.period + x.off) % 1) * x.len); x.c.setAttribute('cx', pt.x); x.c.setAttribute('cy', pt.y); }
    requestAnimationFrame(run);
  };
  requestAnimationFrame(run);
}

function smPanelNode() {
  const n = sm.byId[sm.sel], l = sm.live[n.id] || { state: 'wait', said: SM_SAID.wait, open: [] }, P = $('sm-panel'), words = smWords(sm.query);
  const openKeys = new Map(l.open.map((a) => [a.key, a]));
  const kinds = n.list.map((k) => Object.assign({ key: k }, KINDS[k])).sort((a, b) => (openKeys.has(b.key) - openKeys.has(a.key)) || (smKindMatch(b, words) - smKindMatch(a, words)) || a.title.localeCompare(b.title));
  P.hidden = false; P.classList.remove('smtourp'); P.className = 'smpanel smz-' + n.z;
  const nowSaid = l.open.length ? l.open.length + (l.open.length === 1 ? ' line open now' : ' lines open now') : l.said;
  P.innerHTML = '<button type="button" class="smx" id="sm-x" aria-label="Close">×</button>' +
    '<div class="smeb">' + esc(SM_ZONES[n.z].name) + '</div><h3>' + esc(n.name) + '</h3>' +
    '<p class="smnow ' + esc(l.state) + '">' + esc(nowSaid) + '</p><p class="smwhat">' + esc(n.what) + '</p>' +
    '<a class="smgo" href="#g/' + esc(n.group) + '">Open ' + esc(titleOf(n.group)) + ' →</a>' +
    '<h4>What can go wrong (' + kinds.length + ')</h4>' +
    (kinds.length ? '<ul class="smkinds">' + kinds.map((k) => {
      const a = openKeys.get(k.key), cls = a ? (a.level === 'watch' ? 'openw' : 'open') : '';
      const title = smKindMatch(k, words) ? '<mark class="smm">' + esc(k.title) + '</mark>' : esc(k.title);
      return '<li class="' + cls + '"><span class="smkt">' + title + '</span><span class="smkw">' + (a ? '<a href="' + esc(cardHref(n.group, lineCardId(a))) + '">Open now: ' + esc(a.level === 'watch' ? 'watch' : 'fix soon') + ' →</a>' : '<span>Not open now</span>') +
        (k.person ? '<span>A person acts on a page</span>' : '') + '</span></li>';
    }).join('') + '</ul>' : '<p class="muted">The dashboard shows this part, but it has no line of its own.</p>') +
    '<h4>Connected to</h4><ul class="smlinks">' + SM_EDGES.filter((e) => e[0] === n.id || e[1] === n.id).map((e) => {
      const out = e[0] === n.id, o = sm.byId[out ? e[1] : e[0]];
      return '<li><button type="button" class="smz-' + o.z + '" data-sm-go="' + o.id + '"><i></i><b>' + (out ? '' : '← ') + esc(o.name) + (out ? ' →' : '') + '</b><span>' + esc(e[2]) + '</span></button></li>';
    }).join('') + '</ul>';
  $('sm-x').addEventListener('click', () => { sm.sel = null; smPaint(); });
}

function smPanelTour() {
  const T = SM_TOURS[sm.tour], st = T.steps[sm.step], n = sm.byId[st[0]], P = $('sm-panel');
  P.hidden = false; P.className = 'smpanel smtourp smz-' + n.z;
  P.innerHTML = '<button type="button" class="smx" id="sm-x" aria-label="Stop">×</button><div class="smeb">' + esc(T.title) + '</div><h3>' + esc(n.name) + '</h3>' +
    '<span class="smstepno">Step ' + (sm.step + 1) + ' of ' + T.steps.length + '</span><p class="smsay">' + esc(st[2]) + '</p>' +
    '<div class="smnav"><button type="button" id="sm-back"' + (sm.step === 0 ? ' disabled' : '') + '>Back</button><button type="button" class="smpri" id="sm-next">' + (sm.step === T.steps.length - 1 ? 'Done' : 'Next') + '</button></div>';
  $('sm-x').addEventListener('click', () => { sm.tour = null; smPaint(); });
  $('sm-back').addEventListener('click', () => { sm.step--; smPaint(); smReveal(SM_TOURS[sm.tour].steps[sm.step][0]); });
  $('sm-next').addEventListener('click', () => {
    if (sm.step === T.steps.length - 1) { sm.tour = null; sm.sel = n.id; } else sm.step++;
    smPaint(); smReveal(sm.tour ? SM_TOURS[sm.tour].steps[sm.step][0] : sm.sel);
  });
}

function smPeek(id, el) {
  const pk = $('sm-peek');
  if (!id || sm.tour || id === sm.sel || matchMedia('(hover: none)').matches) { pk.hidden = true; return; }
  const n = sm.byId[id], l = sm.live[id] || { said: SM_SAID.wait, open: [] };
  const open = l.open.map((a) => ({ t: KINDS[a.key] ? KINDS[a.key].title : a.key, cls: a.level === 'watch' ? 'openw' : 'open' }));
  const openKeys = new Set(l.open.map((a) => a.key));
  const rest = n.list.filter((k) => !openKeys.has(k)).map((k) => ({ t: KINDS[k].title, cls: '' }));
  const all = open.concat(rest);
  pk.className = 'smpeek smz-' + n.z;
  pk.innerHTML = '<b>' + esc(n.name) + '</b><p class="smsaid">' + esc(l.open.length ? l.open.length + ' open now' : l.said) + ' · ' + n.list.length + ' kinds of problem</p>' +
    (all.length ? '<ul>' + all.slice(0, 4).map((x) => '<li class="' + x.cls + '">' + esc(x.t) + '</li>').join('') + '</ul>' : '') +
    '<div class="smmore">' + (all.length > 4 ? (all.length - 4) + ' more. ' : '') + 'Tap for each problem and its page.</div>';
  pk.hidden = false;
  const f = $('sm-frame').getBoundingClientRect(), r = el.getBoundingClientRect();
  let x = Math.max(10, Math.min(r.left - f.left, f.width - 310)), y = r.bottom - f.top + 10;
  if (y + pk.offsetHeight > f.height - 10) y = r.top - f.top - pk.offsetHeight - 10;
  pk.style.left = x + 'px'; pk.style.top = y + 'px';
}

// ---- Zoom and move ----
function smSize() {
  const vp = $('sm-vp'), sizer = $('sm-sizer');
  if (!vp) return;
  const open = !$('sm-panel').hidden && !matchMedia('(max-width: 760px)').matches;
  sizer.style.width = (SM_W * sm.scale + (open ? 410 : 0)) + 'px'; sizer.style.height = (SM_H * sm.scale) + 'px';
}
function smSetScale(s, cx, cy) {
  const vp = $('sm-vp');
  const px = cx === undefined ? vp.clientWidth / 2 : cx, py = cy === undefined ? vp.clientHeight / 2 : cy;
  const ax = (vp.scrollLeft + px) / sm.scale, ay = (vp.scrollTop + py) / sm.scale;
  sm.scale = Math.min(1.6, Math.max(0.3, s));
  $('sm-canvas').style.transform = 'scale(' + sm.scale + ')';
  smSize();
  vp.style.height = Math.min(SM_H * sm.scale, Math.max(420, innerHeight - 120)) + 'px';
  vp.scrollLeft = ax * sm.scale - px; vp.scrollTop = ay * sm.scale - py;
}
function smFit() {
  const vp = $('sm-vp');
  if (!vp || !vp.clientWidth) return;
  sm.fitted = true;
  smSetScale(Math.min(1, (vp.clientWidth - 2) / SM_W), 0, 0);
  vp.scrollLeft = 0; vp.scrollTop = 0;
}
function smReveal(id) {
  if (!id) return;
  const vp = $('sm-vp'), n = sm.byId[id], x = n.x * sm.scale, y = n.y * sm.scale;
  const w = vp.clientWidth - (matchMedia('(max-width: 760px)').matches || $('sm-panel').hidden ? 0 : 400);
  if (x < vp.scrollLeft + 110 || x > vp.scrollLeft + w - 110) vp.scrollTo({ left: x - w / 2, behavior: 'smooth' });
  if (y < vp.scrollTop + 60 || y > vp.scrollTop + vp.clientHeight - 60) vp.scrollTo({ top: y - vp.clientHeight / 2, behavior: 'smooth' });
}

function smEvents() {
  const vp = $('sm-vp'), canvas = $('sm-canvas');
  $('sm-z-in').addEventListener('click', () => { sm.fitted = false; smSetScale(sm.scale * 1.2); });
  $('sm-z-out').addEventListener('click', () => { sm.fitted = false; smSetScale(sm.scale / 1.2); });
  $('sm-z-fit').addEventListener('click', smFit);
  // A pinch on a trackpad, or Ctrl and the wheel, zooms where the pointer is; the wheel alone scrolls.
  vp.addEventListener('wheel', (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const r = vp.getBoundingClientRect();
    sm.fitted = false; smSetScale(sm.scale * Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });
  new ResizeObserver(() => { if (sm.fitted) smFit(); }).observe(vp);
  vp.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse' && e.button === 0) { sm.drag = { x: e.clientX, y: e.clientY, l: vp.scrollLeft, t: vp.scrollTop }; sm.moved = false; } });
  addEventListener('pointermove', (e) => {
    if (!sm.drag) return;
    const dx = e.clientX - sm.drag.x, dy = e.clientY - sm.drag.y;
    if (!sm.moved && Math.hypot(dx, dy) > 5) { sm.moved = true; vp.classList.add('smdrag'); $('sm-peek').hidden = true; }
    if (sm.moved) { vp.scrollLeft = sm.drag.l - dx; vp.scrollTop = sm.drag.t - dy; }
  });
  addEventListener('pointerup', () => { sm.drag = null; vp.classList.remove('smdrag'); });
  vp.addEventListener('scroll', () => { $('sm-peek').hidden = true; });
  canvas.addEventListener('click', (e) => {
    if (sm.moved) { sm.moved = false; return; }
    const b = e.target.closest('.smnode');
    if (!b) { if (sm.sel && !sm.tour) { sm.sel = null; smPaint(); } return; }
    sm.sel = b.dataset.sm; sm.tour = null; $('sm-peek').hidden = true; smPaint(); smReveal(sm.sel);
    if (matchMedia('(max-width: 760px)').matches) $('sm-panel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
  canvas.addEventListener('pointerover', (e) => {
    const b = e.target.closest('.smnode'), h = b ? b.dataset.sm : null;
    if (h !== sm.hover && !sm.drag) { sm.hover = h; smPaint(); smPeek(h, b); }
  });
  canvas.addEventListener('pointerleave', () => { $('sm-peek').hidden = true; if (sm.hover) { sm.hover = null; smPaint(); } });
  $('sm-panel').addEventListener('click', (e) => { const b = e.target.closest('[data-sm-go]'); if (!b) return; sm.sel = b.dataset.smGo; smPaint(); smReveal(sm.sel); });
  $('sm-q').addEventListener('input', (e) => { sm.query = e.target.value.trim(); sm.tour = null; smPaint(); });
  for (const [btn, key] of [['sm-t-rec', 'rec'], ['sm-t-fix', 'fix']]) $(btn).addEventListener('click', () => {
    sm.tour = sm.tour === key ? null : key; sm.step = 0; sm.sel = null; smPaint();
    if (sm.tour) smReveal(SM_TOURS[sm.tour].steps[0][0]);
  });
  $('sm-frame').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { sm.tour = null; sm.sel = null; smPaint(); return; }
    if (!sm.tour) return;
    if (e.key === 'ArrowRight' && sm.step < SM_TOURS[sm.tour].steps.length - 1) { sm.step++; smPaint(); smReveal(SM_TOURS[sm.tour].steps[sm.step][0]); }
    if (e.key === 'ArrowLeft' && sm.step > 0) { sm.step--; smPaint(); smReveal(SM_TOURS[sm.tour].steps[sm.step][0]); }
  });
}

/** The Overview calls this each time a part answers: the canvas once, then the states. */
function drawSysMap() { smBuild(); smLive(); }
`;
