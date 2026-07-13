import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FootprintView } from '../../src/views/FootprintView';
import { ViewType } from '../../src/views/ChartView';
import type { ChartStoreState, BarPayload } from '../../src/types';

function createMockCtx(): CanvasRenderingContext2D {
  return {
    canvas: {} as HTMLCanvasElement,
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    strokeRect: vi.fn(),
    beginPath: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
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
}

const mockCtx = createMockCtx();

vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => mockCtx);

vi.stubGlobal('ResizeObserver', vi.fn(() => ({
  observe: vi.fn(),
  disconnect: vi.fn(),
})));

function createBars(count: number): BarPayload[] {
  const bars: BarPayload[] = [];
  for (let i = 0; i < count; i++) {
    bars.push({ ts_event: (i + 1) * 1000, open: 100, high: 101, low: 99, close: 100, volume: 1000 });
  }
  return bars;
}

describe('FootprintView viewport round-trip', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should capture and restore viewport state with anchor ts_event and followLatest flag', () => {
    const view = new FootprintView();
    const container = document.createElement('div');
    view.mount(container);

    const bars = createBars(200);
    const state: ChartStoreState = { bars, cvd: new Map(), footprints: new Map() };
    view.seed(state);

    // Pan away from latest to trigger followLatest = false
    view.viewState.pan(-5);

    const captured = view.getViewportState();
    expect(captured.anchorTsEvent).not.toBeNull();
    expect(captured.followLatest).toBe(false);

    // The anchorTsEvent should match the right-edge visible bar
    const rightEdgeIndex = view.viewState.getRightEdgeBarIndex();
    expect(captured.anchorTsEvent).toBe(bars[rightEdgeIndex].ts_event);

    // Restore and verify the viewport is unchanged
    view.restoreViewportState(captured);
    const restored = view.getViewportState();
    expect(restored.anchorTsEvent).toBe(captured.anchorTsEvent);
    expect(restored.followLatest).toBe(captured.followLatest);
  });
});

describe('FootprintView clamp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should clamp out-of-range anchorTsEvent without crash', () => {
    const view = new FootprintView();
    const container = document.createElement('div');
    view.mount(container);

    const bars = createBars(10);
    const state: ChartStoreState = { bars, cvd: new Map(), footprints: new Map() };
    view.seed(state);

    // Restore with ts_event lower than any bar
    expect(() => view.restoreViewportState({ anchorTsEvent: 0, followLatest: false })).not.toThrow();

    // Restore with ts_event higher than any bar
    expect(() => view.restoreViewportState({ anchorTsEvent: 999999, followLatest: false })).not.toThrow();

    // Verify clamping worked - bars[0] for too-low, bars[last] for too-high
    const lowState = view.getViewportState();
    expect(lowState.anchorTsEvent).not.toBeNull();

    view.restoreViewportState({ anchorTsEvent: 999999, followLatest: false });
    const highState = view.getViewportState();
    expect(highState.anchorTsEvent).toBe(bars[bars.length - 1].ts_event);
  });

  it('should clamp with 1-bar data without crash', () => {
    const view = new FootprintView();
    const container = document.createElement('div');
    view.mount(container);

    const bars = createBars(1);
    const state: ChartStoreState = { bars, cvd: new Map(), footprints: new Map() };
    view.seed(state);

    expect(() => view.restoreViewportState({ anchorTsEvent: 0, followLatest: false })).not.toThrow();
    expect(view.getViewportState().anchorTsEvent).toBe(bars[0].ts_event);
  });

  it('should return null anchorTsEvent when bars array is empty', () => {
    const view = new FootprintView();
    const state = view.getViewportState();
    expect(state.anchorTsEvent).toBeNull();
    expect(state.followLatest).toBe(true);
  });
});

describe('FootprintView followLatest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should restore viewport with followLatest=true at latest bar', () => {
    const view = new FootprintView();
    const container = document.createElement('div');
    view.mount(container);

    const bars = createBars(200);
    const state: ChartStoreState = { bars, cvd: new Map(), footprints: new Map() };
    view.seed(state);

    // Pan away from latest
    view.viewState.pan(-30);
    expect(view.viewState.isAtLatest()).toBe(false);

    // Restore with followLatest=true
    view.restoreViewportState({ anchorTsEvent: null, followLatest: true });

    // Should now be at latest
    expect(view.viewState.isAtLatest()).toBe(true);
    const rightEdgeIndex = view.viewState.getRightEdgeBarIndex();
    expect(rightEdgeIndex).toBe(bars.length - 1);
  });

  it('captures verticalOffset + verticalAutoCenter in getViewportState', () => {
    const view = new FootprintView();
    view.mount(document.createElement('div'));
    view.seed({ bars: createBars(50), cvd: new Map(), footprints: new Map() });

    // Default: auto-centered, offset 0.
    let vp = view.getViewportState();
    expect(vp.verticalAutoCenter).toBe(true);
    expect(vp.verticalOffset).toBe(0);

    // After a manual pan, the state carries the offset + autoCenter=false.
    view.viewState.setVerticalContentBounds(2000, 400);
    view.viewState.panVertical(120);
    vp = view.getViewportState();
    expect(vp.verticalAutoCenter).toBe(false);
    expect(vp.verticalOffset).toBe(120);
  });

  it('restores verticalOffset (clamped) and verticalAutoCenter', () => {
    const view = new FootprintView();
    view.mount(document.createElement('div'));
    view.seed({ bars: createBars(50), cvd: new Map(), footprints: new Map() });
    view.viewState.setVerticalContentBounds(2000, 400);

    view.restoreViewportState({
      anchorTsEvent: null, followLatest: true,
      verticalOffset: 200, verticalAutoCenter: false,
    });
    expect(view.viewState.getVerticalAutoCenter()).toBe(false);
    expect(view.viewState.getVerticalOffset()).toBe(200);

    // An out-of-range offset on restore is clamped, never applied raw.
    view.viewState.setVerticalContentBounds(2000, 400);
    view.restoreViewportState({
      anchorTsEvent: null, followLatest: true,
      verticalOffset: 999999, verticalAutoCenter: false,
    });
    expect(view.viewState.getVerticalOffset()).toBeLessThan(999999);

    // autoCenter=true restores centered mode regardless of offset.
    view.restoreViewportState({
      anchorTsEvent: null, followLatest: true, verticalAutoCenter: true,
    });
    expect(view.viewState.getVerticalAutoCenter()).toBe(true);
    expect(view.viewState.getVerticalOffset()).toBe(0);
  });
});

describe('FootprintView Latest button (slice 12)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('is hidden while live, shown after horizontal or vertical drift, and returns to live on click', () => {
    const view = new FootprintView();
    const container = document.createElement('div');
    view.mount(container);
    view.seed({ bars: createBars(200), cvd: new Map(), footprints: new Map() });

    const latest = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Latest'
    ) as HTMLButtonElement;
    expect(latest).toBeDefined();
    // Live (following latest + auto-centered) => hidden.
    expect(latest.style.display).toBe('none');

    // Pan back in time => shown.
    view.viewState.pan(-40);
    view.restoreViewportState(view.getViewportState());
    expect(latest.style.display).toBe('block');

    // Click returns to latest + auto-center and hides again.
    latest.click();
    expect(view.viewState.isAtLatest()).toBe(true);
    expect(view.viewState.getVerticalAutoCenter()).toBe(true);
    expect(latest.style.display).toBe('none');

    // Vertical scroll alone also reveals it.
    view.viewState.setVerticalContentBounds(2000, 400);
    view.viewState.panVertical(120);
    view.restoreViewportState(view.getViewportState());
    expect(latest.style.display).toBe('block');
  });
});
