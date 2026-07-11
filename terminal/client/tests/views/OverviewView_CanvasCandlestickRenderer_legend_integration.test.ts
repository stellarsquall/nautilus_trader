import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OverviewView } from '../../src/views/OverviewView';
import { CanvasCandlestickRenderer } from '../../src/renderers/CanvasCandlestickRenderer';
import { VolumeProfileOverlay } from '../../src/chart/VolumeProfileOverlay';
import type { LegendEntry } from '../../src/ui/LegendPanel';
import type { BarPayload, FootprintPayload } from '../../src/types';

const mockRenderer = vi.hoisted(() => ({
  update: vi.fn(),
  updateCvd: vi.fn(),
  updateFootprint: vi.fn(),
  destroy: vi.fn(),
}));

vi.mock('../../src/renderers/CanvasCandlestickRenderer', () => ({
  CanvasCandlestickRenderer: vi.fn(() => mockRenderer),
}));

describe('OverviewView + CanvasCandlestickRenderer + Value Area legend integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('getLegendEntries() includes the combined Value Area entry matching VolumeProfileOverlay color scheme', () => {
    const view = new OverviewView();
    const entries: LegendEntry[] = view.getLegendEntries();
    expect(entries).toHaveLength(10);

    const valueAreaEntry = entries.find(e => e.label === 'Value Area (VAH/VAL)');
    expect(valueAreaEntry).toBeDefined();
    expect(valueAreaEntry!.color).toBe('#787b86');
    expect(valueAreaEntry!.kind).toBe('valueArea');

    const currentPriceEntry = entries.find(e => e.label === 'Current Price');
    expect(currentPriceEntry).toBeDefined();
    expect(currentPriceEntry!.color).toBe('#333333');
    expect(currentPriceEntry!.kind).toBe('dashedLine');
  });

  it('mount() creates CanvasCandlestickRenderer and LegendPanel with Value Area entries', () => {
    const container = document.createElement('div');
    const view = new OverviewView();
    view.mount(container);

    expect(CanvasCandlestickRenderer).toHaveBeenCalledWith(container);

    const legendButton = container.querySelector('button');
    expect(legendButton).not.toBeNull();
    expect(legendButton!.textContent).toBe('Legend: OFF');

    view.destroy();
  });

  it('seeds renderer with bars, CVD, and footprint data', () => {
    const container = document.createElement('div');
    const view = new OverviewView();
    view.mount(container);

    const bar: BarPayload = { ts_event: 1000, open: 100, high: 101, low: 99, close: 100.5, volume: 1000 };
    const cvd = { ts_event: 1000, cvd: 50, delta: 50 };
    const footprint: FootprintPayload = { ts_event: 1000, bin_size: 60000, levels: [{ price: 100, buy: 50, sell: 30 }] };

    view.seed({
      bars: [bar],
      cvd: new Map([[1000, cvd]]),
      footprints: new Map([[1000, footprint]]),
    } as any);

    expect(mockRenderer.update).toHaveBeenCalledWith(bar);
    expect(mockRenderer.updateCvd).toHaveBeenCalledWith(cvd);
    expect(mockRenderer.updateFootprint).toHaveBeenCalledWith(footprint);

    view.destroy();
  });

  it('updateBar delegates to renderer.update', () => {
    const container = document.createElement('div');
    const view = new OverviewView();
    view.mount(container);

    const bar: BarPayload = { ts_event: 1000, open: 100, high: 101, low: 99, close: 100.5, volume: 1000 };
    view.updateBar(bar);
    expect(mockRenderer.update).toHaveBeenCalledWith(bar);

    view.destroy();
  });

  it('updateFootprint delegates to renderer.updateFootprint', () => {
    const container = document.createElement('div');
    const view = new OverviewView();
    view.mount(container);

    const footprint: FootprintPayload = { ts_event: 1000, bin_size: 60000, levels: [] };
    view.updateFootprint(footprint);
    expect(mockRenderer.updateFootprint).toHaveBeenCalledWith(footprint);

    view.destroy();
  });

  it('destroy cleans up both legend and renderer', () => {
    const container = document.createElement('div');
    const view = new OverviewView();
    view.mount(container);

    expect(container.querySelector('button')).not.toBeNull();
    view.destroy();

    expect(container.querySelector('button')).toBeNull();
    expect(mockRenderer.destroy).toHaveBeenCalled();
  });
});
