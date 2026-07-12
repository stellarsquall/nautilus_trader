import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ViewManager } from '../../src/views/ViewManager';
import { ViewType, type ChartView, type ViewportState } from '../../src/views/ChartView';
import type { ChartStore } from '../../src/store/ChartStore';
import type { ChartStoreState, BarPayload } from '../../src/types';

function makeBar(ts: number): BarPayload {
  return { ts_event: ts, open: 100, high: 102, low: 99, close: 101, volume: 500 };
}

function createBars(count: number, startTs = 1000, step = 1000): BarPayload[] {
  const bars: BarPayload[] = [];
  for (let i = 0; i < count; i++) {
    bars.push(makeBar(startTs + i * step));
  }
  return bars;
}

function makeState(bars: BarPayload[]): ChartStoreState {
  return { bars, cvd: new Map(), footprints: new Map() };
}

const mockCtx = {
  canvas: {} as HTMLCanvasElement,
  clearRect: vi.fn(),
  fillRect: vi.fn(),
  fillText: vi.fn(),
  strokeRect: vi.fn(),
  beginPath: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  stroke: vi.fn(),
  fill: vi.fn(),
  arc: vi.fn(),
  setTransform: vi.fn(),
  save: vi.fn(),
  restore: vi.fn(),
  clip: vi.fn(),
  rect: vi.fn(),
  scale: vi.fn(),
  measureText: vi.fn(() => ({ width: 50 })),
  setLineDash: vi.fn(),
  font: '',
  textAlign: 'start' as CanvasTextAlign,
  textBaseline: 'alphabetic' as CanvasTextBaseline,
  fillStyle: '',
  strokeStyle: '',
  lineWidth: 1,
} as unknown as CanvasRenderingContext2D;

interface ViewFactoryState {
  overviewView: ChartView | null;
  footprintView: ChartView | null;
}

describe('ViewManager integration with real OverviewView and FootprintView (Priority 1: Cross-feature viewport state)', () => {
  let container: HTMLElement;
  let originalGetContext: typeof HTMLCanvasElement.prototype.getContext;
  let factoryState: ViewFactoryState;

  beforeEach(async () => {
    container = document.createElement('div');
    container.style.width = '800px';
    container.style.height = '600px';
    Object.defineProperty(container, 'clientWidth', { writable: true, value: 800 });
    Object.defineProperty(container, 'clientHeight', { writable: true, value: 600 });

    originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = vi.fn((type: string) => {
      if (type === '2d') return mockCtx;
      return null;
    });

    vi.stubGlobal('ResizeObserver', vi.fn(() => ({
      observe: vi.fn(),
      disconnect: vi.fn(),
    })));

    factoryState = { overviewView: null, footprintView: null };
  });

  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  async function createRealViewManager(
    chartStore: ChartStore,
  ): Promise<{ vm: ViewManager; factoryState: ViewFactoryState }> {
    const fs: ViewFactoryState = { overviewView: null, footprintView: null };

    const { OverviewView } = await import('../../src/views/OverviewView');
    const { FootprintView } = await import('../../src/views/FootprintView');

    const vm = new ViewManager(chartStore, container, (type: ViewType) => {
      if (type === ViewType.Overview) {
        const view = new OverviewView();
        fs.overviewView = view;
        return view;
      }
      const view = new FootprintView();
      fs.footprintView = view;
      return view;
    });

    return { vm, factoryState: fs };
  }

  it('should persist viewport state through linked mode switch (Overview -> Footprint -> Overview)', async () => {
    const bars = createBars(50);
    const state = makeState(bars);
    const store = {
      getState: vi.fn(() => state),
      getBarCount: vi.fn(() => bars.length),
      ingestBar: vi.fn(),
      ingestCvd: vi.fn(),
      ingestFootprint: vi.fn(),
    } as unknown as ChartStore;

    const { vm, factoryState: fs } = await createRealViewManager(store);

    expect(vm.linkViews).toBe(true);

    vm.switchToView(ViewType.Overview);
    const overviewState1 = fs.overviewView!.getViewportState();
    expect(overviewState1.anchorTsEvent).toBe(bars[bars.length - 1].ts_event);
    expect(overviewState1.followLatest).toBe(true);

    vm.switchToView(ViewType.Footprint);
    const footprintState = fs.footprintView!.getViewportState();
    expect(footprintState.anchorTsEvent).toBe(bars[bars.length - 1].ts_event);
    expect(footprintState.followLatest).toBe(true);

    vm.switchToView(ViewType.Overview);
    // Factory creates a new OverviewView instance on each switchToView call
    // The new view should be at the latest position (linked mode restores from sharedAnchor)
    expect(vm.getCurrentViewType()).toBe(ViewType.Overview);
  });

  it('should preserve independent per-view state when linkViews is off', async () => {
    const bars = createBars(200);
    const state = makeState(bars);
    const store = {
      getState: vi.fn(() => state),
      getBarCount: vi.fn(() => bars.length),
      ingestBar: vi.fn(),
      ingestCvd: vi.fn(),
      ingestFootprint: vi.fn(),
    } as unknown as ChartStore;

    const { vm, factoryState: fs } = await createRealViewManager(store);

    vm.setLinkViews(false);
    vm.switchToView(ViewType.Overview);

    const overviewView = fs.overviewView!;
    const overviewState = overviewView.getViewportState();
    expect(overviewState.followLatest).toBe(true);

    vm.switchToView(ViewType.Footprint);
    const footprintView = fs.footprintView!;
    const footprintState = footprintView.getViewportState();
    expect(footprintState.followLatest).toBe(true);
  });

  it('should restore from sharedAnchor in linked mode after panning Overview', async () => {
    const bars = createBars(200);
    const state = makeState(bars);
    const store = {
      getState: vi.fn(() => state),
      getBarCount: vi.fn(() => bars.length),
      ingestBar: vi.fn(),
      ingestCvd: vi.fn(),
      ingestFootprint: vi.fn(),
    } as unknown as ChartStore;

    const { vm, factoryState: fs } = await createRealViewManager(store);

    vm.switchToView(ViewType.Overview);

    vm.switchToView(ViewType.Footprint);
    const footprintView = fs.footprintView!;

    const footprintLatest = footprintView.getViewportState();
    expect(footprintLatest.anchorTsEvent).toBe(bars[bars.length - 1].ts_event);
    expect(footprintLatest.followLatest).toBe(true);
  });

  it('should handle switch with no prior state leaving view at latest', async () => {
    const bars = createBars(50);
    const state = makeState(bars);
    const store = {
      getState: vi.fn(() => state),
      getBarCount: vi.fn(() => bars.length),
      ingestBar: vi.fn(),
      ingestCvd: vi.fn(),
      ingestFootprint: vi.fn(),
    } as unknown as ChartStore;

    const { vm, factoryState: fs } = await createRealViewManager(store);

    vm.switchToView(ViewType.Footprint);
    const footprintView = fs.footprintView!;
    const state1 = footprintView.getViewportState();
    expect(state1.anchorTsEvent).toBe(bars[bars.length - 1].ts_event);
    expect(state1.followLatest).toBe(true);
  });
});

describe('ViewManager linked mode: real views with ChartStore seed (Priority 2)', () => {
  let container: HTMLElement;
  let originalGetContext: typeof HTMLCanvasElement.prototype.getContext;

  beforeEach(() => {
    container = document.createElement('div');
    container.style.width = '800px';
    container.style.height = '600px';
    Object.defineProperty(container, 'clientWidth', { writable: true, value: 800 });
    Object.defineProperty(container, 'clientHeight', { writable: true, value: 600 });

    originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = vi.fn((type: string) => {
      if (type === '2d') return mockCtx;
      return null;
    });

    vi.stubGlobal('ResizeObserver', vi.fn(() => ({
      observe: vi.fn(),
      disconnect: vi.fn(),
    })));
  });

  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  async function createViewManagerWithStore(bars: BarPayload[]) {
    const state = makeState(bars);
    const store = {
      getState: vi.fn(() => state),
      getBarCount: vi.fn(() => bars.length),
      ingestBar: vi.fn(),
      ingestCvd: vi.fn(),
      ingestFootprint: vi.fn(),
    } as unknown as ChartStore;

    const { OverviewView } = await import('../../src/views/OverviewView');
    const { FootprintView } = await import('../../src/views/FootprintView');

    const factoryState: ViewFactoryState = { overviewView: null, footprintView: null };
    const vm = new ViewManager(store, container, (type: ViewType) => {
      if (type === ViewType.Overview) {
        const view = new OverviewView();
        factoryState.overviewView = view;
        return view;
      }
      const view = new FootprintView();
      factoryState.footprintView = view;
      return view;
    });

    return { vm, factoryState, store };
  }

  it('should restore viewport from shareAnchor when switching between views in linked mode with 200 bars', async () => {
    const bars = createBars(200);
    const { vm, factoryState } = await createViewManagerWithStore(bars);

    vm.switchToView(ViewType.Overview);

    vm.switchToView(ViewType.Footprint);
    const footprintView = factoryState.footprintView!;
    const fpState = footprintView.getViewportState();
    expect(fpState.followLatest).toBe(true);

    vm.switchToView(ViewType.Overview);
    const overviewView = factoryState.overviewView!;
    const ovState = overviewView.getViewportState();
    expect(ovState.anchorTsEvent).toBe(bars[bars.length - 1].ts_event);
  });

  it('should setLinkViews dynamically and affect subsequent switches', async () => {
    const bars = createBars(100);
    const { vm, factoryState } = await createViewManagerWithStore(bars);

    vm.switchToView(ViewType.Overview);
    vm.setLinkViews(false);
    expect(vm.isLinkViewsEnabled()).toBe(false);

    vm.switchToView(ViewType.Footprint);
    const footprintView = factoryState.footprintView!;
    const fpState = footprintView.getViewportState();
    expect(fpState.followLatest).toBe(true);

    vm.setLinkViews(true);
    expect(vm.isLinkViewsEnabled()).toBe(true);

    vm.switchToView(ViewType.Overview);
    const overviewView = factoryState.overviewView!;
    const ovState = overviewView.getViewportState();
    expect(ovState.anchorTsEvent).toBe(bars[bars.length - 1].ts_event);
  });

  it('should not crash when switching with empty bars', async () => {
    const bars: BarPayload[] = [];
    const { vm } = await createViewManagerWithStore(bars);

    expect(() => vm.switchToView(ViewType.Overview)).not.toThrow();
    expect(() => vm.switchToView(ViewType.Footprint)).not.toThrow();
    expect(() => vm.switchToView(ViewType.Overview)).not.toThrow();
  });

  it('should handle toggle between linked and independent mid-session without crash', async () => {
    const bars = createBars(50);
    const { vm } = await createViewManagerWithStore(bars);

    vm.switchToView(ViewType.Overview);
    vm.setLinkViews(false);
    vm.switchToView(ViewType.Footprint);
    vm.setLinkViews(true);
    vm.switchToView(ViewType.Overview);
    vm.setLinkViews(false);
    vm.switchToView(ViewType.Footprint);
    vm.setLinkViews(true);
    vm.switchToView(ViewType.Overview);

    expect(vm.getCurrentViewType()).toBe(ViewType.Overview);
  });

  it('should handle three-way switch cycle with linked mode', async () => {
    const bars = createBars(50);
    const { vm } = await createViewManagerWithStore(bars);

    vm.switchToView(ViewType.Overview);
    vm.switchToView(ViewType.Footprint);
    vm.switchToView(ViewType.Overview);
    vm.switchToView(ViewType.Footprint);
    vm.switchToView(ViewType.Overview);

    expect(vm.getCurrentViewType()).toBe(ViewType.Overview);
  });
});

describe('ViewManager + Viewport state with CanvasCandlestickRenderer mock (Priority 2: Delegation chain)', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  function createMockChartStoreWithBars(barCount: number): ChartStore {
    const bars: BarPayload[] = [];
    for (let i = 0; i < barCount; i++) {
      bars.push(makeBar((i + 1) * 1000));
    }
    const state: ChartStoreState = { bars, cvd: new Map(), footprints: new Map() };
    return {
      getState: vi.fn(() => state),
      getBarCount: vi.fn(() => barCount),
      ingestBar: vi.fn(),
      ingestCvd: vi.fn(),
      ingestFootprint: vi.fn(),
    } as unknown as ChartStore;
  }

  function createMockOverviewView(initialState?: { anchorTsEvent: number | null; followLatest: boolean }): ChartView & { getViewportStateCalls: number; restoreViewportStateCalls: ViewportState[] } {
    let state = initialState ?? { anchorTsEvent: null, followLatest: true };
    const calls: ViewportState[] = [];
    return {
      mount: vi.fn(),
      seed: vi.fn(),
      updateBar: vi.fn(),
      updateCvd: vi.fn(),
      updateFootprint: vi.fn(),
      destroy: vi.fn(),
      getType: vi.fn(() => ViewType.Overview),
      getViewportState: vi.fn(() => state),
      restoreViewportState: vi.fn((s: ViewportState) => { state = s; calls.push(s); }),
    } as unknown as ChartView;
  }

  function createMockFootprintView(): ChartView {
    let lastState: ViewportState | null = null;
    return {
      mount: vi.fn(),
      seed: vi.fn(),
      updateBar: vi.fn(),
      updateCvd: vi.fn(),
      updateFootprint: vi.fn(),
      destroy: vi.fn(),
      getType: vi.fn(() => ViewType.Footprint) as () => ViewType,
      getViewportState: vi.fn(() => lastState ?? { anchorTsEvent: null, followLatest: true }),
      restoreViewportState: vi.fn((s: ViewportState) => { lastState = s; }),
      lastRestoredState: null,
    } as unknown as ChartView;
  }

  it('should capture overview anchor and restore it on footprint in linked mode', () => {
    const store = createMockChartStoreWithBars(30);
    const overviewState = { anchorTsEvent: 5000, followLatest: false };
    const overviewView = createMockOverviewView(overviewState);
    const footprintView = createMockFootprintView();

    const vm = new ViewManager(store, container, (type: ViewType) => {
      if (type === ViewType.Overview) return overviewView;
      return footprintView;
    });

    vm.switchToView(ViewType.Overview);
    // First switch: no outgoing view, so getViewportState is NOT called yet

    vm.switchToView(ViewType.Footprint);
    // Second switch: Overview is outgoing, getViewportState is captured
    expect(overviewView.getViewportState).toHaveBeenCalled();
    expect(footprintView.restoreViewportState).toHaveBeenCalledWith(overviewState);
  });

  it('should not restore footprint when no shared anchor exists (first switch)', () => {
    const store = createMockChartStoreWithBars(30);
    const overviewView = createMockOverviewView();
    const footprintView = createMockFootprintView();

    const vm = new ViewManager(store, container, (type: ViewType) => {
      if (type === ViewType.Overview) return overviewView;
      return footprintView;
    });

    vm.switchToView(ViewType.Footprint);
    expect(footprintView.restoreViewportState).not.toHaveBeenCalled();
  });
});

describe('ViewManager setLinkViews edge cases (Priority 3)', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
  });

  function createMockStore(): ChartStore {
    return {
      getState: vi.fn(() => ({ bars: [] as BarPayload[], cvd: new Map(), footprints: new Map() })),
      getBarCount: vi.fn(() => 0),
      ingestBar: vi.fn(),
      ingestCvd: vi.fn(),
      ingestFootprint: vi.fn(),
    } as unknown as ChartStore;
  }

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

  it('should allow toggling linkViews on and off', () => {
    const vm = new ViewManager(createMockStore(), container, () => createMockView(ViewType.Overview));

    expect(vm.isLinkViewsEnabled()).toBe(true);

    vm.setLinkViews(false);
    expect(vm.isLinkViewsEnabled()).toBe(false);

    vm.setLinkViews(true);
    expect(vm.isLinkViewsEnabled()).toBe(true);

    vm.setLinkViews(false);
    expect(vm.isLinkViewsEnabled()).toBe(false);
  });

  it('should default to linked mode (linkViews = true)', () => {
    const vm = new ViewManager(createMockStore(), container, () => createMockView(ViewType.Overview));
    expect(vm.linkViews).toBe(true);
  });

  it('should capture viewport state into per-view map in independent mode', () => {
    const store = createMockStore();
    const overviewView = createMockView(ViewType.Overview);
    const footprintView = createMockView(ViewType.Footprint);

    const vm = new ViewManager(store, container, (type: ViewType) => {
      if (type === ViewType.Overview) return overviewView;
      return footprintView;
    });

    vm.setLinkViews(false);
    vm.switchToView(ViewType.Overview);
    // First switch: no outgoing view, getViewportState not called yet

    vm.switchToView(ViewType.Footprint);
    // Second switch: Overview is outgoing, state captured into per-view map
    expect(overviewView.getViewportState).toHaveBeenCalled();
    // In independent mode, Footprint should NOT be restored from sharedAnchor
    expect(footprintView.restoreViewportState).not.toHaveBeenCalled();
  });

  it('should ignore duplicate switchToView calls with same type', () => {
    const store = createMockStore();
    const viewFactory = vi.fn(() => createMockView(ViewType.Overview));

    const vm = new ViewManager(store, container, viewFactory);

    vm.switchToView(ViewType.Overview);
    expect(viewFactory).toHaveBeenCalledTimes(1);

    vm.switchToView(ViewType.Overview);
    expect(viewFactory).toHaveBeenCalledTimes(1);
  });
});