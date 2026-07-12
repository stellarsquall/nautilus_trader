import { describe, it, expect, vi } from 'vitest';
import { ViewManager } from '../../src/views/ViewManager';
import { ViewType } from '../../src/views/ChartView';
import type { ChartView, ViewportState } from '../../src/views/ChartView';

function makeFakeView(type: ViewType, ui: unknown): ChartView {
  return {
    mount: vi.fn(),
    seed: vi.fn(),
    updateBar: vi.fn(),
    updateCvd: vi.fn(),
    updateFootprint: vi.fn(),
    destroy: vi.fn(),
    getType: () => type,
    getLegendEntries: () => [],
    getViewportState: (): ViewportState => ({ anchorTsEvent: null, followLatest: true }),
    restoreViewportState: vi.fn(),
    getUiState: () => ui,
    restoreUiState: vi.fn(),
  } as unknown as ChartView;
}

describe('ViewManager UI-state persistence (slice 11)', () => {
  const store = { getState: () => ({ bars: [], cvd: new Map(), footprints: new Map() }) } as never;

  it('captures each view UI state on switch-out and restores it per-view on switch-in', () => {
    const container = document.createElement('div');
    const overviewUi = { colorByDelta: false, vpVisible: false, vaVisible: false, legendVisible: true };
    const footUi = { imbalanceVisible: false, legendVisible: true };
    const overviews: ChartView[] = [];
    const foots: ChartView[] = [];
    const factory = (t: ViewType): ChartView => {
      if (t === ViewType.Overview) { const v = makeFakeView(t, overviewUi); overviews.push(v); return v; }
      const v = makeFakeView(t, footUi); foots.push(v); return v;
    };
    const vm = new ViewManager(store, container, factory);

    vm.switchToView(ViewType.Overview);   // overview #0
    vm.switchToView(ViewType.Footprint);  // captures overview#0 UI; mounts foot#0
    vm.switchToView(ViewType.Overview);   // captures foot#0 UI; mounts overview#1 -> restore overview UI

    // A freshly-created Overview gets the previously-captured Overview UI state.
    expect(overviews[1].restoreUiState).toHaveBeenCalledWith(overviewUi);
    // ...and NOT the Footprint's UI state (UI is per-view, never linked).
    expect(overviews[1].restoreUiState).not.toHaveBeenCalledWith(footUi);

    vm.switchToView(ViewType.Footprint);  // mounts foot#1 -> restore foot UI
    expect(foots[1].restoreUiState).toHaveBeenCalledWith(footUi);
  });

  it('first visit to a view (no prior UI state) does not call restoreUiState', () => {
    const container = document.createElement('div');
    const v = makeFakeView(ViewType.Overview, { colorByDelta: true });
    const vm = new ViewManager(store, container, () => v);
    vm.switchToView(ViewType.Overview);
    expect(v.restoreUiState).not.toHaveBeenCalled();
  });
});
