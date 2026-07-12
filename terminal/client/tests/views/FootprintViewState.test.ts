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

  describe('getRightEdgeBarIndex() (AC7)', () => {
    it('should return visibleStart + visibleCount - 1 after construction', () => {
      const viewState = new FootprintViewState(200, 100);

      // visibleStart = 100, visibleCount = 100 => right edge index = 199
      expect(viewState.getRightEdgeBarIndex()).toBe(199);
    });

    it('should return updated right edge after panning', () => {
      const viewState = new FootprintViewState(200, 100);
      viewState.pan(-50); // visibleStart = 50

      expect(viewState.getRightEdgeBarIndex()).toBe(149); // 50 + 100 - 1
    });

    it('should return -1 for empty buffer', () => {
      const viewState = new FootprintViewState(0);

      expect(viewState.getRightEdgeBarIndex()).toBe(-1);
    });

    it('should reflect right edge after setRightEdgeBarIndex', () => {
      const viewState = new FootprintViewState(200, 100);
      viewState.setRightEdgeBarIndex(120);

      expect(viewState.getRightEdgeBarIndex()).toBe(120);
    });
  });

  describe('setRightEdgeBarIndex() (AC8)', () => {
    it('should position viewport so given bar is at right edge', () => {
      const viewState = new FootprintViewState(200, 100);
      viewState.setRightEdgeBarIndex(120); // visibleStart = 120 - 100 + 1 = 21

      const range = viewState.getVisibleBarRange();
      expect(range.startIndex).toBe(21);
      expect(viewState.getRightEdgeBarIndex()).toBe(120);
    });

    it('should clamp at left edge when index is too small', () => {
      const viewState = new FootprintViewState(200, 100);
      viewState.setRightEdgeBarIndex(10); // would give visibleStart = -89

      const range = viewState.getVisibleBarRange();
      expect(range.startIndex).toBe(0); // clamped
    });

    it('should clamp at right edge when index is too large', () => {
      const viewState = new FootprintViewState(200, 100);
      viewState.setRightEdgeBarIndex(500); // would give visibleStart = 401

      const range = viewState.getVisibleBarRange();
      expect(range.startIndex).toBe(100); // clamped to max(0, 200 - 100)
      expect(viewState.getRightEdgeBarIndex()).toBe(199);
    });

    it('should round fractional index', () => {
      const viewState = new FootprintViewState(200, 100);
      viewState.setRightEdgeBarIndex(120.6); // rounds to 121 => visibleStart = 22

      expect(viewState.getRightEdgeBarIndex()).toBe(121);
    });

    it('should enable followLatest when at latest', () => {
      const viewState = new FootprintViewState(200, 100);
      viewState.pan(-50);
      expect(viewState.getFollowLatest()).toBe(false);

      viewState.setRightEdgeBarIndex(199); // back to tail

      expect(viewState.getFollowLatest()).toBe(true);
    });

    it('should disable followLatest when not at latest', () => {
      const viewState = new FootprintViewState(200, 100);

      viewState.setRightEdgeBarIndex(120); // not at tail

      expect(viewState.getFollowLatest()).toBe(false);
    });

    it('should handle empty buffer', () => {
      const viewState = new FootprintViewState(0);
      viewState.setRightEdgeBarIndex(5);

      expect(viewState.getVisibleBarRange().startIndex).toBe(0);
    });
  });

  describe('getFollowLatest() and setFollowLatest() (AC9)', () => {
    it('should return true after construction by default', () => {
      const viewState = new FootprintViewState(200, 100);

      expect(viewState.getFollowLatest()).toBe(true);
    });

    it('should round-trip setFollowLatest(false)', () => {
      const viewState = new FootprintViewState(200, 100);

      viewState.setFollowLatest(false);
      expect(viewState.getFollowLatest()).toBe(false);
    });

    it('should round-trip setFollowLatest(true) after disabling', () => {
      const viewState = new FootprintViewState(200, 100);
      viewState.setFollowLatest(false);
      viewState.setFollowLatest(true);

      expect(viewState.getFollowLatest()).toBe(true);
    });

    it('should leave viewport unchanged when setting followLatest directly', () => {
      const viewState = new FootprintViewState(200, 100);
      viewState.pan(-30);

      const before = viewState.getVisibleBarRange().startIndex;
      viewState.setFollowLatest(false);

      expect(viewState.getVisibleBarRange().startIndex).toBe(before);
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

  describe('getRightEdgeBarIndex() (AC7)', () => {
    it('should return the index of the right-edge visible bar', () => {
      const viewState = new FootprintViewState(200, 100);

      expect(viewState.getRightEdgeBarIndex()).toBe(199); // 100 + 100 - 1 = 199
    });

    it('should return correct index after panning', () => {
      const viewState = new FootprintViewState(200, 100);
      viewState.pan(-50); // visibleStart = 50

      expect(viewState.getRightEdgeBarIndex()).toBe(149); // 50 + 100 - 1 = 149
    });

    it('should return -1 when totalBars is 0', () => {
      const viewState = new FootprintViewState(0);

      expect(viewState.getRightEdgeBarIndex()).toBe(-1);
    });

    it('should clamp to totalBars - 1 when viewport extends past buffer', () => {
      const viewState = new FootprintViewState(5, MIN_VISIBLE_BARS);

      expect(viewState.getRightEdgeBarIndex()).toBe(4); // totalBars - 1
    });
  });

  describe('setRightEdgeBarIndex() (AC8)', () => {
    it('should position the viewport so the given index is at the right edge', () => {
      const viewState = new FootprintViewState(200, 100);
      viewState.setRightEdgeBarIndex(150);

      const range = viewState.getVisibleBarRange();
      expect(range.startIndex).toBe(51); // 150 - 100 + 1 = 51
      expect(viewState.getRightEdgeBarIndex()).toBe(150);
    });

    it('should clamp index to valid bounds (upper)', () => {
      const viewState = new FootprintViewState(200, 100);

      viewState.setRightEdgeBarIndex(500);

      const range = viewState.getVisibleBarRange();
      expect(range.startIndex).toBe(100); // Clamped to 199 - 100 + 1 = 100
    });

    it('should clamp index to valid bounds (lower)', () => {
      const viewState = new FootprintViewState(200, 100);

      viewState.setRightEdgeBarIndex(-10);

      const range = viewState.getVisibleBarRange();
      expect(range.startIndex).toBe(0);
    });

    it('should do nothing when totalBars is 0', () => {
      const viewState = new FootprintViewState(0);

      viewState.setRightEdgeBarIndex(10);

      expect(viewState.getRightEdgeBarIndex()).toBe(-1);
    });

    it('should update followLatest when setRightEdgeBarIndex reaches latest', () => {
      const viewState = new FootprintViewState(200, 100);
      viewState.pan(-50); // followLatest = false

      viewState.setRightEdgeBarIndex(199);

      expect(viewState.getFollowLatest()).toBe(true);
    });

    it('should update followLatest when setRightEdgeBarIndex moves away from latest', () => {
      const viewState = new FootprintViewState(200, 100);
      expect(viewState.getFollowLatest()).toBe(true);

      viewState.setRightEdgeBarIndex(150);

      expect(viewState.getFollowLatest()).toBe(false);
    });

    it('should handle small totalBars', () => {
      const viewState = new FootprintViewState(3, MIN_VISIBLE_BARS);

      viewState.setRightEdgeBarIndex(2);

      expect(viewState.getRightEdgeBarIndex()).toBe(2);
    });
  });

  describe('getFollowLatest() / setFollowLatest() (AC9)', () => {
    it('should return true by default', () => {
      const viewState = new FootprintViewState(200);

      expect(viewState.getFollowLatest()).toBe(true);
    });

    it('should return false after panning away', () => {
      const viewState = new FootprintViewState(200, 100);
      viewState.pan(-10);

      expect(viewState.getFollowLatest()).toBe(false);
    });

    it('should set followLatest flag', () => {
      const viewState = new FootprintViewState(200, 100);

      viewState.setFollowLatest(false);
      expect(viewState.getFollowLatest()).toBe(false);

      viewState.setFollowLatest(true);
      expect(viewState.getFollowLatest()).toBe(true);
    });
  });
});