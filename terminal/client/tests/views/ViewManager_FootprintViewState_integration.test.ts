import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ViewManager } from '../../src/views/ViewManager';
import { FootprintViewState, MIN_VISIBLE_BARS, DEFAULT_VISIBLE_BARS } from '../../src/views/FootprintViewState';
import { ViewType, type ChartView } from '../../src/views/ChartView';
import type { ChartStore } from '../../src/store/ChartStore';
import type { ChartStoreState, BarPayload, FootprintPayload } from '../../src/types';

function createMockChartStore(barsCount: number = 0): ChartStore {
  const bars: BarPayload[] = [];
  for (let i = 0; i < barsCount; i++) {
    bars.push({ ts_event: i * 1000, open: 100 + i, high: 101 + i, low: 99 + i, close: 100.5 + i, volume: 1000 });
  }
  const footprints = new Map<number, FootprintPayload>();
  for (let i = 0; i < barsCount; i++) {
    footprints.set(i * 1000, { ts_event: i * 1000, bin_size: 60000, levels: [{ price: 100 + i, buy: 50, sell: 30 }] });
  }
  const state: ChartStoreState = { bars, cvd: new Map(), footprints };
  return {
    getState: vi.fn(() => ({ bars: [...bars], cvd: new Map(state.cvd), footprints: new Map(footprints) })),
    getBarCount: vi.fn(() => barsCount),
    ingestBar: vi.fn(),
    ingestCvd: vi.fn(),
    ingestFootprint: vi.fn(),
  } as unknown as ChartStore;
}

interface FootprintViewWithState extends ChartView {
  viewState: FootprintViewState;
}

function createFootprintView(totalBars: number): FootprintViewWithState {
  const viewState = new FootprintViewState(totalBars);
  return {
    viewState,
    mount: vi.fn(),
    seed: vi.fn((state: ChartStoreState) => {
      viewState.setTotalBars(state.bars.length);
      viewState.goToLatest();
    }),
    updateBar: vi.fn((_data: unknown) => {
      viewState.setTotalBars(viewState.getVisibleBarRange().startIndex + viewState.getVisibleBarRange().count + 1);
    }),
    updateCvd: vi.fn(),
    updateFootprint: vi.fn(),
    destroy: vi.fn(() => {}),
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

describe('ViewManager + FootprintViewState Integration (Priority 1: Cross-feature interaction)', () => {
  describe('FootprintViewState initialization from ViewManager seed (Priority 1)', () => {
    it('should initialize FootprintViewState with bar count from ChartStore seed', () => {
      const store = createMockChartStore(50);
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

      vm.switchToView(ViewType.Footprint);

      expect(createdView).not.toBeNull();
      expect(createdView!.seed).toHaveBeenCalled();
      expect(createdView!.viewState.getVisibleBarRange().startIndex).toBeGreaterThanOrEqual(0);
      expect(createdView!.viewState.getVisibleBarRange().count).toBe(DEFAULT_VISIBLE_BARS);
    });

    it('should set FootprintViewState totalBars from seed data', () => {
      const store = createMockChartStore(150);
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

      vm.switchToView(ViewType.Footprint);

      const range = createdView!.viewState.getVisibleBarRange();
      expect(range.count).toBe(DEFAULT_VISIBLE_BARS);
      expect(createdView!.viewState.isAtLatest()).toBe(true);
    });

    it('should handle zero bars seed gracefully in FootprintViewState', () => {
      const store = createMockChartStore(0);
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

      vm.switchToView(ViewType.Footprint);

      expect(() => createdView!.viewState.getVisibleBarRange()).not.toThrow();
      expect(createdView!.viewState.getVisibleBarRange().startIndex).toBe(0);
      expect(createdView!.viewState.isAtLatest()).toBe(true);
    });
  });

  describe('ViewManager updateBar propagates to FootprintViewState (Priority 2)', () => {
    it('should update FootprintViewState totalBars when ViewManager routes new bars', () => {
      const store = createMockChartStore(30);
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

      vm.switchToView(ViewType.Footprint);
      const initialRange = createdView!.viewState.getVisibleBarRange();

      vm.updateBar({ ts_event: 999, open: 100, high: 101, low: 99, close: 100.5, volume: 1000 });

      expect(createdView!.updateBar).toHaveBeenCalledTimes(1);
    });

    it('should not throw when updating bars with no view mounted', () => {
      const store = createMockChartStore(10);
      const container = document.createElement('div');
      const vm = new ViewManager(store, container, (type: ViewType) => type === ViewType.Footprint ? createFootprintView(0) : createOverviewView());

      expect(() => vm.updateBar({ ts_event: 1, open: 100, high: 101, low: 99, close: 100.5, volume: 1000 })).not.toThrow();
    });
  });

  describe('ViewManager updateFootprint routes to FootprintViewState view (Priority 2)', () => {
    it('should forward footprint data to view when FootprintView is active', () => {
      const store = createMockChartStore(30);
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

      vm.switchToView(ViewType.Footprint);
      const fp: FootprintPayload = { ts_event: 100, bin_size: 60000, levels: [{ price: 100, buy: 50, sell: 30 }] };
      vm.updateFootprint(fp);

      expect(createdView!.updateFootprint).toHaveBeenCalledWith(fp);
    });

    it('should not throw when updating footprint with no view mounted', () => {
      const store = createMockChartStore(10);
      const container = document.createElement('div');
      const vm = new ViewManager(store, container, (type: ViewType) => type === ViewType.Footprint ? createFootprintView(0) : createOverviewView());
      const fp: FootprintPayload = { ts_event: 100, bin_size: 60000, levels: [] };

      expect(() => vm.updateFootprint(fp)).not.toThrow();
    });
  });

  describe('View switching destroys old FootprintViewState and creates fresh (Priority 2)', () => {
    it('should destroy previous view when switching from Footprint to Overview', () => {
      const store = createMockChartStore(50);
      const container = document.createElement('div');
      let destroyCount = 0;
      const vm = new ViewManager(store, container, (type: ViewType) => {
        if (type === ViewType.Footprint) {
          const fpView = createFootprintView(0);
          fpView.destroy = vi.fn(() => { destroyCount++; });
          return fpView;
        }
        return createOverviewView();
      });

      vm.switchToView(ViewType.Footprint);
      vm.switchToView(ViewType.Overview);

      expect(destroyCount).toBe(1);
    });

    it('should create fresh FootprintViewState when switching back to Footprint', () => {
      const store = createMockChartStore(50);
      const container = document.createElement('div');
      let fpCreateCount = 0;
      const vm = new ViewManager(store, container, (type: ViewType) => {
        if (type === ViewType.Footprint) {
          fpCreateCount++;
          return createFootprintView(0);
        }
        return createOverviewView();
      });

      vm.switchToView(ViewType.Footprint);
      vm.switchToView(ViewType.Overview);
      vm.switchToView(ViewType.Footprint);

      expect(fpCreateCount).toBe(2);
    });

    it('should seed fresh FootprintViewState with latest ChartStore data on switch back', () => {
      const store = createMockChartStore(50);
      const container = document.createElement('div');
      let fpView: FootprintViewWithState | null = null;
      const vm = new ViewManager(store, container, (type: ViewType) => {
        if (type === ViewType.Footprint) {
          fpView = createFootprintView(0);
          return fpView;
        }
        return createOverviewView();
      });

      vm.switchToView(ViewType.Footprint);
      const firstSeedCall = fpView!.seed;
      vm.switchToView(ViewType.Overview);
      vm.switchToView(ViewType.Footprint);

      expect(fpView!.seed).toHaveBeenCalled();
    });
  });

  describe('ViewManager routes updateCvd correctly when Footprint view active (Priority 3)', () => {
    it('should forward CVD data to Footprint view', () => {
      const store = createMockChartStore(30);
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

      vm.switchToView(ViewType.Footprint);
      const cvdData = { ts_event: 100, cvd: 500, delta: 10 };
      vm.updateCvd(cvdData);

      expect(createdView!.updateCvd).toHaveBeenCalledWith(cvdData);
    });
  });

  describe('ViewManager destroy cleans up FootprintView (Priority 3)', () => {
    it('should destroy view and clear reference', () => {
      const store = createMockChartStore(30);
      const container = document.createElement('div');
      let destroyed = false;
      const vm = new ViewManager(store, container, (type: ViewType) => {
        if (type === ViewType.Footprint) {
          const fpView = createFootprintView(0);
          fpView.destroy = vi.fn(() => { destroyed = true; });
          return fpView;
        }
        return createOverviewView();
      });

      vm.switchToView(ViewType.Footprint);
      vm.destroy();

      expect(destroyed).toBe(true);
      expect(vm.getCurrentViewType()).toBeNull();
    });
  });

  describe('ViewManager prevents duplicate switch for same Footprint type (Priority 3)', () => {
    it('should not destroy/recreate when switching to already-active Footprint view', () => {
      const store = createMockChartStore(50);
      const container = document.createElement('div');
      let createCount = 0;
      const vm = new ViewManager(store, container, (type: ViewType) => {
        createCount++;
        if (type === ViewType.Footprint) return createFootprintView(0);
        return createOverviewView();
      });

      vm.switchToView(ViewType.Footprint);
      expect(createCount).toBe(1);

      vm.switchToView(ViewType.Footprint);
      expect(createCount).toBe(1);
    });
  });
});