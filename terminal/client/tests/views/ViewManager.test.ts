import { describe, it, expect, vi } from 'vitest';
import { ViewManager } from '../../src/views/ViewManager';
import { ViewType } from '../../src/views/ChartView';
import type { ChartView } from '../../src/views/ChartView';
import type { ChartStore } from '../../src/store/ChartStore';
import type { ChartStoreState, FootprintPayload } from '../../src/types';

function createMockView(type: ViewType): ChartView {
  return {
    mount: vi.fn(),
    seed: vi.fn(),
    updateBar: vi.fn(),
    updateCvd: vi.fn(),
    updateFootprint: vi.fn(),
    destroy: vi.fn(),
    getType: vi.fn(() => type),
    getViewportState: vi.fn(() => ({ anchorTsEvent: null, followLatest: true })),
    restoreViewportState: vi.fn(),
  };
}

function createMockChartStore(state?: Partial<ChartStoreState>): ChartStore {
  const defaultState: ChartStoreState = {
    bars: [],
    cvd: new Map(),
    footprints: new Map(),
  };
  return {
    getState: vi.fn(() => ({ ...defaultState, ...state })),
    getBarCount: vi.fn(() => 0),
    ingestBar: vi.fn(),
    ingestCvd: vi.fn(),
    ingestFootprint: vi.fn(),
  } as unknown as ChartStore;
}

describe('ViewManager', () => {
  describe('getCurrentViewType() (AC1)', () => {
    it('should return null when no view is mounted', () => {
      const store = createMockChartStore();
      const container = document.createElement('div');
      const vm = new ViewManager(store, container, createMockView);

      expect(vm.getCurrentViewType()).toBeNull();
    });

    it('should return the type of the currently mounted view', () => {
      const store = createMockChartStore();
      const container = document.createElement('div');
      const vm = new ViewManager(store, container, createMockView);

      vm.switchToView(ViewType.Overview);
      expect(vm.getCurrentViewType()).toBe(ViewType.Overview);

      vm.switchToView(ViewType.Footprint);
      expect(vm.getCurrentViewType()).toBe(ViewType.Footprint);
    });

    it('should enforce exactly one mounted view at a time', () => {
      const store = createMockChartStore();
      const container = document.createElement('div');
      const vm = new ViewManager(store, container, createMockView);

      vm.switchToView(ViewType.Overview);
      expect(vm.getCurrentViewType()).toBe(ViewType.Overview);

      vm.switchToView(ViewType.Footprint);
      expect(vm.getCurrentViewType()).toBe(ViewType.Footprint);
      // Only Footprint should be active now
    });

    it('should return null after destroy', () => {
      const store = createMockChartStore();
      const container = document.createElement('div');
      const vm = new ViewManager(store, container, createMockView);

      vm.switchToView(ViewType.Overview);
      vm.destroy();
      expect(vm.getCurrentViewType()).toBeNull();
    });
  });

  describe('switchToView() (AC2)', () => {
    it('should destroy the current view when switching to a different type', () => {
      const store = createMockChartStore();
      const container = document.createElement('div');
      const vm = new ViewManager(store, container, createMockView);

      vm.switchToView(ViewType.Overview);
      const destroySpy = vi.fn();
      const mockView: ChartView = {
        mount: vi.fn(),
        seed: vi.fn(),
        updateBar: vi.fn(),
        updateCvd: vi.fn(),
        updateFootprint: vi.fn(),
        destroy: destroySpy,
        getType: vi.fn(() => ViewType.Footprint),
        getViewportState: vi.fn(() => ({ anchorTsEvent: null, followLatest: true })),
        restoreViewportState: vi.fn(),
      };
      (vm as unknown as { currentView: ChartView | null }).currentView = mockView;

      vm.switchToView(ViewType.Overview);
      expect(destroySpy).toHaveBeenCalledTimes(1);
    });

    it('should create and mount a new view when switching', () => {
      const store = createMockChartStore();
      const container = document.createElement('div');
      const viewFactory = vi.fn((type: ViewType) => createMockView(type));
      const vm = new ViewManager(store, container, viewFactory);

      vm.switchToView(ViewType.Overview);
      expect(viewFactory).toHaveBeenCalledWith(ViewType.Overview);
    });

    it('should seed the new view with data from ChartStore', () => {
      const state: ChartStoreState = {
        bars: [{ ts_event: 100, open: 100, high: 101, low: 99, close: 100.5, volume: 1000 }],
        cvd: new Map([[100, { ts_event: 100, cvd: 500, delta: 10 }]]),
        footprints: new Map(),
      };
      const store = createMockChartStore(state);
      const container = document.createElement('div');
      const vm = new ViewManager(store, container, createMockView);

      vm.switchToView(ViewType.Footprint);
      expect(store.getState).toHaveBeenCalled();
    });

    it('should not switch if the view type is already active', () => {
      const store = createMockChartStore();
      const container = document.createElement('div');
      const viewFactory = vi.fn((type: ViewType) => createMockView(type));
      const vm = new ViewManager(store, container, viewFactory);

      vm.switchToView(ViewType.Overview);
      expect(viewFactory).toHaveBeenCalledTimes(1);

      vm.switchToView(ViewType.Overview);
      expect(viewFactory).toHaveBeenCalledTimes(1);
    });

    it('should work when no view is currently mounted (initial switch)', () => {
      const store = createMockChartStore();
      const container = document.createElement('div');
      const vm = new ViewManager(store, container, createMockView);

      expect(() => vm.switchToView(ViewType.Overview)).not.toThrow();
      expect(vm.getCurrentViewType()).toBe(ViewType.Overview);
    });
  });

  describe('view switching preserves no state (AC4)', () => {
    it('should call seed with fresh ChartStore state each switch', () => {
      const store = createMockChartStore();
      const container = document.createElement('div');
      const vm = new ViewManager(store, container, createMockView);

      vm.switchToView(ViewType.Overview);

      const seedCalls = (vm as unknown as { currentView: ChartView }).currentView!.seed as ReturnType<typeof vi.fn>;
      expect(seedCalls).toHaveBeenCalledTimes(1);

      vm.switchToView(ViewType.Footprint);
      const newSeedCalls = (vm as unknown as { currentView: ChartView }).currentView!.seed as ReturnType<typeof vi.fn>;
      expect(newSeedCalls).toHaveBeenCalledTimes(1);
    });
  });

  describe('updateBar() (AC3)', () => {
    it('should route bar data to the currently mounted view', () => {
      const store = createMockChartStore();
      const container = document.createElement('div');
      const vm = new ViewManager(store, container, createMockView);

      vm.switchToView(ViewType.Overview);
      const barData = { ts_event: 200, open: 101, high: 102, low: 100, close: 101.5, volume: 500 };
      vm.updateBar(barData);
      const view = (vm as unknown as { currentView: ChartView }).currentView!;
      expect(view.updateBar).toHaveBeenCalledWith(barData);
    });

    it('should not throw when no view is mounted', () => {
      const store = createMockChartStore();
      const container = document.createElement('div');
      const vm = new ViewManager(store, container, createMockView);

      expect(() => vm.updateBar({})).not.toThrow();
    });
  });

  describe('updateCvd() (AC3)', () => {
    it('should route CVD data to the currently mounted view', () => {
      const store = createMockChartStore();
      const container = document.createElement('div');
      const vm = new ViewManager(store, container, createMockView);

      vm.switchToView(ViewType.Footprint);
      const cvdData = { ts_event: 200, cvd: 600, delta: 20 };
      vm.updateCvd(cvdData);
      const view = (vm as unknown as { currentView: ChartView }).currentView!;
      expect(view.updateCvd).toHaveBeenCalledWith(cvdData);
    });

    it('should not throw when no view is mounted', () => {
      const store = createMockChartStore();
      const container = document.createElement('div');
      const vm = new ViewManager(store, container, createMockView);

      expect(() => vm.updateCvd({})).not.toThrow();
    });
  });

  describe('updateFootprint() (AC3)', () => {
    it('should route footprint data to the currently mounted view', () => {
      const store = createMockChartStore();
      const container = document.createElement('div');
      const vm = new ViewManager(store, container, createMockView);

      vm.switchToView(ViewType.Overview);
      const footprintData: FootprintPayload = { ts_event: 200, bin_size: 60000, levels: [] };
      vm.updateFootprint(footprintData);
      const view = (vm as unknown as { currentView: ChartView }).currentView!;
      expect(view.updateFootprint).toHaveBeenCalledWith(footprintData);
    });

    it('should not throw when no view is mounted', () => {
      const store = createMockChartStore();
      const container = document.createElement('div');
      const vm = new ViewManager(store, container, createMockView);

      expect(() => vm.updateFootprint({ ts_event: 0, bin_size: 0, levels: [] })).not.toThrow();
    });
  });

  describe('destroy() (AC5)', () => {
    it('should destroy the current view', () => {
      const store = createMockChartStore();
      const container = document.createElement('div');
      const vm = new ViewManager(store, container, createMockView);

      vm.switchToView(ViewType.Overview);
      const view = (vm as unknown as { currentView: ChartView }).currentView!;
      vm.destroy();
      expect(view.destroy).toHaveBeenCalledTimes(1);
    });

    it('should clear the current view reference', () => {
      const store = createMockChartStore();
      const container = document.createElement('div');
      const vm = new ViewManager(store, container, createMockView);

      vm.switchToView(ViewType.Overview);
      vm.destroy();
      expect(vm.getCurrentViewType()).toBeNull();
    });

    it('should not throw when called with no mounted view', () => {
      const store = createMockChartStore();
      const container = document.createElement('div');
      const vm = new ViewManager(store, container, createMockView);

      expect(() => vm.destroy()).not.toThrow();
    });

    it('should release resources by nullifying the view reference', () => {
      const store = createMockChartStore();
      const container = document.createElement('div');
      const vm = new ViewManager(store, container, createMockView);

      vm.switchToView(ViewType.Footprint);
      vm.destroy();
      // After destroy, updateBar should be a no-op (no view to route to)
      const viewDestroyed = (vm as unknown as { currentView: ChartView | null }).currentView;
      expect(viewDestroyed).toBeNull();
    });
  });
});