/**
 * The Tutorial videos page's first part, laid out so an admin sees what to do
 * (docs/decisions/2026-11-19-the-tutorial-videos-page-opens-on-what-waits-on-you.md):
 * tabs with counts, opening on what waits on the admin, each thing a card with
 * its buttons; then what goes on by itself, every video with a timeline whose
 * marks are small pictures with a name, and the changes Claude made. A reply
 * Claude suggests for a comment is copied from its card and posted by a
 * person on YouTube; the card then takes Done, or No reply needed.
 * Plain JavaScript inside page.ts's script, like pageFixes.ts, after
 * pageOps.ts (its VIDEOS, adminCard, markDetail, perform and the timeline's
 * zoom); everything shown is escaped.
 */

/** The look, inside page.ts's style element. */
export const VIDEO_CSS = String.raw`
.vtabs { display: flex; flex-wrap: wrap; gap: 4px; padding: 4px; margin: 12px 0; background: var(--soft); border-radius: 12px; width: fit-content; max-width: 100%; }
.vtabs button { min-height: 48px; padding: 0 14px; border: 0; border-radius: 9px; background: none; color: var(--ink2); font-weight: 500; font-size: 14px; display: inline-flex; gap: 8px; align-items: center; }
.vtabs button[aria-selected="true"] { background: var(--raised); color: var(--ink); font-weight: 600; box-shadow: 0 1px 2px rgb(0 0 0 / .1); }
.vtabs .count { font-size: 12px; font-weight: 600; padding: 1px 8px; border-radius: 999px; background: var(--line); color: var(--ink); font-variant-numeric: tabular-nums; }
.vtabs .count.you { background: var(--amber); color: #fff; }
.vnone { display: flex; gap: 12px; align-items: center; padding: 20px 4px; font-size: 16px; font-weight: 600; }
.vnone svg { width: 36px; height: 36px; flex: none; fill: none; stroke: var(--green); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.vq { container-type: inline-size; }
.vjobs { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 0 16px; }
.vjob { display: grid; grid-template-columns: 28px minmax(0, 1fr); gap: 10px; align-items: start; padding: 10px 0; border-top: 1px solid var(--line); }
.vjob p { margin: 0 0 2px; } .vjob small { color: var(--muted); }
.vdot { width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center; background: var(--soft); color: var(--muted); }
.vdot svg, .vst svg, .mk svg, .vkey svg, .vneed svg, .vretry svg, .vreply button svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
.vdot.now { background: var(--primary); color: #fff; }
/* A video's row: a mark of its state, its name, its state in a word, its newest film and why; its timeline; what waits. */
.vrow { grid-template-columns: minmax(220px, 340px) 1fr; padding: 8px 0; align-items: start; }
.vrow.head { align-items: end; padding: 0; border-top: 0; }
.vname { display: grid; grid-template-columns: 24px minmax(0, 1fr); gap: 8px; align-items: start; }
.vname b { font-size: 14px; }
.vst { width: 24px; height: 24px; border-radius: 50%; display: grid; place-items: center; background: var(--soft); color: var(--muted); }
.vst.good { background: var(--greenbg); color: var(--green); } .vst.you { background: var(--amber); color: #fff; } .vst.bad { background: var(--redbg); color: var(--red); }
.vst.info { background: var(--soft); color: var(--primary); }
.vstates { display: flex; flex-wrap: wrap; gap: 4px; margin: 3px 0; align-items: center; } .vstates .tag { margin: 0; }
.vstates a.tag { text-decoration: none; } .vstates a.tag::after { content: ' ↗'; }
.vfilm { display: flex; flex-wrap: wrap; gap: 2px 8px; align-items: center; font-size: 12px; color: var(--muted); }
.vcause { display: inline-flex; gap: 4px; align-items: center; } .vcause a { color: var(--primary); font-weight: 600; }
.vneed { min-height: 32px; padding: 0 10px 0 12px; border-radius: 999px; border: 0; font-weight: 600; font-size: 12.5px; display: inline-flex; gap: 4px; align-items: center; white-space: nowrap; }
.vneed.you { background: var(--amber); color: #fff; } .vneed.claude { background: var(--soft); color: var(--primary); }
.vneed[aria-expanded="true"] svg { transform: rotate(180deg); }
/* The timeline's marks: a small picture for each kind of thing, in its colour; a dot when the days are narrow. */
.tl > span { min-height: 26px; gap: 1px; padding: 2px 0; }
.mk { width: 18px; height: 18px; border-radius: 50%; display: inline-grid; place-items: center; background: var(--soft); color: var(--muted); transform: none; }
.mk svg { width: 11px; height: 11px; }
.mk.film.app { background: #8E44AD; color: #fff; } .mk.film.script { background: var(--primary); color: #fff; } .mk.film.tool { background: var(--grey); color: #fff; }
.mk.film.new, .mk.film.asked, .mk.film.unknown { background: var(--muted); color: var(--card); }
.mk.up { background: var(--green); color: #fff; border-radius: 50%; } .mk.comment { background: #2F80ED; color: #fff; border-radius: 50%; }
.mk.suggested, .mk.accepted, .mk.fix { background: var(--amber); color: #fff; border-radius: 50%; width: 18px; height: 18px; transform: none; }
.mk.rejected { background: var(--grey); color: #fff; } .mk.fix.merged { background: var(--green); } .mk.fix.failed, .mk.fix.closed { background: var(--red); }
.mk.held, .mk.failed { background: var(--red); color: #fff; border-radius: 50%; }
.dense .mk { width: 9px; height: 9px; } .dense .mk svg { display: none; }
.timed .tl > span > .mk { top: 3px; }
.vkey { position: sticky; top: 0; z-index: 2; background: var(--card); padding: 6px 0; margin: 4px 0 0; border-bottom: 1px solid var(--line); color: var(--ink2); }
.vkey .mk { cursor: default; }
/* A reply to post: the comment as a speech bubble, the reply to change, and the two steps as buttons. */
.vsaid { margin: 0 0 8px; padding: 10px 12px; border-radius: 12px; border-end-start-radius: 4px; background: var(--soft); font-size: 14px; line-height: 1.45; white-space: pre-line; overflow-wrap: anywhere; }
.vsaid details { margin-top: 6px; font-size: 12.5px; color: var(--muted); }
.vsaidby { display: flex; gap: 6px; align-items: center; font-size: 12px; color: var(--muted); margin: 0 0 4px; }
.vsaidby svg { width: 14px; height: 14px; fill: none; stroke: #2F80ED; stroke-width: 2.2; stroke-linejoin: round; }
.vreply { display: grid; gap: 8px; min-width: 0; }
.vreply label { margin: 0; font-size: 12px; font-weight: 600; color: var(--muted); }
.vreply textarea { min-height: 96px; font-size: 14px; }
.vreply small { font-size: 12px; color: var(--muted); }
.vreply .vsteps { display: grid; gap: 8px; }
.vreply .vsteps button, .vretry { min-height: 48px; display: inline-flex; gap: 8px; align-items: center; justify-content: center; text-align: start; }
.vretry { justify-self: start; margin: 4px 0; }
.vreplyrow { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px 24px; align-items: start; margin: 6px 0; }
.vreply .vsteps .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.vreply .n { width: 20px; height: 20px; border-radius: 50%; display: inline-grid; place-items: center; font-size: 12px; font-weight: 700; background: var(--line); color: var(--ink); flex: none; }
.vreply button.primary .n { background: #fff; color: var(--primary); }
.vpaused { font-size: 12.5px; color: var(--muted); margin: 10px 0 0; }
@media (max-width: 760px) { .vrow { grid-template-columns: minmax(0, 1fr); } .vrow.head > span:first-child { display: none; } }
`;

/** Pure: apps/admin/test/videoPage.test.ts runs these with new Function. */
export const VIDEO_LOGIC = String.raw`
const VIDEO_TABS = [['you', 'Waits on you'], ['auto', 'Automatic'], ['videos', 'All videos'], ['changes', 'Changes made']];
/**
 * What each tab holds (sources/videos.ts Videos): the cards that wait on an admin, the cards Claude acts on next with
 * the workers' jobs, the videos, and the changes Claude made. Paused languages are a standing state, not something
 * to answer, so they are said under All videos. The tab to open: the one chosen, else what waits on the admin when
 * something does, else the videos.
 */
function videoTabs(d, chosen) {
  const cards = d.admin.filter((a) => a.kind !== 'paused');
  const you = cards.filter((a) => a.who === 'you'), claude = cards.filter((a) => a.who !== 'you');
  const count = { you: you.length, auto: claude.length + d.worker.length, videos: d.videos.length, changes: (d.changes || []).length };
  const tab = VIDEO_TABS.some((t) => t[0] === chosen) ? chosen : you.length ? 'you' : 'videos';
  return { you, claude, paused: d.admin.filter((a) => a.kind === 'paused'), count, tab };
}
/** A timeline mark's kind for its picture and colour: a decision is accepted or rejected, a fix has its state. */
function markKind(m) { return m.kind === 'decided' ? (m.cause === 'rejected' ? 'rejected' : 'accepted') : m.kind; }
function markClass(m) { const k = markKind(m); return k + (m.cause && (k === 'film' || k === 'fix') ? ' ' + m.cause : ''); }
const MARK_NAMES = { 'film app': 'New film: an app screen changed', 'film script': 'New film: its script changed', 'film tool': 'New film: the film tool changed', 'film new': 'First film',
  'film asked': 'New film: asked by hand', 'film unknown': 'New film', up: 'Put on YouTube', comment: 'Comment on YouTube', suggested: 'Claude suggested a change',
  accepted: 'Suggestion accepted', rejected: 'Suggestion rejected', fix: 'Claude\'s change to the video', held: 'New film held back', failed: 'Film failed' };
const FIX_WORDS = { working: 'being written', open: 'waits on its checks', merged: 'merged', closed: 'closed', failed: 'failed', unneeded: 'not needed' };
/** A mark's name: what its picture stands for. */
function markName(m) {
  const k = markKind(m);
  if (k === 'film') return MARK_NAMES['film ' + (m.cause || 'unknown')] || MARK_NAMES['film unknown'];
  if (k === 'fix') return MARK_NAMES.fix + (FIX_WORDS[m.cause] ? ', ' + FIX_WORDS[m.cause] : '');
  return MARK_NAMES[k] || k;
}
/** The kinds of mark the shown rows have, each once, in the order of MARK_NAMES: the key says only what is on the page. */
function marksShown(rows) {
  const seen = new Map();
  for (const v of rows) for (const m of v.marks) { const k = markKind(m); const c = k === 'film' ? 'film ' + (m.cause || 'unknown') : k; if (!seen.has(c)) seen.set(c, { cls: k === 'film' ? c : k, kind: k, name: MARK_NAMES[c] || k }); }
  return Object.keys(MARK_NAMES).filter((c) => seen.has(c)).map((c) => seen.get(c));
}
/** A video's mark at the left of its row: something waits on the admin, a film is held or fails, a worker has it, it is paused, or nothing to do. */
function rowMark(v, cards) {
  if (cards.some((a) => a.who === 'you')) return 'you';
  const s = v.states[0] || {};
  return s.key === 'paused' ? 'paused' : s.level === 'bad' ? 'bad' : s.level === 'good' ? 'good' : 'info';
}
`;

/** Drawing; uses the page's helpers (esc, num, when, table, languageName, say, perform, annotate, $) and pageOps.ts's video state and cards. */
export const VIDEO_SCRIPT = String.raw`
let videoTab = null;
const VSHAPE = {
  film: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M10 9.5v5l4.5-2.5z"/>', up: '<path d="M12 17V5M7 10l5-5 5 5M5 20h14"/>', comment: '<path d="M4 5h16v11H10l-5 4v-4H4z"/>',
  suggested: '<path d="M9 18h6M10 21h4M12 3a6 6 0 00-3.6 10.8c.4.4.6.8.6 1.4V16h6v-.8c0-.6.2-1 .6-1.4A6 6 0 0012 3z"/>', accepted: '<path d="M5 12.5l4.5 4.5L19 7"/>', rejected: '<path d="M6 6l12 12M18 6L6 18"/>',
  fix: '<path d="M14.5 5.5a4.5 4.5 0 00-5 6L4 17l3 3 5.500-5.500a4.500 4.500 0 006-5l-3 3-2.500-.5-.5-2.500z"/>', held: '<path d="M9 6v12M15 6v12"/>', failed: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17v.01"/>',
  good: '<path d="M5 12.5l4.5 4.5L19 7"/>', you: '<path d="M12 5v9M12 18v.01"/>', bad: '<path d="M12 5v9M12 18v.01"/>', info: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>', paused: '<path d="M9 6v12M15 6v12"/>',
  now: '<path d="M4 12a8 8 0 0114-5.300M20 12a8 8 0 01-14 5.300M18 3v4h-4M6 21v-4h4"/>', down: '<path d="M6 9l6 6 6-6"/>', big: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l3 3 5-6"/>'
};
const vicon = (k) => '<svg viewBox="0 0 24 24" aria-hidden="true">' + (VSHAPE[k] || '') + '</svg>';
const ROW_MARKS = { you: 'Something waits on you', bad: 'A film is held or fails', info: 'Claude or a worker acts next', paused: 'This language is paused', good: 'Up to date' };

/** The first part of the Tutorial videos page: the tabs, and the chosen tab's pane. */
function videosHtml(d) { return '<div id="video-part">' + videoPart(d) + '</div>'; }
function videoPart(d) {
  const t = videoTabs(d, videoTab);
  let h = '<div class="vtabs" role="tablist" aria-label="Tutorial videos">' + VIDEO_TABS.map((x) => '<button type="button" role="tab" aria-selected="' + (t.tab === x[0]) + '" data-vtab="' + x[0] + '" data-help-key="' + esc(x[1]) + '">' + esc(x[1]) +
    '<span class="count' + (x[0] === 'you' && t.count.you ? ' you' : '') + '">' + num(t.count[x[0]]) + '</span></button>').join('') + '</div>';
  if (d.missing.length) h += '<p class="muted">Not read: ' + esc(d.missing.join('; ')) + '. The lists leave those out.</p>';
  if (t.tab === 'you') h += t.you.length ? '<div class="icards vq">' + t.you.map(adminCard).join('') + '</div>' : '<p class="vnone">' + vicon('big') + 'Nothing waits on you.</p>';
  if (t.tab === 'auto') {
    const job = (w) => '<div class="vjob"><span class="vdot' + (w.when === 'now' ? ' now' : '') + '" role="img" aria-label="' + (w.when === 'now' ? 'Runs now' : 'Waits its turn') + '">' + vicon(w.when === 'now' ? 'now' : 'info') + '</span><div><p><b>' + esc(w.title) + '</b>' +
      (w.at ? ' <small>' + when(w.at) + '</small>' : '') + '</p>' + (w.detail ? '<p><small>' + esc(w.detail) + '</small></p>' : '') + (w.link ? '<p>' + cardLink(w) + '</p>' : '') + '</div></div>';
    h += (t.claude.length ? '<h3>Claude acts next</h3><div class="icards vq">' + t.claude.map(adminCard).join('') + '</div>' : '') +
      '<h3>Jobs, now and tonight</h3>' + (d.worker.length ? '<div class="vjobs">' + d.worker.map(job).join('') + '</div>' : '<p class="muted">Nothing queued.</p>');
  }
  if (t.tab === 'videos') {
    setTimeout(() => layoutTimelines(), 0);
    h += '<div id="video-rows">' + videoRows() + '</div>' + t.paused.map((a) => '<p class="vpaused"><b>' + esc(a.title) + '.</b> ' + esc(a.detail) + ' ' + esc(a.next) + ' ' + cardLink(a) + '</p>').join('');
  }
  if (t.tab === 'changes') {
    const changes = d.changes || [];
    h += changes.length ? table([
      { h: 'When', v: (c) => when(c.at) },
      { h: 'Video', v: (c) => esc(c.video) + ' <small class="muted">' + esc(languageName(c.language)) + '</small>' },
      { h: 'Change', v: (c) => esc(detailParts(c.change)[0]) + (c.note ? '<br><small class="' + (c.state === 'failed' ? 'bad' : 'muted') + '">' + esc(c.note) + '</small>' : '') +
        ((c.pictures || []).length || (c.after || []).length ? '<details class="vtech"><summary>Pictures' + ((c.after || []).length ? ', before and after' : '') + '</summary>' + pictureStrip(c.pictures, c.after) + '</details>' : '') },
      { h: 'Yes from', v: (c) => esc(CHANGE_BY[c.by] || c.by) },
      { h: 'State', v: (c) => '<span class="tag ' + (CHANGE_LEVEL[c.state] || '') + '">' + esc(CHANGE_STATE[c.state] || c.state) + '</span>' },
      { h: '', v: (c) => c.link ? '<a href="' + esc(c.link) + '" target="_blank" rel="noopener noreferrer">' + (c.pr ? 'PR ' + num(c.pr) : 'The run') + '</a>' : '' }
    ], changes) : '<p class="muted">Claude made no change to a video in the last 30 days.</p>';
  }
  return h;
}

/** One mark on a timeline or in the key: its picture in its colour. On a timeline it is a button that says its name, when and what, and opens the details. */
function markButton(m, index) {
  const at = new Date(m.at);
  // The words of the mark follow its name, unless they only say the name again ("new film").
  const more = m.text && m.kind !== 'up' && m.text.toLowerCase() !== markName(m).toLowerCase() ? '. ' + (m.text.length > 140 ? m.text.slice(0, 139) + '…' : m.text) : '';
  const says = markName(m) + '. ' + at.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) + more;
  return '<button type="button" class="mk ' + markClass(m) + '" data-mark="' + index + '" data-h="' + ((at.getUTCHours() * 60 + at.getUTCMinutes()) / 1440).toFixed(4) + '" data-help="' + esc(says) + '" aria-label="' + esc(says) + '">' + vicon(markKind(m)) + '</button>';
}

/** Every video of the chosen language: its state, its newest film and why, its timeline, and what waits on someone. */
function videoRows() {
  const d = VIDEOS;
  if (!d) return '';
  const first = timelineStart();
  shownMarks = [];
  const langs = d.languages.map((l) => '<option value="' + esc(l.language) + '"' + (l.language === videoLanguage ? ' selected' : '') + '>' + esc(languageName(l.language)) +
    (l.issues ? ' (' + num(l.issues) + (l.issues === 1 ? ' waits on you)' : ' wait on you)') : '') + (l.nightly ? '' : ' (paused)') + '</option>').join('');
  let h = '<div class="vtools"><div><label for="video-lang">Language</label><select id="video-lang">' + langs + '</select></div>' +
    '<div><button type="button" data-vzoom="out" aria-label="Show more days">−</button> <button type="button" data-vzoom="in" aria-label="Show fewer days">+</button> ' +
    '<button type="button" data-vfit="14">14 days</button> <button type="button" data-vfit="60">60 days</button></div>' +
    '<div><label class="check"><input type="checkbox" id="video-mine"' + (onlyMine ? ' checked' : '') + '> Only videos that wait on you</label></div></div>';
  const cardsOf = (v) => d.admin.filter((a) => a.tutorial === v.tutorial && a.language === v.language);
  const rows = d.videos.filter((v) => v.language === videoLanguage && (!onlyMine || cardsOf(v).some((a) => a.who === 'you')));
  if (!rows.length) return h + '<p class="muted">' + (onlyMine ? 'No video in this language waits on you.' : 'No videos in this language yet.') + '</p>';
  const key = marksShown(rows);
  if (key.length) h += '<div class="vkey" data-help-key="The marks">' + key.map((k) => '<span><i class="mk ' + esc(k.cls) + '">' + vicon(k.kind) + '</i>' + esc(k.name) + '</span>').join('') + '</div>';
  const days = Array.from({ length: TIMELINE_DAYS }, (_, i) => new Date(first + i * 86400000));
  // Each day by its weekday and number (the lighter column is Sunday); the month where it begins, and at the first day.
  const dayName = (x, i) => i === TIMELINE_DAYS - 1 ? 'Today' : x.toLocaleDateString([], i === 0 || x.getUTCDate() === 1 ? { month: 'short', day: 'numeric', timeZone: 'UTC' } : { weekday: 'short', day: 'numeric', timeZone: 'UTC' });
  h += '<div class="vrow head"><span></span><div class="tlw"><div class="tl days">' + days.map((x, i) => '<span data-day>' + esc(dayName(x, i)) + '</span>').join('') + '</div></div></div>';
  rows.forEach((v, r) => {
    const cells = days.map(() => []);
    for (const m of v.marks) { const i = Math.floor((Date.parse(m.at) - first) / 86400000); if (i >= 0 && i < TIMELINE_DAYS) cells[i].push(m); }
    const mark = (m) => { shownMarks.push({ m, row: r }); return markButton(m, shownMarks.length - 1); };
    const cards = cardsOf(v), mine = cards.filter((a) => a.who === 'you').length, rm = rowMark(v, cards), open = openCards === v.tutorial + '/' + v.language;
    // A state that waits on the admin opens the video's cards; one a worker has links to where it is.
    const chip = (s) => s.link && s.level === 'info' ? '<a class="tag ' + s.level + '" href="' + esc(s.link) + '" target="_blank" rel="noopener noreferrer">' + esc(s.text) + '</a>' : '<span class="tag ' + s.level + '">' + esc(s.text) + '</span>';
    const cause = (c) => '<span class="vcause"><i class="mk film ' + esc(c.mark) + '">' + vicon('film') + '</i>' + esc(c.text) + c.links.map((l) => ' <a href="' + esc(l.href) + '" target="_blank" rel="noopener noreferrer">' + esc(l.text) + '</a>').join('') + '</span>';
    const need = !cards.length ? '' : '<button type="button" class="vneed ' + (mine ? 'you' : 'claude') + '" data-cards="' + r + '" aria-expanded="' + open + '" aria-controls="vcards-' + r + '">' +
      esc(mine ? num(mine) + (mine === 1 ? ' waits on you' : ' wait on you') : 'Claude acts next') + vicon('down') + '</button>';
    h += '<div class="vrow"><div class="vname"><span class="vst ' + rm + '" role="img" aria-label="' + esc(ROW_MARKS[rm]) + '" data-help="' + esc(ROW_MARKS[rm]) + '">' + vicon(rm) + '</span><div><b>' + esc(v.title) + '</b>' +
      '<div class="vstates">' + v.states.map(chip).join('') + need + '</div>' +
      (v.film ? '<div class="vfilm"><span>Filmed ' + when(v.film.madeAt) + '</span>' + (v.film.causes || []).map(cause).join('') + '</div>' : '') + '</div></div>' +
      '<div class="tlw"><div class="tl">' + cells.map((c, i) => '<span' + (days[i].getUTCDay() === 0 ? ' class="wk"' : '') + '>' + c.map(mark).join('') + '</span>').join('') + '</div></div></div>' +
      '<div class="vdet" id="vdet-' + r + '" hidden></div>' +
      (cards.length ? '<div class="vcards icards" id="vcards-' + r + '"' + (open ? '' : ' hidden') + ' data-key="' + esc(v.tutorial + '/' + v.language) + '">' + cards.map(adminCard).join('') + '</div>' : '');
  });
  return h;
}

/** A comment as its writer's words, in English, with the words as written folded under it and the way to it on YouTube. */
function commentSaid(a) {
  const r = a.reply;
  return '<p class="vsaidby">' + vicon('comment') + 'A viewer wrote' + (a.at ? ', ' + when(a.at) : '') + ' · <a href="' + esc(r.link) + '" target="_blank" rel="noopener noreferrer">See it on YouTube</a></p>' +
    '<blockquote class="vsaid">' + esc(r.comment) + (r.original ? '<details><summary>As written</summary>' + esc(r.original) + '</details>' : '') + '</blockquote>';
}
/**
 * The reply Claude suggests, for the admin to change, and the two steps: copy it and open the comment on YouTube (the
 * admin posts it there: nothing is posted from this page), then say what became of it. The card leaves when they do.
 */
function replyBox(a) {
  const r = a.reply, id = esc(r.id);
  return '<div class="vreply"><label for="rp-' + id + '">Your reply</label><textarea id="rp-' + id + '" maxlength="2000" rows="4">' + esc(r.text) + '</textarea>' +
    (r.english ? '<small>In English: ' + esc(r.english) + '</small>' : '') +
    '<div class="vsteps"><button type="button" class="primary" data-reply-copy="' + id + '" data-href="' + esc(r.link) + '"><span class="n">1</span>Copy the reply and open YouTube</button>' +
    '<div class="pair"><button type="button" data-reply-done="' + id + '" data-done="posted"><span class="n">2</span>Done</button>' +
    '<button type="button" data-reply-done="' + id + '" data-done="none">No reply needed</button></div></div></div>';
}
/** For a change Claude could not make: the same change again, as an instruction that names it in full. */
function retryButton(a) {
  return a.retry && a.instruct && !a.instructed ? '<button type="button" class="vretry primary" data-retry="' + esc(cardId(a)) + '">' + vicon('now') + 'Try again</button>' : '';
}

document.addEventListener('click', (e) => {
  const t = e.target.closest ? e.target : null;
  if (!t) return;
  const tab = t.closest('[data-vtab]');
  if (tab && VIDEOS) { videoTab = tab.dataset.vtab; const body = $('video-part'); body.innerHTML = videoPart(VIDEOS); annotate(body); const now = body.querySelector('[data-vtab="' + videoTab + '"]'); if (now) now.focus(); }
  const copy = t.closest('[data-reply-copy]');
  if (copy) {
    const box = $('rp-' + copy.dataset.replyCopy), text = ((box || {}).value || '').trim();
    if (!text) { say('Write the reply first.', 'red'); return; }
    // Copied in the press itself, before the new tab takes the keyboard away from this page.
    let copied = false;
    try { box.select(); copied = document.execCommand('copy'); } catch (err) { copied = false; }
    if (!copied && navigator.clipboard) navigator.clipboard.writeText(text).catch(() => say('The reply was not copied. Select it and copy it.', 'red'));
    window.open(copy.dataset.href, '_blank', 'noopener');
    say('Copied. Paste the reply under the comment on YouTube, then come back and press Done.');
    const done = copy.parentNode.querySelector('[data-done="posted"]');
    copy.classList.remove('primary'); if (done) done.classList.add('primary');
  }
  const done = t.closest('[data-reply-done]');
  if (done) perform({ kind: 'tutorial-reply', id: done.dataset.replyDone, done: done.dataset.done }, done);
  const retry = t.closest('[data-retry]');
  if (retry && VIDEOS) {
    const a = VIDEOS.admin.find((x) => cardId(x) === retry.dataset.retry);
    if (a && a.retry) perform({ kind: 'tutorial-note', tutorial: a.tutorial, text: a.retry.slice(0, 2000), instruct: true, problem: a.instruct.slice(0, 200), language: a.language || 'en', inputs: (a.inputIds || []).slice(0, 20) }, retry);
  }
});
`;
