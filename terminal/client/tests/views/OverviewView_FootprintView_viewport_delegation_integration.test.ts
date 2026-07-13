import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChartStoreState, BarPayload } from '../../src/types';
import type { ViewportState } from '../../src/views/ChartView';

/**
 * Integration tests for the cross-view viewport delegation boundary introduced
 * by Slice 11 (time-linked viewport).
 *
 * These exercise the interaction between:
 *   - ChartView.ViewportState interface (issue 01)
 *   - OverviewView viewport delegation (issue 04 - accepted with debt)
 *   - FootprintView viewport delegation + FootprintViewState (issue 05 / 03)
 *
 * The PRD's central behavior is that a viewport captured from one view can be
 * handed to the other view (time-linked). This suite verifies that the
 * getViewportState()/restoreViewportState() contract is honoured symmetrically
 * by both concrete views and that the handoff never crashes, including for
 * anchors that have rolled off the buffer.
 */

// OverviewView constructs a real CanvasCandlestickRenderer in mount(); stub it
// so the view can be mounted headlessly.
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
  };
});
vi.mock('../../src/renderers/CanvasCandlestickRenderer', () => ({
  CanvasCandlestickRenderer: vi.fn(() => mockRenderer),
}));

// FootprintView draws to a real <canvas>; provide a headless 2D context + a
// ResizeObserver stub, mirroring the existing FootprintView unit test harness.
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

import { OverviewView } from '../../src/views/OverviewView';
import { FootprintView } from '../../src/views/FootprintView';

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

function isViewportState(v: unknown): v is ViewportState {
  if (typeof v !== 'object' || v === null) return false;
  const s = v as Record<string, unknown>;
  const anchorOk = s.anchorTsEvent === null || typeof s.anchorTsEvent === 'number';
  return anchorOk && typeof s.followLatest === 'boolean';
}

describe('OverviewView <-> FootprintView viewport delegation (Slice 11 integration)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('both views satisfy the ViewportState delegation contract shape', () => {
    const overview = new OverviewView();
    const footprint = new FootprintView();

    expect(typeof overview.getViewportState).toBe('function');
    expect(typeof overview.restoreViewportState).toBe('function');
    expect(typeof footprint.getViewportState).toBe('function');
    expect(typeof footprint.restoreViewportState).toBe('function');

    expect(isViewportState(overview.getViewportState())).toBe(true);
    expect(isViewportState(footprint.getViewportState())).toBe(true);
  });

  it('linked handoff: viewport captured from Overview restores into Footprint', () => {
    const overview = new OverviewView();
    overview.mount(document.createElement('div'));
    overview.seed(makeState(makeBars(300)));

    // User pans Overview to a historical bar (followLatest turns off). Buffer is
    // large enough that the anchor sits before the latest bar so the view state
    // can actually represent a panned (non-following) viewport.
    const anchored: ViewportState = { anchorTsEvent: 7_000_000, followLatest: false };
    overview.restoreViewportState(anchored);

    // ViewManager (linked mode) would capture the outgoing state here...
    const captured = overview.getViewportState();
    expect(captured.anchorTsEvent).toBe(7_000_000);
    expect(captured.followLatest).toBe(false);

    // ...and restore it into the incoming Footprint view.
    const footprint = new FootprintView();
    footprint.mount(document.createElement('div'));
    footprint.seed(makeState(makeBars(300)));
    expect(() => footprint.restoreViewportState(captured)).not.toThrow();

    const restored = footprint.getViewportState();
    expect(restored.anchorTsEvent).toBe(captured.anchorTsEvent);
    expect(restored.followLatest).toBe(captured.followLatest);
  });

  it('linked handoff: Footprint -> Overview round-trips anchor and followLatest', () => {
    const footprint = new FootprintView();
    footprint.mount(document.createElement('div'));
    footprint.seed(makeState(makeBars(300)));

    const anchored: ViewportState = { anchorTsEvent: 8_200_000, followLatest: false };
    footprint.restoreViewportState(anchored);
    const captured = footprint.getViewportState();

    const overview = new OverviewView();
    overview.mount(document.createElement('div'));
    overview.seed(makeState(makeBars(300)));
    overview.restoreViewportState(captured);

    const restored = overview.getViewportState();
    expect(restored.anchorTsEvent).toBe(8_200_000);
    expect(restored.followLatest).toBe(false);
  });

  it('handoff with a followLatest=true state is accepted by both views', () => {
    const followState: ViewportState = { anchorTsEvent: null, followLatest: true };

    const overview = new OverviewView();
    overview.mount(document.createElement('div'));
    overview.seed(makeState(makeBars(5)));
    overview.restoreViewportState(followState);
    expect(overview.getViewportState().followLatest).toBe(true);

    const footprint = new FootprintView();
    footprint.mount(document.createElement('div'));
    footprint.seed(makeState(makeBars(5)));
    footprint.restoreViewportState(overview.getViewportState());
    expect(footprint.getViewportState().followLatest).toBe(true);
  });

  it('restoring an anchor for a bar that rolled off the buffer does not crash either view', () => {
    // Anchor ts_event that is far older than any bar currently held.
    const staleAnchor: ViewportState = { anchorTsEvent: 1, followLatest: false };

    const overview = new OverviewView();
    overview.mount(document.createElement('div'));
    overview.seed(makeState(makeBars(10)));
    expect(() => overview.restoreViewportState(staleAnchor)).not.toThrow();

    const footprint = new FootprintView();
    footprint.mount(document.createElement('div'));
    footprint.seed(makeState(makeBars(10)));
    expect(() => footprint.restoreViewportState(staleAnchor)).not.toThrow();

    // A future-dated anchor (beyond the newest bar) must also be tolerated.
    const futureAnchor: ViewportState = { anchorTsEvent: 999_999_999, followLatest: false };
    expect(() => overview.restoreViewportState(futureAnchor)).not.toThrow();
    expect(() => footprint.restoreViewportState(futureAnchor)).not.toThrow();
  });

  it('FootprintView seeds its FootprintViewState to the latest bar (right-edge anchoring)', () => {
    const footprint = new FootprintView();
    footprint.mount(document.createElement('div'));
    // Use more bars than the default visible window (100) so the viewport is
    // genuinely scrolled to the tail rather than showing the whole buffer.
    const bars = makeBars(300);
    footprint.seed(makeState(bars));

    // FootprintView delegates visible-range bookkeeping to FootprintViewState.
    // After seeding, the right edge must sit on the newest bar with follow ON.
    expect(footprint.viewState.getRightEdgeBarIndex()).toBe(bars.length - 1);
    expect(footprint.viewState.getFollowLatest()).toBe(true);
  });

  it('FootprintViewState right-edge repositioning inside FootprintView toggles followLatest off', () => {
    const footprint = new FootprintView();
    footprint.mount(document.createElement('div'));
    const bars = makeBars(300);
    footprint.seed(makeState(bars));

    // Move the right edge back to a historical bar (as a pan/restore would).
    footprint.viewState.setRightEdgeBarIndex(150);
    expect(footprint.viewState.getRightEdgeBarIndex()).toBe(150);
    expect(footprint.viewState.getFollowLatest()).toBe(false);

    // Returning to the newest bar re-enables follow.
    footprint.viewState.setRightEdgeBarIndex(bars.length - 1);
    expect(footprint.viewState.getFollowLatest()).toBe(true);
  });

  it('FootprintViewState clamps an out-of-range right-edge index without throwing', () => {
    const footprint = new FootprintView();
    footprint.mount(document.createElement('div'));
    const bars = makeBars(300);
    footprint.seed(makeState(bars));

    expect(() => footprint.viewState.setRightEdgeBarIndex(9999)).not.toThrow();
    const idx = footprint.viewState.getRightEdgeBarIndex();
    // Clamped to the latest valid bar rather than overrunning the buffer.
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(idx).toBeLessThanOrEqual(bars.length - 1);
  });
});
