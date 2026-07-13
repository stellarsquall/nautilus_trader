import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ViewManager } from '../../src/views/ViewManager';
import { ViewType, type ChartView } from '../../src/views/ChartView';
import type { ChartStore } from '../../src/store/ChartStore';
import type { ChartStoreState, BarPayload } from '../../src/types';

/**
 * Regression for the video-reported bug (2026-07-13): zoom + pan the Overview
 * away from latest, switch to Footprint (untouched), switch back to Overview
 * -- Overview incorrectly snapped to true latest, discarding the zoom+pan.
 *
 * Root cause (found via this real-classes repro, not static reading):
 * CanvasCandlestickRenderer.restoreViewportState() calls
 * ChartViewState.setVisibleCount() (restoring the Overview's own saved zoom)
 * BEFORE checking state.followLatest. setVisibleCount() never repositions or
 * touches followLatest, so on a freshly-constructed ChartViewState (followLatest
 * defaults true, positioned at the tail) it can silently take the state OFF the
 * tail while followLatest stays (stale) true. The subsequent restore then calls
 * pan(delta) to reach the historical anchor -- but ChartViewState.pan() only
 * flips followLatest on a wasAtTail -> nowAtTail TRANSITION; since the state was
 * already (dishonestly) off-tail before this pan() call, no transition is seen
 * and the stale followLatest=true survives. CanvasCandlestickRenderer's render
 * loop (updateVisibleRange) ignores visibleStart entirely whenever followLatest
 * is true and always renders the true tail -- so the Overview visually snaps to
 * latest even though visibleStart/anchorTsEvent were computed correctly.
 *
 * Fix: restoreViewportState() now explicitly sets followLatest=false in the
 * anchorTsEvent branch instead of relying on pan()'s implicit transition
 * detection (mirrors FootprintViewState.setRightEdgeBarIndex, which already
 * recomputes followLatest unconditionally from isAtLatest()).
 */

function makeBar(ts: number): BarPayload {
  return { ts_event: ts, open: 100, high: 102, low: 99, close: 101, volume: 500 };
}
function createBars(count: number, startTs = 1_000_000, step = 60_000): BarPayload[] {
  const bars: BarPayload[] = [];
  for (let i = 0; i < count; i++) bars.push(makeBar(startTs + i * step));
  return bars;
}
function makeState(bars: BarPayload[]): ChartStoreState {
  return { bars, cvd: new Map(), footprints: new Map() };
}

const mockCtx = {
  canvas: {} as HTMLCanvasElement,
  clearRect: vi.fn(), fillRect: vi.fn(), fillText: vi.fn(), strokeRect: vi.fn(),
  beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), fill: vi.fn(),
  arc: vi.fn(), setTransform: vi.fn(), save: vi.fn(), restore: vi.fn(), scale: vi.fn(),
  clip: vi.fn(), rect: vi.fn(), measureText: vi.fn(() => ({ width: 50 })), setLineDash: vi.fn(),
  font: '', textAlign: 'start' as CanvasTextAlign, textBaseline: 'alphabetic' as CanvasTextBaseline,
  fillStyle: '', strokeStyle: '', lineWidth: 1,
} as unknown as CanvasRenderingContext2D;

describe('Overview zoom+pan survives a round-trip through Footprint (slice 12-fix Bug D)', () => {
  let container: HTMLElement;
  let orig: typeof HTMLCanvasElement.prototype.getContext;
  let factoryState: { overviewView: ChartView | null; footprintView: ChartView | null };

  beforeEach(async () => {
    container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', { writable: true, value: 2000 });
    Object.defineProperty(container, 'clientHeight', { writable: true, value: 600 });
    orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = vi.fn((t: string) =>
      (t === '2d' ? mockCtx : null),
    ) as typeof HTMLCanvasElement.prototype.getContext;
    vi.stubGlobal('ResizeObserver', vi.fn(() => ({ observe: vi.fn(), disconnect: vi.fn() })));
    factoryState = { overviewView: null, footprintView: null };
  });
  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = orig;
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  it('Overview stays at its zoomed/panned historical position after switching to Footprint and back', async () => {
    const bars = createBars(299);
    const state = makeState(bars);
    const store = {
      getState: vi.fn(() => state),
      getBarCount: vi.fn(() => bars.length),
      ingestBar: vi.fn(), ingestCvd: vi.fn(), ingestFootprint: vi.fn(),
    } as unknown as ChartStore;
    const { OverviewView } = await import('../../src/views/OverviewView');
    const { FootprintView } = await import('../../src/views/FootprintView');
    const vm = new ViewManager(store, container, (type: ViewType) => {
      if (type === ViewType.Overview) {
        const v = new OverviewView();
        factoryState.overviewView = v;
        return v;
      }
      const v = new FootprintView();
      factoryState.footprintView = v;
      return v;
    });

    vm.switchToView(ViewType.Overview);
    const ov = factoryState.overviewView!;
    // @ts-expect-error accessing the private renderer/viewState for a real-classes repro
    const ovState = ov.renderer.viewState;

    // Real interactive zoom (mouse-wheel path: InteractionController -> zoom())
    // followed by a real interactive pan into history -- exactly what the video
    // reproduction did.
    ovState.zoom(0.2, ovState.getState().visibleStart + 50);
    ovState.pan(-150);
    expect(ovState.getFollowLatest()).toBe(false);
    const historicalAnchor = ov.getViewportState().anchorTsEvent;
    expect(historicalAnchor).not.toBe(bars[bars.length - 1].ts_event);

    vm.switchToView(ViewType.Footprint); // untouched -- just look, don't interact
    vm.switchToView(ViewType.Overview); // switch back

    const ov2 = factoryState.overviewView!;
    const restoredState = ov2.getViewportState();
    expect(restoredState.followLatest).toBe(false);
    expect(restoredState.anchorTsEvent).toBe(historicalAnchor);
  });
});
