import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Integration tests for the Slice 11 conflict-resolution area in OverviewView
 * and CanvasCandlestickRenderer.
 *
 * Branch merge: `feature/slice11e32ecd-linked-viewport-persistence`'s
 * renderer-delegation getViewportState()/restoreViewportState() (delegates to
 * CanvasCandlestickRenderer) was kept over `feature/slice11f20826-linked-by-time-viewport`'s
 * stub. A duplicate stub method left by the auto-merge was removed so the class
 * has a single coherent pair of methods.
 *
 * The delegation itself is thin, so the real risk lives in the renderer's
 * viewport methods driving the REAL ChartViewState. Here the heavy
 * rendering/pane components are mocked, but ChartViewState is the genuine
 * implementation, so OverviewView -> CanvasCandlestickRenderer ->
 * ChartViewState runs through the resolved code path.
 *
 * NOTE: ChartViewState must NOT be mocked below — that is the whole point.
 */

const mockHorizontalTransform = {
  setVisibleBarRange: vi.fn(),
  getVisibleBarRange: vi.fn(() => ({ start: 0, end: 0 })),
};

const mockPaneLayout = {
  setBars: vi.fn(),
  yToValue: vi.fn(() => null),
  updateLayout: vi.fn(),
  destroy: vi.fn(),
  getHorizontalTransform: vi.fn(() => mockHorizontalTransform),
};

const mockCandlestickPane = {
  isColorByDelta: vi.fn(() => true),
  setColorByDelta: vi.fn(),
  destroy: vi.fn(),
};

const mockCrosshair = {
  setBars: vi.fn(),
  show: vi.fn(),
  hide: vi.fn(),
  setValueResolver: vi.fn(),
  destroy: vi.fn(),
};

const mockInteraction = {
  destroy: vi.fn(),
};

const mockResetButton = {
  updateVisibility: vi.fn(),
  destroy: vi.fn(),
};

const mockVolumeProfile = {
  getVolumeAtPrice: vi.fn(() => null),
  setBarsVisible: vi.fn(),
  setValueAreaVisible: vi.fn(),
  destroy: vi.fn(),
};

vi.mock('../../src/chart/PaneLayout', () => ({
  PaneLayout: vi.fn(() => mockPaneLayout),
}));
vi.mock('../../src/chart/CandlestickPane', () => ({
  CandlestickPane: vi.fn(() => mockCandlestickPane),
}));
vi.mock('../../src/chart/CVDPane', () => ({
  CVDPane: vi.fn(() => ({})),
}));
vi.mock('../../src/chart/VolumePane', () => ({
  VolumePane: vi.fn(() => ({})),
}));
vi.mock('../../src/chart/CrosshairOverlay', () => ({
  CrosshairOverlay: vi.fn(() => mockCrosshair),
}));
vi.mock('../../src/chart/InteractionController', () => ({
  InteractionController: vi.fn(() => mockInteraction),
}));
vi.mock('../../src/chart/ResetToLatestButton', () => ({
  ResetToLatestButton: vi.fn(() => mockResetButton),
}));
vi.mock('../../src/chart/VolumeProfileOverlay', () => ({
  VolumeProfileOverlay: vi.fn(() => mockVolumeProfile),
}));

vi.stubGlobal(
  'ResizeObserver',
  vi.fn(() => ({ observe: vi.fn(), disconnect: vi.fn() })),
);
vi.stubGlobal('requestAnimationFrame', vi.fn(() => 0) as unknown as typeof requestAnimationFrame);

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
    scale: vi.fn(),
    clip: vi.fn(),
    rect: vi.fn(),
    measureText: vi.fn(() => ({ width: 10 } as TextMetrics)),
    font: '',
    textAlign: 'start' as CanvasTextAlign,
    textBaseline: 'alphabetic' as CanvasTextBaseline,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
  } as unknown as CanvasRenderingContext2D;
}

import { OverviewView } from '../../src/views/OverviewView';
import { CanvasCandlestickRenderer } from '../../src/renderers/CanvasCandlestickRenderer';
import type { BarPayload, ChartStoreState } from '../../src/types';

function makeBars(count: number, startTs = 1_000_000, stepMs = 60_000): BarPayload[] {
  const bars: BarPayload[] = [];
  for (let i = 0; i < count; i++) {
    const price = 100 + i;
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

function makeState(bars: BarPayload[]): ChartStoreState {
  return { bars, cvd: new Map(), footprints: new Map() };
}

describe('OverviewView <-> CanvasCandlestickRenderer viewport delegation (conflict area: e32ecd retained)', () => {
  let container: HTMLElement;
  let originalGetContext: typeof HTMLCanvasElement.prototype.getContext;

  beforeEach(() => {
    container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', { writable: true, value: 800 });
    Object.defineProperty(container, 'clientHeight', { writable: true, value: 600 });

    originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = vi.fn((type: string) =>
      type === '2d' ? createMockCtx() : null,
    ) as typeof HTMLCanvasElement.prototype.getContext;

    vi.clearAllMocks();
  });

  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
  });

  it('OverviewView.getViewportState delegates to the real renderer and returns right-edge ts_event + followLatest', () => {
    const overview = new OverviewView();
    overview.mount(container);
    overview.seed(makeState(makeBars(20)));

    const state = overview.getViewportState();
    const bars = makeBars(20);
    expect(state.anchorTsEvent).toBe(bars[bars.length - 1].ts_event);
    expect(state.followLatest).toBe(true);
  });

  it('OverviewView getViewportState reflects followLatest after a historical restore (AC-2/AC-3)', () => {
    const overview = new OverviewView();
    overview.mount(container);
    const bars = makeBars(2000);
    overview.seed(makeState(bars));

    // Anchor to a specific historical bar.
    overview.restoreViewportState({ anchorTsEvent: bars[295].ts_event, followLatest: false });

    const captured = overview.getViewportState();
    // followLatest is false because the view is now positioned historically
    // (the renderer's view-state moved off the tail).
    expect(captured.followLatest).toBe(false);
    // After a historical restore, the anchor reflects the (clamped) right-edge
    // VISIBLE bar, NOT the latest buffer bar (returning the latest was the
    // pre-fix bug this test previously encoded).
    expect(captured.anchorTsEvent).not.toBeNull();
    expect(captured.anchorTsEvent).not.toBe(bars[bars.length - 1].ts_event);

    // Round-trip: destroy + recreate + restore keeps the same anchor ts_event.
    overview.destroy();
    const overview2 = new OverviewView();
    overview2.mount(container);
    overview2.seed(makeState(bars));
    overview2.restoreViewportState(captured);
    const restored = overview2.getViewportState();
    expect(restored.anchorTsEvent).toBe(captured.anchorTsEvent);
  });

  it('OverviewView.restoreViewportState with followLatest=true positions at the latest bar', () => {
    const overview = new OverviewView();
    overview.mount(container);
    const bars = makeBars(300);
    overview.seed(makeState(bars));

    overview.restoreViewportState({ anchorTsEvent: bars[5].ts_event, followLatest: false });
    expect(overview.getViewportState().followLatest).toBe(false);

    overview.restoreViewportState({ anchorTsEvent: null, followLatest: true });
    const restored = overview.getViewportState();
    expect(restored.followLatest).toBe(true);
    expect(restored.anchorTsEvent).toBe(bars[bars.length - 1].ts_event);
  });

  it('OverviewView restoreViewportState with an out-of-range anchor does not crash', () => {
    const overview = new OverviewView();
    overview.mount(container);
    const bars = makeBars(300);
    overview.seed(makeState(bars));

    // Anchor far older than any held bar -> must not throw.
    expect(() => overview.restoreViewportState({ anchorTsEvent: 1, followLatest: false })).not.toThrow();
    expect(overview.getViewportState().followLatest).toBe(false);

    // Anchor far newer than any held bar -> must not throw.
    expect(() => overview.restoreViewportState({ anchorTsEvent: 9_999_999, followLatest: false })).not.toThrow();
  });

  it('real CanvasCandlestickRenderer.getViewportState returns null anchor for an empty buffer', () => {
    const renderer = new CanvasCandlestickRenderer(container);
    const state = renderer.getViewportState();
    expect(state.anchorTsEvent).toBeNull();
    expect(state.followLatest).toBe(true);
  });
});
