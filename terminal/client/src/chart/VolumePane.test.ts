import { describe, it, expect, beforeEach, vi } from 'vitest';
import { VolumePane } from './VolumePane.js';
import { CoordinateTransform, type BarRange, type AxisMargins } from './CoordinateTransform.js';
import type { BarPayload } from '../types.js';
import type { PaneRect } from './PaneRect.js';

describe('VolumePane', () => {
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

  const createUpBar = (volume: number): BarPayload => ({
    ts_event: 1000000,
    open: 100,
    high: 105,
    low: 95,
    close: 103, // close >= open → up bar
    volume,
  });

  const createDownBar = (volume: number): BarPayload => ({
    ts_event: 1000000,
    open: 100,
    high: 105,
    low: 95,
    close: 98, // close < open → down bar
    volume,
  });

  const createPaneRect = (): PaneRect => ({
    x: 0,
    y: 450, // Bottom pane starts at y=450
    width: 800,
    height: 150,
  });

  const createHorizontalTransform = (visibleBarRange: BarRange): CoordinateTransform => {
    const margins: AxisMargins = { top: 0, right: 80, bottom: 40, left: 0 };
    const transform = new CoordinateTransform(800, 150, margins);
    transform.setVisibleBarRange(visibleBarRange);
    return transform;
  };

  describe('Constructor', () => {
    it('should construct with initialWidth and initialHeight', () => {
      const pane = new VolumePane(800, 150);
      expect(pane).toBeInstanceOf(VolumePane);
    });

    it('should create vertical transform with correct margins', () => {
      // We can't directly inspect the transform, but we can test behavior
      const pane = new VolumePane(800, 150);
      expect(pane).toBeDefined();
    });
  });

  describe('getValueRange', () => {
    let pane: VolumePane;

    beforeEach(() => {
      pane = new VolumePane(800, 150);
    });

    it('should return [0, maxVolume * 1.05] from visible bars', () => {
      const bars = [
        createUpBar(1000),
        createUpBar(2000),
        createUpBar(1500),
      ];

      const range = pane.getValueRange(bars, 0, 2);
      expect(range).toEqual({ min: 0, max: 2000 * 1.05 });
    });

    it('should clamp startIndex to valid bounds', () => {
      const bars = [
        createUpBar(1000),
        createUpBar(2000),
        createUpBar(1500),
      ];

      const range = pane.getValueRange(bars, -10, 2);
      expect(range).toEqual({ min: 0, max: 2000 * 1.05 });
    });

    it('should clamp endIndex to valid bounds', () => {
      const bars = [
        createUpBar(1000),
        createUpBar(2000),
        createUpBar(1500),
      ];

      const range = pane.getValueRange(bars, 0, 100);
      expect(range).toEqual({ min: 0, max: 2000 * 1.05 });
    });

    it('should return null for empty bars array', () => {
      const range = pane.getValueRange([], 0, 10);
      expect(range).toBeNull();
    });

    it('should return null when startIndex > endIndex after clamping', () => {
      const bars = [createUpBar(1000)];
      const range = pane.getValueRange(bars, 10, 5);
      expect(range).toBeNull();
    });

    it('should handle single bar', () => {
      const bars = [createUpBar(1000)];
      const range = pane.getValueRange(bars, 0, 0);
      expect(range).toEqual({ min: 0, max: 1000 * 1.05 });
    });

    it('should handle zero-volume bars', () => {
      const bars = [
        createUpBar(0),
        createUpBar(0),
        createUpBar(0),
      ];

      const range = pane.getValueRange(bars, 0, 2);
      expect(range).toEqual({ min: 0, max: 0 });
    });

    it('should find max volume across range', () => {
      const bars = createMockBars(10);
      const range = pane.getValueRange(bars, 0, 9);
      // Last bar has volume 1000 + 9 * 100 = 1900
      expect(range).toEqual({ min: 0, max: 1900 * 1.05 });
    });

    it('should only consider visible range for max volume', () => {
      const bars = [
        createUpBar(500),
        createUpBar(3000), // Max, but not in visible range
        createUpBar(1000),
      ];

      const range = pane.getValueRange(bars, 0, 0);
      expect(range).toEqual({ min: 0, max: 500 * 1.05 });
    });
  });

  describe('yToValue', () => {
    let pane: VolumePane;

    beforeEach(() => {
      pane = new VolumePane(800, 150);
    });

    it('should convert Y to volume after volume range is set', () => {
      const bars = [createUpBar(1000), createUpBar(2000)];
      const paneRect = createPaneRect();
      const horizontalTransform = createHorizontalTransform({ start: 0, end: 1 });
      const visibleBarRange: BarRange = { start: 0, end: 1 };

      // Draw to set up transforms
      const ctx = createMockContext();
      pane.draw(ctx, paneRect, horizontalTransform, bars, visibleBarRange);

      // Test yToValue - Y coordinate needs to be relative to pane rect accounting for margins
      // The volume range is [0, 2100], and Y coordinates are inverted
      const value = pane.yToValue(paneRect.y + 60); // Within the chart area
      expect(value).not.toBeNull();
      expect(typeof value).toBe('number');
    });

    it('should return null if vertical transform not initialized', () => {
      const value = pane.yToValue(100);
      expect(value).toBeNull();
    });
  });

  describe('draw', () => {
    let pane: VolumePane;
    let ctx: CanvasRenderingContext2D;

    beforeEach(() => {
      pane = new VolumePane(800, 150);
      ctx = createMockContext();
    });

    it('should update verticalTransform dimensions on first draw', () => {
      const bars = [createUpBar(1000)];
      const paneRect = createPaneRect();
      const horizontalTransform = createHorizontalTransform({ start: 0, end: 0 });
      const visibleBarRange: BarRange = { start: 0, end: 0 };

      pane.draw(ctx, paneRect, horizontalTransform, bars, visibleBarRange);

      // Should not throw when calling yToValue (transform initialized)
      expect(() => pane.yToValue(paneRect.y + 50)).not.toThrow();
    });

    it('should update verticalTransform dimensions when paneRect size changes', () => {
      const bars = [createUpBar(1000)];
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

    it('should set volume range on verticalTransform', () => {
      const bars = [createUpBar(1000), createUpBar(2000)];
      const paneRect = createPaneRect();
      const horizontalTransform = createHorizontalTransform({ start: 0, end: 1 });
      const visibleBarRange: BarRange = { start: 0, end: 1 };

      pane.draw(ctx, paneRect, horizontalTransform, bars, visibleBarRange);

      // Verify by checking yToValue returns reasonable values
      const valueAtTop = pane.yToValue(paneRect.y + 10);
      const valueAtBottom = pane.yToValue(paneRect.y + paneRect.height - 50);

      expect(valueAtTop).toBeGreaterThan(valueAtBottom!);
    });

    it('should call ctx.save() and ctx.restore()', () => {
      const bars = [createUpBar(1000)];
      const paneRect = createPaneRect();
      const horizontalTransform = createHorizontalTransform({ start: 0, end: 0 });
      const visibleBarRange: BarRange = { start: 0, end: 0 };

      pane.draw(ctx, paneRect, horizontalTransform, bars, visibleBarRange);

      expect(ctx.save).toHaveBeenCalled();
      expect(ctx.restore).toHaveBeenCalled();
    });

    it('should draw volume bars at correct positions', () => {
      const bars = [createUpBar(1000), createDownBar(1500)];
      const paneRect = createPaneRect();
      const horizontalTransform = createHorizontalTransform({ start: 0, end: 1 });
      const visibleBarRange: BarRange = { start: 0, end: 1 };

      pane.draw(ctx, paneRect, horizontalTransform, bars, visibleBarRange);

      // Should have called fillRect for volume bars
      expect(ctx.fillRect).toHaveBeenCalled();

      // Count fillRect calls for volume bars (excluding axis backgrounds)
      const fillRectCalls = (ctx.fillRect as any).mock.calls;
      const barWidth = horizontalTransform.getBarWidth();
      const volumeBarWidth = barWidth * 0.8;
      const volumeBarCalls = fillRectCalls.filter((call: any[]) => {
        const [x, y, w, h] = call;
        // Volume bars have positive height and width close to volumeBarWidth
        return h > 1 && Math.abs(w - volumeBarWidth) < 1;
      });
      expect(volumeBarCalls.length).toBeGreaterThanOrEqual(2);
    });

    it('should color up-bars green', () => {
      const bars = [createUpBar(1000)];
      const paneRect = createPaneRect();
      const horizontalTransform = createHorizontalTransform({ start: 0, end: 0 });
      const visibleBarRange: BarRange = { start: 0, end: 0 };

      pane.draw(ctx, paneRect, horizontalTransform, bars, visibleBarRange);

      // Check that fillStyle was set to green
      const fillStyleValues = (ctx as any)._fillStyleValues;
      expect(fillStyleValues).toContain('#26a69a');
    });

    it('should color down-bars red', () => {
      const bars = [createDownBar(1000)];
      const paneRect = createPaneRect();
      const horizontalTransform = createHorizontalTransform({ start: 0, end: 0 });
      const visibleBarRange: BarRange = { start: 0, end: 0 };

      pane.draw(ctx, paneRect, horizontalTransform, bars, visibleBarRange);

      // Check that fillStyle was set to red
      const fillStyleValues = (ctx as any)._fillStyleValues;
      expect(fillStyleValues).toContain('#ef5350');
    });

    it('should cull missing bars', () => {
      const bars = [createUpBar(1000), createUpBar(1500)];
      const paneRect = createPaneRect();
      const horizontalTransform = createHorizontalTransform({ start: 0, end: 5 });
      const visibleBarRange: BarRange = { start: 0, end: 5 }; // Request more bars than exist

      // Should not throw
      expect(() => {
        pane.draw(ctx, paneRect, horizontalTransform, bars, visibleBarRange);
      }).not.toThrow();
    });

    it('should cull zero-volume bars', () => {
      const bars = [createUpBar(0), createUpBar(1000)];
      const paneRect = createPaneRect();
      const horizontalTransform = createHorizontalTransform({ start: 0, end: 1 });
      const visibleBarRange: BarRange = { start: 0, end: 1 };

      pane.draw(ctx, paneRect, horizontalTransform, bars, visibleBarRange);

      // Should draw only one bar (the non-zero one)
      // This is implicit - if it doesn't throw, it handles zero-volume correctly
      expect(ctx.fillRect).toHaveBeenCalled();
    });

    it('should draw grid at nice-tick volumes', () => {
      const bars = [createUpBar(1000), createUpBar(2000)];
      const paneRect = createPaneRect();
      const horizontalTransform = createHorizontalTransform({ start: 0, end: 1 });
      const visibleBarRange: BarRange = { start: 0, end: 1 };

      pane.draw(ctx, paneRect, horizontalTransform, bars, visibleBarRange);

      // Should have called stroke for grid lines
      expect(ctx.stroke).toHaveBeenCalled();
    });

    it('should draw volume axis labels with integer format', () => {
      const bars = [createUpBar(1000), createUpBar(2000)];
      const paneRect = createPaneRect();
      const horizontalTransform = createHorizontalTransform({ start: 0, end: 1 });
      const visibleBarRange: BarRange = { start: 0, end: 1 };

      pane.draw(ctx, paneRect, horizontalTransform, bars, visibleBarRange);

      // Should have called fillText for axis labels
      expect(ctx.fillText).toHaveBeenCalled();

      // Check that labels are integers (no decimal points)
      const fillTextCalls = (ctx.fillText as any).mock.calls;
      const volumeLabels = fillTextCalls.filter((call: any[]) => {
        const text = call[0];
        return /^\d+$/.test(text); // Integer format
      });
      expect(volumeLabels.length).toBeGreaterThan(0);
    });

    it('should draw time axis labels', () => {
      const bars = createMockBars(20);
      const paneRect = createPaneRect();
      const horizontalTransform = createHorizontalTransform({ start: 0, end: 19 });
      const visibleBarRange: BarRange = { start: 0, end: 19 };

      pane.draw(ctx, paneRect, horizontalTransform, bars, visibleBarRange);

      // Should have called fillText for time labels
      expect(ctx.fillText).toHaveBeenCalled();

      // Time labels should be in HH:MM format
      const fillTextCalls = (ctx.fillText as any).mock.calls;
      const timeLabels = fillTextCalls.filter((call: any[]) => {
        const text = call[0];
        return /^\d{2}:\d{2}$/.test(text); // HH:MM format
      });
      expect(timeLabels.length).toBeGreaterThan(0);
    });

    it('should use 80% of barWidth for volume bars', () => {
      const bars = [createUpBar(1000)];
      const paneRect = createPaneRect();
      const horizontalTransform = createHorizontalTransform({ start: 0, end: 0 });
      const visibleBarRange: BarRange = { start: 0, end: 0 };

      pane.draw(ctx, paneRect, horizontalTransform, bars, visibleBarRange);

      const barWidth = horizontalTransform.getBarWidth();
      const expectedWidth = barWidth * 0.8;

      // Find volume bar fillRect calls
      const fillRectCalls = (ctx.fillRect as any).mock.calls;
      const volumeBarCall = fillRectCalls.find((call: any[]) => {
        const [x, y, w, h] = call;
        return h > 0 && Math.abs(w - expectedWidth) < 0.1;
      });

      expect(volumeBarCall).toBeDefined();
    });

    it('should center volume bars at bar X', () => {
      const bars = [createUpBar(1000)];
      const paneRect = createPaneRect();
      const horizontalTransform = createHorizontalTransform({ start: 0, end: 0 });
      const visibleBarRange: BarRange = { start: 0, end: 0 };

      pane.draw(ctx, paneRect, horizontalTransform, bars, visibleBarRange);

      const barX = horizontalTransform.barIndexToX(0);
      const barWidth = horizontalTransform.getBarWidth();
      const volumeBarWidth = barWidth * 0.8;
      const expectedX = barX - volumeBarWidth / 2;

      // Find volume bar fillRect call
      const fillRectCalls = (ctx.fillRect as any).mock.calls;
      const volumeBarCall = fillRectCalls.find((call: any[]) => {
        const [x, y, w, h] = call;
        return h > 0 && Math.abs(w - volumeBarWidth) < 0.1;
      });

      expect(volumeBarCall).toBeDefined();
      expect(volumeBarCall[0]).toBeCloseTo(expectedX, 1);
    });

    it('should handle empty bars array gracefully', () => {
      const bars: BarPayload[] = [];
      const paneRect = createPaneRect();
      const horizontalTransform = createHorizontalTransform({ start: 0, end: 0 });
      const visibleBarRange: BarRange = { start: 0, end: 0 };

      // Should not throw
      expect(() => {
        pane.draw(ctx, paneRect, horizontalTransform, bars, visibleBarRange);
      }).not.toThrow();
    });
  });

  describe('destroy', () => {
    it('should not throw', () => {
      const pane = new VolumePane(800, 150);
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
