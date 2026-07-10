import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ChartStore, MAX_BARS } from '../../src/store/ChartStore.js';
import { ViewToggleButton, type ViewType } from '../../src/ui/ViewToggleButton.js';
import type { BarPayload, CvdPayload, FootprintPayload, Envelope, ChartStoreState } from '../../src/types.js';

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

describe('Cross-Feature Integration: Edge Cases and Data Correlation', () => {
  describe('Priority 2: Orphaned data edge cases', () => {
    it('should handle multiple orphaned footprints with no matching bars', () => {
      const store = new ChartStore();
      store.ingestFootprint(makeFootprint(100));
      store.ingestFootprint(makeFootprint(200));
      store.ingestFootprint(makeFootprint(300));

      const state = store.getState();
      expect(state.footprints.size).toBe(3);
      expect(state.bars).toHaveLength(0);
      expect(state.cvd.size).toBe(0);
    });

    it('should handle orphaned CVD with no matching bar', () => {
      const store = new ChartStore();
      store.ingestCvd(makeCvd(100, 500, 10));
      store.ingestCvd(makeCvd(200, 510, 10));

      const state = store.getState();
      expect(state.cvd.size).toBe(2);
      expect(state.bars).toHaveLength(0);
    });

    it('should evict orphaned footprint when bar with matching ts_event is later evicted', () => {
      const store = new ChartStore();

      for (let i = 0; i < MAX_BARS; i++) {
        store.ingestBar(makeBar(i));
      }

      store.ingestFootprint(makeFootprint(0));

      store.ingestBar(makeBar(MAX_BARS));

      const state = store.getState();
      expect(state.footprints.has(0)).toBe(false);
      expect(state.bars.length).toBe(MAX_BARS);
    });

    it('should keep orphaned footprint with ts_event not in evicted bar range', () => {
      const store = new ChartStore();

      for (let i = 0; i < MAX_BARS; i++) {
        store.ingestBar(makeBar(i));
      }

      store.ingestFootprint(makeFootprint(999));

      store.ingestBar(makeBar(MAX_BARS));

      const state = store.getState();
      expect(state.footprints.has(999)).toBe(true);
      expect(state.bars.length).toBe(MAX_BARS);
    });

    it('should evict footprint when bar is evicted (normal bar-first flow)', () => {
      const store = new ChartStore();

      for (let i = 0; i < MAX_BARS; i++) {
        store.ingestBar(makeBar(i));
        store.ingestFootprint(makeFootprint(i));
      }

      store.ingestBar(makeBar(MAX_BARS));

      const state = store.getState();
      expect(state.footprints.has(0)).toBe(false);
      expect(state.footprints.size).toBe(MAX_BARS - 1);
    });
  });

  describe('Priority 2: Cross-type envelope dispatch preserving data integrity', () => {
    it('should preserve all data types through envelope dispatch pipeline', () => {
      const store = new ChartStore();

      const dispatch = (envelope: Envelope): void => {
        switch (envelope.type) {
          case 'bar':
            store.ingestBar(envelope.payload as BarPayload);
            break;
          case 'cvd':
            store.ingestCvd(envelope.payload as CvdPayload);
            break;
          case 'footprint':
            store.ingestFootprint(envelope.payload as FootprintPayload);
            break;
        }
      };

      dispatch(makeBarEnvelope(makeBar(100)));
      dispatch(makeCvdEnvelope(makeCvd(100, 500, 10)));
      dispatch(makeFootprintEnvelope(makeFootprint(100)));
      dispatch(makeBarEnvelope(makeBar(200)));
      dispatch(makeCvdEnvelope(makeCvd(200, 510, 10)));

      const state = store.getState();
      expect(state.bars).toHaveLength(2);
      expect(state.cvd.size).toBe(2);
      expect(state.footprints.size).toBe(1);
    });

    it('should handle envelope with unknown type without crashing', () => {
      const store = new ChartStore();
      const unknownEnvelope: Envelope = { v: 1, type: 'depth_heatmap', seq: 1, payload: {} };

      const stateBefore = store.getState();

      expect(() => {
        const env = unknownEnvelope;
        if (env.type === 'bar') store.ingestBar(env.payload as BarPayload);
        if (env.type === 'cvd') store.ingestCvd(env.payload as CvdPayload);
        if (env.type === 'footprint') store.ingestFootprint(env.payload as FootprintPayload);
      }).not.toThrow();

      const stateAfter = store.getState();
      expect(stateAfter.bars).toHaveLength(stateBefore.bars.length);
      expect(stateAfter.cvd.size).toBe(stateBefore.cvd.size);
      expect(stateAfter.footprints.size).toBe(stateBefore.footprints.size);
    });
  });

  describe('Priority 2: ViewToggleButton multi-switch with data correlation', () => {
    let container: HTMLDivElement;

    beforeEach(() => {
      container = document.createElement('div');
      document.body.appendChild(container);
    });

    afterEach(() => {
      if (container.parentNode) {
        container.parentNode.removeChild(container);
      }
    });

    it('should correlate bar and footprint data across multiple view toggles with gap ingestion', () => {
      const store = new ChartStore();
      let currentState: ChartStoreState | null = null;

      const toggle = new ViewToggleButton(container, {
        onViewSwitch: (viewType: ViewType) => {
          currentState = store.getState();
        },
      });

      store.ingestBar(makeBar(100));
      store.ingestFootprint(makeFootprint(100));

      const button = container.querySelector('button') as HTMLButtonElement;
      button.click();
      expect(currentState!.bars).toHaveLength(1);
      expect(currentState!.footprints.size).toBe(1);

      store.ingestBar(makeBar(200));
      store.ingestFootprint(makeFootprint(200));
      store.ingestBar(makeBar(300));

      button.click();
      expect(currentState!.bars).toHaveLength(3);
      expect(currentState!.bars[2].ts_event).toBe(300);
      expect(currentState!.footprints.has(100)).toBe(true);
      expect(currentState!.footprints.has(200)).toBe(true);
      expect(currentState!.footprints.has(300)).toBe(false);

      toggle.destroy();
    });

    it('should correctly cycle view type label through multiple switches with data flowing', () => {
      const store = new ChartStore();
      let lastView: ViewType = 'overview';

      const toggle = new ViewToggleButton(container, {
        onViewSwitch: (viewType: ViewType) => {
          lastView = viewType;
          toggle.setViewType(viewType);
        },
      });

      const button = container.querySelector('button') as HTMLButtonElement;

      for (let i = 0; i < 5; i++) {
        store.ingestBar(makeBar(i * 1000));
        button.click();
        const expectedView = i % 2 === 0 ? 'footprint' : 'overview';
        expect(lastView).toBe(expectedView);
        expect(button.textContent).toBe(expectedView === 'overview' ? 'Overview' : 'Footprint');
      }

      toggle.destroy();
    });
  });

  describe('Priority 3: types.ts interface contract across feature boundaries', () => {
    it('should satisfy all required fields of ChartStoreState when populated from bar/CVD/footprint', () => {
      const store = new ChartStore();
      store.ingestBar(makeBar(100));
      store.ingestCvd(makeCvd(100, 500, 10));
      store.ingestFootprint(makeFootprint(100));

      const state: ChartStoreState = store.getState();
      expect(state.bars[0]).toHaveProperty('ts_event');
      expect(state.bars[0]).toHaveProperty('open');
      expect(state.bars[0]).toHaveProperty('high');
      expect(state.bars[0]).toHaveProperty('low');
      expect(state.bars[0]).toHaveProperty('close');
      expect(state.bars[0]).toHaveProperty('volume');
      expect(state.cvd.get(100)).toHaveProperty('cvd');
      expect(state.cvd.get(100)).toHaveProperty('delta');
      expect(state.footprints.get(100)).toHaveProperty('bin_size');
      expect(state.footprints.get(100)).toHaveProperty('levels');
      expect(Array.isArray(state.footprints.get(100)!.levels)).toBe(true);
    });

    it('should ensure FootprintPayload ts_event aligns with BarPayload ts_event type (number)', () => {
      const bar: BarPayload = makeBar(100);
      const fp: FootprintPayload = makeFootprint(100);
      expect(typeof bar.ts_event).toBe('number');
      expect(typeof fp.ts_event).toBe('number');
      expect(bar.ts_event).toBe(fp.ts_event);
    });

    it('should maintain Envelope v1 type contract across all message types', () => {
      const barEnv = makeBarEnvelope(makeBar(100));
      const cvdEnv = makeCvdEnvelope(makeCvd(100, 500, 10));
      const fpEnv = makeFootprintEnvelope(makeFootprint(100));

      expect(barEnv.v).toBe(1);
      expect(cvdEnv.v).toBe(1);
      expect(fpEnv.v).toBe(1);

      expect(['bar', 'cvd', 'footprint']).toContain(barEnv.type);
      expect(['bar', 'cvd', 'footprint']).toContain(cvdEnv.type);
      expect(['bar', 'cvd', 'footprint']).toContain(fpEnv.type);
    });
  });
});