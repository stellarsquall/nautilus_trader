import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ViewType } from '../../src/views/ChartView';
import type { ChartStoreState, FootprintPayload } from '../../src/types';

const mockRenderer = vi.hoisted(() => ({
  update: vi.fn(),
  updateCvd: vi.fn(),
  updateFootprint: vi.fn(),
  destroy: vi.fn(),
}));

vi.mock('../../src/renderers/CanvasCandlestickRenderer', () => ({
  CanvasCandlestickRenderer: vi.fn(() => mockRenderer),
}));

import { OverviewView } from '../../src/views/OverviewView';
import { CanvasCandlestickRenderer } from '../../src/renderers/CanvasCandlestickRenderer';

describe('OverviewView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should implement ChartView interface (AC1)', () => {
    const view = new OverviewView();
    expect(typeof view.mount).toBe('function');
    expect(typeof view.seed).toBe('function');
    expect(typeof view.updateBar).toBe('function');
    expect(typeof view.updateCvd).toBe('function');
    expect(typeof view.updateFootprint).toBe('function');
    expect(typeof view.destroy).toBe('function');
    expect(typeof view.getType).toBe('function');
  });

  it('should return ViewType.Overview from getType (AC1)', () => {
    const view = new OverviewView();
    expect(view.getType()).toBe(ViewType.Overview);
  });

  it('mount() should create CanvasCandlestickRenderer with provided container (AC2)', () => {
    const view = new OverviewView();
    const container = document.createElement('div');

    view.mount(container);

    expect(CanvasCandlestickRenderer).toHaveBeenCalledTimes(1);
    expect(CanvasCandlestickRenderer).toHaveBeenCalledWith(container);
  });

  it('seed() should populate renderer with bars in chronological order (AC3)', () => {
    const view = new OverviewView();
    view.mount(document.createElement('div'));

    const bars = [
      { ts_event: 100, open: 10, high: 11, low: 9, close: 10, volume: 100 },
      { ts_event: 200, open: 11, high: 12, low: 10, close: 11, volume: 200 },
    ];
    const state: ChartStoreState = { bars, cvd: new Map(), footprints: new Map() };

    view.seed(state);

    expect(mockRenderer.update).toHaveBeenCalledTimes(2);
    expect(mockRenderer.update).toHaveBeenNthCalledWith(1, bars[0]);
    expect(mockRenderer.update).toHaveBeenNthCalledWith(2, bars[1]);
  });

  it('seed() should populate renderer with CVD data (AC3)', () => {
    const view = new OverviewView();
    view.mount(document.createElement('div'));

    const cvd = new Map([[100, { ts_event: 100, cvd: 50, delta: 10 }]]);
    const state: ChartStoreState = {
      bars: [],
      cvd,
      footprints: new Map(),
    };

    view.seed(state);

    expect(mockRenderer.updateCvd).toHaveBeenCalledTimes(1);
    expect(mockRenderer.updateCvd).toHaveBeenCalledWith(cvd.get(100));
  });

  it('seed() should populate renderer with footprint data (AC3)', () => {
    const view = new OverviewView();
    view.mount(document.createElement('div'));

    const footprint: FootprintPayload = { ts_event: 100, bin_size: 60000, levels: [] };
    const footprints = new Map([[100, footprint]]);
    const state: ChartStoreState = {
      bars: [],
      cvd: new Map(),
      footprints,
    };

    view.seed(state);

    expect(mockRenderer.updateFootprint).toHaveBeenCalledTimes(1);
    expect(mockRenderer.updateFootprint).toHaveBeenCalledWith(footprint);
  });

  it('updateBar() should pass-through to renderer.update (AC4)', () => {
    const view = new OverviewView();
    view.mount(document.createElement('div'));

    const data = { ts_event: 100, open: 10, high: 11, low: 9, close: 10, volume: 1000 };
    view.updateBar(data);

    expect(mockRenderer.update).toHaveBeenCalledTimes(1);
    expect(mockRenderer.update).toHaveBeenCalledWith(data);
  });

  it('updateCvd() should pass-through to renderer.updateCvd (AC4)', () => {
    const view = new OverviewView();
    view.mount(document.createElement('div'));

    const data = { ts_event: 100, cvd: 500, delta: 50 };
    view.updateCvd(data);

    expect(mockRenderer.updateCvd).toHaveBeenCalledTimes(1);
    expect(mockRenderer.updateCvd).toHaveBeenCalledWith(data);
  });

  it('updateFootprint() should pass-through to renderer.updateFootprint (AC4)', () => {
    const view = new OverviewView();
    view.mount(document.createElement('div'));

    const data: FootprintPayload = { ts_event: 100, bin_size: 60000, levels: [] };
    view.updateFootprint(data);

    expect(mockRenderer.updateFootprint).toHaveBeenCalledTimes(1);
    expect(mockRenderer.updateFootprint).toHaveBeenCalledWith(data);
  });

  it('destroy() should call renderer.destroy() and clean up (AC5)', () => {
    const view = new OverviewView();
    view.mount(document.createElement('div'));

    view.destroy();

    expect(mockRenderer.destroy).toHaveBeenCalledTimes(1);
  });

  it('destroy() should be safe to call multiple times (AC5)', () => {
    const view = new OverviewView();
    view.mount(document.createElement('div'));

    view.destroy();
    view.destroy();

    expect(mockRenderer.destroy).toHaveBeenCalledTimes(1);
  });

  it('should delegate all update methods without modifying data (AC6)', () => {
    const view = new OverviewView();
    view.mount(document.createElement('div'));

    const barData = {
      ts_event: 100,
      open: 10,
      high: 11,
      low: 9,
      close: 10,
      volume: 100,
      buy_volume: 60,
      sell_volume: 40,
      delta: 20,
    };
    const cvdData = { ts_event: 100, cvd: 500, delta: 20 };
    const fpData: FootprintPayload = {
      ts_event: 100,
      bin_size: 60000,
      levels: [{ price: 100, buy: 10, sell: 5 }],
    };

    view.updateBar(barData);
    view.updateCvd(cvdData);
    view.updateFootprint(fpData);

    expect(mockRenderer.update).toHaveBeenCalledWith(barData);
    expect(mockRenderer.updateCvd).toHaveBeenCalledWith(cvdData);
    expect(mockRenderer.updateFootprint).toHaveBeenCalledWith(fpData);
  });

  it('should not throw if update methods called before mount (edge case)', () => {
    const view = new OverviewView();

    expect(() => view.updateBar({})).not.toThrow();
    expect(() => view.updateCvd({})).not.toThrow();
    expect(() => view.updateFootprint({ ts_event: 0, bin_size: 0, levels: [] })).not.toThrow();
  });
});