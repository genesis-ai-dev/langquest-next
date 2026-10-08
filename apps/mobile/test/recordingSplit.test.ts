import { describe, expect, it } from 'vitest';
import {
  BAR, DEFAULT_SPLIT, DIVIDER, fractionAfterDrag, loopPhase, loopStatus, MIN_BOTTOM, MIN_BOTTOM_RECORDING, MIN_TOP,
  nearestSnap, paneHeights, rememberedSplit, rememberSplit, SNAPS, splitValueText, stepSnap
} from '../src/recording/splitModel';

// A low-end Android phone about 640pt tall: status bar 24, the header with
// crumbs, title and language ~104, the footer with the 80pt record button
// ~104, the navigation bar 48. What is left holds both panes and the divider.
const SMALL_PHONE_BODY = 640 - 24 - 104 - 104 - 48;
const SMALL = SMALL_PHONE_BODY - DIVIDER;

describe('the split between source and recorder', () => {
  it('keeps both panes at least their minimum on a 640pt phone at every middle snap', () => {
    for (const snap of SNAPS.filter((x) => x > 0 && x < 1)) {
      const idle = paneHeights(SMALL, snap, MIN_BOTTOM);
      expect(idle.top).toBeGreaterThanOrEqual(MIN_TOP);
      expect(idle.bottom).toBeGreaterThanOrEqual(MIN_BOTTOM);
      expect(idle.top + idle.bottom).toBe(SMALL);
      const recording = paneHeights(SMALL, snap, MIN_BOTTOM_RECORDING);
      expect(recording.top).toBeGreaterThanOrEqual(MIN_TOP);
      expect(recording.bottom).toBeGreaterThanOrEqual(MIN_BOTTOM_RECORDING);
    }
  });

  it('gives the recorder more room while recording without moving the chosen split', () => {
    const idle = paneHeights(SMALL, 0.65, MIN_BOTTOM);
    const recording = paneHeights(SMALL, 0.65, MIN_BOTTOM_RECORDING);
    expect(recording.bottom).toBeGreaterThan(idle.bottom);
    expect(paneHeights(SMALL, 0.65, MIN_BOTTOM)).toEqual(idle);
  });

  it('follows the snaps on a tall phone', () => {
    expect(paneHeights(600, 0.35)).toEqual({ top: 210, bottom: 390 });
    expect(paneHeights(600, 0.5)).toEqual({ top: 300, bottom: 300 });
    expect(paneHeights(600, 0.65)).toEqual({ top: 390, bottom: 210 });
  });

  it('never hides a pane, even when a keyboard leaves almost no room', () => {
    for (const room of [0, 40, 150, MIN_TOP + MIN_BOTTOM]) {
      const h = paneHeights(room, 0.9);
      expect(h.top + h.bottom).toBe(room);
      if (room > 0) { expect(h.top).toBeGreaterThan(0); expect(h.bottom).toBeGreaterThan(0); }
    }
    expect(paneHeights(-10, 0.5)).toEqual({ top: 0, bottom: 0 });
  });

  it('shrinks one side to a single line at the ends, so the other has nearly the whole screen (demo ADR-036)', () => {
    expect(paneHeights(SMALL, 0)).toEqual({ top: BAR, bottom: SMALL - BAR });
    expect(paneHeights(SMALL, 1)).toEqual({ top: SMALL - BAR, bottom: BAR });
    // While recording, the recorder keeps its status and meter even at the end snap.
    expect(paneHeights(SMALL, 1, MIN_BOTTOM_RECORDING).bottom).toBe(MIN_BOTTOM_RECORDING);
    expect(splitValueText(paneHeights(600, 0))).toBe('Reference as one line');
    expect(splitValueText(paneHeights(600, 1))).toBe('Recorder as one line');
  });

  it('drags by the finger and settles on the nearest snap', () => {
    expect(fractionAfterDrag(0.5, 100, 400)).toBeCloseTo(0.75);
    expect(fractionAfterDrag(0.5, -1000, 400)).toBe(0);
    expect(fractionAfterDrag(0.5, 50, 0)).toBe(0.5);
    expect(nearestSnap(0.75)).toBe(0.65);
    expect(nearestSnap(0.1)).toBe(0);
    expect(nearestSnap(0.2)).toBe(0.35);
    expect(nearestSnap(0.9)).toBe(1);
    expect(nearestSnap(0.45)).toBe(0.5);
  });

  it('steps one snap at a time for a screen reader, and says where it is', () => {
    expect(stepSnap(0.5, 1)).toBe(0.65);
    expect(stepSnap(0.65, 1)).toBe(1);
    expect(stepSnap(1, 1)).toBe(1);
    expect(stepSnap(0.5, -1)).toBe(0.35);
    expect(stepSnap(0.35, -1)).toBe(0);
    expect(stepSnap(0, -1)).toBe(0);
    expect(splitValueText({ top: 300, bottom: 300 })).toBe('Source 50%');
  });

  it('is remembered for the session, per screen, as a snap', () => {
    expect(rememberedSplit('test-screen')).toBe(DEFAULT_SPLIT);
    rememberSplit('test-screen', 0.62);
    expect(rememberedSplit('test-screen')).toBe(0.65);
    expect(rememberedSplit('another-screen')).toBe(DEFAULT_SPLIT);
  });
});

describe('listen, speak, listen', () => {
  it('is recording while the microphone is on, listening while paused for the source, else off', () => {
    expect(loopPhase(true, false)).toBe('recording');
    expect(loopPhase(true, true)).toBe('recording');
    expect(loopPhase(false, true)).toBe('listening');
    // A recorder that stopped by itself (background, error) ends the session.
    expect(loopPhase(false, false)).toBe('off');
  });

  it('says plainly that recording is paused while the source plays', () => {
    expect(loopStatus('listening', false, 2, 'take')).toBe('Paused while the source plays. 2 takes so far');
    expect(loopStatus('recording', true, 2, 'take')).toBe('Recording what you say');
    expect(loopStatus('recording', false, 1, 'part')).toBe('Listening for you. 1 part so far');
  });
});
