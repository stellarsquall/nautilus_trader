import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ChartStore, MAX_BARS } from '../../src/store/ChartStore.js';
import { ViewManager } from '../../src/views/ViewManager';
import { ViewType, type ChartView } from '../../src/views/ChartView';
import { ViewToggleButton, type ViewType as ToggleViewType } from '../../src/ui/ViewToggleButton.js';
import type { BarPayload, CvdPayload, FootprintPayload, ChartStoreState } from '../../src/types';

const mockRenderer = vi.hoisted(() => ({
  update: vi.fn(),
  updateCvd: vi.fn(),
  updateFootprint: vi.fn(),
  destroy: vi.fn(),
  getViewportState: vi.fn(() => ({ anchorTsEvent: null, followLatest: true })),
  restoreViewportState: vi.fn(),
  getColorByDelta: vi.fn(() => true),
  setColorByDelta: vi.fn(),
  isVolumeProfileVisible: vi.fn(() => true),
  setVolumeProfileVisible: vi.fn(),
  isValueAreaVisible: vi.fn(() => true),
  setValueAreaVisible: vi.fn(),
}));

vi.mock('../../src/renderers/CanvasCandlestickRenderer', () => ({
  CanvasCandlestickRenderer: vi.fn(() => mockRenderer),
}));

import { OverviewView } from '../../src/views/OverviewView';

function makeBar(ts_event: number, open = 100): BarPayload {
  return { ts_event, open, high: open + 1, low: open - 1, close: open + 0.5, volume: 1000 };
}

function makeCvd(ts_event: number, cvd = 0, delta = 0): CvdPayload {
  return { ts_event, cvd, delta };
}

function makeFootprint(ts_event: number): FootprintPayload {
  return { ts_event, bin_size: 60000, levels: [{ price: 100, buy: 50, sell: 30 }] };
}

function createOverviewFactory(): () => ChartView {
  return () => new OverviewView();
}

function createFootprintMockFactory(): () => ChartView {
  return () => ({
    mount: vi.fn(),
    seed: vi.fn(),
    updateBar: vi.fn(),
    updateCvd: vi.fn(),
    updateFootprint: vi.fn(),
    destroy: vi.fn(),
    getType: vi.fn(() => ViewType.Footprint),
    getViewportState: vi.fn(() => ({ anchorTsEvent: null, followLatest: true })),
    restoreViewportState: vi.fn(),
  });
}

describe('Priority 1: ViewToggleButton + ViewManager + OverviewView end-to-end', () => {
  let container: HTMLDivElement;
  let store: ChartStore;
  let vm: ViewManager;
  let toggle: ViewToggleButton;

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement('div');
    document.body.appendChild(container);
    store = new ChartStore();
    vm = new ViewManager(store, container, (type: ViewType) => {
      if (type === ViewType.Overview) return new OverviewView();
      return createFootprintMockFactory()();
    });
    toggle = new ViewToggleButton(container, {
      onViewSwitch: (viewType: ToggleViewType) => {
        const chartViewType = viewType === 'overview' ? ViewType.Overview : ViewType.Footprint;
        vm.switchToView(chartViewType);
        toggle.setViewType(viewType);
      },
    });
  });

  afterEach(() => {
    toggle.destroy();
    vm.destroy();
    if (container.parentNode) {
      container.parentNode.removeChild(container);
    }
  });

  it('should start with OverviewView mounted and Overview as toggle label', () => {
    vm.switchToView(ViewType.Overview);
    expect(vm.getCurrentViewType()).toBe(ViewType.Overview);
    expect(container.querySelector('button')!.textContent).toBe('Overview');
  });

  it('should switch to Footprint and update toggle label on first click', () => {
    vm.switchToView(ViewType.Overview);
    const button = container.querySelector('button')!;
    button.click();
    expect(vm.getCurrentViewType()).toBe(ViewType.Footprint);
    expect(button.textContent).toBe('Footprint');
  });

  it('should switch back to Overview and update toggle label on second click', () => {
    vm.switchToView(ViewType.Overview);
    const button = container.querySelector('button')!;
    button.click();
    button.click();
    expect(vm.getCurrentViewType()).toBe(ViewType.Overview);
    expect(button.textContent).toBe('Overview');
  });

  it('should pass bar updates to OverviewView after toggling back', () => {
    vm.switchToView(ViewType.Overview);
    vm.updateBar(makeBar(100));
    expect(mockRenderer.update).toHaveBeenCalledTimes(1);

    const button = container.querySelector('button')!;
    button.click();
    button.click();
    expect(vm.getCurrentViewType()).toBe(ViewType.Overview);
    vm.updateBar(makeBar(200));
    expect(mockRenderer.update).toHaveBeenCalledTimes(2);
  });

  it('should seed OverviewView with full store state when initially mounted', () => {
    store.ingestBar(makeBar(100));
    store.ingestCvd(makeCvd(100, 500, 10));
    store.ingestFootprint(makeFootprint(100));
    store.ingestBar(makeBar(200));

    vm.switchToView(ViewType.Overview);

    expect(mockRenderer.update).toHaveBeenCalledTimes(2);
    expect(mockRenderer.updateCvd).toHaveBeenCalledTimes(1);
    expect(mockRenderer.updateFootprint).toHaveBeenCalledTimes(1);
  });

  it('should seed OverviewView with fresh store state when toggling back', () => {
    vm.switchToView(ViewType.Overview);
    store.ingestBar(makeBar(100));
    store.ingestCvd(makeCvd(100, 500, 10));
    store.ingestFootprint(makeFootprint(100));

    const button = container.querySelector('button')!;
    button.click();
    button.click();

    expect(mockRenderer.update).toHaveBeenCalledTimes(1);
    expect(mockRenderer.updateCvd).toHaveBeenCalledTimes(1);
    expect(mockRenderer.updateFootprint).toHaveBeenCalledTimes(1);
  });
});

describe('Priority 2: ViewManager routes all data types to real OverviewView', () => {
  let container: HTMLDivElement;
  let store: ChartStore;
  let vm: ViewManager;

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement('div');
    document.body.appendChild(container);
    store = new ChartStore();
    vm = new ViewManager(store, container, (type: ViewType) => {
      if (type === ViewType.Overview) return new OverviewView();
      return createFootprintMockFactory()();
    });
  });

  afterEach(() => {
    vm.destroy();
    if (container.parentNode) {
      container.parentNode.removeChild(container);
    }
  });

  it('should route bar, cvd, and footprint through ViewManager to OverviewView renderer', () => {
    vm.switchToView(ViewType.Overview);

    const bar = makeBar(100);
    const cvd = makeCvd(100, 500, 10);
    const fp = makeFootprint(100);

    vm.updateBar(bar);
    vm.updateCvd(cvd);
    vm.updateFootprint(fp);

    expect(mockRenderer.update).toHaveBeenCalledWith(bar);
    expect(mockRenderer.updateCvd).toHaveBeenCalledWith(cvd);
    expect(mockRenderer.updateFootprint).toHaveBeenCalledWith(fp);
  });

  it('should route updates in chronological order to OverviewView renderer', () => {
    vm.switchToView(ViewType.Overview);

    const bars = [makeBar(100), makeBar(200), makeBar(300)];
    for (const bar of bars) {
      vm.updateBar(bar);
    }

    expect(mockRenderer.update).toHaveBeenCalledTimes(3);
    expect(mockRenderer.update).toHaveBeenNthCalledWith(1, bars[0]);
    expect(mockRenderer.update).toHaveBeenNthCalledWith(2, bars[1]);
    expect(mockRenderer.update).toHaveBeenNthCalledWith(3, bars[2]);
  });

  it('should not route data to destroyed OverviewView after switch', () => {
    vm.switchToView(ViewType.Overview);
    vm.updateBar(makeBar(100));
    expect(mockRenderer.update).toHaveBeenCalledTimes(1);

    vm.switchToView(ViewType.Footprint);
    vm.updateBar(makeBar(200));
    expect(mockRenderer.update).toHaveBeenCalledTimes(1);
  });

  it('should safely handle updates when no view is mounted', () => {
    expect(() => {
      vm.updateBar(makeBar(100));
      vm.updateCvd(makeCvd(100, 500, 10));
      vm.updateFootprint(makeFootprint(100));
    }).not.toThrow();
  });
});

describe('Priority 2: ChartStore + ViewManager + OverviewView seed pipeline', () => {
  let container: HTMLDivElement;
  let store: ChartStore;
  let vm: ViewManager;

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement('div');
    document.body.appendChild(container);
    store = new ChartStore();
    vm = new ViewManager(store, container, (type: ViewType) => {
      if (type === ViewType.Overview) return new OverviewView();
      return createFootprintMockFactory()();
    });
  });

  afterEach(() => {
    vm.destroy();
    if (container.parentNode) {
      container.parentNode.removeChild(container);
    }
  });

  it('should seed OverviewView with all bars from ChartStore in order', () => {
    for (let i = 0; i < 30; i++) {
      store.ingestBar(makeBar(i * 1000, 100 + i));
    }
    vm.switchToView(ViewType.Overview);
    expect(mockRenderer.update).toHaveBeenCalledTimes(30);
    for (let i = 0; i < 30; i++) {
      expect(mockRenderer.update).toHaveBeenNthCalledWith(i + 1, {
        ts_event: i * 1000,
        open: 100 + i,
        high: 101 + i,
        low: 99 + i,
        close: 100.5 + i,
        volume: 1000,
      });
    }
  });

  it('should seed OverviewView with correlated CVD and footprint data', () => {
    store.ingestBar(makeBar(100));
    store.ingestCvd(makeCvd(100, 500, 10));
    store.ingestFootprint(makeFootprint(100));
    store.ingestBar(makeBar(200));
    store.ingestCvd(makeCvd(200, 510, 20));
    store.ingestFootprint(makeFootprint(200));

    vm.switchToView(ViewType.Overview);

    expect(mockRenderer.update).toHaveBeenCalledTimes(2);
    expect(mockRenderer.updateCvd).toHaveBeenCalledTimes(2);
    expect(mockRenderer.updateFootprint).toHaveBeenCalledTimes(2);
  });

  it('should handle seed with empty ChartStore gracefully', () => {
    vm.switchToView(ViewType.Overview);
    expect(mockRenderer.update).not.toHaveBeenCalled();
    expect(mockRenderer.updateCvd).not.toHaveBeenCalled();
    expect(mockRenderer.updateFootprint).not.toHaveBeenCalled();
  });

  it('should seed OverviewView correctly after ChartStore buffer wraparound', () => {
    for (let i = 0; i < MAX_BARS + 50; i++) {
      store.ingestBar(makeBar(i));
      store.ingestFootprint(makeFootprint(i));
    }
    vm.switchToView(ViewType.Overview);
    expect(mockRenderer.update).toHaveBeenCalledTimes(MAX_BARS);
    expect(mockRenderer.updateCvd).toHaveBeenCalledTimes(0);
    expect(mockRenderer.updateFootprint).toHaveBeenCalledTimes(MAX_BARS);
  });
});

describe('Priority 3: ViewToggleButton label sync with ViewManager state', () => {
  let container: HTMLDivElement;
  let store: ChartStore;
  let vm: ViewManager;
  let toggle: ViewToggleButton;

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement('div');
    document.body.appendChild(container);
    store = new ChartStore();
    vm = new ViewManager(store, container, (type: ViewType) => {
      if (type === ViewType.Overview) return new OverviewView();
      return createFootprintMockFactory()();
    });
    toggle = new ViewToggleButton(container, {
      onViewSwitch: (viewType: ToggleViewType) => {
        const chartViewType = viewType === 'overview' ? ViewType.Overview : ViewType.Footprint;
        vm.switchToView(chartViewType);
        toggle.setViewType(viewType);
      },
    });
  });

  afterEach(() => {
    toggle.destroy();
    vm.destroy();
    if (container.parentNode) {
      container.parentNode.removeChild(container);
    }
  });

  it('should show Overview label when ViewManager has Overview mounted', () => {
    vm.switchToView(ViewType.Overview);
    expect(container.querySelector('button')!.textContent).toBe('Overview');
  });

  it('should show Footprint label after toggle switches to Footprint view', () => {
    vm.switchToView(ViewType.Overview);
    const button = container.querySelector('button')!;
    button.click();
    expect(container.querySelector('button')!.textContent).toBe('Footprint');
  });

  it('should cycle label correctly through multiple toggles', () => {
    vm.switchToView(ViewType.Overview);
    const button = container.querySelector('button')!;

    const expectedLabels = ['Footprint', 'Overview', 'Footprint', 'Overview'];
    for (const expected of expectedLabels) {
      button.click();
      expect(button.textContent).toBe(expected);
    }
  });

  it('should keep button in DOM after multiple switches', () => {
    vm.switchToView(ViewType.Overview);
    const button = container.querySelector('button')!;

    for (let i = 0; i < 10; i++) {
      button.click();
    }
    expect(container.contains(button)).toBe(true);
  });
});