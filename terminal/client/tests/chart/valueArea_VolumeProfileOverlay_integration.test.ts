import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { calculateValueArea, type ValueAreaLevel, type ValueAreaResult } from '../../src/chart/valueArea';
import { VolumeProfileOverlay } from '../../src/chart/VolumeProfileOverlay';
import { CoordinateTransform, type AxisMargins, type BarRange } from '../../src/chart/CoordinateTransform';
import type { BarPayload, FootprintPayload, FootprintLevel } from '../../src/types';

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
    get() { return fillStyleValues[fillStyleValues.length - 1] || '#000000'; },
    set(value: string) { fillStyleValues.push(value); },
    enumerable: true,
    configurable: true,
  });
  return ctx;
};

const margins: AxisMargins = { top: 20, right: 80, bottom: 40, left: 0 };

function buildBars(tsEvents: number[]): BarPayload[] {
  return tsEvents.map(ts => ({
    ts_event: ts, open: 100, high: 101, low: 99, close: 100.5, volume: 1000,
  }));
}

describe('valueArea + VolumeProfileOverlay integration', () => {
  let container: HTMLDivElement;
  let transform: CoordinateTransform;
  let overlay: VolumeProfileOverlay;
  let originalGetContext: typeof HTMLCanvasElement.prototype.getContext;
  let mockContext: ReturnType<typeof createMockContext>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    mockContext = createMockContext();
    originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = vi.fn((contextType: string) => {
      if (contextType === '2d') return mockContext as any;
      return null;
    });
    transform = new CoordinateTransform(800, 600, margins);
    transform.setPriceRange({ min: 99, max: 105 });
    transform.setVisibleBarRange({ start: 0, end: 99 });
    overlay = new VolumeProfileOverlay(container, transform);
    overlay.updateDimensions(800, 600);
  });

  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
    document.body.innerHTML = '';
  });

  it('calculateValueArea consumes VolumeProfileOverlay aggregate output format', () => {
    const levels: FootprintLevel[] = [
      { price: 100.00, buy: 100, sell: 50 },
      { price: 100.50, buy: 300, sell: 200 },
      { price: 101.00, buy: 500, sell: 400 },
      { price: 101.50, buy: 200, sell: 100 },
      { price: 102.00, buy: 80, sell: 40 },
    ];
    const fp: FootprintPayload = { ts_event: 1000, bin_size: 60000, levels };
    overlay.addFootprint(fp);
    const bars = buildBars([1000]);
    const result = overlay.aggregate(bars, { start: 0, end: 0 });
    expect(result).not.toBeNull();

    const valueAreaLevels: ValueAreaLevel[] = result!.levels.map(l => ({
      price: l.price,
      total: l.total,
    }));
    const pocPrice = result!.pocPrice;
    expect(pocPrice).not.toBeNull();

    const vaResult = calculateValueArea(valueAreaLevels, pocPrice);
    expect(vaResult).not.toBeNull();
    expect(vaResult!.val).toBeLessThanOrEqual(vaResult!.poc);
    expect(vaResult!.poc).toBeLessThanOrEqual(vaResult!.vah);
  });

  it('calculateValueArea uses aggregate totals from VolumeProfileOverlay across multiple bars', () => {
    const fp1: FootprintPayload = {
      ts_event: 1000, bin_size: 60000,
      levels: [
        { price: 100.00, buy: 50, sell: 30 },
        { price: 101.00, buy: 200, sell: 100 },
        { price: 102.00, buy: 30, sell: 20 },
      ],
    };
    const fp2: FootprintPayload = {
      ts_event: 2000, bin_size: 60000,
      levels: [
        { price: 100.00, buy: 20, sell: 10 },
        { price: 101.00, buy: 100, sell: 50 },
        { price: 102.00, buy: 60, sell: 40 },
      ],
    };
    overlay.addFootprint(fp1);
    overlay.addFootprint(fp2);
    const bars = buildBars([1000, 2000]);
    const result = overlay.aggregate(bars, { start: 0, end: 1 });
    expect(result).not.toBeNull();

    const valueAreaLevels: ValueAreaLevel[] = result!.levels.map(l => ({
      price: l.price,
      total: l.total,
    }));
    const vaResult = calculateValueArea(valueAreaLevels, result!.pocPrice);
    expect(vaResult).not.toBeNull();
    expect(vaResult!.val).toBeLessThanOrEqual(vaResult!.poc);
    expect(vaResult!.poc).toBeLessThanOrEqual(vaResult!.vah);
    expect(vaResult!.vah).toBeGreaterThanOrEqual(vaResult!.val);
  });

  it('calculateValueArea returns null when VolumeProfileOverlay aggregates return null', () => {
    const result = overlay.aggregate([], { start: 0, end: 0 });
    expect(result).toBeNull();
    const vaResult = calculateValueArea(null, null);
    expect(vaResult).toBeNull();
  });

  it('calculateValueArea handles single price level from VolumeProfileOverlay aggregate', () => {
    const levels: FootprintLevel[] = [{ price: 100.00, buy: 500, sell: 300 }];
    const fp: FootprintPayload = { ts_event: 1000, bin_size: 60000, levels };
    overlay.addFootprint(fp);
    const bars = buildBars([1000]);
    const result = overlay.aggregate(bars, { start: 0, end: 0 });
    expect(result).not.toBeNull();
    expect(result!.levels.length).toBe(1);

    const valueAreaLevels: ValueAreaLevel[] = result!.levels.map(l => ({
      price: l.price,
      total: l.total,
    }));
    const vaResult = calculateValueArea(valueAreaLevels, result!.pocPrice);
    expect(vaResult).not.toBeNull();
    expect(vaResult!.vah).toBe(100.00);
    expect(vaResult!.val).toBe(100.00);
    expect(vaResult!.poc).toBe(100.00);
  });

  it('overlay aggregate pocPrice matches calculateValueArea POC input', () => {
    const levels: FootprintLevel[] = [
      { price: 99.00, buy: 10, sell: 5 },
      { price: 100.00, buy: 100, sell: 50 },
      { price: 101.00, buy: 20, sell: 10 },
    ];
    const fp: FootprintPayload = { ts_event: 1000, bin_size: 60000, levels };
    overlay.addFootprint(fp);
    const bars = buildBars([1000]);
    const result = overlay.aggregate(bars, { start: 0, end: 0 });
    expect(result).not.toBeNull();
    expect(result!.pocPrice).toBe(100.00);

    const valueAreaLevels: ValueAreaLevel[] = result!.levels.map(l => ({
      price: l.price,
      total: l.total,
    }));
    const vaResult = calculateValueArea(valueAreaLevels, result!.pocPrice);
    expect(vaResult).not.toBeNull();
    expect(vaResult!.poc).toBe(100.00);
  });
});
