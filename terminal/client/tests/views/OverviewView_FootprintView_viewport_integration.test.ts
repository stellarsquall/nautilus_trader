import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ViewportState, ViewType } from '../../src/views/ChartView';
import type { BarPayload, ChartStoreState } from '../../src/types';

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

// ──────────────────────────────────────────────
// OverviewView viewport delegation integration
// ──────────────────────────────────────────────
describe('OverviewView viewport delegation to CanvasCandlestickRenderer', () => {
  let container: HTMLElement;
  let originalGetContext: typeof HTMLCanvasElement.prototype.getContext;

  const mockCtx = {
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn(() => ({ width: 50 })),
    setLineDash: vi.fn(),
    scale: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    clip: vi.fn(),
    rect: vi.fn(),
    setTransform: vi.fn(),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: '',
    textBaseline: '',
  } as unknown as CanvasRenderingContext2D;

  beforeEach(async () => {
    container = document.createElement('div');
    container.style.width = '800px';
    container.style.height = '600px';
    document.body.appendChild(container);
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

  it('delegates getViewportState to the renderer after mount and seed', async () => {
    const { OverviewView } = await import('../../src/views/OverviewView');
    const view = new OverviewView();
    view.mount(container);
    const bars = createBars(5);
    view.seed(makeState(bars));

    const state = view.getViewportState();
    // Right-edge bar is bars[4] with ts_event=5000
    expect(state.anchorTsEvent).toBe(5000);
    expect(state.followLatest).toBe(true);

    view.destroy();
  });

  it('returns null anchorTsEvent when no bars are seeded', async () => {
    const { OverviewView } = await import('../../src/views/OverviewView');
    const view = new OverviewView();
    view.mount(container);
    view.seed(makeState([]));

    const state = view.getViewportState();
    expect(state.anchorTsEvent).toBeNull();
    expect(state.followLatest).toBe(true);

    view.destroy();
  });

  it('returns null anchorTsEvent when getViewportState called before mount', async () => {
    const { OverviewView } = await import('../../src/views/OverviewView');
    const view = new OverviewView();

    const state = view.getViewportState();
    expect(state.anchorTsEvent).toBeNull();
    expect(state.followLatest).toBe(true);
  });

  it('restoreViewportState with followLatest=true positions at latest bar', async () => {
    const { OverviewView } = await import('../../src/views/OverviewView');
    const view = new OverviewView();
    view.mount(container);
    const bars = createBars(50);
    view.seed(makeState(bars));

    // Capture default state (at latest)
    const defaultState = view.getViewportState();
    expect(defaultState.followLatest).toBe(true);

    // Restore with explicit followLatest=true
    view.restoreViewportState({ anchorTsEvent: null, followLatest: true });
    const restored = view.getViewportState();
    expect(restored.followLatest).toBe(true);
    expect(restored.anchorTsEvent).toBe(bars[bars.length - 1].ts_event);

    view.destroy();
  });

  it('restoreViewportState with empty bars does not throw', async () => {
    const { OverviewView } = await import('../../src/views/OverviewView');
    const view = new OverviewView();
    view.mount(container);
    view.seed(makeState([]));

    expect(() => {
      view.restoreViewportState({ anchorTsEvent: null, followLatest: true });
    }).not.toThrow();
    expect(() => {
      view.restoreViewportState({ anchorTsEvent: 1000, followLatest: false });
    }).not.toThrow();

    view.destroy();
  });

  it('restoreViewportState before mount does not throw (null guard)', async () => {
    const { OverviewView } = await import('../../src/views/OverviewView');
    const view = new OverviewView();

    expect(() => {
      view.restoreViewportState({ anchorTsEvent: 1000, followLatest: false });
    }).not.toThrow();

    // Should also work after destroy
    view.mount(container);
    view.seed(makeState(createBars(5)));
    view.destroy();
    expect(() => {
      view.restoreViewportState({ anchorTsEvent: 1000, followLatest: false });
    }).not.toThrow();
  });
});

// ──────────────────────────────────────────────
// FootprintView viewport integration
// ──────────────────────────────────────────────
describe('FootprintView viewport integration', () => {
  let container: HTMLElement;

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
    font: '',
    textAlign: 'start' as CanvasTextAlign,
    textBaseline: 'alphabetic' as CanvasTextBaseline,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
  } as unknown as CanvasRenderingContext2D;

  beforeEach(async () => {
    vi.clearAllMocks();
    container = document.createElement('div');

    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => mockCtx);
    vi.stubGlobal('ResizeObserver', vi.fn(() => ({
      observe: vi.fn(),
      disconnect: vi.fn(),
    })));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('getViewportState returns right-edge bar ts_event after seed', async () => {
    const { FootprintView } = await import('../../src/views/FootprintView');
    const view = new FootprintView();
    view.mount(container);
    const bars = createBars(10);
    view.seed(makeState(bars));

    const state = view.getViewportState();
    expect(state.anchorTsEvent).toBe(bars[bars.length - 1].ts_event);
    expect(state.followLatest).toBe(true);

    view.destroy();
  });

  it('getViewportState returns null when no bars', async () => {
    const { FootprintView } = await import('../../src/views/FootprintView');
    const view = new FootprintView();
    const state = view.getViewportState();
    expect(state.anchorTsEvent).toBeNull();
    expect(state.followLatest).toBe(true);
  });

  it('round-trip: capture and restore maintains viewport position', async () => {
    const { FootprintView } = await import('../../src/views/FootprintView');
    const view = new FootprintView();
    view.mount(container);
    const bars = createBars(200);
    view.seed(makeState(bars));

    // Pan away from latest
    view.viewState.pan(-30);
    expect(view.viewState.isAtLatest()).toBe(false);

    const captured = view.getViewportState();
    expect(captured.anchorTsEvent).not.toBeNull();
    expect(captured.followLatest).toBe(false);

    // Verify anchor matches right-edge bar
    const rightEdgeIndex = view.viewState.getRightEdgeBarIndex();
    expect(captured.anchorTsEvent).toBe(bars[rightEdgeIndex].ts_event);

    // Destroy and recreate
    view.destroy();
    const view2 = new FootprintView();
    view2.mount(container);
    view2.seed(makeState(bars));

    // Restore from captured state
    view2.restoreViewportState(captured);
    const restored = view2.getViewportState();
    expect(restored.anchorTsEvent).toBe(captured.anchorTsEvent);

    view2.destroy();
  });

  it('out-of-range anchorTsEvent clamps without crash', async () => {
    const { FootprintView } = await import('../../src/views/FootprintView');
    const view = new FootprintView();
    view.mount(container);
    const bars = createBars(10);
    view.seed(makeState(bars));

    expect(() => view.restoreViewportState({ anchorTsEvent: 0, followLatest: false })).not.toThrow();
    expect(() => view.restoreViewportState({ anchorTsEvent: 999999, followLatest: false })).not.toThrow();

    view.destroy();
  });

  it('followLatest=true positions at latest bar regardless of anchorTsEvent', async () => {
    const { FootprintView } = await import('../../src/views/FootprintView');
    const view = new FootprintView();
    view.mount(container);
    const bars = createBars(200);
    view.seed(makeState(bars));

    view.viewState.pan(-30);
    expect(view.viewState.isAtLatest()).toBe(false);

    view.restoreViewportState({ anchorTsEvent: 1000, followLatest: true });
    expect(view.viewState.isAtLatest()).toBe(true);
    expect(view.viewState.getRightEdgeBarIndex()).toBe(bars.length - 1);

    view.destroy();
  });
});

// ──────────────────────────────────────────────
// Cross-view ChartView interface contract
// ──────────────────────────────────────────────
describe('ChartView viewport interface contract (both views)', () => {
  it('OverviewView.getViewportState returns expected shape', async () => {
    const { OverviewView } = await import('../../src/views/OverviewView');
    const view = new OverviewView();
    const state: ViewportState = view.getViewportState();
    expect(state).toHaveProperty('anchorTsEvent');
    expect(state).toHaveProperty('followLatest');
    expect(typeof state.followLatest).toBe('boolean');
  });

  it('FootprintView.getViewportState returns expected shape', async () => {
    const { FootprintView } = await import('../../src/views/FootprintView');
    const view = new FootprintView();
    const state: ViewportState = view.getViewportState();
    expect(state).toHaveProperty('anchorTsEvent');
    expect(state).toHaveProperty('followLatest');
    expect(typeof state.followLatest).toBe('boolean');
  });

  it('both views implement getViewportState and restoreViewportState', async () => {
    const { OverviewView } = await import('../../src/views/OverviewView');
    const { FootprintView } = await import('../../src/views/FootprintView');

    const overview = new OverviewView();
    const footprint = new FootprintView();

    expect(typeof overview.getViewportState).toBe('function');
    expect(typeof overview.restoreViewportState).toBe('function');
    expect(typeof footprint.getViewportState).toBe('function');
    expect(typeof footprint.restoreViewportState).toBe('function');
  });

  it('ViewportState type allows null anchorTsEvent and boolean followLatest', () => {
    const state1: ViewportState = { anchorTsEvent: null, followLatest: true };
    const state2: ViewportState = { anchorTsEvent: 1000, followLatest: false };
    const state3: ViewportState = { anchorTsEvent: 0, followLatest: true };

    expect(state1.anchorTsEvent).toBeNull();
    expect(state2.anchorTsEvent).toBe(1000);
    expect(state3.anchorTsEvent).toBe(0);
    expect(state1.followLatest).toBe(true);
    expect(state2.followLatest).toBe(false);
  });
});