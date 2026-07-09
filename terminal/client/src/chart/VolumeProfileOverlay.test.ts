import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { VolumeProfileOverlay } from './VolumeProfileOverlay';
import { CoordinateTransform, type AxisMargins, type BarRange } from './CoordinateTransform';
import type { BarPayload, FootprintPayload, FootprintLevel } from '../types';

const createMockContext = () => {
  const fillStyleValues: string[] = [];
  const ctx = {
    _fillStyleValues: fillStyleValues,
    fillRect: vi.fn(),
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    setTransform: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
  } as any;

  Object.defineProperty(ctx, 'fillStyle', {
    get() {
      return fillStyleValues[fillStyleValues.length - 1] || '#000000';
    },
    set(value: string) {
      fillStyleValues.push(value);
    },
    enumerable: true,
    configurable: true,
  });

  return ctx;
};

const sampleFootprintLevels: FootprintLevel[] = [
  { price: 0.67000, buy: 200, sell: 100 },
  { price: 0.67050, buy: 150, sell: 300 },
  { price: 0.67100, buy: 400, sell: 50 },
  { price: 0.67150, buy: 100, sell: 200 },
  { price: 0.67200, buy: 50, sell: 100 },
];

const sampleBars: BarPayload[] = [
  { ts_event: 1000, open: 0.67000, high: 0.67200, low: 0.66900, close: 0.67100, volume: 1000 },
  { ts_event: 2000, open: 0.67100, high: 0.67300, low: 0.67000, close: 0.67200, volume: 1500 },
  { ts_event: 3000, open: 0.67200, high: 0.67400, low: 0.67100, close: 0.67300, volume: 2000 },
];

const sampleFootprints: Map<number, FootprintPayload> = new Map([
  [1000, { ts_event: 1000, bin_size: 60000, levels: sampleFootprintLevels }],
  [2000, { ts_event: 2000, bin_size: 60000, levels: [
    { price: 0.67050, buy: 100, sell: 50 },
    { price: 0.67100, buy: 200, sell: 150 },
    { price: 0.67150, buy: 300, sell: 100 },
    { price: 0.67200, buy: 80, sell: 120 },
    { price: 0.67250, buy: 60, sell: 40 },
  ]}],
  [3000, { ts_event: 3000, bin_size: 60000, levels: [
    { price: 0.67150, buy: 50, sell: 200 },
    { price: 0.67200, buy: 150, sell: 100 },
    { price: 0.67250, buy: 200, sell: 300 },
    { price: 0.67300, buy: 100, sell: 50 },
  ]}],
]);

describe('VolumeProfileOverlay', () => {
  let container: HTMLDivElement;
  let transform: CoordinateTransform;
  let overlay: VolumeProfileOverlay;
  let originalGetContext: typeof HTMLCanvasElement.prototype.getContext;
  let mockContext: ReturnType<typeof createMockContext>;

  const margins: AxisMargins = { top: 20, right: 80, bottom: 40, left: 0 };

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);

    mockContext = createMockContext();

    originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = vi.fn((contextType: string) => {
      if (contextType === '2d') {
        return mockContext as any;
      }
      return null;
    });

    transform = new CoordinateTransform(800, 600, margins);
    transform.setPriceRange({ min: 0.669, max: 0.675 });
    transform.setVisibleBarRange({ start: 0, end: 99 });

    overlay = new VolumeProfileOverlay(container, transform);
    overlay.updateDimensions(800, 600);
  });

  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
    document.body.innerHTML = '';
  });

  describe('Constructor and DOM setup', () => {
    it('should create overlay canvas and append to container', () => {
      expect(container.children.length).toBe(1);
      const canvas = container.children[0] as HTMLCanvasElement;
      expect(canvas.tagName).toBe('CANVAS');
      expect(canvas.style.position).toBe('absolute');
      expect(canvas.style.pointerEvents).toBe('none');
    });

    it('should throw if 2D context is not available', () => {
      HTMLCanvasElement.prototype.getContext = vi.fn(() => null);
      expect(() => new VolumeProfileOverlay(document.createElement('div'), transform))
        .toThrow('Failed to get 2D context for overlay canvas');
    });
  });

  describe('Footprint data management', () => {
    it('should store and retrieve footprint data by ts_event', () => {
      const fp: FootprintPayload = { ts_event: 1000, bin_size: 60000, levels: [] };
      overlay.addFootprint(fp);
      expect(overlay.getFootprintCount()).toBe(1);
    });

    it('should replace existing footprint on same ts_event', () => {
      const fp1: FootprintPayload = { ts_event: 1000, bin_size: 60000, levels: [{ price: 1, buy: 10, sell: 5 }] };
      const fp2: FootprintPayload = { ts_event: 1000, bin_size: 60000, levels: [{ price: 1, buy: 20, sell: 10 }] };
      overlay.addFootprint(fp1);
      overlay.addFootprint(fp2);
      expect(overlay.getFootprintCount()).toBe(1);
    });

    it('should clear all footprints', () => {
      overlay.addFootprint({ ts_event: 1000, bin_size: 60000, levels: [] });
      overlay.addFootprint({ ts_event: 2000, bin_size: 60000, levels: [] });
      overlay.clearFootprints();
      expect(overlay.getFootprintCount()).toBe(0);
    });

    it('should replace footprint data via updateFootprintData', () => {
      const newData = new Map<number, FootprintPayload>();
      newData.set(5000, { ts_event: 5000, bin_size: 60000, levels: [] });
      overlay.updateFootprintData(newData);
      expect(overlay.getFootprintCount()).toBe(1);
    });
  });

  describe('aggregation (AC1 - aggregate footprint levels across visible bars)', () => {
    it('should aggregate buy/sell totals per price bin across visible bars', () => {
      overlay.updateFootprintData(sampleFootprints);
      const result = overlay.aggregate(sampleBars, { start: 0, end: 2 });

      expect(result).not.toBeNull();
      // Price 0.67000: only bar 0 has it -> buy=200, sell=100
      const level67000 = result!.levels.find(l => l.price === 0.67000);
      expect(level67000).toBeDefined();
      expect(level67000!.buy).toBe(200);
      expect(level67000!.sell).toBe(100);

      // Price 0.67050: bar 0 (buy=150, sell=300) + bar 1 (buy=100, sell=50) = buy=250, sell=350
      const level67050 = result!.levels.find(l => l.price === 0.67050);
      expect(level67050).toBeDefined();
      expect(level67050!.buy).toBe(250);
      expect(level67050!.sell).toBe(350);

      // Price 0.67250: bar 1 (buy=60, sell=40) + bar 2 (buy=200, sell=300) = buy=260, sell=340
      const level67250 = result!.levels.find(l => l.price === 0.67250);
      expect(level67250).toBeDefined();
      expect(level67250!.buy).toBe(260);
      expect(level67250!.sell).toBe(340);
    });

    it('should return null for empty visible range', () => {
      overlay.updateFootprintData(sampleFootprints);
      const result = overlay.aggregate([], { start: 0, end: 0 });
      expect(result).toBeNull();
    });

    it('should return null when no footprint data matches bars', () => {
      const result = overlay.aggregate(sampleBars, { start: 0, end: 2 });
      expect(result).toBeNull();
    });

    it('should handle single-level footprint', () => {
      const singleLevel: FootprintLevel[] = [{ price: 0.67100, buy: 500, sell: 300 }];
      const fp: FootprintPayload = { ts_event: 1000, bin_size: 60000, levels: singleLevel };
      overlay.addFootprint(fp);
      const result = overlay.aggregate([sampleBars[0]], { start: 0, end: 0 });
      expect(result).not.toBeNull();
      expect(result!.levels.length).toBe(1);
      expect(result!.levels[0].buy).toBe(500);
      expect(result!.levels[0].sell).toBe(300);
      expect(result!.levels[0].total).toBe(800);
    });

    it('should only consider bars in the visible range', () => {
      overlay.updateFootprintData(sampleFootprints);
      const result = overlay.aggregate(sampleBars, { start: 0, end: 0 });
      // Only bar 0's footprints should be included
      expect(result!.levels.length).toBe(sampleFootprintLevels.length);
      for (const level of result!.levels) {
        const original = sampleFootprintLevels.find(l => l.price === level.price)!;
        expect(level.buy).toBe(original.buy);
        expect(level.sell).toBe(original.sell);
      }
    });

    it('should skip missing bars in visible range', () => {
      overlay.updateFootprintData(sampleFootprints);
      const result = overlay.aggregate(sampleBars, { start: 0, end: 5 });
      // Should not throw and should aggregate only existing bars
      expect(result).not.toBeNull();
      expect(result!.levels.length).toBeGreaterThan(0);
    });
  });

  describe('POC calculation (AC4 - Point of Control)', () => {
    it('should identify POC as price with max total volume', () => {
      overlay.updateFootprintData(sampleFootprints);
      const result = overlay.aggregate(sampleBars, { start: 0, end: 2 });

      expect(result).not.toBeNull();
      // Check totals for each price:
      // 0.67000: 200+100=300
      // 0.67050: 250+350=600
      // 0.67100: 400+50 + 200+150 = 600+350=800
      // 0.67150: 100+200 + 300+100 + 50+200 = 300+400+250=950
      // 0.67200: 50+100 + 80+120 + 150+100 = 150+200+250=600
      // 0.67250: 60+40 + 200+300 = 100+500=600
      // 0.67300: 100+50=150
      // POC should be 0.67150 with total = 950
      expect(result!.pocPrice).toBe(0.67150);
    });

    it('should return null POC for empty result', () => {
      const result = overlay.aggregate(sampleBars, { start: 0, end: 2 });
      expect(result).toBeNull();
    });

    it('should handle single level POC correctly', () => {
      const singleLevel: FootprintLevel[] = [{ price: 0.67100, buy: 500, sell: 300 }];
      const fp: FootprintPayload = { ts_event: 1000, bin_size: 60000, levels: singleLevel };
      overlay.addFootprint(fp);
      const result = overlay.aggregate([sampleBars[0]], { start: 0, end: 0 });
      expect(result!.pocPrice).toBe(0.67100);
    });
  });

  describe('rendering (AC2 - horizontal bars, AC3 - buy/sell colors, AC4 - POC marker)', () => {
    it('should draw buy and sell bars for each price level', () => {
      overlay.updateFootprintData(sampleFootprints);
      overlay.render(sampleBars, { start: 0, end: 2 });

      // Should call fillRect for each level's buy and sell bars
      const fillRectCalls = mockContext.fillRect.mock.calls;
      expect(fillRectCalls.length).toBeGreaterThan(0);
    });

    it('should draw buy bars in green (#26a69a)', () => {
      overlay.updateFootprintData(sampleFootprints);
      overlay.render(sampleBars, { start: 0, end: 2 });

      const fillStyleValues = (mockContext as any)._fillStyleValues as string[];
      expect(fillStyleValues).toContain('#26a69a');
    });

    it('should draw sell bars in red (#ef5350)', () => {
      overlay.updateFootprintData(sampleFootprints);
      overlay.render(sampleBars, { start: 0, end: 2 });

      const fillStyleValues = (mockContext as any)._fillStyleValues as string[];
      expect(fillStyleValues).toContain('#ef5350');
    });

    it('should draw POC marker at Point of Control price', () => {
      overlay.updateFootprintData(sampleFootprints);
      overlay.render(sampleBars, { start: 0, end: 2 });

      expect(mockContext.beginPath).toHaveBeenCalled();
      expect(mockContext.arc).toHaveBeenCalled();
      expect(mockContext.fill).toHaveBeenCalled();
    });

    it('should clear canvas before rendering', () => {
      overlay.render(sampleBars, { start: 0, end: 2 });
      expect(mockContext.clearRect).toHaveBeenCalledWith(0, 0, 800, 600);
    });

    it('should render nothing when no footprint data', () => {
      overlay.render(sampleBars, { start: 0, end: 2 });
      // clearRect called, but no fillRect
      expect(mockContext.clearRect).toHaveBeenCalled();
      expect(mockContext.fillRect).not.toHaveBeenCalled();
    });
  });

  describe('updateDimensions and destroy', () => {
    it('should update internal dimensions', () => {
      overlay.updateDimensions(1000, 800);
      const canvas = container.children[0] as HTMLCanvasElement;
      expect(canvas.style.width).toBe('1000px');
      expect(canvas.style.height).toBe('800px');
    });

    it('should remove overlay canvas from DOM on destroy', () => {
      expect(container.children.length).toBe(1);
      overlay.destroy();
      expect(container.children.length).toBe(0);
    });

    it('should handle destroy when canvas is already removed', () => {
      const canvas = container.children[0] as HTMLCanvasElement;
      container.removeChild(canvas);
      expect(() => overlay.destroy()).not.toThrow();
    });
  });
});