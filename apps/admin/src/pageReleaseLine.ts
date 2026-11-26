/**
 * The line of merges at the top of the Releases page
 * (docs/decisions/2026-11-26-release-timeline-on-the-releases-page.md): each
 * pull request merged into main, to scale on a line that scrolls sideways
 * and zooms until every card shows; its areas by color; filters by area,
 * part, who made it, where it is and more; under the center line, each
 * change's own line from its report to the first iPhone and Android phone;
 * the failures each hour behind it; and the chosen change's detail. A tap
 * lights a change and its line and dims the rest; nothing shows on hover.
 *
 * This file holds the look, the page's place for it and the pure parts
 * (apps/admin/test/releaseLine.test.ts runs RLINE_LOGIC with new Function);
 * pageReleaseLineDraw.ts draws it. Plain JavaScript inside page.ts's script;
 * everything shown is escaped, and no element has a style attribute (the
 * page's rules allow none): places and sizes are set from the script.
 */

/** The look, inside page.ts's style element. Every class starts with rl, so no other file's rule reaches it. */
export const RLINE_CSS = String.raw`
#rline { --rl-line2: #D9D6CE; --rl-teal: #0E7378; --rl-tealbg: #DFF1F1; --rl-onp: #fff; --rl-pbg: #EEEAFB; --rl-bluebg: #E4ECFB; --rl-orange: #B9531A; --rl-orangebg: #FBEADF;
  margin-bottom: 22px; }
.rl-a-app { --ac: #0F766E; } .rl-a-ui { --ac: #BE185D; } .rl-a-dashboard { --ac: #0369A1; } .rl-a-backend { --ac: #C2410C; }
.rl-a-videos { --ac: #A16207; } .rl-a-jobs { --ac: #7C3AED; } .rl-a-tests { --ac: #475569; } .rl-a-docs { --ac: #78716C; }
@media (prefers-color-scheme: dark) {
  #rline { --rl-line2: #3A3A37; --rl-teal: #56C4C8; --rl-tealbg: #122A2B; --rl-onp: #17132A; --rl-pbg: #2A2440; --rl-bluebg: #16243A; --rl-orange: #F0915A; --rl-orangebg: #33211A; }
  .rl-a-app { --ac: #4FD1C5; } .rl-a-ui { --ac: #F472B6; } .rl-a-dashboard { --ac: #38BDF8; } .rl-a-backend { --ac: #FB923C; }
  .rl-a-videos { --ac: #EAB308; } .rl-a-jobs { --ac: #B197FC; } .rl-a-tests { --ac: #94A3B8; } .rl-a-docs { --ac: #A8A29E; }
}
#rline[hidden] { display: none; }
.rl-card { background: var(--card); border: 1px solid var(--line); border-radius: 16px; padding: 18px 20px; box-shadow: var(--sh); min-width: 0; }
.rl-head { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 16px; align-items: start; }
.rl-head h2 { font-size: 17px; }
.rl-say { margin: 4px 0 0; color: var(--ink2); font-size: 14.5px; max-width: 64ch; }
.rl-now { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
.rl-tile { margin: 0; min-width: 150px; text-align: start; background: var(--bg); border: 1px solid transparent; border-radius: 12px; padding: 8px 12px 9px; cursor: pointer; display: grid; gap: 1px; min-height: 48px; font: inherit; color: inherit; }
.rl-tile:hover { border-color: var(--line); }
.rl-tile .rl-k { font-size: 12px; color: var(--muted); display: flex; gap: 6px; align-items: center; }
.rl-tile .rl-v { font-weight: 650; font-size: 15px; }
.rl-tile .rl-s { font-size: 12px; color: var(--muted); }
.rl-tile .rl-s.rl-go { color: var(--blue); }
.rl-tile.rl-grp { cursor: default; }
.rl-tb { all: unset; cursor: pointer; display: block; }
.rl-tb:hover { text-decoration: underline; }
.rl-tb:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; border-radius: 4px; }
.rl-pip { width: 8px; height: 8px; border-radius: 50%; display: inline-block; background: var(--grey); flex: none; }
.rl-pip.live { background: var(--green); } .rl-pip.onway { background: var(--blue); }
.rl-bar { display: flex; gap: 8px 10px; align-items: center; flex-wrap: wrap; margin-top: 14px; }
.rl-bar + .rl-bar, .rl-subs + .rl-bar { margin-top: 10px; }
.rl-find { margin: 0; font-weight: 400; display: flex; align-items: center; gap: 6px; min-height: 36px; padding: 0 10px; border: 1px solid var(--line); border-radius: 10px; background: var(--bg); flex: 0 1 260px; min-width: 180px; color: var(--muted); }
.rl-find input { width: auto; border: 0; background: transparent; font: inherit; font-size: 13.5px; color: var(--ink); min-width: 0; flex: 1; outline: none; min-height: 34px; padding: 0; margin: 0; }
.rl-find svg { width: 15px; height: 15px; flex: none; }
.rl-areas, .rl-subs, .rl-chips { display: flex; gap: 6px; flex-wrap: wrap; }
.rl-chip { min-height: 36px; padding: 0 11px 0 9px; border-radius: 999px; border: 1px solid var(--line); background: var(--card); font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; color: var(--ink2); }
.rl-chip small { color: var(--muted); font-weight: 500; }
.rl-chip[aria-pressed="true"] { background: color-mix(in srgb, var(--ac, var(--ink)) 14%, var(--card)); border-color: var(--ac, var(--ink)); color: var(--ink); }
.rl-chip.rl-plain[aria-pressed="true"] { background: var(--ink); color: var(--card); border-color: var(--ink); }
.rl-chip.rl-plain[aria-pressed="true"] small { color: inherit; opacity: .7; }
.rl-subs { margin-top: 8px; padding: 8px 10px; border-radius: 12px; background: var(--bg); align-items: center; }
.rl-subs[hidden] { display: none; }
.rl-subs .rl-lab { font-size: 12px; color: var(--muted); margin-right: 4px; }
.rl-chip.rl-sub { min-height: 30px; font-weight: 550; font-size: 12.5px; padding: 0 10px; }
.rl-chip.rl-sub::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: var(--ac); }
.rl-sum { font-size: 12.5px; color: var(--muted); display: flex; gap: 10px; align-items: center; flex-wrap: wrap; min-height: 20px; }
.rl-sum button, .rl-link { min-height: 32px; border-radius: 6px; border: 0; background: none; color: var(--primary); cursor: pointer; padding: 6px 2px; font: inherit; font-weight: 600; font-size: 12.5px; }
.rl-btn { min-height: 36px; min-width: 36px; padding: 0 11px; border-radius: 10px; border: 1px solid var(--line); background: var(--card); font: inherit; font-weight: 600; font-size: 13px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 6px; color: var(--ink); text-decoration: none; }
.rl-btn:disabled { opacity: .4; cursor: default; }
.rl-btn .rl-badge { background: var(--primary); color: var(--rl-onp); border-radius: 999px; font-size: 11px; padding: 0 6px; }
.rl-pop { position: fixed; z-index: 30; background: var(--card); border: 1px solid var(--line); border-radius: 14px; box-shadow: 0 12px 40px rgb(0 0 0 / .18); padding: 14px 16px; width: min(420px, calc(100vw - 32px)); max-height: min(520px, 70vh); overflow: auto; }
.rl-pop[hidden] { display: none; }
.rl-pop h4 { margin: 12px 0 6px; font-size: 12.5px; color: var(--muted); font-weight: 650; display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.rl-pop h4:first-child { margin-top: 0; }
.rl-pop h4 button { min-height: 0; border: 0; background: none; color: var(--primary); font: inherit; font-size: 12px; font-weight: 600; cursor: pointer; padding: 4px; }
.rl-ek { margin: 0; font-weight: 400; display: grid; grid-template-columns: 20px minmax(0, 1fr) 56px 44px; gap: 8px; align-items: center; font-size: 13px; padding: 5px 0; cursor: pointer; border-top: 1px solid var(--line); }
.rl-ek input { width: 16px; height: 16px; accent-color: var(--red); margin: 0; }
.rl-ek span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rl-ek i { height: 6px; border-radius: 3px; background: var(--red); opacity: .55; justify-self: start; }
.rl-ek b { font-weight: 600; text-align: end; font-size: 12.5px; color: var(--ink2); }
.rl-zrow { display: flex; gap: 8px; align-items: center; justify-content: space-between; flex-wrap: wrap; margin: 14px 0 8px; }
.rl-zoom { display: flex; gap: 4px; align-items: center; flex-wrap: wrap; }
.rl-seg { display: inline-flex; border: 1px solid var(--line); border-radius: 10px; overflow: hidden; }
.rl-seg button { border-radius: 0; border: 0; background: var(--card); min-height: 34px; padding: 0 11px; font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; color: var(--ink2); }
.rl-seg button + button { border-left: 1px solid var(--line); }
.rl-seg button[aria-pressed="true"] { background: var(--ink); color: var(--card); }
.rl-zlab { font-size: 12.5px; color: var(--muted); }
.rl-mini { position: relative; user-select: none; touch-action: none; margin-bottom: 8px; }
.rl-mplot { position: relative; height: 40px; border-radius: 10px; background: var(--bg); cursor: pointer; overflow: hidden; }
.rl-mplot svg { position: absolute; inset: 0; width: 100%; height: 100%; }
.rl-win { position: absolute; top: 2px; bottom: 2px; border-radius: 8px; border: 2px solid var(--primary); background: color-mix(in srgb, var(--primary) 8%, transparent); pointer-events: none; min-width: 8px; }
.rl-mdays { position: relative; height: 16px; font-size: 11px; color: var(--muted); }
.rl-mdays span { position: absolute; transform: translateX(-50%); white-space: nowrap; top: 2px; }
.rl-mm { fill: var(--grey); } .rl-mm.live { fill: var(--green); } .rl-mm.onway { fill: var(--blue); }
.rl-merr { fill: var(--red); fill-opacity: .2; }
.rl-view { position: relative; overflow-x: auto; overflow-y: hidden; border-radius: 12px; background: var(--bg); scrollbar-width: thin; overscroll-behavior-x: contain; touch-action: pan-x; }
.rl-view:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
.rl-can { position: relative; }
.rl-can > svg { position: absolute; left: 0; top: 0; overflow: visible; }
.rl-lay { position: absolute; left: 0; top: 0; }
.rl-day { position: absolute; top: 6px; font-size: 12px; color: var(--muted); white-space: nowrap; padding-left: 8px; pointer-events: none; }
.rl-day b { color: var(--ink2); font-weight: 650; }
.rl-day.rl-stick { background: linear-gradient(90deg, var(--bg) 75%, transparent); padding-right: 18px; }
.rl-day[hidden] { display: none; }
.rl-wrap { position: relative; }
.rl-hint { position: absolute; left: 0; right: 0; top: 150px; font-size: 13.5px; color: var(--muted); text-align: center; pointer-events: none; }
.rl-hint[hidden] { display: none; }
.rl-loading { padding: 40px; text-align: center; color: var(--muted); }
.rl-it { min-height: 0; position: absolute; text-align: start; background: var(--card); border: 1px solid var(--line); border-left: 4px solid var(--ac); border-radius: 12px; padding: 9px 12px 9px 11px; cursor: pointer; display: flex; flex-direction: column; gap: 5px; overflow: hidden; font: inherit; color: inherit; margin: 0; transition: border-color .15s, box-shadow .15s, opacity .15s; }
.rl-it:hover { box-shadow: 0 0 0 1px color-mix(in srgb, var(--primary) 50%, transparent), var(--sh); }
.rl-it.rl-on { border-color: var(--primary); border-left-color: var(--ac); box-shadow: 0 0 0 2px var(--primary), var(--sh); }
.rl-it .rl-h { display: flex; justify-content: space-between; align-items: center; gap: 6px; font-size: 12px; color: var(--muted); white-space: nowrap; }
.rl-it .rl-h b { color: var(--ink); font-size: 13px; }
.rl-it .rl-ars { display: flex; gap: 4px; align-items: center; min-width: 0; overflow: hidden; }
.rl-it .rl-an { font-weight: 650; color: var(--ac); font-size: 12px; }
.rl-it .rl-ti { font-size: 13.5px; line-height: 1.35; color: var(--ink); font-weight: 560; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.rl-it .rl-iss { font-size: 12px; color: var(--muted); display: flex; gap: 6px; align-items: baseline; min-width: 0; }
.rl-it .rl-iss span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.rl-it .rl-pe { font-size: 12px; line-height: 1.35; color: var(--muted); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.rl-it .rl-f { display: flex; gap: 8px; align-items: center; justify-content: space-between; min-width: 0; margin-top: auto; }
.rl-it.rl-c { padding: 7px 10px 7px 9px; gap: 3px; border-radius: 10px; }
.rl-it.rl-c .rl-ti { font-size: 12.5px; -webkit-line-clamp: 2; font-weight: 550; }
.rl-it.rl-c .rl-h { font-size: 11.5px; }
.rl-st { font-size: 11.5px; font-weight: 650; display: inline-flex; gap: 5px; align-items: center; white-space: nowrap; color: var(--muted); }
.rl-st::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: var(--grey); }
.rl-st.live { color: var(--green); } .rl-st.live::before { background: var(--green); }
.rl-st.onway { color: var(--blue); } .rl-st.onway::before { background: var(--blue); }
.rl-st.none::before { background: transparent; box-shadow: inset 0 0 0 1.5px var(--grey); }
.rl-more { position: absolute; z-index: 2; transform: translateX(-50%); min-height: 26px; padding: 0 9px; border-radius: 999px; background: var(--ink); color: var(--card); font: inherit; font-size: 12px; font-weight: 700; border: 0; cursor: zoom-in; white-space: nowrap; }
.rl-ax { stroke: var(--rl-line2); stroke-width: 2; }
.rl-dg { stroke: var(--line); stroke-dasharray: 3 4; }
.rl-hr { stroke: var(--line); }
.rl-hrl { fill: var(--muted); font-size: 10.5px; }
.rl-ld { stroke: var(--rl-line2); fill: none; stroke-width: 1; }
.rl-stem { stroke: var(--rl-line2); stroke-width: 1; opacity: .55; }
.rl-ld.rl-hot, .rl-stem.rl-hot { stroke: var(--primary); stroke-width: 1.5; opacity: 1; }
.rl-err { fill: var(--red); fill-opacity: .13; stroke: var(--red); stroke-opacity: .45; stroke-width: 1; }
.rl-sp { fill: none; stroke-linecap: round; }
.rl-sp.wait { stroke: var(--grey); stroke-dasharray: 2 3; stroke-opacity: .7; }
.rl-sp.work { stroke: var(--primary); }
.rl-sp.go { stroke: var(--blue); }
.rl-sp.go.open, .rl-sp.one.open { stroke-dasharray: 5 4; }
.rl-sp.one { stroke: var(--green); stroke-opacity: .5; }
.rl-mk { stroke: var(--bg); stroke-width: 1.5; }
.rl-mk.r { fill: var(--bg); stroke: var(--grey); }
.rl-mk.m { fill: var(--card); stroke: var(--ink2); }
.rl-mk.i, .rl-mk.a { fill: var(--green); }
.rl-lane .rl-hit { stroke: transparent; fill: none; stroke-linecap: round; cursor: pointer; }
.rl-lane.rl-hot .rl-sp { stroke-width: 5; }
.rl-dot { stroke: var(--bg); stroke-width: 2; cursor: pointer; }
.rl-dot.live { fill: var(--green); } .rl-dot.onway { fill: var(--blue); }
.rl-dot.none { fill: var(--card); stroke: var(--grey); }
.rl-dot.rl-on { stroke: var(--primary); stroke-width: 3; }
.rl-dot.rl-fade { opacity: .18; }
.rl-ping { fill: none; stroke: var(--blue); stroke-width: 2; opacity: .5; transform-box: fill-box; transform-origin: center; animation: rl-ping 1.8s ease-out infinite; pointer-events: none; }
@keyframes rl-ping { from { transform: scale(.6); opacity: .7; } to { transform: scale(1.8); opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .rl-ping { animation: none; } }
.rl-nowl { stroke: var(--primary); stroke-width: 2; }
.rl-nowt { fill: var(--primary); font-size: 12px; font-weight: 700; }
#rl-can .rl-it, #rl-can .rl-lane, #rl-can .rl-dot, #rl-can .rl-ld, #rl-can .rl-stem, #rl-can .rl-more, #rl-can .rl-err { transition: opacity .15s; }
#rl-can.rl-focus .rl-it:not(.rl-on), #rl-can.rl-focus .rl-more { opacity: .32; }
#rl-can.rl-focus .rl-lane:not(.rl-hot) { opacity: .1; }
#rl-can.rl-focus .rl-dot:not(.rl-on), #rl-can.rl-focus .rl-ld:not(.rl-hot), #rl-can.rl-focus .rl-stem:not(.rl-hot) { opacity: .25; }
#rl-can.rl-focus .rl-err { opacity: .45; }
#rl-can.rl-focus .rl-it.rl-on { z-index: 3; }
.rl-legend { display: flex; gap: 6px 14px; flex-wrap: wrap; align-items: center; font-size: 12.5px; color: var(--muted); margin: 10px 2px 0; }
.rl-legend > span { display: inline-flex; gap: 6px; align-items: center; }
.rl-legend i.rl-sepv { width: 1px; height: 14px; background: var(--line); }
.rl-lg { width: 11px; height: 11px; border-radius: 50%; display: inline-block; background: var(--grey); }
.rl-lg.live { background: var(--green); } .rl-lg.onway { background: var(--blue); }
.rl-lg.none { width: 9px; height: 9px; background: transparent; box-shadow: inset 0 0 0 2px var(--grey); }
.rl-lg.sb { border-radius: 2px; transform: rotate(45deg); width: 10px; height: 10px; background: var(--ink2); }
.rl-ll { width: 22px; height: 4px; border-radius: 2px; display: inline-block; }
.rl-ll.wait { background: repeating-linear-gradient(90deg, var(--grey) 0 2px, transparent 2px 5px); }
.rl-ll.work { background: var(--primary); } .rl-ll.go { background: var(--blue); }
.rl-lm { width: 9px; height: 9px; background: var(--green); display: inline-block; }
.rl-lm.i { border-radius: 50%; } .rl-lm.a { border-radius: 2px; }
.rl-lerr { width: 18px; height: 12px; background: color-mix(in srgb, var(--red) 18%, transparent); border-top: 1.5px solid color-mix(in srgb, var(--red) 55%, transparent); display: inline-block; }
.rl-sw { min-height: 0; position: relative; width: 34px; height: 20px; border-radius: 999px; background: var(--rl-line2); border: 0; cursor: pointer; padding: 0; flex: none; }
.rl-sw::after { content: ""; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%; background: var(--card); transition: left .15s; }
.rl-sw[aria-checked="true"] { background: var(--red); }
.rl-sw[aria-checked="true"]::after { left: 16px; }
.rl-ai { width: 22px; height: 22px; border-radius: 6px; display: inline-grid; place-items: center; flex: none; color: var(--ac); background: color-mix(in srgb, var(--ac) 14%, transparent); }
.rl-ai svg { width: 13px; height: 13px; }
.rl-ai.rl-small { width: 18px; height: 18px; border-radius: 5px; } .rl-ai.rl-small svg { width: 11px; height: 11px; }
.rl-who { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; font-weight: 600; color: var(--ink2); white-space: nowrap; min-width: 0; overflow: hidden; }
.rl-who .rl-nm { overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.rl-av { width: 18px; height: 18px; border-radius: 50%; display: inline-grid; place-items: center; flex: none; background: var(--rl-orangebg); color: var(--rl-orange); }
.rl-av svg { width: 11px; height: 11px; }
.rl-av.thread { background: var(--rl-pbg); color: var(--primary); } .rl-av.agent { background: var(--rl-tealbg); color: var(--rl-teal); }
.rl-av.dev2 { background: var(--rl-bluebg); color: var(--blue); } .rl-av.bot { background: var(--soft); color: var(--muted); }
.rl-lan { font-size: 11.5px; font-weight: 650; color: var(--primary); border: 1px solid color-mix(in srgb, var(--primary) 35%, transparent); border-radius: 999px; padding: 0 7px; white-space: nowrap; flex: none; }
.rl-detail { margin-top: 16px; border-top: 1px solid var(--line); padding-top: 16px; }
.rl-dcard, .rl-dinfo { display: grid; gap: 18px; }
.rl-meta b { color: var(--ink); }
.rl-meta code { font-size: 12px; }
.rl-errs h4 { margin: 4px 0; }
.rl-detail:empty { display: none; }
.rl-dhead { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; flex-wrap: wrap; }
.rl-meta { font-size: 13px; color: var(--muted); display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.rl-dhead h2 { font-size: 19px; margin-top: 4px; max-width: 64ch; }
.rl-dareas { display: flex; gap: 6px 14px; flex-wrap: wrap; margin-top: 8px; font-size: 12.5px; color: var(--ink2); }
.rl-dareas > span { display: inline-flex; gap: 6px; align-items: center; }
.rl-dareas b { color: var(--ac); font-weight: 650; }
.rl-acts { display: flex; gap: 8px; flex-wrap: wrap; }
.rl-box { min-width: 0; }
.rl-box > h3 { margin: 0 0 8px; }
.rl-steps { display: grid; grid-template-columns: repeat(auto-fit, minmax(118px, 1fr)); position: relative; padding-top: 18px; }
.rl-ls { position: relative; padding: 0 10px 0 0; min-width: 0; }
.rl-ls .rl-lbar { height: 6px; border-radius: 3px; background: var(--line); margin: 7px 0 10px 18px; }
.rl-lbar.wait { background: repeating-linear-gradient(90deg, var(--grey) 0 3px, transparent 3px 7px); }
.rl-lbar.work { background: var(--primary); } .rl-lbar.go { background: var(--blue); } .rl-lbar.one { background: color-mix(in srgb, var(--green) 50%, transparent); }
.rl-lbar.open { background: repeating-linear-gradient(90deg, var(--blue) 0 6px, transparent 6px 10px); }
.rl-lbar.none { background: transparent; }
.rl-ls .rl-nd { position: absolute; left: 0; top: 0; width: 20px; height: 20px; border-radius: 50%; background: var(--card); border: 2px solid var(--ink2); }
.rl-nd.green { background: var(--green); border-color: var(--green); } .rl-nd.sq { border-radius: 5px; } .rl-nd.todo { border-style: dashed; border-color: var(--grey); }
.rl-ls b { display: block; font-size: 13px; }
.rl-ls small { display: block; font-size: 12px; color: var(--muted); }
.rl-ls .rl-du { position: absolute; top: -16px; left: 26px; font-size: 11.5px; color: var(--muted); white-space: nowrap; }
.rl-dgrid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.15fr); gap: 16px 28px; align-items: start; }
.rl-dcol { display: grid; gap: 18px; align-content: start; min-width: 0; }
.rl-issue { display: grid; gap: 3px; padding: 10px 12px; border: 1px solid var(--line); border-radius: 12px; }
.rl-issue + .rl-issue { margin-top: 8px; }
.rl-issue .rl-r1 { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; font-size: 12.5px; color: var(--muted); }
.rl-issue .rl-t { font-weight: 600; }
.rl-state { font-size: 11.5px; font-weight: 650; border-radius: 999px; padding: 1px 8px; background: var(--soft); color: var(--muted); }
.rl-state.done { background: var(--greenbg); color: var(--green); }
.rl-issue .rl-links { font-size: 13px; display: flex; gap: 12px; flex-wrap: wrap; }
.rl-issue .rl-sib { font-size: 12.5px; color: var(--muted); }
.rl-issue .rl-sib .rl-link { min-height: 0; padding: 2px; }
ol.rl-people { margin: 0; padding-inline-start: 20px; display: grid; gap: 6px; color: var(--ink2); font-size: 14px; }
.rl-place { display: grid; grid-template-columns: 76px minmax(0, 1fr); gap: 10px; align-items: start; padding: 8px 0; border-bottom: 1px solid var(--line); }
.rl-place:last-child { border-bottom: 0; }
.rl-place > b { font-size: 13px; padding-top: 2px; }
.rl-trail { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 0; font-size: 13px; }
.rl-tr { display: inline-flex; align-items: center; gap: 6px; color: var(--ink2); }
.rl-tr::before { content: ""; width: 10px; height: 10px; border-radius: 50%; background: var(--green); flex: none; }
.rl-tr.go::before { background: var(--blue); } .rl-tr.go { color: var(--blue); font-weight: 600; }
.rl-tr.no::before { background: transparent; box-shadow: inset 0 0 0 2px var(--grey); } .rl-tr.no { color: var(--muted); }
.rl-sep { width: 18px; height: 2px; background: var(--line); margin: 0 6px; flex: none; }
.rl-errs { display: grid; gap: 8px; }
.rl-errs .rl-row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.rl-errs .rl-n { background: var(--bg); border-radius: 10px; padding: 8px 12px; }
.rl-errs .rl-n b { font-size: 18px; display: block; }
.rl-errs .rl-n small { color: var(--muted); font-size: 12px; }
.rl-errs .rl-n.rl-up b { color: var(--red); }
.rl-errs ul { margin: 0; padding-inline-start: 18px; font-size: 13px; color: var(--ink2); display: grid; gap: 3px; }
.rl-errs h4 { margin: 4px 0; font-size: 13px; color: var(--muted); }
.rl-note { font-size: 12.5px; color: var(--muted); margin: 0; }
.rl-whobig { display: flex; gap: 10px; align-items: center; }
.rl-whobig .rl-av { width: 32px; height: 32px; } .rl-whobig .rl-av svg { width: 17px; height: 17px; }
.rl-whobig b { display: block; } .rl-whobig small { color: var(--muted); font-size: 13px; }
@media (pointer: coarse) {
  .rl-chip, .rl-btn, .rl-find, .rl-seg button, .rl-tile { min-height: 48px; } .rl-btn { min-width: 48px; } .rl-chip.rl-sub { min-height: 44px; } .rl-more { min-height: 36px; }
}
@media (max-width: 900px) { .rl-head { grid-template-columns: 1fr; } .rl-now { justify-content: flex-start; } .rl-dgrid { grid-template-columns: 1fr; } }
@media (max-width: 560px) {
  .rl-card { padding: 14px; } .rl-tile { flex: 1 1 140px; min-width: 0; } .rl-find { flex: 1 1 100%; }
  .rl-mdays span.rl-odd { display: none; } .rl-place { grid-template-columns: 1fr; gap: 4px; } .rl-steps { grid-template-columns: 1fr 1fr; row-gap: 22px; }
}
`;

/** The line's place on the page, above a section's summary; shown only on the Releases page. */
export const RLINE_HTML = String.raw`
    <div id="rline" hidden><section class="rl-card" aria-labelledby="rl-title">
      <div class="rl-head"><div><h2 id="rl-title">Every change merged into the app</h2><p class="rl-say" id="rl-say">Reading the merges…</p></div><div class="rl-now" id="rl-now"></div></div>
      <div class="rl-bar"><div class="rl-areas" id="rl-areas" role="group" aria-label="Areas"></div></div>
      <div class="rl-subs" id="rl-subs" hidden role="group" aria-label="Parts of the chosen areas"></div>
      <div class="rl-bar">
        <label class="rl-find"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3.5 3.5"/></svg><input id="rl-q" type="search" placeholder="Find a PR, an issue or a word" aria-label="Find a change"></label>
        <button class="rl-btn" type="button" id="rl-morebtn" aria-expanded="false" aria-controls="rl-more">More filters</button>
        <div class="rl-sum" id="rl-sum"></div>
      </div>
      <div class="rl-zrow">
        <div class="rl-zoom">
          <div class="rl-seg" id="rl-presets" role="group" aria-label="Time on screen"><button type="button" data-rl-h="all">All</button><button type="button" data-rl-h="72">3 days</button><button type="button" data-rl-h="24">1 day</button><button type="button" data-rl-h="6">6 hours</button></div>
          <button class="rl-btn" type="button" id="rl-out" aria-label="Zoom out">−</button><button class="rl-btn" type="button" id="rl-in" aria-label="Zoom in">+</button>
          <span class="rl-zlab" id="rl-zlab"></span>
        </div>
        <button class="rl-btn" type="button" id="rl-newest">Newest</button>
      </div>
      <div class="rl-mini" aria-hidden="true"><div class="rl-mplot" id="rl-mplot"></div><div class="rl-mdays" id="rl-mdays"></div></div>
      <div class="rl-wrap">
        <div class="rl-view" id="rl-view" tabindex="0" aria-label="Merges on a line, oldest on the left. The arrow keys choose the change before or after."><div class="rl-can" id="rl-can"><div class="rl-loading">Reading the merges…</div></div></div>
        <div class="rl-hint" id="rl-hint" hidden>Zoom in to read the changes.</div>
      </div>
      <div class="rl-legend" aria-label="What the marks mean">
        <span><span class="rl-lg live"></span>On phones</span><span><span class="rl-lg onway"></span>On its way</span><span><span class="rl-lg none"></span>No phone change</span><span><span class="rl-lg sb"></span>New store build</span>
        <i class="rl-sepv"></i>
        <span><span class="rl-ll wait"></span>Waiting</span><span><span class="rl-ll work"></span>Work</span><span><span class="rl-ll go"></span>Merged, on its way</span><span><span class="rl-lm i"></span>First iPhone</span><span><span class="rl-lm a"></span>First Android phone</span>
        <i class="rl-sepv"></i>
        <span><button class="rl-sw" type="button" role="switch" id="rl-errsw" aria-checked="true" aria-label="Show failures"></button><span class="rl-lerr"></span><span id="rl-errlab">Failures each hour</span><button class="rl-link" type="button" id="rl-errbtn" aria-expanded="false" aria-controls="rl-errpop">Choose failures</button></span>
      </div>
      <div class="rl-detail" id="rl-detail" aria-live="polite"></div>
    </section></div>
    <div class="rl-pop" id="rl-more" hidden role="dialog" aria-label="More filters"></div>
    <div class="rl-pop" id="rl-errpop" hidden role="dialog" aria-label="Choose failures"></div>`;

/** Pure: apps/admin/test/releaseLine.test.ts runs these with new Function. */
export const RLINE_LOGIC = String.raw`
const RL_H = 3600000;
/** Where a change is: on phones (a production phone ran it), on its way, or no change to the phone app. */
function rlWhere(m) { return !m.app ? 'none' : m.i || m.a ? 'live' : 'onway'; }
/**
 * A change's line: reported (the earliest issue it names, when Linear says, and only before the merge),
 * work started, merged, first iPhone and Android phone; it starts at the first and ends at the merge,
 * or at the last phone, or now while a phone has yet to run it.
 */
function rlLife(m, issues, now) {
  const mt = Date.parse(m.t);
  const reps = (m.is || []).map((s) => issues && issues[s.id] && Date.parse(issues[s.id].createdAt)).filter((t) => t && t < mt);
  const r = reps.length ? Math.min(...reps) : null;
  const w0 = m.ws ? Date.parse(m.ws) : null;
  const w = w0 && w0 <= mt ? (r && w0 < r ? r : w0) : null;
  const i = m.i ? Date.parse(m.i) : null, a = m.a ? Date.parse(m.a) : null;
  const start = Math.min(...[r, w, mt].filter((x) => x !== null));
  const ph = [i, a].filter(Boolean);
  const end = !m.app ? mt : ph.length === 2 ? Math.max(...ph) : Math.max(mt, now);
  return { r, w, m: mt, i, a, start, end };
}
/** Rows for the lines: short lines (two days or less) first, so they pack tight; long ones below them. */
function rlPack(items) {
  const out = new Map();
  const ends = [];
  const place = (list, from) => {
    for (const x of list) {
      let k = -1;
      for (let j = from; j < ends.length; j++) if (ends[j] + 0.4 * RL_H <= x.L.start) { k = j; break; }
      if (k < 0) { k = ends.length; ends.push(0); }
      ends[k] = x.L.end; out.set(x.id, k);
    }
  };
  const by = (p, q) => p.L.start - q.L.start;
  place(items.filter((x) => x.L.end - x.L.start <= 48 * RL_H).sort(by), 0);
  place(items.filter((x) => x.L.end - x.L.start > 48 * RL_H).sort(by), ends.length);
  return { rows: out, count: Math.max(1, ends.length) };
}
/**
 * The deepest zoom, in pixels an hour: any three changes in a row fit two rows of cards, so every card
 * can show; never shallower than 240, and never wider than browsers draw (about 16 million pixels).
 */
function rlMaxZoom(times, cardWidth, spanHours) {
  const ts = times.slice().sort((p, q) => p - q);
  let gap = Infinity;
  for (let k = 0; k + 2 < ts.length; k++) gap = Math.min(gap, ts[k + 2] - ts[k]);
  const need = gap === Infinity ? 240 : ((cardWidth + 12) / Math.max(gap / RL_H, 1 / 3600)) * 1.05;
  return Math.max(240, Math.min(need, 16e6 / Math.max(1, spanHours)));
}
/**
 * Cards on rows: the most telling changes first, at their dot or moved left; a change with no room goes
 * into a "+N" bubble. xs: each change's x; returns each placed one's row and left, and the rest.
 */
function rlPlace(list, xs, rows, cardWidth, score) {
  // Each row keeps its cards' left edges in buckets one card (and gap) wide, so a card is checked only against its neighbours.
  const gap = 10, size = cardWidth + gap, occ = Array.from({ length: rows }, () => new Map());
  const free = (r, l) => {
    const b = Math.floor(l / size);
    for (let j = b - 1; j <= b + 1; j++) for (const p of occ[r].get(j) || []) if (l + size > p && l < p + size) return false;
    return true;
  };
  const take = (r, l) => { const b = Math.floor(l / size), a = occ[r].get(b); if (a) a.push(l); else occ[r].set(b, [l]); };
  const shifts = [0];
  for (let k = 1; k * 24 <= cardWidth * 0.8; k++) { shifts.push(-k * 24); if (k * 24 <= cardWidth * 0.12) shifts.push(k * 24); }
  const placed = new Map(), hidden = [];
  for (const m of list.slice().sort((p, q) => score(q) - score(p))) {
    const want = xs.get(m) - 16;
    let done = false;
    for (const sh of shifts) {
      const l = want + sh;
      if (l < 4) continue;
      for (let r = 0; r < rows && !done; r++) if (free(r, l)) { take(r, l); placed.set(m, { r, left: l }); done = true; }
      if (done) break;
    }
    if (!done) hidden.push(m);
  }
  return { placed, hidden };
}
/** Failures by hour from each chosen kind's points; a day's count (before diag.hourly's 14 days) spread over its 24 hours. */
function rlErrHours(kinds, chosen, h0) {
  const out = new Map();
  for (const k of kinds) {
    if (!chosen.has(k.id)) continue;
    for (const [h, v, span] of k.s) for (let j = 0; j < (span || 1); j++) { const t = h0 + (h + j) * RL_H; out.set(t, (out.get(t) || 0) + v / (span || 1)); }
  }
  return out;
}
/** "25 min", "3 h 10 min", "7 d 17 h". */
function rlDur(ms) {
  const m = Math.round(ms / 60000);
  if (m < 60) return m + ' min';
  const h = Math.round(m / 60);
  if (h < 48) return (Math.floor(m / 60) + ' h ' + (m % 60 ? (m % 60) + ' min' : '')).trim();
  return Math.floor(h / 24) + ' d ' + (h % 24) + ' h';
}
/** Whether a change matches the filters: words, areas (and their chosen parts), who, where, how and issue. */
function rlMatches(m, F, whoKey) {
  if (F.q) {
    const q = F.q.toLowerCase().replace(/^#/, '');
    const hay = [String(m.n), m.ti, m.s, ...(m.is || []).flatMap((s) => [s.id, s.title || '']), ...(m.pe || []), m.w.name].join(' ').toLowerCase();
    if (!hay.includes(q)) return false;
  }
  if (F.areas.size) {
    let ok = false;
    for (const a of F.areas) {
      const mine = m.ar.find((x) => x[0] === a);
      if (!mine) continue;
      const chosen = [...F.subs].filter((s) => s.startsWith(a + '/'));
      if (!chosen.length || chosen.some((s) => mine[1].includes(s.slice(a.length + 1)))) { ok = true; break; }
    }
    if (!ok) return false;
  }
  if (F.who.size && !F.who.has(whoKey(m.w))) return false;
  if (F.where.size && !F.where.has(rlWhere(m))) return false;
  if (F.how.size && !(m.app && F.how.has(m.sb ? 'store' : 'ota'))) return false;
  if (F.issue.size) { const k = !m.is ? 'none' : m.is.some((s) => s.r === 'f') ? 'fixes' : 'part'; if (!F.issue.has(k)) return false; }
  if (F.db && !m.mg) return false;
  return true;
}
`;
