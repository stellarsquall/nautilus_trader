import { describe, it, expect, vi } from 'vitest';
import { ChartView, ViewType } from '../../src/views/ChartView';
import type { ChartStoreState, FootprintPayload } from '../../src/types';

describe('ViewType enum (AC2)', () => {
  it('should have Overview value equal to overview string', () => {
    expect(ViewType.Overview).toBe('overview');
  });

  it('should have Footprint value equal to footprint string', () => {
    expect(ViewType.Footprint).toBe('footprint');
  });

  it('should support type narrowing with switch', () => {
    const viewType: ViewType = ViewType.Overview;
    switch (viewType) {
      case ViewType.Overview:
        expect(viewType).toBe(ViewType.Overview);
        break;
      case ViewType.Footprint:
        expect(true).toBe(false);
        break;
    }
  });
});

describe('ChartView interface contract (AC1, AC3, AC4)', () => {
  it('should define mount method accepting HTMLElement (AC1)', () => {
    const mock: ChartView = createMockChartView();
    const container = document.createElement('div');
    expect(() => mock.mount(container)).not.toThrow();
    expect(mock.mount).toHaveBeenCalledWith(container);
  });

  it('should define seed method accepting ChartStoreState (AC1)', () => {
    const mock: ChartView = createMockChartView();
    const state: ChartStoreState = {
      bars: [],
      cvd: new Map(),
      footprints: new Map(),
    };
    expect(() => mock.seed(state)).not.toThrow();
    expect(mock.seed).toHaveBeenCalledWith(state);
  });

  it('should define updateBar method accepting unknown data (AC1, AC4)', () => {
    const mock: ChartView = createMockChartView();
    const data = { ts_event: 1000, open: 100, high: 101, low: 99, close: 100.5, volume: 1000 };
    expect(() => mock.updateBar(data)).not.toThrow();
    expect(mock.updateBar).toHaveBeenCalledWith(data);
  });

  it('should define updateCvd method accepting unknown data (AC1, AC4)', () => {
    const mock: ChartView = createMockChartView();
    const data = { ts_event: 1000, cvd: 500, delta: 50 };
    expect(() => mock.updateCvd(data)).not.toThrow();
    expect(mock.updateCvd).toHaveBeenCalledWith(data);
  });

  it('should define updateFootprint method accepting FootprintPayload (AC1, AC4)', () => {
    const mock: ChartView = createMockChartView();
    const data: FootprintPayload = { ts_event: 1000, bin_size: 60000, levels: [] };
    expect(() => mock.updateFootprint(data)).not.toThrow();
    expect(mock.updateFootprint).toHaveBeenCalledWith(data);
  });

  it('should define destroy method (AC1)', () => {
    const mock: ChartView = createMockChartView();
    expect(() => mock.destroy()).not.toThrow();
    expect(mock.destroy).toHaveBeenCalled();
  });

  it('should define getType method returning ViewType (AC1)', () => {
    const mock: ChartView = createMockChartView();
    const result = mock.getType();
    expect(result).toBe(ViewType.Overview);
  });
});

describe('ChartView supports both adapter pattern and custom implementations (AC3)', () => {
  it('should accept OverviewView-style adapter implementation', () => {
    class OverviewView implements ChartView {
      public mount = vi.fn();
      public seed = vi.fn();
      public updateBar = vi.fn();
      public updateCvd = vi.fn();
      public updateFootprint = vi.fn();
      public destroy = vi.fn();
      public getType = vi.fn(() => ViewType.Overview);
    }

    const view: ChartView = new OverviewView();
    expect(view.getType()).toBe(ViewType.Overview);
    view.mount(document.createElement('div'));
    view.seed({ bars: [], cvd: new Map(), footprints: new Map() });
    view.updateBar({});
    view.updateCvd({});
    view.updateFootprint({ ts_event: 0, bin_size: 0, levels: [] });
    view.destroy();
  });

  it('should accept FootprintView-style custom implementation (AC3)', () => {
    class FootprintView implements ChartView {
      public mount = vi.fn();
      public seed = vi.fn();
      public updateBar = vi.fn();
      public updateCvd = vi.fn();
      public updateFootprint = vi.fn();
      public destroy = vi.fn();
      public getType = vi.fn(() => ViewType.Footprint);
    }

    const view: ChartView = new FootprintView();
    expect(view.getType()).toBe(ViewType.Footprint);
    view.mount(document.createElement('div'));
    view.destroy();
  });
});

describe('Method signatures align with renderer patterns (AC4)', () => {
  it('should have updateBar signature matching Renderer.update', () => {
    const mock: ChartView = {
      mount: vi.fn(),
      seed: vi.fn(),
      updateBar: (_data: unknown) => {},
      updateCvd: vi.fn(),
      updateFootprint: vi.fn(),
      destroy: vi.fn(),
      getType: () => ViewType.Overview,
    };
    expect(typeof mock.updateBar).toBe('function');
    expect(mock.updateBar.length).toBe(1);
  });

  it('should have updateCvd signature matching Renderer.updateCvd', () => {
    const mock: ChartView = {
      mount: vi.fn(),
      seed: vi.fn(),
      updateBar: vi.fn(),
      updateCvd: (_data: unknown) => {},
      updateFootprint: vi.fn(),
      destroy: vi.fn(),
      getType: () => ViewType.Overview,
    };
    expect(typeof mock.updateCvd).toBe('function');
    expect(mock.updateCvd.length).toBe(1);
  });

  it('should have updateFootprint signature matching Renderer.updateFootprint', () => {
    const mock: ChartView = {
      mount: vi.fn(),
      seed: vi.fn(),
      updateBar: vi.fn(),
      updateCvd: vi.fn(),
      updateFootprint: (_data: FootprintPayload) => {},
      destroy: vi.fn(),
      getType: () => ViewType.Overview,
    };
    expect(typeof mock.updateFootprint).toBe('function');
    expect(mock.updateFootprint.length).toBe(1);
  });
});

function createMockChartView(): ChartView {
  return {
    mount: vi.fn(),
    seed: vi.fn(),
    updateBar: vi.fn(),
    updateCvd: vi.fn(),
    updateFootprint: vi.fn(),
    destroy: vi.fn(),
    getType: vi.fn(() => ViewType.Overview),
  };
}