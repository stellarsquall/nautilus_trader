import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChartStoreState, BarPayload, FootprintPayload } from '../../src/types';
import type { ChartStore } from '../../src/store/ChartStore';
import type { ChartView, ViewportState } from '../../src/views/ChartView';

/**
 * Integration tests for the ViewManager <-> concrete-view boundary in Slice 11.
 *
 * ViewManager.switchToView() is the seam where the time-linked viewport is meant
 * to be captured from the outgoing view and restored into the incoming view.
 * These tests drive REAL OverviewView and FootprintView instances through the
 * ViewManager (not mocks), verifying that:
 *   - switching destroys the outgoing view and mounts + seeds the incoming one,
 *   - the live view always exposes the viewport delegation contract, and
 *   - a viewport captured before a switch can be restored into the new view
 *     across the ViewManager boundary (the linked-viewport handoff).
 */

const mockRenderer = vi.hoisted(() => {
  const viewport: ViewportState = { anchorTsEvent: null, followLatest: true };
  return {
    update: vi.fn(),
    updateCvd: vi.fn(),
    updateFootprint: vi.fn(),
    destroy: vi.fn(),
    getViewportState: vi.fn(() => ({ ...viewport })),
    restoreViewportState: vi.fn((state: ViewportState) => {
      viewport.anchorTsEvent = state.anchorTsEvent;
      viewport.followLatest = state.followLatest;
    }),
    getColorByDelta: vi.fn(() => true),
    setColorByDelta: vi.fn(),
    isVolumeProfileVisible: vi.fn(() => true),
    setVolumeProfileVisible: vi.fn(),
    isValueAreaVisible: vi.fn(() => true),
    setValueAreaVisible: vi.fn(),
  };
});
vi.mock('../../src/renderers/CanvasCandlestickRenderer', () => ({
  CanvasCandlestickRenderer: vi.fn(() => mockRenderer),
}));

function createMockCtx(): CanvasRenderingContext2D {
  return {
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
    measureText: vi.fn(() => ({ width: 10 }) as TextMetrics),
    font: '',
    textAlign: 'start' as CanvasTextAlign,
    textBaseline: 'alphabetic' as CanvasTextBaseline,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
  } as unknown as CanvasRenderingContext2D;
}
vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => createMockCtx());
vi.stubGlobal(
  'ResizeObserver',
  vi.fn(() => ({ observe: vi.fn(), disconnect: vi.fn() })),
);

import { ViewManager } from '../../src/views/ViewManager';
import { ViewType } from '../../src/views/ChartView';
import { OverviewView } from '../../src/views/OverviewView';
import { FootprintView } from '../../src/views/FootprintView';

function makeBars(count: number, startTs = 2_000_000, stepMs = 60_000): BarPayload[] {
  const bars: BarPayload[] = [];
  for (let i = 0; i < count; i++) {
    const price = 200 + i;
    bars.push({
      ts_event: startTs + i * stepMs,
      open: price,
      high: price + 1,
      low: price - 1,
      close: price + 0.5,
      volume: 100 + i,
    });
  }
  return bars;
}

function createMockChartStore(bars: BarPayload[]): ChartStore {
  const footprints = new Map<number, FootprintPayload>();
  for (const bar of bars) {
    footprints.set(bar.ts_event, {
      ts_event: bar.ts_event,
      bin_size: 0.1,
      levels: [
        { price: bar.close, buy: 10, sell: 5 },
        { price: bar.close + 0.1, buy: 3, sell: 8 },
      ],
    });
  }
  const state: ChartStoreState = { bars, cvd: new Map(), footprints };
  return {
    getState: vi.fn(() => state),
    getBarCount: vi.fn(() => bars.length),
    ingestBar: vi.fn(),
    ingestCvd: vi.fn(),
    ingestFootprint: vi.fn(),
  } as unknown as ChartStore;
}

function realViewFactory(type: ViewType): ChartView {
  return type === ViewType.Overview ? new OverviewView() : new FootprintView();
}

describe('ViewManager <-> ChartView switching with real views (Slice 11 integration)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('switches Overview -> Footprint and seeds the incoming view from the store', () => {
    const store = createMockChartStore(makeBars(10));
    const container = document.createElement('div');
    const vm = new ViewManager(store, container, realViewFactory);

    vm.switchToView(ViewType.Overview);
    expect(vm.getCurrentViewType()).toBe(ViewType.Overview);

    vm.switchToView(ViewType.Footprint);
    expect(vm.getCurrentViewType()).toBe(ViewType.Footprint);

    // Store is queried for state each time a view is (re)seeded.
    expect(store.getState).toHaveBeenCalledTimes(2);
  });

  it('destroys the outgoing real view when switching to another type', () => {
    const store = createMockChartStore(makeBars(6));
    const container = document.createElement('div');
    const vm = new ViewManager(store, container, realViewFactory);

    vm.switchToView(ViewType.Overview);
    const outgoing = (vm as unknown as { currentView: ChartView }).currentView;
    const destroySpy = vi.spyOn(outgoing, 'destroy');

    vm.switchToView(ViewType.Footprint);
    expect(destroySpy).toHaveBeenCalledTimes(1);
  });

  it('exposes the viewport delegation contract on the live view after each switch', () => {
    const store = createMockChartStore(makeBars(8));
    const container = document.createElement('div');
    const vm = new ViewManager(store, container, realViewFactory);

    vm.switchToView(ViewType.Overview);
    let live = (vm as unknown as { currentView: ChartView }).currentView;
    expect(typeof live.getViewportState).toBe('function');
    let vp = live.getViewportState();
    expect(vp).toHaveProperty('anchorTsEvent');
    expect(vp).toHaveProperty('followLatest');

    vm.switchToView(ViewType.Footprint);
    live = (vm as unknown as { currentView: ChartView }).currentView;
    vp = live.getViewportState();
    expect(vp).toHaveProperty('anchorTsEvent');
    expect(vp).toHaveProperty('followLatest');
  });

  it('linked handoff across a switch: an anchor captured from Overview restores into Footprint', () => {
    const store = createMockChartStore(makeBars(300));
    const container = document.createElement('div');
    const vm = new ViewManager(store, container, realViewFactory);

    vm.switchToView(ViewType.Overview);
    const overview = (vm as unknown as { currentView: ChartView }).currentView;

    // Pan Overview to a historical bar. The buffer is large enough that the
    // anchor sits before the latest bar, so the Footprint view can actually
    // represent a panned (non-following) viewport after the handoff.
    const anchored: ViewportState = { anchorTsEvent: 11_000_000, followLatest: false };
    overview.restoreViewportState(anchored);

    // Simulate linked-mode capture at the ViewManager seam.
    const sharedAnchor = overview.getViewportState();

    vm.switchToView(ViewType.Footprint);
    const footprint = (vm as unknown as { currentView: ChartView }).currentView;
    expect(() => footprint.restoreViewportState(sharedAnchor)).not.toThrow();

    const restored = footprint.getViewportState();
    expect(restored.anchorTsEvent).toBe(11_000_000);
    expect(restored.followLatest).toBe(false);
  });

  it('first switch with no prior state leaves the view following the latest bar (default)', () => {
    // More bars than the default 100-bar window so the tail is genuinely scrolled.
    const store = createMockChartStore(makeBars(200));
    const container = document.createElement('div');
    const vm = new ViewManager(store, container, realViewFactory);

    vm.switchToView(ViewType.Footprint);
    const footprint = (vm as unknown as { currentView: FootprintView }).currentView;

    // Default viewport follows latest, and the state class anchors the right edge
    // on the newest seeded bar.
    expect(footprint.getViewportState().followLatest).toBe(true);
    expect(footprint.viewState.getFollowLatest()).toBe(true);
    expect(footprint.viewState.getRightEdgeBarIndex()).toBe(199);
  });

  it('routes live bar/footprint updates to the currently active real view without throwing', () => {
    const store = createMockChartStore(makeBars(5));
    const container = document.createElement('div');
    const vm = new ViewManager(store, container, realViewFactory);

    vm.switchToView(ViewType.Footprint);
    const newBar: BarPayload = {
      ts_event: 2_500_000,
      open: 210,
      high: 211,
      low: 209,
      close: 210.5,
      volume: 300,
    };
    expect(() => vm.updateBar(newBar)).not.toThrow();

    const fp: FootprintPayload = {
      ts_event: 2_500_000,
      bin_size: 0.1,
      levels: [{ price: 210.5, buy: 12, sell: 4 }],
    };
    expect(() => vm.updateFootprint(fp)).not.toThrow();
  });
});
