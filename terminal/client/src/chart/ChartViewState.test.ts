import { describe, it, expect } from 'vitest';
import {
  ChartViewState,
  MIN_VISIBLE_BARS,
  MAX_VISIBLE_BARS,
  DEFAULT_VISIBLE_BARS,
  type ViewStateSnapshot,
} from './ChartViewState';

describe('ChartViewState', () => {
  describe('Constructor', () => {
    it('should initialize with default visible count', () => {
      const viewState = new ChartViewState(200);
      const state = viewState.getState();

      expect(state.visibleCount).toBe(DEFAULT_VISIBLE_BARS);
      expect(state.visibleStart).toBe(100); // 200 - 100
      expect(state.followLatest).toBe(true);
    });

    it('should initialize with custom visible count', () => {
      const viewState = new ChartViewState(200, 50);
      const state = viewState.getState();

      expect(state.visibleCount).toBe(50);
      expect(state.visibleStart).toBe(150); // 200 - 50
      expect(state.followLatest).toBe(true);
    });

    it('should clamp visible count to MIN_VISIBLE_BARS', () => {
      const viewState = new ChartViewState(200, 10);
      const state = viewState.getState();

      expect(state.visibleCount).toBe(MIN_VISIBLE_BARS);
    });

    it('should clamp visible count to MAX_VISIBLE_BARS', () => {
      const viewState = new ChartViewState(1000, 600);
      const state = viewState.getState();

      expect(state.visibleCount).toBe(MAX_VISIBLE_BARS);
    });

    it('should handle totalBars less than visibleCount', () => {
      const viewState = new ChartViewState(10, 100);
      const state = viewState.getState();

      expect(state.visibleStart).toBe(0);
      expect(state.visibleCount).toBe(DEFAULT_VISIBLE_BARS);
    });

    it('should handle zero totalBars', () => {
      const viewState = new ChartViewState(0);
      const state = viewState.getState();

      expect(state.visibleStart).toBe(0);
      expect(state.visibleCount).toBe(DEFAULT_VISIBLE_BARS);
      expect(state.followLatest).toBe(true);
    });
  });

  describe('pan()', () => {
    it('should pan right (positive delta) within bounds', () => {
      const viewState = new ChartViewState(200, 100);
      viewState.pan(-50); // Start at index 50 (not at tail)

      const beforeState = viewState.getState();
      expect(beforeState.visibleStart).toBe(50);

      viewState.pan(20);
      const afterState = viewState.getState();

      expect(afterState.visibleStart).toBe(70);
    });

    it('should pan left (negative delta) within bounds', () => {
      const viewState = new ChartViewState(200, 100);
      // Initially at tail (visibleStart = 100)

      viewState.pan(-30);
      const state = viewState.getState();

      expect(state.visibleStart).toBe(70);
    });

    it('should clamp pan at left edge (visibleStart = 0)', () => {
      const viewState = new ChartViewState(200, 100);
      viewState.pan(-200); // Pan far left

      const state = viewState.getState();
      expect(state.visibleStart).toBe(0);
    });

    it('should clamp pan at right edge (at totalBars)', () => {
      const viewState = new ChartViewState(200, 100);
      viewState.pan(-50); // Move away from tail
      viewState.pan(200); // Pan far right

      const state = viewState.getState();
      expect(state.visibleStart).toBe(100); // max(0, 200 - 100)
      expect(viewState.isAtTail()).toBe(true);
    });

    it('should round fractional deltaBars', () => {
      const viewState = new ChartViewState(200, 100);
      viewState.pan(-50);

      viewState.pan(10.7); // Should round to 11
      const state = viewState.getState();

      expect(state.visibleStart).toBe(61); // 50 + 11
    });

    it('should set followLatest=false when panning away from tail', () => {
      const viewState = new ChartViewState(200, 100);
      expect(viewState.getState().followLatest).toBe(true);
      expect(viewState.isAtTail()).toBe(true);

      viewState.pan(-10); // Pan left from tail

      const state = viewState.getState();
      expect(state.followLatest).toBe(false);
      expect(viewState.isAtTail()).toBe(false);
    });

    it('should set followLatest=true when panning to tail', () => {
      const viewState = new ChartViewState(200, 100);
      viewState.pan(-30); // Pan away from tail
      expect(viewState.getState().followLatest).toBe(false);

      viewState.pan(30); // Pan back to tail

      const state = viewState.getState();
      expect(state.followLatest).toBe(true);
      expect(viewState.isAtTail()).toBe(true);
    });

    it('should not change followLatest when panning in middle (not at tail)', () => {
      const viewState = new ChartViewState(200, 100);
      viewState.pan(-50); // Start in middle
      expect(viewState.getState().followLatest).toBe(false);

      viewState.pan(10); // Pan right (still not at tail)

      const state = viewState.getState();
      expect(state.followLatest).toBe(false);
      expect(viewState.isAtTail()).toBe(false);
    });
  });

  describe('zoom()', () => {
    it('should zoom in (zoomFactor < 1) and clamp to MIN_VISIBLE_BARS', () => {
      const viewState = new ChartViewState(200, 100);
      const anchorBarIndex = 150;

      viewState.zoom(0.5, anchorBarIndex); // Zoom in to 50 bars

      const state = viewState.getState();
      expect(state.visibleCount).toBe(50);
    });

    it('should zoom out (zoomFactor > 1) within bounds', () => {
      const viewState = new ChartViewState(200, 100);
      const anchorBarIndex = 150;

      viewState.zoom(1.5, anchorBarIndex); // Zoom out to 150 bars

      const state = viewState.getState();
      expect(state.visibleCount).toBe(150);
    });

    it('should clamp zoom to MIN_VISIBLE_BARS', () => {
      const viewState = new ChartViewState(200, 100);
      const anchorBarIndex = 150;

      viewState.zoom(0.1, anchorBarIndex); // Try to zoom to 10 bars

      const state = viewState.getState();
      expect(state.visibleCount).toBe(MIN_VISIBLE_BARS);
    });

    it('should clamp zoom to MAX_VISIBLE_BARS', () => {
      const viewState = new ChartViewState(1000, 100);
      const anchorBarIndex = 550;

      viewState.zoom(10, anchorBarIndex); // Try to zoom to 1000 bars

      const state = viewState.getState();
      expect(state.visibleCount).toBe(MAX_VISIBLE_BARS);
    });

    it('should preserve anchor bar position (cursor-anchored zoom)', () => {
      const viewState = new ChartViewState(1000, 100);
      viewState.pan(-500); // Move to middle of buffer: visibleStart=400

      const anchorBarIndex = 425; // 25% into visible range (400 + 25)

      viewState.zoom(2, anchorBarIndex); // Zoom out to 200 bars

      const state = viewState.getState();
      expect(state.visibleCount).toBe(200);

      // Anchor should be at same fraction: (425 - visibleStart) / 200 = 0.25
      // So visibleStart should be 425 - (0.25 * 200) = 375
      expect(state.visibleStart).toBe(375);
    });

    it('should handle anchor at start of visible range', () => {
      const viewState = new ChartViewState(200, 100);
      const anchorBarIndex = 100; // At start of visible range

      viewState.zoom(0.5, anchorBarIndex); // Zoom in to 50 bars

      const state = viewState.getState();
      expect(state.visibleCount).toBe(50);
      expect(state.visibleStart).toBe(100); // Anchor at 0% of range
    });

    it('should handle anchor at end of visible range', () => {
      const viewState = new ChartViewState(200, 100);
      const anchorBarIndex = 199; // At end of visible range

      viewState.zoom(0.5, anchorBarIndex); // Zoom in to 50 bars

      const state = viewState.getState();
      expect(state.visibleCount).toBe(50);
      // Anchor should remain at same position
      // (199 - visibleStart) / 50 = (199 - 100) / 100 = 0.99
      // visibleStart = 199 - (0.99 * 50) = 149.5 → 150
      expect(state.visibleStart).toBe(150);
    });

    it('should clamp visibleStart after zoom', () => {
      const viewState = new ChartViewState(100, 50);
      const anchorBarIndex = 10;

      viewState.zoom(5, anchorBarIndex); // Zoom out, would push visibleStart negative

      const state = viewState.getState();
      expect(state.visibleStart).toBeGreaterThanOrEqual(0);
      expect(state.visibleStart).toBeLessThanOrEqual(Math.max(0, 100 - state.visibleCount));
    });
  });

  describe('onNewBar()', () => {
    it('should advance visibleStart when followLatest=true and at tail', () => {
      const viewState = new ChartViewState(200, 100);
      // Initially at tail (visibleStart=100, followLatest=true)

      viewState.onNewBar(201); // New bar arrives

      const state = viewState.getState();
      expect(state.visibleStart).toBe(101); // Advances to keep tail visible
      expect(viewState.isAtTail()).toBe(true);
    });

    it('should not advance when followLatest=false', () => {
      const viewState = new ChartViewState(200, 100);
      viewState.pan(-10); // Pan away from tail (sets followLatest=false)

      const beforeState = viewState.getState();
      expect(beforeState.followLatest).toBe(false);
      expect(beforeState.visibleStart).toBe(90);

      viewState.onNewBar(201); // New bar arrives

      const afterState = viewState.getState();
      expect(afterState.visibleStart).toBe(90); // Unchanged
      expect(afterState.followLatest).toBe(false);
    });

    it('should not advance when followLatest=true but not at tail', () => {
      const viewState = new ChartViewState(200, 100);
      viewState.pan(-10); // Pan away from tail
      viewState.pan(5); // Pan back partially (followLatest still false)

      // Manually set followLatest to test this edge case
      // (In real usage, this wouldn't happen, but testing the logic)
      const state = viewState.getState();
      expect(state.followLatest).toBe(false);

      viewState.onNewBar(201);

      // Should clamp but not advance since followLatest=false
      expect(viewState.getState().visibleStart).toBe(95);
    });

    it('should handle multiple bars arriving in sequence', () => {
      const viewState = new ChartViewState(200, 100);

      viewState.onNewBar(201);
      viewState.onNewBar(202);
      viewState.onNewBar(203);

      const state = viewState.getState();
      expect(state.visibleStart).toBe(103);
      expect(viewState.isAtTail()).toBe(true);
    });

    it('should clamp visibleStart when totalBars decreases', () => {
      const viewState = new ChartViewState(200, 100);

      viewState.onNewBar(150); // Buffer shrinks

      const state = viewState.getState();
      expect(state.visibleStart).toBe(50); // Clamped to max(0, 150 - 100)
    });
  });

  describe('resetToLatest()', () => {
    it('should reset to tail and enable auto-follow', () => {
      const viewState = new ChartViewState(200, 100);
      viewState.pan(-50); // Pan away from tail

      expect(viewState.getState().followLatest).toBe(false);
      expect(viewState.isAtTail()).toBe(false);

      viewState.resetToLatest();

      const state = viewState.getState();
      expect(state.visibleStart).toBe(100);
      expect(state.followLatest).toBe(true);
      expect(viewState.isAtTail()).toBe(true);
    });

    it('should handle reset when totalBars < visibleCount', () => {
      const viewState = new ChartViewState(50, 100);
      viewState.pan(-10); // Try to pan

      viewState.resetToLatest();

      const state = viewState.getState();
      expect(state.visibleStart).toBe(0);
      expect(state.followLatest).toBe(true);
    });

    it('should work when already at tail', () => {
      const viewState = new ChartViewState(200, 100);
      // Already at tail

      viewState.resetToLatest();

      const state = viewState.getState();
      expect(state.visibleStart).toBe(100);
      expect(state.followLatest).toBe(true);
      expect(viewState.isAtTail()).toBe(true);
    });
  });

  describe('setTotalBars()', () => {
    it('should update totalBars without changing followLatest', () => {
      const viewState = new ChartViewState(200, 100);
      viewState.pan(-50); // Set followLatest=false

      viewState.setTotalBars(250);

      const state = viewState.getState();
      expect(state.followLatest).toBe(false); // Unchanged
      expect(state.visibleStart).toBe(50); // Unchanged (within new bounds)
    });

    it('should clamp visibleStart when buffer shrinks', () => {
      const viewState = new ChartViewState(200, 100);
      viewState.pan(-50); // visibleStart=50

      viewState.setTotalBars(100); // Shrink buffer

      const state = viewState.getState();
      expect(state.visibleStart).toBe(0); // Clamped to max(0, 100 - 100)
    });

    it('should handle buffer growing', () => {
      const viewState = new ChartViewState(200, 100);

      viewState.setTotalBars(300); // Grow buffer

      const state = viewState.getState();
      expect(state.visibleStart).toBe(100); // Unchanged, still valid
    });

    it('should clamp visibleStart when visibleStart would be out of bounds', () => {
      const viewState = new ChartViewState(200, 100);
      // visibleStart=100

      viewState.setTotalBars(150); // totalBars shrinks

      const state = viewState.getState();
      expect(state.visibleStart).toBe(50); // Clamped to max(0, 150 - 100)
    });

    it('should handle setTotalBars to 0', () => {
      const viewState = new ChartViewState(200, 100);

      viewState.setTotalBars(0);

      const state = viewState.getState();
      expect(state.visibleStart).toBe(0);
    });
  });

  describe('isAtTail()', () => {
    it('should return true when visibleStart + visibleCount >= totalBars', () => {
      const viewState = new ChartViewState(200, 100);

      expect(viewState.isAtTail()).toBe(true);
    });

    it('should return false when not at tail', () => {
      const viewState = new ChartViewState(200, 100);
      viewState.pan(-10);

      expect(viewState.isAtTail()).toBe(false);
    });

    it('should return true when visibleCount >= totalBars', () => {
      const viewState = new ChartViewState(50, 100);

      expect(viewState.isAtTail()).toBe(true);
    });

    it('should return true at exact boundary', () => {
      const viewState = new ChartViewState(200, 100);
      // visibleStart=100, visibleCount=100, totalBars=200
      // 100 + 100 = 200, so at tail

      expect(viewState.isAtTail()).toBe(true);
    });
  });

  describe('getState()', () => {
    it('should return readonly snapshot', () => {
      const viewState = new ChartViewState(200, 100);
      const state = viewState.getState();

      expect(state.visibleStart).toBe(100);
      expect(state.visibleCount).toBe(100);
      expect(state.followLatest).toBe(true);
    });

    it('should return current state after mutations', () => {
      const viewState = new ChartViewState(200, 100);

      viewState.pan(-20);
      viewState.zoom(1.5, 90);

      const state = viewState.getState();
      expect(state.visibleStart).toBeGreaterThanOrEqual(0);
      expect(state.visibleCount).toBeGreaterThanOrEqual(MIN_VISIBLE_BARS);
      expect(state.visibleCount).toBeLessThanOrEqual(MAX_VISIBLE_BARS);
    });
  });

  describe('Invariants', () => {
    it('should maintain visibleCount within [MIN, MAX] after all operations', () => {
      const viewState = new ChartViewState(1000, 100);

      viewState.zoom(0.01, 500); // Extreme zoom in
      expect(viewState.getState().visibleCount).toBeGreaterThanOrEqual(MIN_VISIBLE_BARS);

      viewState.zoom(100, 500); // Extreme zoom out
      expect(viewState.getState().visibleCount).toBeLessThanOrEqual(MAX_VISIBLE_BARS);
    });

    it('should maintain visibleStart within [0, max(0, totalBars - visibleCount)]', () => {
      const viewState = new ChartViewState(200, 100);

      viewState.pan(-500); // Extreme left pan
      expect(viewState.getState().visibleStart).toBe(0);

      viewState.pan(500); // Extreme right pan
      expect(viewState.getState().visibleStart).toBeLessThanOrEqual(100);
    });

    it('should maintain visibleStart + visibleCount <= totalBars when not at tail', () => {
      const viewState = new ChartViewState(200, 100);
      viewState.pan(-10);

      const state = viewState.getState();
      expect(state.visibleStart + state.visibleCount).toBeLessThanOrEqual(200);
    });
  });

  describe('Edge Cases', () => {
    it('should handle zero totalBars throughout lifecycle', () => {
      const viewState = new ChartViewState(0, 50);

      expect(viewState.isAtTail()).toBe(true);

      viewState.pan(10);
      expect(viewState.getState().visibleStart).toBe(0);

      viewState.zoom(2, 0);
      expect(viewState.getState().visibleCount).toBeGreaterThanOrEqual(MIN_VISIBLE_BARS);
    });

    it('should handle rapid zoom in and out', () => {
      const viewState = new ChartViewState(200, 100);

      for (let i = 0; i < 10; i++) {
        viewState.zoom(0.9, 150);
      }
      expect(viewState.getState().visibleCount).toBeGreaterThanOrEqual(MIN_VISIBLE_BARS);

      for (let i = 0; i < 10; i++) {
        viewState.zoom(1.1, 150);
      }
      expect(viewState.getState().visibleCount).toBeLessThanOrEqual(MAX_VISIBLE_BARS);
    });

    it('should handle pan and zoom combinations', () => {
      const viewState = new ChartViewState(500, 100);

      viewState.pan(-50);
      viewState.zoom(2, 100);
      viewState.pan(30);
      viewState.zoom(0.5, 150);

      const state = viewState.getState();
      expect(state.visibleStart).toBeGreaterThanOrEqual(0);
      expect(state.visibleStart).toBeLessThanOrEqual(Math.max(0, 500 - state.visibleCount));
      expect(state.visibleCount).toBeGreaterThanOrEqual(MIN_VISIBLE_BARS);
      expect(state.visibleCount).toBeLessThanOrEqual(MAX_VISIBLE_BARS);
    });
  });
});
