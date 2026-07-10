import { describe, it, expect } from 'vitest';
import { ChartStore, MAX_BARS } from '../../src/store/ChartStore.js';
import { ChartViewState, MIN_VISIBLE_BARS, DEFAULT_VISIBLE_BARS } from '../../src/chart/ChartViewState.js';
import type { BarPayload, CvdPayload, FootprintPayload, Envelope } from '../../src/types.js';

function makeBar(ts_event: number, open = 100): BarPayload {
  return { ts_event, open, high: open + 1, low: open - 1, close: open + 0.5, volume: 1000 };
}

function makeCvd(ts_event: number, cvd = 0, delta = 0): CvdPayload {
  return { ts_event, cvd, delta };
}

function makeFootprint(ts_event: number): FootprintPayload {
  return { ts_event, bin_size: 60000, levels: [{ price: 100, buy: 50, sell: 30 }] };
}

function makeBarEnvelope(bar: BarPayload): Envelope {
  return { v: 1, type: 'bar', seq: bar.ts_event, payload: bar };
}

function makeCvdEnvelope(cvd: CvdPayload): Envelope {
  return { v: 1, type: 'cvd', seq: cvd.ts_event, payload: cvd };
}

function makeFootprintEnvelope(fp: FootprintPayload): Envelope {
  return { v: 1, type: 'footprint', seq: fp.ts_event, payload: fp };
}

describe('Cross-Feature Integration: ChartStore + ChartViewState', () => {
  describe('Priority 2: View state follows ChartStore bar count', () => {
    it('should seed ChartViewState from empty ChartStore', () => {
      const store = new ChartStore();
      const viewState = new ChartViewState(store.getBarCount());
      expect(viewState.getState().visibleStart).toBe(0);
      expect(viewState.getState().followLatest).toBe(true);
    });

    it('should seed ChartViewState from ChartStore with bars', () => {
      const store = new ChartStore();
      for (let i = 0; i < 50; i++) {
        store.ingestBar(makeBar(i));
      }

      const viewState = new ChartViewState(store.getBarCount());
      const vs = viewState.getState();
      expect(vs.visibleStart).toBe(0);
      expect(vs.followLatest).toBe(true);
    });

    it('should advance ChartViewState when new bars ingested in ChartStore (followLatest)', () => {
      const store = new ChartStore();
      const viewState = new ChartViewState(store.getBarCount());

      for (let i = 0; i < 150; i++) {
        store.ingestBar(makeBar(i));
        viewState.onNewBar(store.getBarCount());
      }

      const vs = viewState.getState();
      expect(viewState.isAtTail()).toBe(true);
      expect(vs.visibleStart).toBe(150 - DEFAULT_VISIBLE_BARS);
    });

    it('should keep view state at tail after buffer overflow (MAX_BARS)', () => {
      const store = new ChartStore();
      const viewState = new ChartViewState(store.getBarCount());

      for (let i = 0; i < MAX_BARS + 50; i++) {
        store.ingestBar(makeBar(i));
        viewState.onNewBar(store.getBarCount());
      }

      expect(store.getBarCount()).toBe(MAX_BARS);
      expect(viewState.isAtTail()).toBe(true);
      expect(viewState.getState().visibleStart).toBe(MAX_BARS - DEFAULT_VISIBLE_BARS);
    });
  });

  describe('Priority 2: ChartStore state provides correct data for ChartViewState pan operations', () => {
    it('should pan correctly through ChartStore bars after seeding from getState()', () => {
      const store = new ChartStore();
      for (let i = 0; i < 200; i++) {
        store.ingestBar(makeBar(i));
      }

      const viewState = new ChartViewState(store.getBarCount(), 50);
      expect(viewState.getState().visibleStart).toBe(150);
      expect(viewState.getState().visibleCount).toBe(50);

      viewState.pan(-30);
      const vs = viewState.getState();
      expect(vs.visibleStart).toBe(120);

      const state = store.getState();
      expect(state.bars[vs.visibleStart].ts_event).toBe(120);
    });

    it('should correlate pan position with ChartStore bar data by index', () => {
      const store = new ChartStore();
      for (let i = 0; i < 100; i++) {
        store.ingestBar(makeBar(i * 1000, 100 + i));
      }

      const viewState = new ChartViewState(store.getBarCount(), 30);
      viewState.pan(-40);

      const vs = viewState.getState();
      const state = store.getState();
      const firstVisibleBar = state.bars[vs.visibleStart];

      expect(firstVisibleBar.ts_event).toBe((100 - 30 - 40) * 1000);
    });
  });

  describe('Priority 3: Shared data type consistency across ChartStore and ChartViewState', () => {
    it('should correctly pass ChartStore getState() bar array as index source for ChartViewState', () => {
      const store = new ChartStore();
      for (let i = 0; i < 50; i++) {
        store.ingestBar(makeBar(i * 1000, 100 + i));
      }

      const viewState = new ChartViewState(store.getBarCount(), 20);
      const vs = viewState.getState();
      const state = store.getState();

      expect(vs.visibleStart).toBe(30);
      expect(state.bars.length).toBe(50);

      const visibleBars = state.bars.slice(vs.visibleStart, vs.visibleStart + vs.visibleCount);
      expect(visibleBars).toHaveLength(20);
      expect(visibleBars[0].ts_event).toBe(30 * 1000);
    });

    it('should maintain bar-to-footprint correlation when panning through ChartStore data', () => {
      const store = new ChartStore();
      for (let i = 0; i < 100; i++) {
        store.ingestBar(makeBar(i * 1000));
        store.ingestFootprint(makeFootprint(i * 1000));
      }

      const viewState = new ChartViewState(store.getBarCount(), 30);
      viewState.pan(-20);
      const vs = viewState.getState();
      const state = store.getState();

      for (let j = vs.visibleStart; j < vs.visibleStart + vs.visibleCount && j < state.bars.length; j++) {
        const bar = state.bars[j];
        expect(state.footprints.has(bar.ts_event)).toBe(true);
      }
    });
  });

  describe('Priority 2: Envelope ingestion pipeline driving ChartStore and ChartViewState', () => {
    it('should process full envelope pipeline: bar → store → view state → getState', () => {
      const store = new ChartStore();
      const viewState = new ChartViewState(store.getBarCount(), 30);

      const envelope = makeBarEnvelope(makeBar(100, 150));
      store.ingestBar(envelope.payload as BarPayload);
      viewState.onNewBar(store.getBarCount());

      expect(store.getBarCount()).toBe(1);
      expect(viewState.getState().visibleStart).toBe(0);
      expect(viewState.getState().visibleCount).toBe(30);

      const state = store.getState();
      expect(state.bars[0].open).toBe(150);
      expect(state.bars[0].ts_event).toBe(100);
    });

    it('should handle sequential bar+cvd+footprint envelopes with view state tracking', () => {
      const store = new ChartStore();
      const viewState = new ChartViewState(store.getBarCount(), 50);

      for (let i = 0; i < 25; i++) {
        store.ingestBar(makeBarEnvelope(makeBar(i * 1000)).payload as BarPayload);
        store.ingestCvd(makeCvdEnvelope(makeCvd(i * 1000, i * 100, i * 10)).payload as CvdPayload);
        store.ingestFootprint(makeFootprintEnvelope(makeFootprint(i * 1000)).payload as FootprintPayload);
        viewState.onNewBar(store.getBarCount());
      }

      expect(store.getBarCount()).toBe(25);
      expect(viewState.isAtTail()).toBe(true);

      const state = store.getState();
      expect(state.cvd.size).toBe(25);
      expect(state.footprints.size).toBe(25);

      const vs = viewState.getState();
      const firstVisible = state.bars[vs.visibleStart];
      const cvdForBar = state.cvd.get(firstVisible.ts_event);
      const fpForBar = state.footprints.get(firstVisible.ts_event);
      expect(cvdForBar).toBeDefined();
      expect(fpForBar).toBeDefined();
    });

    it('should handle out-of-order footprint arrival then subsequent bar matching ts_event', () => {
      const store = new ChartStore();
      store.ingestFootprint(makeFootprintEnvelope(makeFootprint(5000)).payload as FootprintPayload);

      const stateBefore = store.getState();
      expect(stateBefore.footprints.has(5000)).toBe(true);
      expect(stateBefore.bars).toHaveLength(0);

      store.ingestBar(makeBarEnvelope(makeBar(5000)).payload as BarPayload);

      const stateAfter = store.getState();
      expect(stateAfter.bars).toHaveLength(1);
      expect(stateAfter.bars[0].ts_event).toBe(5000);
      expect(stateAfter.footprints.has(5000)).toBe(true);
    });
  });

  describe('Priority 2: ChartStore getState() + ChartViewState integration edge cases', () => {
    it('should handle zero bars in store with view state at minimum', () => {
      const store = new ChartStore();
      const viewState = new ChartViewState(store.getBarCount());
      expect(viewState.getState().visibleStart).toBe(0);
      expect(viewState.getState().followLatest).toBe(true);
      expect(viewState.isAtTail()).toBe(true);

      const state = store.getState();
      expect(state.bars).toHaveLength(0);
      expect(state.cvd.size).toBe(0);
      expect(state.footprints.size).toBe(0);
    });

    it('should handle view state after buffer wraparound with MAX_BARS+1 ingestions', () => {
      const store = new ChartStore();
      const viewState = new ChartViewState(store.getBarCount(), 50);

      for (let i = 0; i < MAX_BARS + 1; i++) {
        store.ingestBar(makeBar(i));
        viewState.onNewBar(store.getBarCount());
      }

      expect(store.getBarCount()).toBe(MAX_BARS);
      expect(viewState.isAtTail()).toBe(true);

      const state = store.getState();
      expect(state.bars).toHaveLength(MAX_BARS);
      expect(state.bars[0].ts_event).toBe(1);
    });

    it('should survive zoom after store wraparound', () => {
      const store = new ChartStore();
      const viewState = new ChartViewState(store.getBarCount(), 100);

      for (let i = 0; i < MAX_BARS + 50; i++) {
        store.ingestBar(makeBar(i));
        viewState.onNewBar(store.getBarCount());
      }

      viewState.pan(-30);
      viewState.zoom(2, store.getBarCount() - 50);
      viewState.pan(-10);

      const vs = viewState.getState();
      expect(vs.visibleStart).toBeGreaterThanOrEqual(0);
      expect(vs.visibleCount).toBeGreaterThanOrEqual(MIN_VISIBLE_BARS);
      expect(vs.visibleCount).toBeLessThanOrEqual(500);

      const state = store.getState();
      expect(state.bars.length).toBe(MAX_BARS);
    });
  });
});