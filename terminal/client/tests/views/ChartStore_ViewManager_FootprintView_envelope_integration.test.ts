import { describe, it, expect, vi } from 'vitest';
import { ChartStore, MAX_BARS } from '../../src/store/ChartStore.js';
import { ViewManager } from '../../src/views/ViewManager';
import { ViewType, type ChartView } from '../../src/views/ChartView';
import { FootprintViewState, DEFAULT_VISIBLE_BARS } from '../../src/views/FootprintViewState';
import type { BarPayload, CvdPayload, FootprintPayload, ChartStoreState } from '../../src/types';

function makeBar(ts_event: number, open = 100): BarPayload {
  return { ts_event, open, high: open + 1, low: open - 1, close: open + 0.5, volume: 1000 };
}

function makeCvd(ts_event: number, cvd = 0, delta = 0): CvdPayload {
  return { ts_event, cvd, delta };
}

function makeFootprint(ts_event: number): FootprintPayload {
  return { ts_event, bin_size: 60000, levels: [{ price: 100, buy: 50, sell: 30 }] };
}

interface FootprintViewWithState extends ChartView {
  viewState: FootprintViewState;
}

function createFootprintView(totalBars: number, barCountRef?: { current: number }): FootprintViewWithState {
  const viewState = new FootprintViewState(totalBars);
  return {
    viewState,
    mount: vi.fn(),
    seed: vi.fn((state: ChartStoreState) => {
      viewState.setTotalBars(state.bars.length);
      viewState.goToLatest();
      if (barCountRef) barCountRef.current = state.bars.length;
    }),
    updateBar: vi.fn(() => {
      if (barCountRef) {
        barCountRef.current++;
        viewState.setTotalBars(barCountRef.current);
      }
    }),
    updateCvd: vi.fn(),
    updateFootprint: vi.fn(),
    destroy: vi.fn(),
    getType: vi.fn(() => ViewType.Footprint),
  };
}

function createOverviewView(): ChartView {
  return {
    mount: vi.fn(),
    seed: vi.fn(),
    updateBar: vi.fn(),
    updateCvd: vi.fn(),
    updateFootprint: vi.fn(),
    destroy: vi.fn(),
    getType: vi.fn(() => ViewType.Overview),
  };
}

describe('ViewManager + ChartStore + FootprintView + Envelope Pipeline (Priority 1: Full cross-feature integration)', () => {
  describe('End-to-end: Envelope → ChartStore → ViewManager switchToView → FootprintViewState seed (Priority 1)', () => {
    it('should flow envelope data through ChartStore into ViewManager and seed FootprintViewState with correct bar count', () => {
      const store = new ChartStore();
      const container = document.createElement('div');
      let createdView: FootprintViewWithState | null = null;

      const vm = new ViewManager(store, container, (type: ViewType) => {
        if (type === ViewType.Footprint) {
          const fpView = createFootprintView(0);
          createdView = fpView;
          return fpView;
        }
        return createOverviewView();
      });

      for (let i = 0; i < 30; i++) {
        store.ingestBar(makeBar(i * 1000));
        store.ingestCvd(makeCvd(i * 1000, i * 100, i * 10));
        store.ingestFootprint(makeFootprint(i * 1000));
      }

      vm.switchToView(ViewType.Footprint);

      expect(createdView).not.toBeNull();
      expect(createdView!.seed).toHaveBeenCalled();
      expect(createdView!.viewState.getVisibleBarRange().count).toBe(DEFAULT_VISIBLE_BARS);
    });

    it('should preserve ts_event correlation between bars and footprints after full pipeline', () => {
      const store = new ChartStore();
      const container = document.createElement('div');
      let createdView: FootprintViewWithState | null = null;

      const vm = new ViewManager(store, container, (type: ViewType) => {
        if (type === ViewType.Footprint) {
          const fpView = createFootprintView(0);
          createdView = fpView;
          return fpView;
        }
        return createOverviewView();
      });

      for (let i = 0; i < 10; i++) {
        store.ingestBar(makeBar(i * 1000));
        store.ingestFootprint(makeFootprint(i * 1000));
      }

      vm.switchToView(ViewType.Footprint);

      const seedArg = vi.mocked(createdView!.seed).mock.calls[0][0];
      for (let i = 0; i < 10; i++) {
        const bar = seedArg.bars.find((b: BarPayload) => b.ts_event === i * 1000);
        expect(bar).toBeDefined();
        expect(seedArg.footprints.has(i * 1000)).toBe(true);
      }
    });

    it('should maintain FootprintViewState at latest after envelope ingestion during follow mode', () => {
      const store = new ChartStore();
      const container = document.createElement('div');
      let createdView: FootprintViewWithState | null = null;
      const barCountRef = { current: 0 };

      const vm = new ViewManager(store, container, (type: ViewType) => {
        if (type === ViewType.Footprint) {
          const fpView = createFootprintView(0, barCountRef);
          createdView = fpView;
          return fpView;
        }
        return createOverviewView();
      });

      for (let i = 0; i < 50; i++) {
        store.ingestBar(makeBar(i * 1000));
      }
      barCountRef.current = 50;

      vm.switchToView(ViewType.Footprint);
      expect(createdView!.viewState.isAtLatest()).toBe(true);

      store.ingestBar(makeBar(50000));
      barCountRef.current = 51;
      vm.updateBar(makeBar(50000));

      expect(createdView!.viewState.isAtLatest()).toBe(true);
    });
  });

  describe('ViewManager + ChartStore circular buffer overflow (Priority 2)', () => {
    it('should seed FootprintViewState correctly after circular buffer wraparound', () => {
      const store = new ChartStore();
      const container = document.createElement('div');
      let createdView: FootprintViewWithState | null = null;

      const vm = new ViewManager(store, container, (type: ViewType) => {
        if (type === ViewType.Footprint) {
          const fpView = createFootprintView(0);
          createdView = fpView;
          return fpView;
        }
        return createOverviewView();
      });

      for (let i = 0; i < MAX_BARS + 50; i++) {
        store.ingestBar(makeBar(i));
        store.ingestFootprint(makeFootprint(i));
      }

      vm.switchToView(ViewType.Footprint);

      const seedState = vi.mocked(createdView!.seed).mock.calls[0][0];
      expect(seedState.bars).toHaveLength(MAX_BARS);
      expect(seedState.bars[0].ts_event).toBe(50);
      expect(seedState.bars[MAX_BARS - 1].ts_event).toBe(MAX_BARS + 49);
      expect(seedState.footprints.size).toBe(MAX_BARS);
      expect(seedState.footprints.has(0)).toBe(false);
      expect(seedState.footprints.has(50)).toBe(true);
    });
  });

  describe('ViewManager routes updateFootprint preserves data for FootprintView (Priority 2)', () => {
    it('should forward footprint data immediately after view switch', () => {
      const store = new ChartStore();
      const container = document.createElement('div');
      let createdView: FootprintViewWithState | null = null;

      const vm = new ViewManager(store, container, (type: ViewType) => {
        if (type === ViewType.Footprint) {
          const fpView = createFootprintView(0);
          createdView = fpView;
          return fpView;
        }
        return createOverviewView();
      });

      store.ingestBar(makeBar(100));

      vm.switchToView(ViewType.Footprint);

      const fp = makeFootprint(100);
      vm.updateFootprint(fp);

      expect(createdView!.updateFootprint).toHaveBeenCalledWith(fp);
    });

    it('should forward CVD data to FootprintView after switch', () => {
      const store = new ChartStore();
      const container = document.createElement('div');
      let createdView: FootprintViewWithState | null = null;

      const vm = new ViewManager(store, container, (type: ViewType) => {
        if (type === ViewType.Footprint) {
          const fpView = createFootprintView(0);
          createdView = fpView;
          return fpView;
        }
        return createOverviewView();
      });

      store.ingestBar(makeBar(100));

      vm.switchToView(ViewType.Footprint);

      const cvd = makeCvd(100, 500, 10);
      vm.updateCvd(cvd);

      expect(createdView!.updateCvd).toHaveBeenCalledWith(cvd);
    });
  });

  describe('FootprintViewState pan bounds with ViewManager data flow (Priority 2)', () => {
    it('should clamp pan when new bars arrive increasing total', () => {
      const store = new ChartStore();
      const container = document.createElement('div');
      let createdView: FootprintViewWithState | null = null;
      const barCountRef = { current: 0 };

      const vm = new ViewManager(store, container, (type: ViewType) => {
        if (type === ViewType.Footprint) {
          const fpView = createFootprintView(0, barCountRef);
          createdView = fpView;
          return fpView;
        }
        return createOverviewView();
      });

      for (let i = 0; i < 200; i++) {
        store.ingestBar(makeBar(i * 1000));
      }
      barCountRef.current = 200;

      vm.switchToView(ViewType.Footprint);

      createdView!.viewState.pan(-40);
      expect(createdView!.viewState.isAtLatest()).toBe(false);

      for (let i = 200; i < 300; i++) {
        store.ingestBar(makeBar(i * 1000));
        barCountRef.current++;
        vm.updateBar(makeBar(i * 1000));
      }

      const range = createdView!.viewState.getVisibleBarRange();
      expect(range.startIndex).toBeGreaterThanOrEqual(0);
      expect(range.count).toBe(DEFAULT_VISIBLE_BARS);
    });

    it('should not throw when panning with rapidly changing total bars', () => {
      const store = new ChartStore();
      const container = document.createElement('div');
      let createdView: FootprintViewWithState | null = null;

      const vm = new ViewManager(store, container, (type: ViewType) => {
        if (type === ViewType.Footprint) {
          const fpView = createFootprintView(0);
          createdView = fpView;
          return fpView;
        }
        return createOverviewView();
      });

      for (let i = 0; i < 50; i++) {
        store.ingestBar(makeBar(i * 1000));
      }

      vm.switchToView(ViewType.Footprint);

      expect(() => {
        for (let i = 0; i < 20; i++) {
          createdView!.viewState.pan(-5);
          store.ingestBar(makeBar((50 + i) * 1000));
          vm.updateBar(makeBar((50 + i) * 1000));
        }
      }).not.toThrow();
    });
  });

  describe('ViewManager full lifecycle with data eviction from circular buffer (Priority 3)', () => {
    it('should handle switchToView after bar eviction clears old footprints', () => {
      const store = new ChartStore();
      const container = document.createElement('div');
      let createdView: FootprintViewWithState | null = null;

      const vm = new ViewManager(store, container, (type: ViewType) => {
        if (type === ViewType.Footprint) {
          const fpView = createFootprintView(0);
          createdView = fpView;
          return fpView;
        }
        return createOverviewView();
      });

      for (let i = 0; i < MAX_BARS + 10; i++) {
        store.ingestBar(makeBar(i));
        store.ingestFootprint(makeFootprint(i));
      }

      vm.switchToView(ViewType.Footprint);

      const seedState = vi.mocked(createdView!.seed).mock.calls[0][0];
      expect(seedState.footprints.has(0)).toBe(false);
      expect(seedState.footprints.has(10)).toBe(true);
      expect(seedState.footprints.has(MAX_BARS + 9)).toBe(true);
    });

    it('should preserve isolate state after switching back to previously active view type', () => {
      const store = new ChartStore();
      const container = document.createElement('div');
      let fpView: FootprintViewWithState | null = null;
      let ovView: ChartView | null = null;

      const vm = new ViewManager(store, container, (type: ViewType) => {
        if (type === ViewType.Footprint) {
          fpView = createFootprintView(0);
          return fpView;
        }
        ovView = createOverviewView();
        return ovView;
      });

      store.ingestBar(makeBar(100));
      store.ingestFootprint(makeFootprint(100));

      vm.switchToView(ViewType.Footprint);
      const fpSeedState = vi.mocked(fpView!.seed).mock.calls[0][0];
      expect(fpSeedState.bars).toHaveLength(1);

      store.ingestBar(makeBar(200));
      store.ingestFootprint(makeFootprint(200));

      vm.switchToView(ViewType.Overview);
      const ovSeedState = vi.mocked(ovView!.seed).mock.calls[0][0];
      expect(ovSeedState.bars).toHaveLength(2);

      store.ingestBar(makeBar(300));

      vm.switchToView(ViewType.Footprint);
      const fpSeedState2 = vi.mocked(fpView!.seed).mock.calls[0][0];
      expect(fpSeedState2.bars).toHaveLength(3);
    });
  });

  describe('ViewManager data routing to multiple view types (Priority 3)', () => {
    it('should route bar data to Overview view when active, then Footprint view after switch', () => {
      const store = new ChartStore();
      const container = document.createElement('div');
      const createdViews: ChartView[] = [];

      const vm = new ViewManager(store, container, (type: ViewType) => {
        const view = type === ViewType.Footprint ? createFootprintView(0) : createOverviewView();
        createdViews.push(view);
        return view;
      });

      vm.switchToView(ViewType.Overview);
      vm.updateBar(makeBar(100));
      const ovView = createdViews[0];

      vm.switchToView(ViewType.Footprint);
      vm.updateBar(makeBar(200));
      const fpView = createdViews[1];

      vm.switchToView(ViewType.Overview);
      vm.updateBar(makeBar(300));
      const ovView2 = createdViews[2];

      expect(ovView.updateBar).toHaveBeenCalledTimes(1);
      expect(fpView.updateBar).toHaveBeenCalledTimes(1);
      expect(ovView2.updateBar).toHaveBeenCalledTimes(1);
    });

    it('should not route data to destroyed views after switch', () => {
      const store = new ChartStore();
      const container = document.createElement('div');
      let fpDestroyed = false;
      const fpView = createFootprintView(0);
      fpView.destroy = vi.fn(() => { fpDestroyed = true; });

      const vm = new ViewManager(store, container, (type: ViewType) => {
        if (type === ViewType.Footprint) return fpView;
        return createOverviewView();
      });

      vm.switchToView(ViewType.Footprint);
      vm.switchToView(ViewType.Overview);

      expect(fpDestroyed).toBe(true);
      vm.updateBar(makeBar(999));
      expect(fpView.updateBar).not.toHaveBeenCalled();
    });
  });
});
