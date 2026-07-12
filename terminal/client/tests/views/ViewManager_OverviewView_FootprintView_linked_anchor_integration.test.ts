import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ViewManager } from '../../src/views/ViewManager';
import { ViewType, type ChartView, type ViewportState } from '../../src/views/ChartView';
import type { ChartStore } from '../../src/store/ChartStore';
import type { ChartStoreState, BarPayload } from '../../src/types';

/**
 * Cross-feature integration test (Priority 2) for the Slice 11 merge boundary:
 *
 *   ViewManager <-> OverviewView <-> CanvasCandlestickRenderer
 *   ViewManager <-> FootprintView  <-> FootprintViewState
 *
 * AC-8/AC-9 exercise the full linked vs independent switch path with REAL views
 * (no mocks of the viewport state machinery). The Overview view is positioned at
 * a historical (non-latest) bar via restoreViewportState, then a view switch is
 * performed and the incoming view's right-edge ts_event is asserted to match the
 * shared anchor (linked) or its own saved state (independent).
 */

function makeBar(ts: number): BarPayload {
  return { ts_event: ts, open: 100, high: 102, low: 99, close: 101, volume: 500 };
}

function createBars(count: number, startTs = 1_000_000, step = 60_000): BarPayload[] {
  const bars: BarPayload[] = [];
  for (let i = 0; i < count; i++) {
    bars.push(makeBar(startTs + i * step));
  }
  return bars;
}

function makeState(bars: BarPayload[]): ChartStoreState {
  return { bars, cvd: new Map(), footprints: new Map() };
}

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
  scale: vi.fn(),
  clip: vi.fn(),
  rect: vi.fn(),
  measureText: vi.fn(() => ({ width: 50 })),
  setLineDash: vi.fn(),
  font: '',
  textAlign: 'start' as CanvasTextAlign,
  textBaseline: 'alphabetic' as CanvasTextBaseline,
  fillStyle: '',
  strokeStyle: '',
  lineWidth: 1,
} as unknown as CanvasRenderingContext2D;

describe('ViewManager linked/independent anchor propagation with real views (Priority 2: cross-feature)', () => {
  let container: HTMLElement;
  let originalGetContext: typeof HTMLCanvasElement.prototype.getContext;
  let factoryState: { overviewView: ChartView | null; footprintView: ChartView | null };

  beforeEach(async () => {
    container = document.createElement('div');
    container.style.width = '800px';
    container.style.height = '600px';
    Object.defineProperty(container, 'clientWidth', { writable: true, value: 800 });
    Object.defineProperty(container, 'clientHeight', { writable: true, value: 600 });

    originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = vi.fn((type: string) =>
      type === '2d' ? mockCtx : null,
    ) as typeof HTMLCanvasElement.prototype.getContext;

    vi.stubGlobal('ResizeObserver', vi.fn(() => ({
      observe: vi.fn(),
      disconnect: vi.fn(),
    })));

    factoryState = { overviewView: null, footprintView: null };
  });

  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  async function makeManager(bars: BarPayload[]): Promise<ViewManager> {
    const state = makeState(bars);
    const store = {
      getState: vi.fn(() => state),
      getBarCount: vi.fn(() => bars.length),
      ingestBar: vi.fn(),
      ingestCvd: vi.fn(),
      ingestFootprint: vi.fn(),
    } as unknown as ChartStore;

    const { OverviewView } = await import('../../src/views/OverviewView');
    const { FootprintView } = await import('../../src/views/FootprintView');

    return new ViewManager(store, container, (type: ViewType) => {
      if (type === ViewType.Overview) {
        const view = new OverviewView();
        factoryState.overviewView = view;
        return view;
      }
      const view = new FootprintView();
      factoryState.footprintView = view;
      return view;
    });
  }

  it('AC-8: linked mode propagates Overview historical anchor to Footprint', async () => {
    const bars = createBars(200);
    const vm = await makeManager(bars);

    // Position Overview at a historical bar.
    vm.switchToView(ViewType.Overview);
    factoryState.overviewView!.restoreViewportState({ anchorTsEvent: bars[40].ts_event, followLatest: false });

    // Capture whatever right-edge ts_event the Overview resolved to.
    const overviewAnchor = factoryState.overviewView!.getViewportState();
    expect(overviewAnchor.followLatest).toBe(false);

    // Switch to Footprint — linked default captures shared anchor and restores
    // it, so the Footprint's right-edge ts_event must match the Overview's
    // (time-linked: both views land on the same point in time).
    vm.switchToView(ViewType.Footprint);
    const fpState = factoryState.footprintView!.getViewportState();
    expect(fpState.anchorTsEvent).toBe(overviewAnchor.anchorTsEvent);
  });

  it('AC-9: independent mode restores Footprint from its own saved state, not the shared anchor', async () => {
    const bars = createBars(200);
    const vm = await makeManager(bars);
    vm.setLinkViews(false);

    // Overview positioned at a historical bar (its own saved state).
    vm.switchToView(ViewType.Overview);
    factoryState.overviewView!.restoreViewportState({ anchorTsEvent: bars[30].ts_event, followLatest: false });

    // Switch to Footprint. In independent mode the sharedAnchor must NOT be used;
    // Footprint has no prior saved state, so it stays at default (latest).
    vm.switchToView(ViewType.Footprint);
    const fpState = factoryState.footprintView!.getViewportState();
    expect(fpState.anchorTsEvent).toBe(bars[bars.length - 1].ts_event);
    expect(fpState.followLatest).toBe(true);
  });

  it('AC-9b: independent mode keeps each view at its own distinct saved anchor across switches', async () => {
    const bars = createBars(300);
    const vm = await makeManager(bars);
    vm.setLinkViews(false);

    vm.switchToView(ViewType.Overview);
    factoryState.overviewView!.restoreViewportState({ anchorTsEvent: bars[20].ts_event, followLatest: false });
    const overviewAnchor = factoryState.overviewView!.getViewportState().anchorTsEvent;

    vm.switchToView(ViewType.Footprint);
    factoryState.footprintView!.restoreViewportState({ anchorTsEvent: bars[120].ts_event, followLatest: false });
    const fpAnchor = factoryState.footprintView!.getViewportState().anchorTsEvent;

    // Switch back to Overview — must restore Overview's own saved anchor, not Footprint's.
    vm.switchToView(ViewType.Overview);
    expect(factoryState.overviewView!.getViewportState().anchorTsEvent).toBe(overviewAnchor);

    // Switch to Footprint — must restore Footprint's own saved anchor, not Overview's.
    vm.switchToView(ViewType.Footprint);
    expect(factoryState.footprintView!.getViewportState().anchorTsEvent).toBe(fpAnchor);
  });

  it('AC-10: first switch with no prior state leaves the view at latest', async () => {
    const bars = createBars(80);
    const vm = await makeManager(bars);

    vm.switchToView(ViewType.Footprint);
    const state = factoryState.footprintView!.getViewportState();
    expect(state.anchorTsEvent).toBe(bars[bars.length - 1].ts_event);
    expect(state.followLatest).toBe(true);
  });

  it('ChartViewState.setRightEdgeBarIndex variant retained from merge updates followLatest (conflict area)', async () => {
    const { ChartViewState } = await import('../../src/chart/ChartViewState');
    const vs = new ChartViewState(200, 100);
    expect(vs.getFollowLatest()).toBe(true);

    vs.setRightEdgeBarIndex(120);
    expect(vs.getFollowLatest()).toBe(false);

    vs.setRightEdgeBarIndex(199);
    expect(vs.getFollowLatest()).toBe(true);
  });
});
