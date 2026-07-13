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

describe('FootprintView renders the latest columns when the window overflows', () => {
  let orig: typeof HTMLCanvasElement.prototype.getContext;
  let texts: string[];
  beforeEach(() => {
    texts = [];
    orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = vi.fn(() => recordingCtx(texts)) as typeof HTMLCanvasElement.prototype.getContext;
    vi.stubGlobal('ResizeObserver', vi.fn(() => ({ observe: vi.fn(), disconnect: vi.fn() })));
  });
  afterEach(() => { HTMLCanvasElement.prototype.getContext = orig; vi.clearAllMocks(); });

  it('shows the newest bar at the right edge even with a large visible-count window', () => {
    const v = new FootprintView();
    const c = document.createElement('div');
    // 800px canvas: floor((800-56)/60) = 12 columns fit, but the window is 100.
    Object.defineProperty(c, 'clientWidth', { value: 800, configurable: true });
    Object.defineProperty(c, 'clientHeight', { value: 600, configurable: true });
    c.getBoundingClientRect = () => ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    v.mount(c);
    texts.length = 0;
    v.seed({ bars: makeBars(299), cvd: new Map(), footprints: makeFps(299) } as ChartStoreState);

    const latestLabel = formatTime(299 * 60000); // newest bar's column header
    const oldWindowLabel = formatTime(200 * 60000); // a bar from the left of the 100-window
    expect(texts).toContain(latestLabel);      // newest column IS drawn (right edge)
    expect(texts).not.toContain(oldWindowLabel); // the far-left overflow is NOT drawn
  });
});
