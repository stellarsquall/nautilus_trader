import { describe, it, expect } from 'vitest';
import {
  FootprintViewState,
  MIN_VISIBLE_BARS,
  MAX_VISIBLE_BARS,
  DEFAULT_VISIBLE_BARS,
  type BarRange,
} from '../../src/views/FootprintViewState';

describe('FootprintViewState', () => {
  describe('Constructor (AC1)', () => {
    it('should initialize with default visible count', () => {
      const viewState = new FootprintViewState(200);
      const range = viewState.getVisibleBarRange();

      expect(range.count).toBe(DEFAULT_VISIBLE_BARS);
      expect(range.startIndex).toBe(100); // 200 - 100
      expect(viewState.isAtLatest()).toBe(true);
    });

    it('should initialize with custom visible count', () => {
      const viewState = new FootprintViewState(200, 50);
      const range = viewState.getVisibleBarRange();

      expect(range.count).toBe(50);
      expect(range.startIndex).toBe(150); // 200 - 50
      expect(viewState.isAtLatest()).toBe(true);
    });

    it('should clamp visible count to MIN_VISIBLE_BARS', () => {
      const viewState = new FootprintViewState(200, 5);

      expect(viewState.getVisibleBarRange().count).toBe(MIN_VISIBLE_BARS);
    });

    it('should handle zero totalBars', () => {
      const viewState = new FootprintViewState(0);
      const range = viewState.getVisibleBarRange();

      expect(range.startIndex).toBe(0);
      expect(range.count).toBe(DEFAULT_VISIBLE_BARS);
      expect(viewState.isAtLatest()).toBe(true);
    });
  });

  describe('setTotalBars() (AC2)', () => {
    it('should update available bar count and adjust viewport', () => {
      const viewState = new FootprintViewState(200, 100);
      viewState.pan(-50); // visibleStart = 50

      viewState.setTotalBars(300);

      const range = viewState.getVisibleBarRange();
      expect(range.startIndex).toBe(50); // Unchanged, still valid
    });

    it('should clamp visibleStart when buffer shrinks', () => {
      const viewState = new FootprintViewState(200, 100);
      viewState.pan(-50); // visibleStart = 50

      viewState.setTotalBars(100);

      const range = viewState.getVisibleBarRange();
      expect(range.startIndex).toBe(0); // Clamped to max(0, 100 - 100)
    });

    it('should handle setTotalBars to 0', () => {
      const viewState = new FootprintViewState(200, 100);

      viewState.setTotalBars(0);

      expect(viewState.getVisibleBarRange().startIndex).toBe(0);
    });
  });

  describe('pan() (AC3)', () => {
    it('should pan right (positive delta) within bounds', () => {
      const viewState = new FootprintViewState(200, 100);
      viewState.pan(-50); // Start at index 50

      viewState.pan(20);

      expect(viewState.getVisibleBarRange().startIndex).toBe(70);
    });

    it('should pan left (negative delta) within bounds', () => {
      const viewState = new FootprintViewState(200, 100);

      viewState.pan(-30);

      expect(viewState.getVisibleBarRange().startIndex).toBe(70);
    });

    it('should prevent over-panning at left edge', () => {
      const viewState = new FootprintViewState(200, 100);

      viewState.pan(-500);

      expect(viewState.getVisibleBarRange().startIndex).toBe(0);
    });

    it('should prevent over-panning at right edge', () => {
      const viewState = new FootprintViewState(200, 100);
      viewState.pan(-50);
      viewState.pan(200);

      expect(viewState.getVisibleBarRange().startIndex).toBe(100);
      expect(viewState.isAtLatest()).toBe(true);
    });

    it('should round fractional deltaBars', () => {
      const viewState = new FootprintViewState(200, 100);
      viewState.pan(-50);

      viewState.pan(10.7);

      expect(viewState.getVisibleBarRange().startIndex).toBe(61);
    });

    it('should disable follow-latest when panning away from latest', () => {
      const viewState = new FootprintViewState(200, 100);
      expect(viewState.isAtLatest()).toBe(true);

      viewState.pan(-10);

      expect(viewState.isAtLatest()).toBe(false);
    });

    it('should re-enable follow-latest when panning to latest', () => {
      const viewState = new FootprintViewState(200, 100);
      viewState.pan(-30);
      expect(viewState.isAtLatest()).toBe(false);

      viewState.pan(30);

      expect(viewState.isAtLatest()).toBe(true);
    });
  });

  describe('getVisibleBarRange() (AC4)', () => {
    it('should return BarRange with startIndex and count', () => {
      const viewState = new FootprintViewState(200, 100);

      const range: BarRange = viewState.getVisibleBarRange();

      expect(range).toEqual({ startIndex: 100, count: 100 });
    });

    it('should reflect current viewport after mutations', () => {
      const viewState = new FootprintViewState(200, 100);
      viewState.pan(-20);

      const range = viewState.getVisibleBarRange();

      expect(range.startIndex).toBe(80);
      expect(range.count).toBe(100);
    });
  });

  describe('isAtLatest() and goToLatest() (AC5)', () => {
    it('should return true when viewport is at latest bars', () => {
      const viewState = new FootprintViewState(200, 100);

      expect(viewState.isAtLatest()).toBe(true);
    });

    it('should return false after panning away', () => {
      const viewState = new FootprintViewState(200, 100);
      viewState.pan(-10);

      expect(viewState.isAtLatest()).toBe(false);
    });

    it('should go to latest and re-enable follow mode', () => {
      const viewState = new FootprintViewState(200, 100);
      viewState.pan(-50);
      expect(viewState.isAtLatest()).toBe(false);

      viewState.goToLatest();

      expect(viewState.isAtLatest()).toBe(true);
      expect(viewState.getVisibleBarRange().startIndex).toBe(100);
    });

    it('should handle goToLatest when totalBars < visibleCount', () => {
      const viewState = new FootprintViewState(50, 100);
      viewState.pan(-10);

      viewState.goToLatest();

      expect(viewState.isAtLatest()).toBe(true);
      expect(viewState.getVisibleBarRange().startIndex).toBe(0);
    });
  });

  describe('Edge Cases (AC6)', () => {
    it('should handle empty bars (zero totalBars)', () => {
      const viewState = new FootprintViewState(0);

      expect(viewState.getVisibleBarRange().startIndex).toBe(0);
      expect(viewState.isAtLatest()).toBe(true);
    });

    it('should handle single bar', () => {
      const viewState = new FootprintViewState(1);

      expect(viewState.getVisibleBarRange().startIndex).toBe(0);
      expect(viewState.isAtLatest()).toBe(true);
    });

    it('should handle insufficient data (totalBars < MIN_VISIBLE_BARS)', () => {
      const viewState = new FootprintViewState(5, MIN_VISIBLE_BARS);

      const range = viewState.getVisibleBarRange();
      expect(range.startIndex).toBe(0);
      expect(range.count).toBe(MIN_VISIBLE_BARS);
      expect(viewState.isAtLatest()).toBe(true);
    });

    it('should not over-pan when totalBars is small', () => {
      const viewState = new FootprintViewState(3, MIN_VISIBLE_BARS);

      viewState.pan(-100);
      expect(viewState.getVisibleBarRange().startIndex).toBe(0);

      viewState.pan(100);
      expect(viewState.getVisibleBarRange().startIndex).toBe(0);
    });

    it('should maintain invariant: startIndex >= 0 after all operations', () => {
      const viewState = new FootprintViewState(200, 100);

      viewState.pan(-500);
      expect(viewState.getVisibleBarRange().startIndex).toBeGreaterThanOrEqual(0);

      viewState.setTotalBars(0);
      expect(viewState.getVisibleBarRange().startIndex).toBeGreaterThanOrEqual(0);
    });
  });
});