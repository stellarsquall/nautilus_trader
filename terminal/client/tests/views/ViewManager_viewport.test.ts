import { describe, it, expect, vi } from 'vitest';
import { ViewManager } from '../../src/views/ViewManager';
import { ViewType } from '../../src/views/ChartView';
import type { ChartView, ViewportState } from '../../src/views/ChartView';
import type { ChartStore } from '../../src/store/ChartStore';
import type { ChartStoreState } from '../../src/types';

function createMockView(
  type: ViewType,
  viewportState?: ViewportState,
): ChartView {
  return {
    mount: vi.fn(),
    seed: vi.fn(),
    updateBar: vi.fn(),
    updateCvd: vi.fn(),
    updateFootprint: vi.fn(),
    destroy: vi.fn(),
    getType: vi.fn(() => type),
    getViewportState: vi.fn(() => viewportState ?? { anchorTsEvent: null, followLatest: true }),
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

describe('ViewManager linked', () => {
  it('should capture outgoing viewport state into sharedAnchor and restore incoming view', () => {
    const store = createMockChartStore();
    const container = document.createElement('div');

    const overviewState: ViewportState = { anchorTsEvent: 12345, followLatest: false };
    const overviewView = createMockView(ViewType.Overview, overviewState);
    let footprintView = createMockView(ViewType.Footprint);

    const viewFactory = vi.fn((type: ViewType): ChartView => {
      if (type === ViewType.Overview) return overviewView;
      return footprintView;
    });

    const vm = new ViewManager(store, container, viewFactory);
    expect(vm.linkViews).toBe(true);

    vm.switchToView(ViewType.Overview);
    vm.switchToView(ViewType.Footprint);

    expect(overviewView.getViewportState).toHaveBeenCalledTimes(1);
    expect(footprintView.restoreViewportState).toHaveBeenCalledWith(overviewState);
  });

  it('should use shared anchor for all subsequent view switches', () => {
    const store = createMockChartStore();
    const container = document.createElement('div');

    const overviewState: ViewportState = { anchorTsEvent: 555, followLatest: false };
    const footprintState: ViewportState = { anchorTsEvent: 999, followLatest: false };
    const overviewView = createMockView(ViewType.Overview, overviewState);
    const footprintView = createMockView(ViewType.Footprint, footprintState);

    const viewFactory = vi.fn((type: ViewType): ChartView => {
      if (type === ViewType.Overview) return overviewView;
      return footprintView;
    });

    const vm = new ViewManager(store, container, viewFactory);

    vm.switchToView(ViewType.Overview);
    vm.switchToView(ViewType.Footprint);

    expect(overviewView.getViewportState).toHaveBeenCalledTimes(1);
    expect(footprintView.restoreViewportState).toHaveBeenCalledWith(overviewState);

    vm.switchToView(ViewType.Overview);
    expect(footprintView.getViewportState).toHaveBeenCalledTimes(1);
    expect(overviewView.restoreViewportState).toHaveBeenCalledWith(footprintState);
  });
});

describe('ViewManager independent', () => {
  it('should restore incoming view from per-view saved state, not shared anchor', () => {
    const store = createMockChartStore();
    const container = document.createElement('div');

    const overviewState: ViewportState = { anchorTsEvent: 100, followLatest: false };
    const footprintState: ViewportState = { anchorTsEvent: 200, followLatest: false };

    const overviewView = createMockView(ViewType.Overview, overviewState);
    const footprintView = createMockView(ViewType.Footprint, footprintState);

    const viewFactory = vi.fn((type: ViewType): ChartView => {
      if (type === ViewType.Overview) return overviewView;
      return footprintView;
    });

    const vm = new ViewManager(store, container, viewFactory);
    vm.setLinkViews(false);
    expect(vm.isLinkViewsEnabled()).toBe(false);

    vm.switchToView(ViewType.Overview);
    vm.switchToView(ViewType.Footprint);

    expect(overviewView.getViewportState).toHaveBeenCalledTimes(1);
    expect(footprintView.restoreViewportState).not.toHaveBeenCalled();

    vm.switchToView(ViewType.Overview);
    expect(overviewView.restoreViewportState).toHaveBeenCalledWith(overviewState);
    expect(footprintView.getViewportState).toHaveBeenCalledTimes(1);
  });
});

describe('ViewManager first/default', () => {
  it('should leave the view at latest (no restore) on first invocation with no prior state', () => {
    const store = createMockChartStore();
    const container = document.createElement('div');

    const overviewView = createMockView(ViewType.Overview);
    const viewFactory = vi.fn(() => overviewView);

    const vm = new ViewManager(store, container, viewFactory);
    vm.switchToView(ViewType.Overview);

    expect(overviewView.restoreViewportState).not.toHaveBeenCalled();
  });
});

describe('ViewManager default', () => {
  it('should default linkViews to true', () => {
    const store = createMockChartStore();
    const container = document.createElement('div');
    const vm = new ViewManager(store, container, () => createMockView(ViewType.Overview));

    expect(vm.linkViews).toBe(true);
  });
});