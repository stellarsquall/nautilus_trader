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
});