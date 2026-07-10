import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

describe('Cross-Feature Integration: ChartStore + types.ts + ViewToggleButton', () => {
  describe('Shared file modification area: types.ts type consistency (Priority 3)', () => {
    it('should correctly type ChartStoreState with all three Map types from merged types.ts', () => {
      const store = new ChartStore();
      store.ingestBar(makeBar(100));
      store.ingestCvd(makeCvd(100, 500, 10));
      store.ingestFootprint(makeFootprint(100));

      const state: ChartStoreState = store.getState();
      expect(state.bars).toBeInstanceOf(Array);
      expect(state.bars[0].ts_event).toBe(100);
      expect(state.cvd).toBeInstanceOf(Map);
      expect(state.cvd.get(100)?.cvd).toBe(500);
      expect(state.footprints).toBeInstanceOf(Map);
      expect(state.footprints.get(100)?.bin_size).toBe(60000);
    });

    it('should preserve FootprintPayload.bin_size type as number (documentation-fix merge area)', () => {
      const fp: FootprintPayload = {
        ts_event: 100,
        bin_size: 60000,
        levels: [{ price: 100, buy: 50, sell: 30 }],
      };
      expect(typeof fp.bin_size).toBe('number');

      const store = new ChartStore();
      store.ingestFootprint(fp);
      const state = store.getState();
      expect(typeof state.footprints.get(100)?.bin_size).toBe('number');
    });

    it('should maintain ChartStoreState interface contract after types.ts merges', () => {
      const store = new ChartStore();
      const state = store.getState();
      expect(state).toHaveProperty('bars');
      expect(state).toHaveProperty('cvd');
      expect(state).toHaveProperty('footprints');
      expect(Array.isArray(state.bars)).toBe(true);
      expect(state.cvd instanceof Map).toBe(true);
      expect(state.footprints instanceof Map).toBe(true);
    });
  });

  describe('Cross-feature: ViewToggleButton + ChartStore interaction (Priority 2)', () => {
    let container: HTMLDivElement;
    let store: ChartStore;

    beforeEach(() => {
      container = document.createElement('div');
      document.body.appendChild(container);
      store = new ChartStore();
      store.ingestBar(makeBar(100));
      store.ingestCvd(makeCvd(100, 500, 10));
      store.ingestFootprint(makeFootprint(100));
      store.ingestBar(makeBar(200));
      store.ingestCvd(makeCvd(200, 510, 10));
      store.ingestFootprint(makeFootprint(200));
    });

    afterEach(() => {
      if (container.parentNode) {
        container.parentNode.removeChild(container);
      }
    });

    it('should allow ViewToggleButton onViewSwitch to read ChartStore state', () => {
      let capturedView: ViewType | null = null;
      let capturedState: ChartStoreState | null = null;

      const toggle = new ViewToggleButton(container, {
        onViewSwitch: (viewType: ViewType) => {
          capturedView = viewType;
          capturedState = store.getState();
        },
      });

      const button = container.querySelector('button') as HTMLButtonElement;
      button.click();

      expect(capturedView).toBe('footprint');
      expect(capturedState).not.toBeNull();
      expect(capturedState!.bars.length).toBe(2);
      expect(capturedState!.cvd.size).toBe(2);
      expect(capturedState!.footprints.size).toBe(2);
      toggle.destroy();
    });

    it('should provide latest ChartStore data when onViewSwitch fires after new ingestion', () => {
      let capturedState: ChartStoreState | null = null;

      const toggle = new ViewToggleButton(container, {
        onViewSwitch: (viewType: ViewType) => {
          capturedState = store.getState();
        },
      });

      store.ingestBar(makeBar(300));
      store.ingestCvd(makeCvd(300, 520, 10));
      store.ingestFootprint(makeFootprint(300));

      const button = container.querySelector('button') as HTMLButtonElement;
      button.click();

      expect(capturedState!.bars.length).toBe(3);
      expect(capturedState!.bars[2].ts_event).toBe(300);
      toggle.destroy();
    });

    it('should correlate bar data with footprint data via ts_event through onViewSwitch', () => {
      let capturedState: ChartStoreState | null = null;

      const toggle = new ViewToggleButton(container, {
        onViewSwitch: (viewType: ViewType) => {
          capturedState = store.getState();
        },
      });

      const button = container.querySelector('button') as HTMLButtonElement;
      button.click();

      expect(capturedState).not.toBeNull();
      for (const bar of capturedState!.bars) {
        expect(capturedState!.footprints.has(bar.ts_event)).toBe(true);
      }
      toggle.destroy();
    });

    it('should cycle view type correctly when wired through ChartStore state', () => {
      let capturedView: ViewType = 'overview';

      const toggle = new ViewToggleButton(container, {
        onViewSwitch: (viewType: ViewType) => {
          capturedView = viewType;
          toggle.setViewType(viewType);
        },
      });

      const button = container.querySelector('button') as HTMLButtonElement;

      button.click();
      expect(capturedView).toBe('footprint');
      expect(button.textContent).toBe('Footprint');

      button.click();
      expect(capturedView).toBe('overview');
      expect(button.textContent).toBe('Overview');

      toggle.destroy();
    });
  });

  describe('Envelope dispatch → ChartStore ingestion pipeline (Priority 2)', () => {
    it('should ingest bar from envelope payload', () => {
      const store = new ChartStore();
      const bar = makeBar(100);
      const envelope = makeBarEnvelope(bar);

      store.ingestBar(envelope.payload as BarPayload);
      expect(store.getBarCount()).toBe(1);
      expect(store.getState().bars[0].ts_event).toBe(100);
    });

    it('should ingest cvd from envelope payload', () => {
      const store = new ChartStore();
      const cvd = makeCvd(100, 500, 10);
      const envelope = makeCvdEnvelope(cvd);

      store.ingestCvd(envelope.payload as CvdPayload);
      expect(store.getState().cvd.get(100)?.cvd).toBe(500);
    });

    it('should ingest footprint from envelope payload', () => {
      const store = new ChartStore();
      const fp = makeFootprint(100);
      const envelope = makeFootprintEnvelope(fp);

      store.ingestFootprint(envelope.payload as FootprintPayload);
      expect(store.getState().footprints.has(100)).toBe(true);
    });

    it('should handle mixed envelope ingestion preserving ts_event correlation', () => {
      const store = new ChartStore();

      store.ingestBar(makeBarEnvelope(makeBar(100)).payload as BarPayload);
      store.ingestCvd(makeCvdEnvelope(makeCvd(100, 500, 10)).payload as CvdPayload);
      store.ingestFootprint(makeFootprintEnvelope(makeFootprint(100)).payload as FootprintPayload);

      store.ingestBar(makeBarEnvelope(makeBar(200)).payload as BarPayload);
      store.ingestCvd(makeCvdEnvelope(makeCvd(200, 510, 10)).payload as CvdPayload);

      const state = store.getState();
      expect(state.bars).toHaveLength(2);
      expect(state.cvd.size).toBe(2);
      expect(state.footprints.size).toBe(1);
    });

    it('should evict footprint data from envelope when bar is evicted', () => {
      const store = new ChartStore();

      for (let i = 0; i < MAX_BARS; i++) {
        store.ingestBar(makeBarEnvelope(makeBar(i)).payload as BarPayload);
        store.ingestFootprint(makeFootprintEnvelope(makeFootprint(i)).payload as FootprintPayload);
      }

      expect(store.getState().footprints.has(0)).toBe(true);

      store.ingestBar(makeBarEnvelope(makeBar(MAX_BARS)).payload as BarPayload);
      expect(store.getState().footprints.has(0)).toBe(false);
    });
  });

  describe('ChartStore getState() snapshot isolation (Priority 1 - conflict area behavior)', () => {
    it('should not allow bar array mutation to corrupt internal store', () => {
      const store = new ChartStore();
      store.ingestBar(makeBar(100));
      store.ingestBar(makeBar(200));

      const state = store.getState();
      state.bars.push(makeBar(999));

      expect(store.getState().bars).toHaveLength(2);
    });

    it('should not allow Map mutation to corrupt internal CVD store', () => {
      const store = new ChartStore();
      store.ingestCvd(makeCvd(100, 500, 10));

      const state = store.getState();
      state.cvd.set(200, makeCvd(200, 600, 20));

      expect(store.getState().cvd.size).toBe(1);
      expect(store.getState().cvd.has(200)).toBe(false);
    });

    it('should not allow Map mutation to corrupt internal footprint store', () => {
      const store = new ChartStore();
      store.ingestFootprint(makeFootprint(100));

      const state = store.getState();
      state.footprints.set(200, makeFootprint(200));

      expect(store.getState().footprints.size).toBe(1);
      expect(store.getState().footprints.has(200)).toBe(false);
    });

    it('SHOULD_FIX: bar object mutation in returned array should not corrupt internal store', () => {
      const store = new ChartStore();
      store.ingestBar(makeBar(100, 100));

      const state = store.getState();
      state.bars[0].open = 999;

      const barsAfter = store.getState().bars;
      expect(barsAfter[0].open).not.toBe(999);
    });
  });

  describe('End-to-end: Envelope routing through ChartStore to ViewToggleButton', () => {
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

    it('should simulate full message dispatch pipeline', () => {
      const store = new ChartStore();
      let currentState: ChartStoreState | null = null;

      function handleEnvelope(envelope: Envelope): void {
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
      }

      const toggle = new ViewToggleButton(container, {
        onViewSwitch: (viewType: ViewType) => {
          currentState = store.getState();
        },
      });

      handleEnvelope(makeBarEnvelope(makeBar(100)));
      handleEnvelope(makeCvdEnvelope(makeCvd(100, 500, 10)));
      handleEnvelope(makeFootprintEnvelope(makeFootprint(100)));
      handleEnvelope(makeBarEnvelope(makeBar(200)));
      handleEnvelope(makeCvdEnvelope(makeCvd(200, 510, 10)));

      const button = container.querySelector('button') as HTMLButtonElement;
      button.click();

      expect(currentState).not.toBeNull();
      expect(currentState!.bars).toHaveLength(2);
      expect(currentState!.cvd.size).toBe(2);
      expect(currentState!.footprints.size).toBe(1);
      expect(currentState!.bars[0].ts_event).toBe(100);
      expect(currentState!.bars[1].ts_event).toBe(200);

      toggle.destroy();
    });

    it('should handle out-of-order footprint ingestion (no matching bar)', () => {
      const store = new ChartStore();

      const orphanFootprint = makeFootprint(999);
      store.ingestFootprint(orphanFootprint);

      const state = store.getState();
      expect(state.footprints.has(999)).toBe(true);
      expect(state.bars).toHaveLength(0);
    });
  });
});