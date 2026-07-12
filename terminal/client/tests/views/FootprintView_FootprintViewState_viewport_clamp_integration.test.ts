import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FootprintView } from '../../src/views/FootprintView';
import { FootprintViewState } from '../../src/views/FootprintViewState';
import { ViewType, type ViewportState } from '../../src/views/ChartView';
import type { ChartStoreState, BarPayload } from '../../src/types';

/**
 * Integration tests for the Slice 11 conflict-resolution area in FootprintView
 * and FootprintViewState.
 *
 * Branch merge: `feature/slice11e32ecd-linked-viewport-persistence` (complete
 * anchor-based impl with binarySearchClosest) was kept over
 * `feature/slice11f20826-linked-by-time-viewport` (stub returning
 * {anchorTsEvent:null, followLatest:true} / no-op restore).
 *
 * The duplicate FootprintViewState.getRightEdgeBarIndex/setRightEdgeBarIndex/
 * getFollowLatest/setFollowLatest pairs were collapsed to the robust e32ecd
 * variant (returns -1 for an empty buffer; setRightEdgeBarIndex updates
 * followLatest). These tests lock that resolved behaviour down end-to-end.
 */

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
    measureText: vi.fn(() => ({ width: 10 } as TextMetrics)),
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

function createBars(count: number, startTs = 1000, step = 1000): BarPayload[] {
  const bars: BarPayload[] = [];
  for (let i = 0; i < count; i++) {
    bars.push({ ts_event: startTs + i * step, open: 100, high: 101, low: 99, close: 100, volume: 1000 });
  }
  return bars;
}

function makeState(bars: BarPayload[]): ChartStoreState {
  return { bars, cvd: new Map(), footprints: new Map() };
}

describe('FootprintView.restoreViewportState binarySearchClosest (conflict area: e32ecd retained)', () => {
  // Use > DEFAULT_VISIBLE_BARS (100) so the visible window can actually scroll.
  const BARS = 300;

  beforeEach(() => vi.clearAllMocks());

  it('snaps an exact-bar anchor to that bar (right edge == requested index)', () => {
    const view = new FootprintView();
    view.mount(document.createElement('div'));
    const bars = createBars(BARS);
    view.seed(makeState(bars));

    // Anchor exactly on bar[150] -> binarySearchClosest finds it exactly.
    view.restoreViewportState({ anchorTsEvent: bars[150].ts_event, followLatest: false });

    const rightEdgeIndex = view.viewState.getRightEdgeBarIndex();
    expect(rightEdgeIndex).toBe(150);
    expect(view.getViewportState().anchorTsEvent).toBe(bars[150].ts_event);
  });

  it('snaps an off-grid anchor to the closer of two surrounding bars', () => {
    const view = new FootprintView();
    view.mount(document.createElement('div'));
    const bars = createBars(BARS);
    view.seed(makeState(bars));

    // bars[100]=101000, bars[101]=102000; anchor 101200 is closer to bar[100].
    view.restoreViewportState({ anchorTsEvent: bars[100].ts_event + 200, followLatest: false });

    const rightEdgeIndex = view.viewState.getRightEdgeBarIndex();
    // setRightEdgeBarIndex(100) -> visibleStart = 100 - 100 + 1 = 1 -> right edge = 100.
    expect(rightEdgeIndex).toBe(100);
  });

  it('clamps an out-of-range low anchor to the oldest reachable window', () => {
    const view = new FootprintView();
    view.mount(document.createElement('div'));
    const bars = createBars(BARS);
    view.seed(makeState(bars));

    expect(() => view.restoreViewportState({ anchorTsEvent: 0, followLatest: false })).not.toThrow();
    // Requesting index 0 with a 100-bar window clamps the right edge to bar 99
    // (leftmost scrollable position), and followLatest flips off.
    expect(view.viewState.getRightEdgeBarIndex()).toBe(99);
    expect(view.viewState.getFollowLatest()).toBe(false);
  });

  it('clamps an out-of-range high anchor to the newest bar', () => {
    const view = new FootprintView();
    view.mount(document.createElement('div'));
    const bars = createBars(BARS);
    view.seed(makeState(bars));

    expect(() => view.restoreViewportState({ anchorTsEvent: 9_999_999, followLatest: false })).not.toThrow();
    expect(view.viewState.getRightEdgeBarIndex()).toBe(BARS - 1);
    expect(view.getViewportState().anchorTsEvent).toBe(bars[BARS - 1].ts_event);
  });

  it('followLatest=true overrides the anchor and restores to the latest bar', () => {
    const view = new FootprintView();
    view.mount(document.createElement('div'));
    const bars = createBars(BARS);
    view.seed(makeState(bars));

    view.viewState.setRightEdgeBarIndex(50);
    expect(view.viewState.getFollowLatest()).toBe(false);

    view.restoreViewportState({ anchorTsEvent: 12345, followLatest: true });

    expect(view.viewState.getFollowLatest()).toBe(true);
    expect(view.viewState.getRightEdgeBarIndex()).toBe(BARS - 1);
  });
});

describe('FootprintViewState retained-variant right-edge accessors (conflict area: dedupe)', () => {
  it('getRightEdgeBarIndex returns -1 for an empty buffer (e32ecd variant)', () => {
    const state = new FootprintViewState(0);
    expect(state.getRightEdgeBarIndex()).toBe(-1);
  });

  it('setRightEdgeBarIndex is a no-op on an empty buffer (e32ecd variant)', () => {
    const state = new FootprintViewState(0);
    state.setRightEdgeBarIndex(42);
    expect(state.getRightEdgeBarIndex()).toBe(-1);
  });

  it('setRightEdgeBarIndex updates followLatest to false when moved off the tail', () => {
    const state = new FootprintViewState(200, 100);
    expect(state.getFollowLatest()).toBe(true);

    state.setRightEdgeBarIndex(120);
    expect(state.getFollowLatest()).toBe(false);
  });

  it('setRightEdgeBarIndex updates followLatest to true when repositioned at the tail', () => {
    const state = new FootprintViewState(200, 100);
    state.setRightEdgeBarIndex(120);
    expect(state.getFollowLatest()).toBe(false);

    state.setRightEdgeBarIndex(199);
    expect(state.getFollowLatest()).toBe(true);
  });

  it('full round-trip through FootprintView delegates to FootprintViewState', () => {
    const view = new FootprintView();
    view.mount(document.createElement('div'));
    const bars = createBars(300);
    view.seed(makeState(bars));

    view.viewState.setRightEdgeBarIndex(150);
    const captured: ViewportState = view.getViewportState();
    expect(captured.anchorTsEvent).toBe(bars[150].ts_event);
    expect(captured.followLatest).toBe(false);

    view.restoreViewportState(captured);
    expect(view.viewState.getRightEdgeBarIndex()).toBe(150);
    expect(view.getViewportState().anchorTsEvent).toBe(bars[150].ts_event);
  });
});

describe('FootprintView ViewportState contract shape', () => {
  it('exposes getViewportState/restoreViewportState and a well-formed ViewportState', () => {
    const view = new FootprintView();
    view.mount(document.createElement('div'));
    const state = view.getViewportState();
    expect(typeof state.anchorTsEvent === 'number' || state.anchorTsEvent === null).toBe(true);
    expect(typeof state.followLatest).toBe('boolean');
    expect(view.getType()).toBe(ViewType.Footprint);
  });
});
