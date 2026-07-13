import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FootprintView } from '../../src/views/FootprintView';
import type { ChartStoreState, BarPayload, FootprintPayload } from '../../src/types';
import { formatTime } from '../../src/chart/CoordinateTransform';

function makeBars(n: number): BarPayload[] {
  const b: BarPayload[] = [];
  for (let i = 1; i <= n; i++) b.push({ ts_event: i * 60000, open: 100, high: 102, low: 99, close: 101, volume: 500 });
  return b;
}
function makeFps(n: number): Map<number, FootprintPayload> {
  const m = new Map<number, FootprintPayload>();
  for (let i = 1; i <= n; i++) m.set(i * 60000, { ts_event: i * 60000, bin_size: 0.1, levels: [{ price: 100, buy: 5, sell: 3 }] } as FootprintPayload);
  return m;
}

/** ctx mock that records fillText calls so we can assert which time labels rendered. */
function recordingCtx(texts: string[]): CanvasRenderingContext2D {
  return new Proxy({} as Record<string, unknown>, {
    get: (_t, prop) => {
      if (prop === 'fillText') return (text: string) => { texts.push(String(text)); };
      if (prop === 'measureText') return () => ({ width: 30 });
      return () => undefined;
    },
    set: () => true,
  }) as unknown as CanvasRenderingContext2D;
}

// Repro for slice 12-fix Bug B: the footprint's visibleCount window (100 bars) is
// wider than what actually fits on screen (fixed 60px columns), and the renderer
// only draws the RIGHTMOST columns that fit. That means the left portion of the
// window is never drawable -- panning fully "left" into history cannot reach the
// true oldest bars; the pan gets stuck showing bars from partway through the window.
describe('FootprintView — panning must be able to reach the oldest bar (slice 12-fix Bug B)', () => {
  let orig: typeof HTMLCanvasElement.prototype.getContext;
  let texts: string[];
  beforeEach(() => {
    texts = [];
    orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = vi.fn(() => recordingCtx(texts)) as typeof HTMLCanvasElement.prototype.getContext;
    vi.stubGlobal('ResizeObserver', vi.fn(() => ({ observe: vi.fn(), disconnect: vi.fn() })));
  });
  afterEach(() => { HTMLCanvasElement.prototype.getContext = orig; vi.clearAllMocks(); });

  function mount(width = 2000, height = 600): FootprintView {
    const v = new FootprintView();
    const c = document.createElement('div');
    Object.defineProperty(c, 'clientWidth', { value: width, configurable: true });
    Object.defineProperty(c, 'clientHeight', { value: height, configurable: true });
    c.getBoundingClientRect = () => ({ left: 0, top: 0, right: width, bottom: height, width, height, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    v.mount(c);
    return v;
  }

  it('reaches and renders the oldest bar after panning fully into history', () => {
    const v = mount();
    v.seed({ bars: makeBars(299), cvd: new Map(), footprints: makeFps(299) } as ChartStoreState);

    // Pan far past the start of history; the view should clamp at visibleStart=0.
    v.viewState.pan(-100000);
    expect(v.viewState.getVisibleBarRange().startIndex).toBe(0);

    texts.length = 0;
    v.updateFootprint({ ts_event: 1 * 60000, bin_size: 0.1, levels: [{ price: 100, buy: 5, sell: 3 }] } as FootprintPayload);

    const oldestLabel = formatTime(1 * 60000);
    expect(texts).toContain(oldestLabel);
  });

  it("the state's visibleCount matches what actually fits on screen (window == display)", () => {
    const v = mount(2000);
    v.seed({ bars: makeBars(299), cvd: new Map(), footprints: makeFps(299) } as ChartStoreState);
    const maxColumns = Math.floor((2000 - 56) / 60); // PRICE_AXIS_WIDTH / MIN_COLUMN_WIDTH
    expect(v.viewState.getVisibleBarRange().count).toBe(maxColumns);
  });
});
