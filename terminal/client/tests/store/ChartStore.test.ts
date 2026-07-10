import { describe, it, expect } from 'vitest';
import { ChartStore, MAX_BARS } from '../../src/store/ChartStore.js';
import type { BarPayload, CvdPayload, FootprintPayload } from '../../src/types.js';

function makeBar(ts_event: number, open = 100): BarPayload {
  return { ts_event, open, high: open + 1, low: open - 1, close: open + 0.5, volume: 1000 };
}

function makeCvd(ts_event: number, cvd = 0, delta = 0): CvdPayload {
  return { ts_event, cvd, delta };
}

function makeFootprint(ts_event: number): FootprintPayload {
  return { ts_event, bin_size: 60000, levels: [{ price: 100, buy: 50, sell: 30 }] };
}

describe('ChartStore', () => {
  describe('ingestBar()', () => {
    it('should append bars in chronological order', () => {
      const store = new ChartStore();
      store.ingestBar(makeBar(100));
      store.ingestBar(makeBar(200));
      store.ingestBar(makeBar(300));

      const state = store.getState();
      expect(state.bars).toHaveLength(3);
      expect(state.bars[0].ts_event).toBe(100);
      expect(state.bars[1].ts_event).toBe(200);
      expect(state.bars[2].ts_event).toBe(300);
    });

    it('should enforce MAX_BARS limit', () => {
      const store = new ChartStore();

      for (let i = 0; i < MAX_BARS + 100; i++) {
        store.ingestBar(makeBar(i));
      }

      const state = store.getState();
      expect(state.bars).toHaveLength(MAX_BARS);
    });

    it('should evict oldest bar when buffer is full', () => {
      const store = new ChartStore();

      for (let i = 0; i < MAX_BARS; i++) {
        store.ingestBar(makeBar(i));
      }

      // After filling the buffer, ingest one more bar
      store.ingestBar(makeBar(MAX_BARS));

      const state = store.getState();
      expect(state.bars).toHaveLength(MAX_BARS);
      expect(state.bars[0].ts_event).toBe(1);
      expect(state.bars[MAX_BARS - 1].ts_event).toBe(MAX_BARS);
    });

    it('should evict CVD and footprint when a bar is evicted', () => {
      const store = new ChartStore();
      const evictedTs = 0;

      for (let i = 0; i < MAX_BARS; i++) {
        store.ingestBar(makeBar(i));
        store.ingestCvd(makeCvd(i, i * 10, i));
        store.ingestFootprint(makeFootprint(i));
      }

      // All bars, CVD, and footprints present before overflow
      expect(store.getState().cvd.has(evictedTs)).toBe(true);
      expect(store.getState().footprints.has(evictedTs)).toBe(true);

      // Ingest one more bar to trigger eviction
      store.ingestBar(makeBar(MAX_BARS));

      expect(store.getState().cvd.has(evictedTs)).toBe(false);
      expect(store.getState().footprints.has(evictedTs)).toBe(false);
    });

    it('should maintain chronological order after wraparound', () => {
      const store = new ChartStore();

      for (let i = 0; i < MAX_BARS; i++) {
        store.ingestBar(makeBar(i));
      }

      // Buffer is full with ts 0..999. Now overwrite oldest with new timestamps.
      for (let i = 0; i < 50; i++) {
        store.ingestBar(makeBar(1000 + i));
      }

      const state = store.getState();
      expect(state.bars).toHaveLength(MAX_BARS);
      // First bar should be ts 50 (the oldest surviving)
      expect(state.bars[0].ts_event).toBe(50);
      // Last bar should be ts 1049
      expect(state.bars[MAX_BARS - 1].ts_event).toBe(1049);
    });
  });

  describe('ingestCvd()', () => {
    it('should store CVD data keyed by ts_event', () => {
      const store = new ChartStore();
      store.ingestCvd(makeCvd(100, 500, 10));
      store.ingestCvd(makeCvd(200, 510, 10));

      const state = store.getState();
      expect(state.cvd.get(100)?.cvd).toBe(500);
      expect(state.cvd.get(200)?.cvd).toBe(510);
    });

    it('should overwrite CVD data for the same ts_event', () => {
      const store = new ChartStore();
      store.ingestCvd(makeCvd(100, 500, 10));
      store.ingestCvd(makeCvd(100, 600, 20));

      expect(store.getState().cvd.get(100)?.cvd).toBe(600);
    });
  });

  describe('ingestFootprint()', () => {
    it('should store footprint data keyed by ts_event', () => {
      const store = new ChartStore();
      store.ingestFootprint(makeFootprint(100));
      store.ingestFootprint(makeFootprint(200));

      const state = store.getState();
      expect(state.footprints.has(100)).toBe(true);
      expect(state.footprints.has(200)).toBe(true);
    });

    it('should overwrite footprint data for the same ts_event', () => {
      const store = new ChartStore();
      store.ingestFootprint(makeFootprint(100));
      store.ingestFootprint(makeFootprint(100));

      const state = store.getState();
      expect(state.footprints.size).toBe(1);
    });
  });

  describe('getState()', () => {
    it('should return empty state when no data ingested', () => {
      const store = new ChartStore();
      const state = store.getState();

      expect(state.bars).toHaveLength(0);
      expect(state.cvd.size).toBe(0);
      expect(state.footprints.size).toBe(0);
    });

    it('should return a snapshot (not live reference)', () => {
      const store = new ChartStore();
      store.ingestBar(makeBar(100));

      const state = store.getState();
      state.bars.push(makeBar(999));

      // The store's internal state should be unaffected
      expect(store.getState().bars).toHaveLength(1);
    });

    it('should return read-only state with all three buffers populated', () => {
      const store = new ChartStore();
      store.ingestBar(makeBar(100));
      store.ingestCvd(makeCvd(100, 500, 10));
      store.ingestFootprint(makeFootprint(100));

      const state = store.getState();
      expect(state.bars).toHaveLength(1);
      expect(state.cvd.size).toBe(1);
      expect(state.footprints.size).toBe(1);
    });

    it('should correlate CVD and footprint with bars by ts_event', () => {
      const store = new ChartStore();

      store.ingestBar(makeBar(100));
      store.ingestCvd(makeCvd(100, 500, 10));
      store.ingestFootprint(makeFootprint(100));

      store.ingestBar(makeBar(200));
      store.ingestCvd(makeCvd(200, 510, 10));
      store.ingestFootprint(makeFootprint(200));

      const state = store.getState();
      for (const bar of state.bars) {
        expect(state.cvd.has(bar.ts_event)).toBe(true);
        expect(state.footprints.has(bar.ts_event)).toBe(true);
      }
    });
  });

  describe('getBarCount()', () => {
    it('should return 0 for empty store', () => {
      const store = new ChartStore();
      expect(store.getBarCount()).toBe(0);
    });

    it('should return the number of bars ingested', () => {
      const store = new ChartStore();
      store.ingestBar(makeBar(100));
      store.ingestBar(makeBar(200));
      store.ingestBar(makeBar(300));

      expect(store.getBarCount()).toBe(3);
    });

    it('should return MAX_BARS when buffer is full', () => {
      const store = new ChartStore();
      for (let i = 0; i < MAX_BARS + 50; i++) {
        store.ingestBar(makeBar(i));
      }

      expect(store.getBarCount()).toBe(MAX_BARS);
    });
  });

  describe('Buffer edge cases', () => {
    it('should handle rapid ingestion of MAX_BARS bars', () => {
      const store = new ChartStore();

      for (let i = 0; i < MAX_BARS; i++) {
        store.ingestBar(makeBar(i));
      }

      expect(store.getBarCount()).toBe(MAX_BARS);
      expect(store.getState().bars[0].ts_event).toBe(0);
      expect(store.getState().bars[MAX_BARS - 1].ts_event).toBe(MAX_BARS - 1);
    });

    it('should prevent memory leaks by evicting oldest CVD/footprint', () => {
      const store = new ChartStore();

      for (let i = 0; i < MAX_BARS; i++) {
        store.ingestBar(makeBar(i));
        store.ingestCvd(makeCvd(i, i, i));
        store.ingestFootprint(makeFootprint(i));
      }

      // After MAX_BARS ingested: cvd and footprints each have MAX_BARS entries
      expect(store.getState().cvd.size).toBe(MAX_BARS);
      expect(store.getState().footprints.size).toBe(MAX_BARS);

      // Trigger 50 evictions by ingesting 50 more bars
      for (let i = 0; i < 50; i++) {
        store.ingestBar(makeBar(MAX_BARS + i));
      }

      // 50 oldest CVD/footprint entries evicted along with their bars
      expect(store.getState().cvd.size).toBe(MAX_BARS - 50);
      expect(store.getState().footprints.size).toBe(MAX_BARS - 50);
    });

    it('should maintain chronological order through full buffer wraparound', () => {
      const store = new ChartStore();

      for (let i = 0; i < MAX_BARS * 3; i++) {
        store.ingestBar(makeBar(i));
      }

      const state = store.getState();
      expect(state.bars).toHaveLength(MAX_BARS);

      // Last MAX_BARS bars ingested: timestamps MAX_BARS*2 .. MAX_BARS*3-1
      const expectedFirst = MAX_BARS * 2;
      const expectedLast = MAX_BARS * 3 - 1;
      expect(state.bars[0].ts_event).toBe(expectedFirst);
      expect(state.bars[MAX_BARS - 1].ts_event).toBe(expectedLast);

      // Verify strictly increasing order
      for (let i = 1; i < state.bars.length; i++) {
        expect(state.bars[i].ts_event).toBeGreaterThan(state.bars[i - 1].ts_event);
      }
    });
  });
});