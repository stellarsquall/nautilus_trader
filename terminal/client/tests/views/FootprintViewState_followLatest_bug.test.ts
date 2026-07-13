import { describe, it, expect } from 'vitest';
import { FootprintViewState, DEFAULT_VISIBLE_BARS } from '../../src/views/FootprintViewState';

// Repro for slice 12-fix Bug A: once totalBars exceeds visibleCount, the footprint
// silently stops following the latest bar (updateBar only calls setTotalBars,
// which clamps visibleStart but never advances it), while getFollowLatest()
// keeps dishonestly reporting true. This is the root cause of the "Overview
// resets to latest on switch" symptom, since ViewManager trusts the outgoing
// view's followLatest flag verbatim.
describe('FootprintViewState — onNewBar keeps the tail honest past the visible window (slice 12-fix Bug A)', () => {
  it('advances the right edge and stays honestly at latest once totalBars > visibleCount', () => {
    const state = new FootprintViewState(DEFAULT_VISIBLE_BARS); // totalBars == visibleCount == 100
    expect(state.isAtLatest()).toBe(true);
    expect(state.getFollowLatest()).toBe(true);

    // Grow past the visible window one bar at a time, as updateBar would.
    for (let n = DEFAULT_VISIBLE_BARS + 1; n <= DEFAULT_VISIBLE_BARS + 50; n++) {
      state.onNewBar(n);
    }

    expect(state.getRightEdgeBarIndex()).toBe(DEFAULT_VISIBLE_BARS + 50 - 1);
    expect(state.isAtLatest()).toBe(true);
    expect(state.getFollowLatest()).toBe(true);
  });

  it('does NOT advance the tail if the user had panned away from latest', () => {
    const state = new FootprintViewState(150, 100); // visibleStart = 50, right edge = 149
    state.pan(-40); // moves away from latest -> followLatest becomes false
    expect(state.getFollowLatest()).toBe(false);
    const edgeBefore = state.getRightEdgeBarIndex();

    state.onNewBar(151);

    expect(state.getFollowLatest()).toBe(false);
    expect(state.getRightEdgeBarIndex()).toBe(edgeBefore); // unchanged, still panned away
  });
});
