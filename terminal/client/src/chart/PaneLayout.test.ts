import { describe, it, expect, vi } from 'vitest';
import { PaneLayout } from './PaneLayout.js';
import type { Pane } from './Pane.js';
import type { BarPayload } from '../types.js';
import type { BarRange, CoordinateTransform } from './CoordinateTransform.js';
import type { PaneRect } from './PaneRect.js';

// Mock Pane implementation for testing
class MockPane implements Pane {
  public getValueRangeCalls: Array<{ bars: BarPayload[]; startIndex: number; endIndex: number }> = [];
  public yToValueCalls: number[] = [];
  public drawCalls: Array<{
    ctx: CanvasRenderingContext2D;
    paneRect: PaneRect;
    horizontalTransform: CoordinateTransform;
    bars: BarPayload[];
    visibleBarRange: BarRange;
  }> = [];
  public destroyCalls = 0;

  getValueRange(bars: BarPayload[], startIndex: number, endIndex: number): { min: number; max: number } | null {
    this.getValueRangeCalls.push({ bars, startIndex, endIndex });
    return { min: 100, max: 200 };
  }

  yToValue(y: number): number | null {
    this.yToValueCalls.push(y);
    return y * 0.1; // Simple transformation for testing
  }

  draw(
    ctx: CanvasRenderingContext2D,
    paneRect: PaneRect,
    horizontalTransform: CoordinateTransform,
    bars: BarPayload[],
    visibleBarRange: BarRange
  ): void {
    this.drawCalls.push({ ctx, paneRect, horizontalTransform, bars, visibleBarRange });
  }

  destroy(): void {
    this.destroyCalls++;
  }
}

describe('PaneLayout', () => {
  describe('Constructor validation', () => {
    it('should construct successfully with valid parameters', () => {
      const pane1 = new MockPane();
      const pane2 = new MockPane();
      const layout = new PaneLayout([pane1, pane2], [0.75, 0.25], 800, 600);

      expect(layout).toBeInstanceOf(PaneLayout);
    });

    it('should throw when paneHeightFractions length does not match panes length', () => {
      const pane1 = new MockPane();
      const pane2 = new MockPane();

      expect(() => new PaneLayout([pane1, pane2], [0.75], 800, 600))
        .toThrow('paneHeightFractions length (1) must equal panes length (2)');
    });

    it('should throw when paneHeightFractions do not sum to 1.0', () => {
      const pane1 = new MockPane();
      const pane2 = new MockPane();

      expect(() => new PaneLayout([pane1, pane2], [0.5, 0.3], 800, 600))
        .toThrow('Sum of paneHeightFractions (0.8) must equal 1.0 (within 0.01 tolerance)');
    });

    it('should accept paneHeightFractions that sum to 1.0 within tolerance', () => {
      const pane1 = new MockPane();
      const pane2 = new MockPane();

      // Sum = 1.005, within 0.01 tolerance
      const layout = new PaneLayout([pane1, pane2], [0.755, 0.25], 800, 600);
      expect(layout).toBeInstanceOf(PaneLayout);
    });

    it('should throw when any paneHeightFraction is zero', () => {
      const pane1 = new MockPane();
      const pane2 = new MockPane();

      expect(() => new PaneLayout([pane1, pane2], [1.0, 0.0], 800, 600))
        .toThrow('paneHeightFraction at index 1 is 0, must be > 0');
    });

    it('should throw when any paneHeightFraction is negative', () => {
      const pane1 = new MockPane();
      const pane2 = new MockPane();

      expect(() => new PaneLayout([pane1, pane2], [1.2, -0.2], 800, 600))
        .toThrow('paneHeightFraction at index 1 is -0.2, must be > 0');
    });
  });

  describe('Pane rectangle allocation', () => {
    it('should allocate 75%/25% split correctly for 2-pane layout', () => {
      const pane1 = new MockPane();
      const pane2 = new MockPane();
      const layout = new PaneLayout([pane1, pane2], [0.75, 0.25], 800, 600);

      const rect0 = layout.getPaneRect(0);
      const rect1 = layout.getPaneRect(1);

      expect(rect0).toEqual({
        x: 0,
        y: 0,
        width: 800,
        height: 450, // Math.floor(600 * 0.75) = 450
      });

      expect(rect1).toEqual({
        x: 0,
        y: 450,
        width: 800,
        height: 150, // Math.floor(600 * 0.25) = 150
      });
    });

    it('should stack panes vertically starting from y=0', () => {
      const pane1 = new MockPane();
      const pane2 = new MockPane();
      const pane3 = new MockPane();
      const layout = new PaneLayout([pane1, pane2, pane3], [0.5, 0.3, 0.2], 800, 600);

      const rect0 = layout.getPaneRect(0);
      const rect1 = layout.getPaneRect(1);
      const rect2 = layout.getPaneRect(2);

      expect(rect0?.y).toBe(0);
      expect(rect1?.y).toBe(300); // 0 + 300
      expect(rect2?.y).toBe(480); // 0 + 300 + 180
    });
  });

  describe('getPaneRect', () => {
    it('should return correct PaneRect for valid index', () => {
      const pane1 = new MockPane();
      const pane2 = new MockPane();
      const layout = new PaneLayout([pane1, pane2], [0.75, 0.25], 800, 600);

      const rect = layout.getPaneRect(1);
      expect(rect).not.toBeNull();
      expect(rect?.y).toBe(450);
      expect(rect?.height).toBe(150);
    });

    it('should return null for negative index', () => {
      const pane1 = new MockPane();
      const layout = new PaneLayout([pane1], [1.0], 800, 600);

      expect(layout.getPaneRect(-1)).toBeNull();
    });

    it('should return null for out-of-bounds index', () => {
      const pane1 = new MockPane();
      const pane2 = new MockPane();
      const layout = new PaneLayout([pane1, pane2], [0.75, 0.25], 800, 600);

      expect(layout.getPaneRect(2)).toBeNull();
      expect(layout.getPaneRect(10)).toBeNull();
    });
  });

  describe('getPaneAtY', () => {
    it('should return correct pane index for Y coordinate in first pane', () => {
      const pane1 = new MockPane();
      const pane2 = new MockPane();
      const layout = new PaneLayout([pane1, pane2], [0.75, 0.25], 800, 600);

      expect(layout.getPaneAtY(0)).toBe(0);
      expect(layout.getPaneAtY(100)).toBe(0);
      expect(layout.getPaneAtY(449)).toBe(0);
    });

    it('should return correct pane index for Y coordinate in second pane', () => {
      const pane1 = new MockPane();
      const pane2 = new MockPane();
      const layout = new PaneLayout([pane1, pane2], [0.75, 0.25], 800, 600);

      expect(layout.getPaneAtY(450)).toBe(1);
      expect(layout.getPaneAtY(500)).toBe(1);
      expect(layout.getPaneAtY(599)).toBe(1);
    });

    it('should return null for Y coordinate outside all panes', () => {
      const pane1 = new MockPane();
      const pane2 = new MockPane();
      const layout = new PaneLayout([pane1, pane2], [0.75, 0.25], 800, 600);

      expect(layout.getPaneAtY(-1)).toBeNull();
      expect(layout.getPaneAtY(600)).toBeNull();
      expect(layout.getPaneAtY(1000)).toBeNull();
    });

    it('should handle boundary correctly (Y at exact pane boundary)', () => {
      const pane1 = new MockPane();
      const pane2 = new MockPane();
      const layout = new PaneLayout([pane1, pane2], [0.5, 0.5], 800, 600);

      // Y=300 is the boundary between panes
      // Our logic: y >= rect.y && y < rect.y + rect.height
      // So Y=300 should be in pane 1 (second pane)
      expect(layout.getPaneAtY(299)).toBe(0);
      expect(layout.getPaneAtY(300)).toBe(1);
    });
  });

  describe('yToValue', () => {
    it('should delegate to correct pane based on Y coordinate', () => {
      const pane1 = new MockPane();
      const pane2 = new MockPane();
      const layout = new PaneLayout([pane1, pane2], [0.75, 0.25], 800, 600);

      const result = layout.yToValue(100);

      expect(result).not.toBeNull();
      expect(result?.paneIndex).toBe(0);
      expect(result?.value).toBe(10); // MockPane returns y * 0.1
      expect(pane1.yToValueCalls).toContain(100);
    });

    it('should return null for Y outside all panes', () => {
      const pane1 = new MockPane();
      const pane2 = new MockPane();
      const layout = new PaneLayout([pane1, pane2], [0.75, 0.25], 800, 600);

      expect(layout.yToValue(-10)).toBeNull();
      expect(layout.yToValue(700)).toBeNull();
    });

    it('should return null when pane.yToValue returns null', () => {
      const pane1 = new MockPane();
      // Override yToValue to return null
      pane1.yToValue = () => null;

      const layout = new PaneLayout([pane1], [1.0], 800, 600);

      expect(layout.yToValue(100)).toBeNull();
    });
  });

  describe('getBarIndexAtX', () => {
    it('should delegate to horizontal transform', () => {
      const pane1 = new MockPane();
      const layout = new PaneLayout([pane1], [1.0], 800, 600);

      // Need to set visible bar range first
      const mockCtx = {} as CanvasRenderingContext2D;
      layout.render(mockCtx, { start: 0, end: 99 });

      const barIndex = layout.getBarIndexAtX(400);
      expect(typeof barIndex).toBe('number');
    });
  });

  describe('getBarWidth', () => {
    it('should delegate to horizontal transform', () => {
      const pane1 = new MockPane();
      const layout = new PaneLayout([pane1], [1.0], 800, 600);

      // Need to set visible bar range first
      const mockCtx = {} as CanvasRenderingContext2D;
      layout.render(mockCtx, { start: 0, end: 99 });

      const barWidth = layout.getBarWidth();
      expect(typeof barWidth).toBe('number');
      expect(barWidth).toBeGreaterThan(0);
    });
  });

  describe('updateLayout', () => {
    it('should recompute pane rectangles on resize', () => {
      const pane1 = new MockPane();
      const pane2 = new MockPane();
      const layout = new PaneLayout([pane1, pane2], [0.75, 0.25], 800, 600);

      // Initial rectangles
      const rect0Before = layout.getPaneRect(0);
      expect(rect0Before?.width).toBe(800);
      expect(rect0Before?.height).toBe(450);

      // Resize
      layout.updateLayout(1000, 800);

      // Rectangles should be updated
      const rect0After = layout.getPaneRect(0);
      const rect1After = layout.getPaneRect(1);

      expect(rect0After?.width).toBe(1000);
      expect(rect0After?.height).toBe(600); // Math.floor(800 * 0.75)
      expect(rect1After?.y).toBe(600);
      expect(rect1After?.height).toBe(200); // Math.floor(800 * 0.25)
    });
  });

  describe('setBars', () => {
    it('should update bar data reference', () => {
      const pane1 = new MockPane();
      const layout = new PaneLayout([pane1], [1.0], 800, 600);

      const bars: BarPayload[] = [
        { ts_event: 1000, open: 100, high: 110, low: 90, close: 105, volume: 1000 },
      ];

      layout.setBars(bars);

      // Verify bars are passed to pane during render
      const mockCtx = {} as CanvasRenderingContext2D;
      layout.render(mockCtx, { start: 0, end: 0 });

      expect(pane1.drawCalls[0].bars).toBe(bars);
    });
  });

  describe('render', () => {
    it('should call horizontalTransform.setVisibleBarRange', () => {
      const pane1 = new MockPane();
      const layout = new PaneLayout([pane1], [1.0], 800, 600);

      const mockCtx = {} as CanvasRenderingContext2D;
      const visibleBarRange: BarRange = { start: 10, end: 50 };

      layout.render(mockCtx, visibleBarRange);

      // Should not throw - this validates that setVisibleBarRange was called
      expect(() => layout.getBarWidth()).not.toThrow();
    });

    it('should call draw on all panes', () => {
      const pane1 = new MockPane();
      const pane2 = new MockPane();
      const layout = new PaneLayout([pane1, pane2], [0.75, 0.25], 800, 600);

      const mockCtx = {} as CanvasRenderingContext2D;
      const visibleBarRange: BarRange = { start: 0, end: 99 };

      layout.render(mockCtx, visibleBarRange);

      expect(pane1.drawCalls.length).toBe(1);
      expect(pane2.drawCalls.length).toBe(1);
    });

    it('should pass correct paneRect to each pane', () => {
      const pane1 = new MockPane();
      const pane2 = new MockPane();
      const layout = new PaneLayout([pane1, pane2], [0.75, 0.25], 800, 600);

      const mockCtx = {} as CanvasRenderingContext2D;
      const visibleBarRange: BarRange = { start: 0, end: 99 };

      layout.render(mockCtx, visibleBarRange);

      expect(pane1.drawCalls[0].paneRect).toEqual({
        x: 0,
        y: 0,
        width: 800,
        height: 450,
      });

      expect(pane2.drawCalls[0].paneRect).toEqual({
        x: 0,
        y: 450,
        width: 800,
        height: 150,
      });
    });

    it('should pass same horizontalTransform reference to all panes', () => {
      const pane1 = new MockPane();
      const pane2 = new MockPane();
      const layout = new PaneLayout([pane1, pane2], [0.75, 0.25], 800, 600);

      const mockCtx = {} as CanvasRenderingContext2D;
      const visibleBarRange: BarRange = { start: 0, end: 99 };

      layout.render(mockCtx, visibleBarRange);

      // Both panes should receive the same transform instance
      expect(pane1.drawCalls[0].horizontalTransform).toBe(pane2.drawCalls[0].horizontalTransform);
    });

    it('should pass bars and visibleBarRange to all panes', () => {
      const pane1 = new MockPane();
      const pane2 = new MockPane();
      const layout = new PaneLayout([pane1, pane2], [0.75, 0.25], 800, 600);

      const bars: BarPayload[] = [
        { ts_event: 1000, open: 100, high: 110, low: 90, close: 105, volume: 1000 },
      ];
      layout.setBars(bars);

      const mockCtx = {} as CanvasRenderingContext2D;
      const visibleBarRange: BarRange = { start: 0, end: 0 };

      layout.render(mockCtx, visibleBarRange);

      expect(pane1.drawCalls[0].bars).toBe(bars);
      expect(pane1.drawCalls[0].visibleBarRange).toEqual(visibleBarRange);
      expect(pane2.drawCalls[0].bars).toBe(bars);
      expect(pane2.drawCalls[0].visibleBarRange).toEqual(visibleBarRange);
    });
  });

  describe('destroy', () => {
    it('should call destroy on all panes', () => {
      const pane1 = new MockPane();
      const pane2 = new MockPane();
      const layout = new PaneLayout([pane1, pane2], [0.75, 0.25], 800, 600);

      layout.destroy();

      expect(pane1.destroyCalls).toBe(1);
      expect(pane2.destroyCalls).toBe(1);
    });

    it('should clear panes array', () => {
      const pane1 = new MockPane();
      const pane2 = new MockPane();
      const layout = new PaneLayout([pane1, pane2], [0.75, 0.25], 800, 600);

      layout.destroy();

      // After destroy, render should do nothing (no panes to render)
      const mockCtx = {} as CanvasRenderingContext2D;
      layout.render(mockCtx, { start: 0, end: 99 });

      // No additional draw calls after destroy
      expect(pane1.drawCalls.length).toBe(0);
      expect(pane2.drawCalls.length).toBe(0);
    });
  });

  describe('Integration: Multi-pane workflow', () => {
    it('should handle complete render cycle', () => {
      const pane1 = new MockPane();
      const pane2 = new MockPane();
      const layout = new PaneLayout([pane1, pane2], [0.75, 0.25], 800, 600);

      const bars: BarPayload[] = [
        { ts_event: 1000, open: 100, high: 110, low: 90, close: 105, volume: 1000 },
        { ts_event: 2000, open: 105, high: 115, low: 95, close: 110, volume: 1500 },
      ];
      layout.setBars(bars);

      const mockCtx = {} as CanvasRenderingContext2D;
      const visibleBarRange: BarRange = { start: 0, end: 1 };

      layout.render(mockCtx, visibleBarRange);

      // Verify both panes were rendered
      expect(pane1.drawCalls.length).toBe(1);
      expect(pane2.drawCalls.length).toBe(1);

      // Verify hit-testing works
      expect(layout.getPaneAtY(100)).toBe(0);
      expect(layout.getPaneAtY(500)).toBe(1);

      // Verify yToValue works
      const value = layout.yToValue(200);
      expect(value?.paneIndex).toBe(0);
      expect(value?.value).toBe(20);

      // Verify cleanup
      layout.destroy();
      expect(pane1.destroyCalls).toBe(1);
      expect(pane2.destroyCalls).toBe(1);
    });
  });
});
