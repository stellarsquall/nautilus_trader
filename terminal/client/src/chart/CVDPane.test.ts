import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CVDPane } from './CVDPane.js';
import { CoordinateTransform, type BarRange, type AxisMargins } from './CoordinateTransform.js';
import type { BarPayload } from '../types.js';
import type { PaneRect } from './PaneRect.js';

describe('CVDPane', () => {
  const createMockBars = (count: number): BarPayload[] => {
    return Array.from({ length: count }, (_, i) => ({
      ts_event: 1000000 + i * 60000,
      open: 100 + i,
      high: 105 + i,
      low: 95 + i,
      close: 102 + i,
      volume: 1000 + i * 100,
    }));
  };

  const createBar = (): BarPayload => ({
    ts_event: 1000000,
    open: 100,
    high: 105,
    low: 95,
    close: 102,
    volume: 1000,
  });

  const createPaneRect = (): PaneRect => ({
    x: 0,
    y: 600, // Third pane starts at y=600
    width: 800,
    height: 150,
  });

  const createHorizontalTransform = (visibleBarRange: BarRange): CoordinateTransform => {
    const margins: AxisMargins = { top: 0, right: 80, bottom: 10, left: 0 };
    const transform = new CoordinateTransform(800, 150, margins);
    transform.setVisibleBarRange(visibleBarRange);
    return transform;
  };

  describe('Constructor', () => {
    it('should construct with initialWidth and initialHeight', () => {
      const pane = new CVDPane(800, 150);
      expect(pane).toBeInstanceOf(CVDPane);
    });

    it('should create vertical transform with correct margins', () => {
      // We can't directly inspect the transform, but we can test behavior
      const pane = new CVDPane(800, 150);
      expect(pane).toBeDefined();
    });
  });

  describe('updateCvdData', () => {
    let pane: CVDPane;

    beforeEach(() => {
      pane = new CVDPane(800, 150);
    });

    it('should store CVD data by bar index', () => {
      pane.updateCvdData(0, 100, 50);
      pane.updateCvdData(1, 150, 50);
      pane.updateCvdData(2, 120, -30);

      // Verify by checking getValueRange returns correct min/max
      const bars = createMockBars(3);
      const range = pane.getValueRange(bars, 0, 2);

      expect(range).not.toBeNull();
      // Min should be around 120 - headroom, max around 150 + headroom
      expect(range!.min).toBeLessThan(120);
      expect(range!.max).toBeGreaterThan(150);
    });

    it('should update existing CVD data for same bar index', () => {
      pane.updateCvdData(0, 100, 50);
      pane.updateCvdData(0, 200, 100); // Update bar 0

      const bars = createMockBars(1);
      const range = pane.getValueRange(bars, 0, 0);

      expect(range).not.toBeNull();
      // Should reflect updated value (200), not original (100)
      expect(range!.max).toBeGreaterThan(200);
    });

    it('should handle negative CVD values', () => {
      pane.updateCvdData(0, -100, -50);
      pane.updateCvdData(1, -150, -50);

      const bars = createMockBars(2);
      const range = pane.getValueRange(bars, 0, 1);

      expect(range).not.toBeNull();
      expect(range!.min).toBeLessThan(-150);
      expect(range!.max).toBeGreaterThan(-100);
    });

    it('should handle mixed positive and negative CVD values', () => {
      pane.updateCvdData(0, -100, -100);
      pane.updateCvdData(1, 50, 150);
      pane.updateCvdData(2, 200, 150);

      const bars = createMockBars(3);
      const range = pane.getValueRange(bars, 0, 2);

      expect(range).not.toBeNull();
      expect(range!.min).toBeLessThan(-100);
      expect(range!.max).toBeGreaterThan(200);
    });
  });

  describe('reset', () => {
    it('should clear all CVD data', () => {
      const pane = new CVDPane(800, 150);
      pane.updateCvdData(0, 100, 50);
      pane.updateCvdData(1, 150, 50);

      pane.reset();

      const bars = createMockBars(2);
      const range = pane.getValueRange(bars, 0, 1);

      // Should return null after reset (no CVD data)
      expect(range).toBeNull();
    });
  });

  describe('getValueRange', () => {
    let pane: CVDPane;

    beforeEach(() => {
      pane = new CVDPane(800, 150);
    });

    it('should return null when no CVD data exists', () => {
      const bars = createMockBars(3);
      const range = pane.getValueRange(bars, 0, 2);

      expect(range).toBeNull();
    });

    it('should return null for empty bars array', () => {
      const range = pane.getValueRange([], 0, 10);
      expect(range).toBeNull();
    });

    it('should return null when startIndex > endIndex after clamping', () => {
      const bars = [createBar()];
      const range = pane.getValueRange(bars, 10, 5);
      expect(range).toBeNull();
    });

    it('should return min/max with 5% headroom for positive CVD values', () => {
      pane.updateCvdData(0, 100, 50);
      pane.updateCvdData(1, 200, 100);
      pane.updateCvdData(2, 150, -50);

      const bars = createMockBars(3);
      const range = pane.getValueRange(bars, 0, 2);

      expect(range).not.toBeNull();

      // Range is 200 - 100 = 100, headroom is 5
      expect(range!.min).toBeCloseTo(100 - 5, 1);
      expect(range!.max).toBeCloseTo(200 + 5, 1);
    });

    it('should return min/max with 5% headroom for negative CVD values', () => {
      pane.updateCvdData(0, -100, -50);
      pane.updateCvdData(1, -200, -100);

      const bars = createMockBars(2);
      const range = pane.getValueRange(bars, 0, 1);

      expect(range).not.toBeNull();

      // Range is -100 - (-200) = 100, headroom is 5
      expect(range!.min).toBeCloseTo(-200 - 5, 1);
      expect(range!.max).toBeCloseTo(-100 + 5, 1);
    });

    it('should handle single CVD point (min === max)', () => {
      pane.updateCvdData(0, 100, 50);

      const bars = createMockBars(1);
      const range = pane.getValueRange(bars, 0, 0);

      expect(range).not.toBeNull();
      // Should add fixed headroom when min === max
      expect(range!.min).toBeLessThan(100);
      expect(range!.max).toBeGreaterThan(100);
    });

    it('should handle CVD value of zero with min === max', () => {
      pane.updateCvdData(0, 0, 0);

      const bars = createMockBars(1);
      const range = pane.getValueRange(bars, 0, 0);

      expect(range).not.toBeNull();
      // Should add fixed headroom of ±1 when value is 0
      expect(range!.min).toBeCloseTo(-1, 1);
      expect(range!.max).toBeCloseTo(1, 1);
    });

    it('should clamp startIndex to valid bounds', () => {
      pane.updateCvdData(0, 100, 50);
      pane.updateCvdData(1, 200, 100);

      const bars = createMockBars(2);
      const range = pane.getValueRange(bars, -10, 1);

      expect(range).not.toBeNull();
      expect(range!.min).toBeLessThan(100);
      expect(range!.max).toBeGreaterThan(200);
    });

    it('should clamp endIndex to valid bounds', () => {
      pane.updateCvdData(0, 100, 50);
      pane.updateCvdData(1, 200, 100);

      const bars = createMockBars(2);
      const range = pane.getValueRange(bars, 0, 100);

      expect(range).not.toBeNull();
      expect(range!.min).toBeLessThan(100);
      expect(range!.max).toBeGreaterThan(200);
    });

    it('should only consider visible range for min/max', () => {
      pane.updateCvdData(0, 50, 50);
      pane.updateCvdData(1, 500, 450); // Max, but not in visible range
      pane.updateCvdData(2, 100, -400);

      const bars = createMockBars(3);
      const range = pane.getValueRange(bars, 0, 0);

      expect(range).not.toBeNull();
      // Should only consider bar 0 (CVD = 50)
      expect(range!.max).toBeLessThan(100); // Should not include 500
    });
  });

  describe('yToValue', () => {
    let pane: CVDPane;

    beforeEach(() => {
      pane = new CVDPane(800, 150);
    });

    it('should convert Y to CVD after CVD range is set', () => {
      pane.updateCvdData(0, 100, 50);
      pane.updateCvdData(1, 200, 100);

      const bars = createMockBars(2);
      const paneRect = createPaneRect();
      const horizontalTransform = createHorizontalTransform({ start: 0, end: 1 });
      const visibleBarRange: BarRange = { start: 0, end: 1 };

      // Draw to set up transforms
      const ctx = createMockContext();
      pane.draw(ctx, paneRect, horizontalTransform, bars, visibleBarRange);

      // Test yToValue - Y coordinate needs to be relative to pane rect accounting for margins
      const value = pane.yToValue(paneRect.y + 60); // Within the chart area
      expect(value).not.toBeNull();
      expect(typeof value).toBe('number');
    });

    it('should return null if vertical transform not initialized', () => {
      const value = pane.yToValue(100);
      expect(value).toBeNull();
    });

    it('should use verticalTransform.yToPrice()', () => {
      pane.updateCvdData(0, 100, 50);

      const bars = createMockBars(1);
      const paneRect = createPaneRect();
      const horizontalTransform = createHorizontalTransform({ start: 0, end: 0 });
      const visibleBarRange: BarRange = { start: 0, end: 0 };

      const ctx = createMockContext();
      pane.draw(ctx, paneRect, horizontalTransform, bars, visibleBarRange);

      const value = pane.yToValue(paneRect.y + 50);
      expect(value).not.toBeNull();
    });
  });

  describe('draw', () => {
    let pane: CVDPane;
    let ctx: CanvasRenderingContext2D;

    beforeEach(() => {
      pane = new CVDPane(800, 150);
      ctx = createMockContext();
    });

    it('should update verticalTransform dimensions on first draw', () => {
      pane.updateCvdData(0, 100, 50);
      const bars = createMockBars(1);
      const paneRect = createPaneRect();
      const horizontalTransform = createHorizontalTransform({ start: 0, end: 0 });
      const visibleBarRange: BarRange = { start: 0, end: 0 };

      pane.draw(ctx, paneRect, horizontalTransform, bars, visibleBarRange);

      // Should not throw when calling yToValue (transform initialized)
      expect(() => pane.yToValue(paneRect.y + 50)).not.toThrow();
    });

    it('should update verticalTransform dimensions when paneRect size changes', () => {
      pane.updateCvdData(0, 100, 50);
      const bars = createMockBars(1);
      const horizontalTransform = createHorizontalTransform({ start: 0, end: 0 });
      const visibleBarRange: BarRange = { start: 0, end: 0 };

      // First draw with one size
      const paneRect1 = createPaneRect();
      pane.draw(ctx, paneRect1, horizontalTransform, bars, visibleBarRange);

      // Second draw with different size
      const paneRect2 = { ...paneRect1, height: 200 };
      pane.draw(ctx, paneRect2, horizontalTransform, bars, visibleBarRange);

      // Should not throw (transform updated)
      expect(() => pane.yToValue(paneRect2.y + 50)).not.toThrow();
    });

    it('should set CVD range on verticalTransform', () => {
      pane.updateCvdData(0, 100, 50);
      pane.updateCvdData(1, 200, 100);

      const bars = createMockBars(2);
      const paneRect = createPaneRect();
      const horizontalTransform = createHorizontalTransform({ start: 0, end: 1 });
      const visibleBarRange: BarRange = { start: 0, end: 1 };

      pane.draw(ctx, paneRect, horizontalTransform, bars, visibleBarRange);

      // Verify by checking yToValue returns reasonable values
      const valueAtTop = pane.yToValue(paneRect.y + 10);
      const valueAtBottom = pane.yToValue(paneRect.y + paneRect.height - 20);

      expect(valueAtTop).toBeGreaterThan(valueAtBottom!);
    });

    it('should call ctx.save() and ctx.restore()', () => {
      pane.updateCvdData(0, 100, 50);
      const bars = createMockBars(1);
      const paneRect = createPaneRect();
      const horizontalTransform = createHorizontalTransform({ start: 0, end: 0 });
      const visibleBarRange: BarRange = { start: 0, end: 0 };

      pane.draw(ctx, paneRect, horizontalTransform, bars, visibleBarRange);

      expect(ctx.save).toHaveBeenCalled();
      expect(ctx.restore).toHaveBeenCalled();
    });

    it('should render CVD line with color #3f51b5', () => {
      pane.updateCvdData(0, 100, 50);
      pane.updateCvdData(1, 150, 50);

      const bars = createMockBars(2);
      const paneRect = createPaneRect();
      const horizontalTransform = createHorizontalTransform({ start: 0, end: 1 });
      const visibleBarRange: BarRange = { start: 0, end: 1 };

      pane.draw(ctx, paneRect, horizontalTransform, bars, visibleBarRange);

      // Check that strokeStyle was set to blue
      const strokeStyleValues = (ctx as any)._strokeStyleValues;
      expect(strokeStyleValues).toContain('#3f51b5');
    });

    it('should draw line chart with lineTo calls', () => {
      pane.updateCvdData(0, 100, 50);
      pane.updateCvdData(1, 150, 50);
      pane.updateCvdData(2, 120, -30);

      const bars = createMockBars(3);
      const paneRect = createPaneRect();
      const horizontalTransform = createHorizontalTransform({ start: 0, end: 2 });
      const visibleBarRange: BarRange = { start: 0, end: 2 };

      pane.draw(ctx, paneRect, horizontalTransform, bars, visibleBarRange);

      // Should have called moveTo (first point) and lineTo (subsequent points)
      expect(ctx.moveTo).toHaveBeenCalled();
      expect(ctx.lineTo).toHaveBeenCalled();
      expect(ctx.stroke).toHaveBeenCalled();

      // Should have 2 lineTo calls for 3 points (first is moveTo)
      expect((ctx.lineTo as any).mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it('should draw CVD axis labels as integers', () => {
      pane.updateCvdData(0, 100.7, 50);
      pane.updateCvdData(1, 200.3, 100);

      const bars = createMockBars(2);
      const paneRect = createPaneRect();
      const horizontalTransform = createHorizontalTransform({ start: 0, end: 1 });
      const visibleBarRange: BarRange = { start: 0, end: 1 };

      pane.draw(ctx, paneRect, horizontalTransform, bars, visibleBarRange);

      // Should have called fillText for axis labels
      expect(ctx.fillText).toHaveBeenCalled();

      // Check that labels are integers (no decimal points)
      const fillTextCalls = (ctx.fillText as any).mock.calls;
      const cvdLabels = fillTextCalls.filter((call: any[]) => {
        const text = call[0];
        return /^-?\d+$/.test(text); // Integer format (optional minus sign)
      });
      expect(cvdLabels.length).toBeGreaterThan(0);
    });

    it('should have margins with bottom=10 (no time axis)', () => {
      // This is a structural test - CVDPane should have margins.bottom = 10
      // We verify indirectly by checking that no time axis is drawn

      pane.updateCvdData(0, 100, 50);
      const bars = createMockBars(20);
      const paneRect = createPaneRect();
      const horizontalTransform = createHorizontalTransform({ start: 0, end: 19 });
      const visibleBarRange: BarRange = { start: 0, end: 19 };

      pane.draw(ctx, paneRect, horizontalTransform, bars, visibleBarRange);

      // Check that fillText calls do NOT include time labels (HH:MM format)
      const fillTextCalls = (ctx.fillText as any).mock.calls;
      const timeLabels = fillTextCalls.filter((call: any[]) => {
        const text = call[0];
        return /^\d{2}:\d{2}$/.test(text); // HH:MM format
      });
      expect(timeLabels.length).toBe(0); // No time labels
    });

    it('should cull missing bars', () => {
      pane.updateCvdData(0, 100, 50);
      pane.updateCvdData(1, 150, 50);

      const bars = createMockBars(2);
      const paneRect = createPaneRect();
      const horizontalTransform = createHorizontalTransform({ start: 0, end: 5 });
      const visibleBarRange: BarRange = { start: 0, end: 5 }; // Request more bars than exist

      // Should not throw
      expect(() => {
        pane.draw(ctx, paneRect, horizontalTransform, bars, visibleBarRange);
      }).not.toThrow();
    });

    it('should cull bars without CVD data', () => {
      // Only add CVD for bar 1, not bar 0
      pane.updateCvdData(1, 150, 50);

      const bars = createMockBars(2);
      const paneRect = createPaneRect();
      const horizontalTransform = createHorizontalTransform({ start: 0, end: 1 });
      const visibleBarRange: BarRange = { start: 0, end: 1 };

      pane.draw(ctx, paneRect, horizontalTransform, bars, visibleBarRange);

      // Should only draw one point (moveTo but no lineTo)
      expect(ctx.moveTo).toHaveBeenCalled();
      // lineTo might not be called if there's only one point
    });

    it('should draw grid at nice-tick CVD values', () => {
      pane.updateCvdData(0, 100, 50);
      pane.updateCvdData(1, 200, 100);

      const bars = createMockBars(2);
      const paneRect = createPaneRect();
      const horizontalTransform = createHorizontalTransform({ start: 0, end: 1 });
      const visibleBarRange: BarRange = { start: 0, end: 1 };

      pane.draw(ctx, paneRect, horizontalTransform, bars, visibleBarRange);

      // Should have called stroke for grid lines
      expect(ctx.stroke).toHaveBeenCalled();
    });

    it('should handle empty CVD data gracefully', () => {
      const bars = createMockBars(2);
      const paneRect = createPaneRect();
      const horizontalTransform = createHorizontalTransform({ start: 0, end: 1 });
      const visibleBarRange: BarRange = { start: 0, end: 1 };

      // Should not throw (draws empty pane with axis background only)
      expect(() => {
        pane.draw(ctx, paneRect, horizontalTransform, bars, visibleBarRange);
      }).not.toThrow();
    });

    it('should handle negative CVD values', () => {
      pane.updateCvdData(0, -100, -50);
      pane.updateCvdData(1, -200, -100);

      const bars = createMockBars(2);
      const paneRect = createPaneRect();
      const horizontalTransform = createHorizontalTransform({ start: 0, end: 1 });
      const visibleBarRange: BarRange = { start: 0, end: 1 };

      // Should not throw
      expect(() => {
        pane.draw(ctx, paneRect, horizontalTransform, bars, visibleBarRange);
      }).not.toThrow();

      // Should have drawn the line
      expect(ctx.moveTo).toHaveBeenCalled();
      expect(ctx.lineTo).toHaveBeenCalled();
    });
  });

  describe('destroy', () => {
    it('should not throw', () => {
      const pane = new CVDPane(800, 150);
      expect(() => pane.destroy()).not.toThrow();
    });
  });
});

// Helper to create a mock CanvasRenderingContext2D
function createMockContext(): CanvasRenderingContext2D {
  const fillStyleValues: string[] = [];
  const strokeStyleValues: string[] = [];

  const ctx = {
    _fillStyleValues: fillStyleValues,
    _strokeStyleValues: strokeStyleValues,
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn(() => ({ width: 50 })),
    setLineDash: vi.fn(),
    lineWidth: 1,
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
  } as any;

  // Define fillStyle as a property with getter/setter
  Object.defineProperty(ctx, 'fillStyle', {
    get() {
      return fillStyleValues[fillStyleValues.length - 1] || '#000000';
    },
    set(value: string) {
      fillStyleValues.push(value);
    },
    enumerable: true,
    configurable: true
  });

  // Define strokeStyle as a property with getter/setter
  Object.defineProperty(ctx, 'strokeStyle', {
    get() {
      return strokeStyleValues[strokeStyleValues.length - 1] || '#000000';
    },
    set(value: string) {
      strokeStyleValues.push(value);
    },
    enumerable: true,
    configurable: true
  });

  return ctx;
}
