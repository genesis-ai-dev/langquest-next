import { cameraPath, shotOf, viewExpression, ZOOM_MOST, type Move } from './camera';

/** Where a tutorial video's camera looks (camera.ts, compose.ts). */

const page = { width: 1920, height: 1080 };
// A phone's screen beside the title, as compose.ts places it.
const phone = { x: 1174, y: 50, width: 452, height: 980 };

/** An ffmpeg expression run in JavaScript: its st/ld memory, clip, and `;` as the comma operator. */
function evaluate(expression: string, it: number): number {
  const memory: number[] = [];
  const st = (i: number, v: number) => (memory[i] = v);
  const ld = (i: number) => memory[i]!;
  const clip = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
  return new Function('it', 'st', 'ld', 'clip', `return (${expression.replaceAll(';', ',')});`)(it, st, ld, clip) as number;
}

describe('the camera', () => {
  it('goes in on a small part as far as it goes, and keeps the phone in the middle of the shot', () => {
    const button = { x: 1190, y: 950, width: 420, height: 60 };
    const shot = shotOf(button, page, phone);
    expect(shot.width).toBeCloseTo(page.width / ZOOM_MOST);
    // The phone (narrower than the shot) stays in its middle; the shot stops a little past the bottom of its screen.
    expect(shot.x + shot.width / 2).toBeCloseTo(phone.x + phone.width / 2);
    const bottom = shot.y + (shot.width * page.height) / page.width;
    expect(bottom).toBeGreaterThan(phone.y + phone.height);
    expect(bottom).toBeLessThan(page.height);
    // A tall part is shown less close, whole; nothing lit shows the whole page.
    const list = shotOf({ x: 1190, y: 200, width: 420, height: 600 }, page, phone);
    expect(list.width).toBeGreaterThan(shot.width);
    expect(list.y).toBeLessThanOrEqual(200);
    expect(list.y + (list.width * page.height) / page.width).toBeGreaterThanOrEqual(800);
    expect(shotOf(null, page, phone)).toEqual({ x: 0, y: 0, width: page.width });
  });

  it('never films an empty screen: a tab under a short page is shown from further out, with the page', () => {
    const tab = { x: 1290, y: 960, width: 110, height: 66 };
    // The page's heading and card at the top, the tabs at the bottom, nothing between.
    const short: [number, number][] = [[60, 360], [960, 1026]];
    const close = shotOf(tab, page, phone);
    const shot = shotOf(tab, page, phone, short);
    // Here that is the whole page: a shot that would still cut a little off the top shows the screen whole.
    expect(shot).toEqual({ x: 0, y: 0, width: page.width });
    expect(close.y).toBeGreaterThan(360);
    // A tab under a full page is shown as close as ever.
    expect(shotOf(tab, page, phone, [[60, 1026]])).toEqual(close);
  });

  it('holds the title first, moves to each part as it is lit, and goes back out at the end', () => {
    const top = { x: 1190, y: 100, width: 420, height: 80 };
    const bottom = { x: 1190, y: 900, width: 420, height: 80 };
    const moves = cameraPath([{ t: 0.9, box: top }, { t: 6, box: bottom }, { t: 12, box: null }, { t: 16, box: bottom }], 22, page, phone);
    expect(moves.map((m) => m.at)).toEqual([1.2, 6 - 0.35, 12 - 0.35, 16 - 0.35, 22 - 1.6]);
    expect(moves.at(-1)!.to).toEqual({ x: 0, y: 0, width: page.width });
    // Moves never overlap, so each starts from where the last one left the camera.
    for (const [i, m] of moves.slice(1).entries()) expect(m.at).toBeGreaterThanOrEqual(moves[i]!.at + moves[i]!.for);
  });

  it('holds still for a part already in the shot, and leaves out a shot too short to see', () => {
    const card = { x: 1190, y: 400, width: 420, height: 80 };
    const below = { x: 1190, y: 500, width: 420, height: 60 };
    const far = { x: 1190, y: 950, width: 420, height: 60 };
    const moves = cameraPath([{ t: 2, box: card }, { t: 5, box: below }, { t: 8, box: null }, { t: 8.4, box: far }], 14, page, phone);
    expect(moves.map((m) => m.at)).toEqual([2 - 0.35, 8.4 - 0.35, 14 - 1.6]);
    // A video that lights nothing never moves.
    expect(cameraPath([{ t: 1, box: null }], 10, page, phone)).toEqual([]);
  });

  it('is the same path in ffmpeg: whole at first, eased halfway at a move\'s middle, there at its end', () => {
    const moves: Move[] = [{ at: 2, for: 0.8, to: { x: 1000, y: 500, width: 800 } }, { at: 5, for: 0.8, to: { x: 0, y: 0, width: 1920 } }];
    const side = (s: 'x' | 'y' | 'width', t: number) => Math.round(evaluate(viewExpression(moves, s, page), t) * 1000) / 1000;
    const at = (t: number) => ({ x: side('x', t), y: side('y', t), width: side('width', t) });
    expect(at(1)).toEqual({ x: 0, y: 0, width: 1920 });
    expect(at(2.4)).toEqual({ x: 500, y: 250, width: 1360 });
    expect(at(3)).toEqual({ x: 1000, y: 500, width: 800 });
    expect(at(9)).toEqual({ x: 0, y: 0, width: 1920 });
    // Quoted in the filter graph, it needs no ':' and no quote of its own.
    expect(viewExpression(moves, 'x', page)).not.toMatch(/[:'"]/);
  });
});
