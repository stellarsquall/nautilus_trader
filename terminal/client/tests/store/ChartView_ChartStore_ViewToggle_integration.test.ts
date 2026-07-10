import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ChartStore, MAX_BARS } from '../../src/store/ChartStore.js';
import { ViewToggleButton, type ViewType as ToggleViewType } from '../../src/ui/ViewToggleButton.js';
import { ChartView, ViewType as ChartViewEnum } from '../../src/views/ChartView.js';
import type { BarPayload, CvdPayload, FootprintPayload, Envelope, ChartStoreState } from '../../src/types.js';

function makeBar(ts_event: number, open = 100): BarPayload {
  return { ts_event, open, high: open + 1, low: open - 1, close: open + 0.5, volume: 1000 };
}

function makeCvd(ts_event: number, cvd = 0, delta = 0): CvdPayload {
  return { ts_event, cvd, delta };
}

function makeFootprint(ts_event: number, levels?: Array<{ price: number; buy: number; sell: number }>): FootprintPayload {
  return { ts_event, bin_size: 60000, levels: levels ?? [{ price: 100, buy: 50, sell: 30 }] };
}

function makeBarEnvelope(bar: BarPayload): Envelope {
  return { v: 1, type: 'bar', seq: bar.ts_event, payload: bar };
}

function makeCvdEnvelope(cvd: CvdPayload): Envelope {
  return { v: 1, type: 'cvd', seq: cvd.ts_event, payload: cvd };
}

function makeFootprintEnvelope(fp: FootprintPayload): Envelope {
  return { v: 1, type: 'footprint', seq: fp.ts_event, payload: fp };
}

function makeMockChartView(type: ChartViewEnum): ChartView {
  return {
    mount: vi.fn(),
    seed: vi.fn(),
    updateBar: vi.fn(),
    updateCvd: vi.fn(),
    updateFootprint: vi.fn(),
    destroy: vi.fn(),
    getType: vi.fn(() => type),
  };
}

describe('Cross-Feature Integration: ChartView + ChartStore + ViewToggleButton', () => {
  describe('Priority 2: ChartView interface receives correct data from ChartStore', () => {
    it('should seed ChartView with full ChartStore state including bars, cvd, footprints', () => {
      const store = new ChartStore();
      store.ingestBar(makeBar(100));
      store.ingestCvd(makeCvd(100, 500, 10));
      store.ingestFootprint(makeFootprint(100));
      store.ingestBar(makeBar(200));

      const view = makeMockChartView(ChartViewEnum.Overview);
      const state = store.getState();
      view.seed(state);

      expect(view.seed).toHaveBeenCalledTimes(1);
      const seededState = vi.mocked(view.seed).mock.calls[0][0];
      expect(seededState.bars).toHaveLength(2);
      expect(seededState.bars[0].ts_event).toBe(100);
      expect(seededState.bars[1].ts_event).toBe(200);
      expect(seededState.cvd.size).toBe(1);
      expect(seededState.cvd.get(100)?.cvd).toBe(500);
      expect(seededState.footprints.size).toBe(1);
      expect(seededState.footprints.get(100)?.bin_size).toBe(60000);
    });

    it('should call updateBar on ChartView after bar ingestion', () => {
      const store = new ChartStore();
      const view = makeMockChartView(ChartViewEnum.Overview);

      const bar = makeBar(100);
      store.ingestBar(bar);

      const state = store.getState();
      const latestBar = state.bars[state.bars.length - 1];
      view.updateBar(latestBar);

      expect(view.updateBar).toHaveBeenCalledWith(bar);
    });

    it('should call updateCvd on ChartView after CVD ingestion', () => {
      const store = new ChartStore();
      const view = makeMockChartView(ChartViewEnum.Overview);

      const cvd = makeCvd(100, 500, 10);
      store.ingestCvd(cvd);
      view.updateCvd(cvd);

      expect(view.updateCvd).toHaveBeenCalledWith(cvd);
    });

    it('should call updateFootprint on ChartView after footprint ingestion', () => {
      const store = new ChartStore();
      const view = makeMockChartView(ChartViewEnum.Footprint);

      const fp = makeFootprint(100);
      store.ingestFootprint(fp);
      view.updateFootprint(fp);

      expect(view.updateFootprint).toHaveBeenCalledWith(fp);
    });

    it('should propagate multiple bar updates to ChartView in chronological order', () => {
      const store = new ChartStore();
      const view = makeMockChartView(ChartViewEnum.Overview);

      for (let i = 0; i < 10; i++) {
        const bar = makeBar(i * 1000);
        store.ingestBar(bar);
        view.updateBar(bar);
      }

      expect(view.updateBar).toHaveBeenCalledTimes(10);
      const calls = vi.mocked(view.updateBar).mock.calls;
      for (let i = 0; i < 10; i++) {
        expect((calls[i][0] as BarPayload).ts_event).toBe(i * 1000);
      }
    });
  });

  describe('Priority 2: ViewToggleButton triggers ChartView lifecycle', () => {
    let container: HTMLDivElement;
    let store: ChartStore;

    beforeEach(() => {
      container = document.createElement('div');
      document.body.appendChild(container);
      store = new ChartStore();
    });

    afterEach(() => {
      if (container.parentNode) {
        container.parentNode.removeChild(container);
      }
    });

    it('should destroy current view and seed new view on toggle', () => {
      const overviewView = makeMockChartView(ChartViewEnum.Overview);
      const footprintView = makeMockChartView(ChartViewEnum.Footprint);

      let currentView: ChartView = overviewView;
      currentView.mount(container);

      store.ingestBar(makeBar(100));
      store.ingestFootprint(makeFootprint(100));

      const toggle = new ViewToggleButton(container, {
        onViewSwitch: (_viewType: ToggleViewType) => {
          currentView.destroy();
          currentView = footprintView;
          currentView.seed(store.getState());
          currentView.mount(container);
        },
      });

      const button = container.querySelector('button') as HTMLButtonElement;
      button.click();

      expect(overviewView.destroy).toHaveBeenCalledOnce();
      expect(footprintView.seed).toHaveBeenCalledOnce();
      expect(footprintView.mount).toHaveBeenCalledOnce();
      expect(footprintView.getType()).toBe(ChartViewEnum.Footprint);

      toggle.destroy();
    });

    it('should seed new view with latest ChartStore state on switch', () => {
      const overviewView = makeMockChartView(ChartViewEnum.Overview);
      const footprintView = makeMockChartView(ChartViewEnum.Footprint);

      let currentView: ChartView = overviewView;

      for (let i = 0; i < 5; i++) {
        store.ingestBar(makeBar(i * 1000));
        store.ingestFootprint(makeFootprint(i * 1000));
      }

      const toggle = new ViewToggleButton(container, {
        onViewSwitch: () => {
          currentView.destroy();
          currentView = footprintView;
          currentView.seed(store.getState());
        },
      });

      store.ingestBar(makeBar(5000));
      store.ingestFootprint(makeFootprint(5000));
      store.ingestCvd(makeCvd(5000, 1000, 50));

      const button = container.querySelector('button') as HTMLButtonElement;
      button.click();

      const seededState = vi.mocked(footprintView.seed).mock.calls[0][0];
      expect(seededState.bars).toHaveLength(6);
      expect(seededState.bars[5].ts_event).toBe(5000);
      expect(seededState.footprints.has(5000)).toBe(true);
      expect(seededState.cvd.has(5000)).toBe(true);

      toggle.destroy();
    });

    it('should cycle between overview and footprint views on repeated toggles', () => {
      const overviewView = makeMockChartView(ChartViewEnum.Overview);
      const footprintView = makeMockChartView(ChartViewEnum.Footprint);
      let currentView: ChartView = overviewView;

      store.ingestBar(makeBar(100));
      store.ingestFootprint(makeFootprint(100));

      const toggle = new ViewToggleButton(container, {
        onViewSwitch: (viewType: ToggleViewType) => {
          currentView.destroy();
          currentView = viewType === 'footprint' ? footprintView : overviewView;
          currentView.seed(store.getState());
          currentView.mount(container);
          toggle.setViewType(viewType);
        },
      });

      const button = container.querySelector('button') as HTMLButtonElement;

      button.click();
      expect(footprintView.mount).toHaveBeenCalledOnce();
      expect(overviewView.destroy).toHaveBeenCalledOnce();

      button.click();
      expect(overviewView.mount).toHaveBeenCalledOnce();
      expect(footprintView.destroy).toHaveBeenCalledOnce();

      toggle.destroy();
    });

    it('should correlate bar and footprint data after toggle with gap ingestion', () => {
      const overviewView = makeMockChartView(ChartViewEnum.Overview);
      const footprintView = makeMockChartView(ChartViewEnum.Footprint);
      let currentView: ChartView = overviewView;

      const toggle = new ViewToggleButton(container, {
        onViewSwitch: () => {
          currentView.destroy();
          currentView = footprintView;
          currentView.seed(store.getState());
        },
      });

      store.ingestBar(makeBar(100));
      store.ingestFootprint(makeFootprint(100));
      store.ingestBar(makeBar(200));

      const button = container.querySelector('button') as HTMLButtonElement;
      button.click();

      const seededState = vi.mocked(footprintView.seed).mock.calls[0][0];
      expect(seededState.footprints.has(100)).toBe(true);
      expect(seededState.footprints.has(200)).toBe(false);
      expect(seededState.bars.find((b: BarPayload) => b.ts_event === 100)).toBeDefined();
      expect(seededState.bars.find((b: BarPayload) => b.ts_event === 200)).toBeDefined();

      toggle.destroy();
    });
  });

  describe('Priority 2: ViewType string compatibility across modules', () => {
    it('should have ChartView ViewType enum values matching ViewToggleButton ViewType strings', () => {
      const toggleOverview: ToggleViewType = 'overview';
      const toggleFootprint: ToggleViewType = 'footprint';

      expect(ChartViewEnum.Overview).toBe(toggleOverview);
      expect(ChartViewEnum.Footprint).toBe(toggleFootprint);
    });

    it('should allow switching between ChartView and ViewToggleButton ViewType values', () => {
      function isToggleType(v: string): v is ToggleViewType {
        return v === 'overview' || v === 'footprint';
      }

      const enumVal: ChartViewEnum = ChartViewEnum.Overview;
      expect(isToggleType(enumVal)).toBe(true);

      const footprintEnumVal: ChartViewEnum = ChartViewEnum.Footprint;
      expect(isToggleType(footprintEnumVal)).toBe(true);
    });

    it('should support direct assignment between ChartView enum and toggle type', () => {
      const toggleView: ToggleViewType = ChartViewEnum.Overview;
      expect(toggleView).toBe('overview');

      const toggleFootprint: ToggleViewType = ChartViewEnum.Footprint;
      expect(toggleFootprint).toBe('footprint');
    });
  });

  describe('Priority 2: Full pipeline envelope → store → view lifecycle', () => {
    let container: HTMLDivElement;
    let store: ChartStore;

    beforeEach(() => {
      container = document.createElement('div');
      document.body.appendChild(container);
      store = new ChartStore();
    });

    afterEach(() => {
      if (container.parentNode) {
        container.parentNode.removeChild(container);
      }
    });

    it('should flow through full pipeline: envelope dispatch → store → view seed', () => {
      const overviewView = makeMockChartView(ChartViewEnum.Overview);
      let currentView: ChartView = overviewView;
      currentView.mount(container);

      function dispatchEnvelope(envelope: Envelope): void {
        switch (envelope.type) {
          case 'bar':
            store.ingestBar(envelope.payload as BarPayload);
            currentView.updateBar(envelope.payload as BarPayload);
            break;
          case 'cvd':
            store.ingestCvd(envelope.payload as CvdPayload);
            currentView.updateCvd(envelope.payload as CvdPayload);
            break;
          case 'footprint':
            store.ingestFootprint(envelope.payload as FootprintPayload);
            currentView.updateFootprint(envelope.payload as FootprintPayload);
            break;
        }
      }

      dispatchEnvelope(makeBarEnvelope(makeBar(100)));
      dispatchEnvelope(makeCvdEnvelope(makeCvd(100, 500, 10)));
      dispatchEnvelope(makeFootprintEnvelope(makeFootprint(100)));
      dispatchEnvelope(makeBarEnvelope(makeBar(200)));

      expect(store.getBarCount()).toBe(2);
      expect(store.getState().cvd.size).toBe(1);
      expect(store.getState().footprints.size).toBe(1);
      expect(overviewView.updateBar).toHaveBeenCalledTimes(2);
      expect(overviewView.updateCvd).toHaveBeenCalledTimes(1);
      expect(overviewView.updateFootprint).toHaveBeenCalledTimes(1);
    });

    it('should maintain data integrity across toggle with continuing envelope stream', () => {
      const overviewView = makeMockChartView(ChartViewEnum.Overview);
      const footprintView = makeMockChartView(ChartViewEnum.Footprint);
      let currentView: ChartView = overviewView;
      currentView.mount(container);

      const toggle = new ViewToggleButton(container, {
        onViewSwitch: () => {
          currentView.destroy();
          currentView = footprintView;
          currentView.seed(store.getState());
          currentView.mount(container);
        },
      });

      function dispatchBar(ts_event: number): void {
        store.ingestBar(makeBar(ts_event));
        currentView.updateBar(makeBar(ts_event));
      }

      function dispatchFootprint(ts_event: number): void {
        store.ingestFootprint(makeFootprint(ts_event));
        currentView.updateFootprint(makeFootprint(ts_event));
      }

      dispatchBar(100);
      dispatchFootprint(100);
      dispatchBar(200);
      dispatchFootprint(200);

      const button = container.querySelector('button') as HTMLButtonElement;
      button.click();

      const seededAfterToggle = vi.mocked(footprintView.seed).mock.calls[0][0];
      expect(seededAfterToggle.bars).toHaveLength(2);
      expect(seededAfterToggle.footprints.size).toBe(2);

      dispatchBar(300);
      dispatchFootprint(300);

      expect(footprintView.updateBar).toHaveBeenCalledTimes(1);
      const updatedBar = vi.mocked(footprintView.updateBar).mock.calls[0][0] as BarPayload;
      expect(updatedBar.ts_event).toBe(300);

      expect(footprintView.updateFootprint).toHaveBeenCalledTimes(1);

      toggle.destroy();
    });

    it('should handle multiple toggles with growing store data', () => {
      const overviewView = makeMockChartView(ChartViewEnum.Overview);
      const footprintView = makeMockChartView(ChartViewEnum.Footprint);
      let currentView: ChartView = overviewView;

      const toggle = new ViewToggleButton(container, {
        onViewSwitch: () => {
          currentView.destroy();
          currentView = currentView === overviewView ? footprintView : overviewView;
          currentView.seed(store.getState());
          currentView.mount(container);
        },
      });

      store.ingestBar(makeBar(100));

      let button = container.querySelector('button') as HTMLButtonElement;
      button.click();
      expect(vi.mocked(footprintView.seed).mock.calls[0][0].bars).toHaveLength(1);

      store.ingestBar(makeBar(200));
      store.ingestBar(makeBar(300));

      button.click();
      expect(vi.mocked(overviewView.seed).mock.calls[0][0].bars).toHaveLength(3);

      store.ingestBar(makeBar(400));
      store.ingestBar(makeBar(500));

      button.click();
      expect(vi.mocked(footprintView.seed).mock.calls[1][0].bars).toHaveLength(5);

      toggle.destroy();
    });
  });

  describe('Priority 3: Interface contract between ChartView and Renderer patterns', () => {
    it('should allow OverviewView adapter wrapping a Renderer', () => {
      const mockRenderer = {
        update: vi.fn(),
        updateCvd: vi.fn(),
        updateFootprint: vi.fn(),
        destroy: vi.fn(),
      };

      class OverviewViewAdapter implements ChartView {
        public mount = vi.fn((_container: HTMLElement) => {});
        public seed = vi.fn((_state: ChartStoreState) => {});
        public updateBar = vi.fn((data: unknown) => mockRenderer.update(data));
        public updateCvd = vi.fn((data: unknown) => { if (mockRenderer.updateCvd) mockRenderer.updateCvd(data); });
        public updateFootprint = vi.fn((data: FootprintPayload) => { if (mockRenderer.updateFootprint) mockRenderer.updateFootprint(data); });
        public destroy = vi.fn(() => mockRenderer.destroy());
        public getType = vi.fn(() => ChartViewEnum.Overview);
      }

      const adapter: ChartView = new OverviewViewAdapter();
      const barData = makeBar(100);
      const fpData = makeFootprint(100);

      adapter.updateBar(barData);
      adapter.updateFootprint(fpData);
      adapter.destroy();

      expect(mockRenderer.update).toHaveBeenCalledWith(barData);
      expect(mockRenderer.updateFootprint).toHaveBeenCalledWith(fpData);
      expect(mockRenderer.destroy).toHaveBeenCalled();
    });

    it('should implement all 7 required ChartView methods', () => {
      const requiredMethods = ['mount', 'seed', 'updateBar', 'updateCvd', 'updateFootprint', 'destroy', 'getType'];
      const impl: ChartView = makeMockChartView(ChartViewEnum.Overview);

      for (const method of requiredMethods) {
        expect(typeof (impl as Record<string, unknown>)[method]).toBe('function');
      }
    });
  });

  describe('Priority 3: ChartStore state consumption by ChartView after data accumulation', () => {
    it('should correctly seed view with bars after buffer wraparound', () => {
      const store = new ChartStore();
      const view = makeMockChartView(ChartViewEnum.Overview);

      for (let i = 0; i < MAX_BARS + 50; i++) {
        store.ingestBar(makeBar(i));
      }

      view.seed(store.getState());
      const seededState = vi.mocked(view.seed).mock.calls[0][0];

      expect(seededState.bars).toHaveLength(MAX_BARS);
      expect(seededState.bars[0].ts_event).toBe(50);
      expect(seededState.bars[MAX_BARS - 1].ts_event).toBe(MAX_BARS + 49);
    });

    it('should correlate footprints with bars after seed', () => {
      const store = new ChartStore();
      const view = makeMockChartView(ChartViewEnum.Overview);

      for (let i = 0; i < 30; i++) {
        store.ingestBar(makeBar(i));
        store.ingestFootprint(makeFootprint(i));
      }

      view.seed(store.getState());
      const state = vi.mocked(view.seed).mock.calls[0][0];

      for (const bar of state.bars) {
        expect(state.footprints.has(bar.ts_event)).toBe(true);
      }
    });
  });
});
