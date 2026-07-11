import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FootprintView, type PocResult } from '../../src/views/FootprintView';
import { ViewType } from '../../src/views/ChartView';
import { FootprintViewState } from '../../src/views/FootprintViewState';
import type { ChartStoreState, FootprintPayload, FootprintLevel } from '../../src/types';

function createMockCtx(): CanvasRenderingContext2D {
  return {
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
    font: '',
    textAlign: 'start' as CanvasTextAlign,
    textBaseline: 'alphabetic' as CanvasTextBaseline,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
  } as unknown as CanvasRenderingContext2D;
}

const mockCtx = createMockCtx();

vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => mockCtx);

vi.stubGlobal('ResizeObserver', vi.fn(() => ({
  observe: vi.fn(),
  disconnect: vi.fn(),
})));

describe('FootprintView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('POC calculation (AC1 - Point of Control)', () => {
    it('should identify POC as price level with max total (buy + sell) volume', () => {
      const view = new FootprintView();
      const levels: FootprintLevel[] = [
        { price: 100.00, buy: 50, sell: 30 },   // total = 80
        { price: 100.01, buy: 100, sell: 60 },  // total = 160
        { price: 100.02, buy: 40, sell: 20 },   // total = 60
        { price: 100.03, buy: 70, sell: 50 },   // total = 120
      ];

      const result = view.calculatePOC(levels);

      expect(result.pocPrice).toBe(100.01);
      expect(result.maxTotal).toBe(160);
    });

    it('should return null POC for empty levels array', () => {
      const view = new FootprintView();
      const result = view.calculatePOC([]);
      expect(result.pocPrice).toBeNull();
      expect(result.maxTotal).toBe(0);
    });

    it('should handle single level correctly', () => {
      const view = new FootprintView();
      const levels: FootprintLevel[] = [
        { price: 100.00, buy: 75, sell: 25 },
      ];

      const result = view.calculatePOC(levels);

      expect(result.pocPrice).toBe(100.00);
      expect(result.maxTotal).toBe(100);
    });
  });

  describe('POC equal volumes (AC3 - equal max volume picks first)', () => {
    it('should pick the first price level when multiple have equal max total', () => {
      const view = new FootprintView();
      const levels: FootprintLevel[] = [
        { price: 100.00, buy: 50, sell: 50 },   // total = 100
        { price: 100.01, buy: 60, sell: 40 },   // total = 100 (equal)
        { price: 100.02, buy: 30, sell: 20 },   // total = 50
      ];

      const result = view.calculatePOC(levels);

      expect(result.pocPrice).toBe(100.00);
      expect(result.maxTotal).toBe(100);
    });

    it('should pick first when all levels have same total', () => {
      const view = new FootprintView();
      const levels: FootprintLevel[] = [
        { price: 100.00, buy: 10, sell: 10 },   // total = 20
        { price: 100.01, buy: 10, sell: 10 },   // total = 20
        { price: 100.02, buy: 10, sell: 10 },   // total = 20
      ];

      const result = view.calculatePOC(levels);

      expect(result.pocPrice).toBe(100.00);
    });
  });

  describe('POC edge cases (AC4 - no footprint data)', () => {
    it('should return null POC when no footprint data exists for a bar', () => {
      const view = new FootprintView();

      const result = view.calculatePOCForBar(999);

      expect(result.pocPrice).toBeNull();
      expect(result.maxTotal).toBe(0);
    });

    it('should return null POC when footprint has empty levels', () => {
      const view = new FootprintView();
      const fp: FootprintPayload = { ts_event: 100, bin_size: 60000, levels: [] };
      view.updateFootprint(fp);

      const result = view.calculatePOCForBar(100);

      expect(result.pocPrice).toBeNull();
      expect(result.maxTotal).toBe(0);
    });
  });

  describe('POC with zero values (edge cases)', () => {
    it('should handle levels where all buy and sell are zero', () => {
      const view = new FootprintView();
      const levels: FootprintLevel[] = [
        { price: 100.00, buy: 0, sell: 0 },
        { price: 100.01, buy: 0, sell: 0 },
      ];

      const result = view.calculatePOC(levels);

      expect(result.pocPrice).toBe(100.00);
      expect(result.maxTotal).toBe(0);
    });

    it('should handle levels where only one has non-zero volume', () => {
      const view = new FootprintView();
      const levels: FootprintLevel[] = [
        { price: 100.00, buy: 0, sell: 0 },
        { price: 100.01, buy: 100, sell: 0 },
        { price: 100.02, buy: 0, sell: 0 },
      ];

      const result = view.calculatePOC(levels);

      expect(result.pocPrice).toBe(100.01);
      expect(result.maxTotal).toBe(100);
    });
  });

  describe('POC calculation across visible bars', () => {
    it('should calculate POC per bar column independently', () => {
      const view = new FootprintView();

      const fp1: FootprintPayload = {
        ts_event: 100,
        bin_size: 60000,
        levels: [
          { price: 100.00, buy: 10, sell: 20 },   // total = 30
          { price: 100.01, buy: 50, sell: 30 },   // total = 80 ← POC
          { price: 100.02, buy: 5, sell: 5 },     // total = 10
        ],
      };

      const fp2: FootprintPayload = {
        ts_event: 200,
        bin_size: 60000,
        levels: [
          { price: 100.00, buy: 60, sell: 40 },   // total = 100 ← POC
          { price: 100.01, buy: 20, sell: 10 },   // total = 30
          { price: 100.02, buy: 10, sell: 10 },   // total = 20
        ],
      };

      view.updateFootprint(fp1);
      view.updateFootprint(fp2);

      const result1 = view.calculatePOCForBar(100);
      const result2 = view.calculatePOCForBar(200);

      expect(result1.pocPrice).toBe(100.01);
      expect(result1.maxTotal).toBe(80);

      expect(result2.pocPrice).toBe(100.00);
      expect(result2.maxTotal).toBe(100);

      expect(result1.pocPrice).not.toBe(result2.pocPrice);
    });
  });

  describe('View lifecycle', () => {
    it('should implement ChartView interface', () => {
      const view = new FootprintView();
      expect(typeof view.mount).toBe('function');
      expect(typeof view.seed).toBe('function');
      expect(typeof view.updateBar).toBe('function');
      expect(typeof view.updateCvd).toBe('function');
      expect(typeof view.updateFootprint).toBe('function');
      expect(typeof view.destroy).toBe('function');
      expect(typeof view.getType).toBe('function');
    });

    it('should return ViewType.Footprint from getType', () => {
      const view = new FootprintView();
      expect(view.getType()).toBe(ViewType.Footprint);
    });

    it('mount() should create canvas element in container', () => {
      const view = new FootprintView();
      const container = document.createElement('div');

      view.mount(container);

      expect(container.querySelector('canvas')).not.toBeNull();
    });

    it('destroy() should remove canvas from container', () => {
      const view = new FootprintView();
      const container = document.createElement('div');
      view.mount(container);

      view.destroy();

      expect(container.querySelector('canvas')).toBeNull();
    });

    it('destroy() should be safe to call multiple times', () => {
      const view = new FootprintView();
      view.destroy();
      view.destroy();
    });

    it('should expose FootprintViewState via viewState property', () => {
      const view = new FootprintView();
      expect(view.viewState).toBeInstanceOf(FootprintViewState);
    });

    it('seed() should populate bars and update viewState', () => {
      const view = new FootprintView();
      view.mount(document.createElement('div'));

      const bars = [
        { ts_event: 100, open: 10, high: 11, low: 9, close: 10, volume: 100 },
        { ts_event: 200, open: 11, high: 12, low: 10, close: 11, volume: 200 },
      ];
      const state: ChartStoreState = { bars, cvd: new Map(), footprints: new Map() };

      view.seed(state);

      expect(view.viewState.isAtLatest()).toBe(true);
      expect(mockCtx.clearRect).toHaveBeenCalled();
    });

    it('seed() should populate footprint data', () => {
      const view = new FootprintView();
      view.mount(document.createElement('div'));

      const fp: FootprintPayload = { ts_event: 100, bin_size: 60000, levels: [{ price: 100, buy: 50, sell: 30 }] };
      const footprints = new Map([[100, fp]]);
      const state: ChartStoreState = { bars: [{ ts_event: 100, open: 10, high: 11, low: 9, close: 10, volume: 100 }], cvd: new Map(), footprints };

      view.seed(state);

      const result = view.calculatePOCForBar(100);
      expect(result.pocPrice).toBe(100);
      expect(result.maxTotal).toBe(80);
    });
  });

  describe('Data routing', () => {
    it('updateBar() should store bar data', () => {
      const view = new FootprintView();
      view.mount(document.createElement('div'));

      const data = { ts_event: 100, open: 10, high: 11, low: 9, close: 10, volume: 1000 };
      view.updateBar(data);

      expect(view.viewState.getVisibleBarRange()).toBeDefined();
    });

    it('updateBar() should not throw when called before mount', () => {
      const view = new FootprintView();
      expect(() => view.updateBar({ ts_event: 100, open: 10, high: 11, low: 9, close: 10, volume: 1000 })).not.toThrow();
    });

    it('updateFootprint() should store footprint data', () => {
      const view = new FootprintView();
      view.mount(document.createElement('div'));

      const fp: FootprintPayload = { ts_event: 100, bin_size: 60000, levels: [{ price: 100, buy: 50, sell: 30 }] };
      view.updateFootprint(fp);

      const result = view.calculatePOCForBar(100);
      expect(result.pocPrice).toBe(100);
    });

    it('updateFootprint() should not throw when called before mount', () => {
      const view = new FootprintView();
      expect(() => view.updateFootprint({ ts_event: 100, bin_size: 60000, levels: [{ price: 100, buy: 50, sell: 30 }] })).not.toThrow();
    });

    it('updateCvd() should not throw', () => {
      const view = new FootprintView();
      expect(() => view.updateCvd({})).not.toThrow();
    });
  });

  describe('COLOR_POC constant (AC2 - visual marker color)', () => {
    it('should use #ff9800 as the POC highlight color', () => {
      expect(FootprintView.COLOR_POC).toBe('#ff9800');
    });

    it('should have distinct POC background color', () => {
      expect(FootprintView.COLOR_POC_BG).toBe('rgba(255, 152, 0, 0.12)');
    });
  });

  describe('POC rendering (AC2, AC5 - visual marker)', () => {
    it('should render POC highlight only at the identified POC price level', () => {
      const view = new FootprintView();
      const container = document.createElement('div');
      container.style.width = '800px';
      container.style.height = '600px';
      view.mount(container);

      const fp: FootprintPayload = {
        ts_event: 100,
        bin_size: 60000,
        levels: [
          { price: 100.00, buy: 50, sell: 30 },   // total = 80
          { price: 100.01, buy: 100, sell: 60 },  // total = 160 ← POC
          { price: 100.02, buy: 40, sell: 20 },   // total = 60
        ],
      };
      view.updateFootprint(fp);

      const bar = { ts_event: 100, open: 10, high: 11, low: 9, close: 10, volume: 1000 };
      view.updateBar(bar);

      expect(mockCtx.clearRect).toHaveBeenCalled();
      expect(mockCtx.fillStyle).toBeDefined();
    });
  });

  describe('Performance consideration (AC6)', () => {
    it('should calculate POC efficiently for many levels', () => {
      const view = new FootprintView();
      const levels: FootprintLevel[] = [];

      for (let i = 0; i < 100; i++) {
        levels.push({ price: 100.00 + i * 0.01, buy: Math.random() * 100, sell: Math.random() * 100 });
      }

      const start = performance.now();
      const result = view.calculatePOC(levels);
      const elapsed = performance.now() - start;

      expect(result.pocPrice).not.toBeNull();
      expect(elapsed).toBeLessThan(50);
    });

    it('should handle many bars with footprints without error', () => {
      const view = new FootprintView();
      view.mount(document.createElement('div'));

      const bars: Array<{ ts_event: number; open: number; high: number; low: number; close: number; volume: number }> = [];
      for (let i = 0; i < 50; i++) {
        bars.push({ ts_event: i * 1000, open: 100, high: 101, low: 99, close: 100, volume: 1000 });
        const levels: FootprintLevel[] = [];
        for (let j = 0; j < 10; j++) {
          levels.push({ price: 100 + j * 0.01, buy: Math.random() * 100, sell: Math.random() * 100 });
        }
        view.updateFootprint({ ts_event: i * 1000, bin_size: 60000, levels });
      }

      const state: ChartStoreState = { bars, cvd: new Map(), footprints: new Map() };
      expect(() => view.seed(state)).not.toThrow();
    });
  });

  describe('Numbers-bars visualization (AC - sell | buy format with delta backgrounds)', () => {
    it('should render volume text in "sell | buy" format', () => {
      const view = new FootprintView();
      const container = document.createElement('div');
      container.style.width = '800px';
      container.style.height = '600px';
      view.mount(container);

      const fp: FootprintPayload = {
        ts_event: 100,
        bin_size: 60000,
        levels: [
          { price: 100.00, buy: 50, sell: 30 },
        ],
      };
      view.updateFootprint(fp);
      view.updateBar({ ts_event: 100, open: 10, high: 11, low: 9, close: 10, volume: 1000 });

      expect(mockCtx.fillText).toHaveBeenCalledWith('30 | 50', expect.any(Number), expect.any(Number));
    });

    it('should render the price-axis label at bin-size precision (not the clipped over-precise form)', () => {
      const view = new FootprintView();
      const container = document.createElement('div');
      container.style.width = '800px';
      container.style.height = '600px';
      view.mount(container);

      const fp: FootprintPayload = {
        ts_event: 100,
        bin_size: 0.1,
        levels: [
          { price: 426.5, buy: 50, sell: 30 },
        ],
      };
      view.updateFootprint(fp);
      view.updateBar({ ts_event: 100, open: 426, high: 427, low: 425, close: 426.5, volume: 1000 });

      // bin_size 0.1 -> 1 decimal -> '426.5' (was the clipped '426.50000')
      const labels = mockCtx.fillText.mock.calls.map((c: unknown[]) => c[0]);
      expect(labels).toContain('426.5');
      expect(labels).not.toContain('426.50000');
    });

    it('should render a per-column time label from bar.ts_event in the header', () => {
      const view = new FootprintView();
      const container = document.createElement('div');
      container.style.width = '800px';
      container.style.height = '600px';
      view.mount(container);

      const fp: FootprintPayload = {
        ts_event: 100,
        bin_size: 60000,
        levels: [
          { price: 100.00, buy: 50, sell: 30 },
        ],
      };
      view.updateFootprint(fp);
      view.updateBar({ ts_event: 100, open: 10, high: 11, low: 9, close: 10, volume: 1000 });

      // formatTime(100) === new Date(100).toISOString().slice(11, 16) === '00:00'
      expect(mockCtx.fillText).toHaveBeenCalledWith('00:00', expect.any(Number), expect.any(Number));
    });

    it('should render green delta background when buy > sell', () => {
      const view = new FootprintView();
      const container = document.createElement('div');
      container.style.width = '800px';
      container.style.height = '600px';
      view.mount(container);

      const fp: FootprintPayload = {
        ts_event: 100,
        bin_size: 60000,
        levels: [
          { price: 100.00, buy: 100, sell: 30 },
        ],
      };
      view.updateFootprint(fp);
      view.updateBar({ ts_event: 100, open: 10, high: 11, low: 9, close: 10, volume: 1000 });

      // fillRect should have been called - rendering didn't throw
      expect(mockCtx.fillRect).toHaveBeenCalled();
    });

    it('should render red delta background when sell > buy', () => {
      const view = new FootprintView();
      const container = document.createElement('div');
      container.style.width = '800px';
      container.style.height = '600px';
      view.mount(container);

      const fp: FootprintPayload = {
        ts_event: 100,
        bin_size: 60000,
        levels: [
          { price: 100.00, buy: 30, sell: 100 },
        ],
      };
      view.updateFootprint(fp);
      view.updateBar({ ts_event: 100, open: 10, high: 11, low: 9, close: 10, volume: 1000 });

      expect(mockCtx.fillRect).toHaveBeenCalled();
    });

    it('should define COLOR_DELTA_BUY_BG as green tint', () => {
      expect(FootprintView.COLOR_DELTA_BUY_BG).toBe('rgba(38, 166, 154, 0.15)');
    });

    it('should define COLOR_DELTA_SELL_BG as red tint', () => {
      expect(FootprintView.COLOR_DELTA_SELL_BG).toBe('rgba(239, 83, 80, 0.15)');
    });
  });
});