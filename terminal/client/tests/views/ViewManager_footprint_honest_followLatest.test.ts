import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ViewManager } from '../../src/views/ViewManager';
import { ViewType, type ChartView } from '../../src/views/ChartView';
import type { ChartStore } from '../../src/store/ChartStore';
import type { ChartStoreState, BarPayload } from '../../src/types';
import type { FootprintView as FootprintViewClass } from '../../src/views/FootprintView';

/**
 * Repro for slice 12-fix Bug C: switching from a Footprint view that has been
 * PANNED AWAY from latest must NOT force the incoming Overview to latest.
 * Before the fix, the footprint's getViewportState().followLatest could lie
 * (stay true) once totalBars grew past the visible window without the tail
 * advancing -- ViewManager trusts that flag verbatim (see AC-8/AC-9 tests),
 * so a dishonest true forced the Overview to latest even when the user had
 * panned the footprint into history.
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

describe('ViewManager — footprint honest followLatest (slice 12-fix Bug C guard)', () => {
  let container: HTMLElement;
  let originalGetContext: typeof HTMLCanvasElement.prototype.getContext;
  let factoryState: { overviewView: ChartView | null; footprintView: ChartView | null };

  beforeEach(async () => {
    container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', { writable: true, value: 2000 });
    Object.defineProperty(container, 'clientHeight', { writable: true, value: 600 });
    originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = vi.fn((type: string) =>
      type === '2d' ? mockCtx : null,
    ) as typeof HTMLCanvasElement.prototype.getContext;
    vi.stubGlobal('ResizeObserver', vi.fn(() => ({ observe: vi.fn(), disconnect: vi.fn() })));
    factoryState = { overviewView: null, footprintView: null };
  });
  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  let footprintInstance: FootprintViewClass | null = null;

  async function makeManager(bars: BarPayload[]): Promise<{ vm: ViewManager; bars: BarPayload[] }> {
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
        const view = new OverviewView();
        factoryState.overviewView = view;
        return view;
      }
      const view = new FootprintView();
      factoryState.footprintView = view;
      footprintInstance = view;
      return view;
    });
    return { vm, bars };
  }

  it('a footprint genuinely at latest correctly carries the Overview to latest on switch', async () => {
    const bars = createBars(150);
    const { vm } = await makeManager(bars);
    vm.switchToView(ViewType.Footprint); // starts at latest by default
    expect(factoryState.footprintView!.getViewportState().followLatest).toBe(true);

    vm.switchToView(ViewType.Overview);
    expect(factoryState.overviewView!.getViewportState().followLatest).toBe(true);
  });

  it('a footprint that silently drifted past its visible window (no explicit pan) must not report a stale bar as "latest"', async () => {
    // Reproduces the real streaming path: seed with 100 bars (visibleCount=100,
    // so the window exactly covers the seed), then 60 NEW bars arrive one at a
    // time via updateBar -- exactly what happens with a live feed. The user
    // never pans. Before the fix, the window silently freezes at the original
    // seed's right edge while followLatest stays (dishonestly) true.
    const seedBars = createBars(100);
    const { vm } = await makeManager(seedBars);
    vm.switchToView(ViewType.Footprint);
    expect(footprintInstance!.viewState.getFollowLatest()).toBe(true);

    let lastTs = seedBars[seedBars.length - 1].ts_event;
    for (let i = 0; i < 60; i++) {
      lastTs += 60_000;
      const newBar = makeBar(lastTs);
      seedBars.push(newBar); // mirror real flow: chartStore.ingestBar() + viewManager.updateBar()
      footprintInstance!.updateBar(newBar);
    }

    // The footprint must still be honestly at latest -- its right edge must be
    // the bar that JUST arrived, not the stale seed-time edge.
    expect(footprintInstance!.viewState.getFollowLatest()).toBe(true);
    expect(footprintInstance!.viewState.isAtLatest()).toBe(true);
    const fpAnchor = footprintInstance!.getViewportState().anchorTsEvent;
    expect(fpAnchor).toBe(lastTs);

    // And switching to the (linked) Overview must land on that same true latest
    // moment, not a stale one.
    vm.switchToView(ViewType.Overview);
    const ovState = factoryState.overviewView!.getViewportState();
    expect(ovState.followLatest).toBe(true);
    expect(ovState.anchorTsEvent).toBe(lastTs);
  });

  it('a footprint deliberately panned away from latest must NOT force Overview to latest, even after new bars keep arriving', async () => {
    const bars = createBars(150);
    const { vm } = await makeManager(bars);
    vm.switchToView(ViewType.Footprint);

    // User pans away from the tail (real drag path, not a restore).
    footprintInstance!.viewState.pan(-40);
    expect(footprintInstance!.viewState.getFollowLatest()).toBe(false);
    const edgeBeforeGrowth = footprintInstance!.viewState.getRightEdgeBarIndex();

    // New bars keep streaming in (updateBar), as they would live.
    for (let i = 0; i < 10; i++) {
      footprintInstance!.updateBar(bars[bars.length - 1]);
    }

    // Still panned away: the flag must stay honest and the position must not
    // silently snap back toward latest.
    expect(footprintInstance!.viewState.getFollowLatest()).toBe(false);
    expect(footprintInstance!.viewState.getRightEdgeBarIndex()).toBe(edgeBeforeGrowth);

    vm.switchToView(ViewType.Overview);
    expect(factoryState.overviewView!.getViewportState().followLatest).toBe(false);
  });
});
