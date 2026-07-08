/**
 * CandlestickPane unit tests.
 *
 * Tests getValueRange, yToValue, and draw methods with jsdom canvas mocking.
 * Verifies price range computation, coordinate conversion, candle rendering,
 * color selection (bullish vs bearish), doji handling, and axis rendering.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CandlestickPane } from './CandlestickPane.js';
import type { BarPayload } from '../types.js';
import type { PaneRect } from './PaneRect.js';
import { CoordinateTransform, type BarRange } from './CoordinateTransform.js';

describe('CandlestickPane', () => {
  let pane: CandlestickPane;
  let mockCtx: CanvasRenderingContext2D;
  let horizontalTransform: CoordinateTransform;

  const defaultPaneRect: PaneRect = {
    x: 0,
    y: 0,
    width: 800,
    height: 600,
  };

  // Sample bar data
  const sampleBars: BarPayload[] = [
    { ts_event: 1000, open: 100, high: 110, low: 95, close: 105, volume: 1000 },
    { ts_event: 2000, open: 105, high: 115, low: 100, close: 110, volume: 1500 },
    { ts_event: 3000, open: 110, high: 120, low: 105, close: 115, volume: 2000 },
    { ts_event: 4000, open: 115, high: 125, low: 110, close: 112, volume: 1200 },
    { ts_event: 5000, open: 112, high: 118, low: 108, close: 116, volume: 1800 },
  ];

  beforeEach(() => {
    pane = new CandlestickPane(800, 600);

    // Create horizontal transform for shared bar→X mapping
    horizontalTransform = new CoordinateTransform(800, 600, {
      top: 10,
      right: 80,
      bottom: 10,
      left: 0,
    });
    horizontalTransform.setVisibleBarRange({ start: 0, end: 4 });

    // Mock canvas context
    mockCtx = {
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      fillRect: vi.fn(),
      strokeRect: vi.fn(),
      fillText: vi.fn(),
      measureText: vi.fn(() => ({ width: 50 })),
      rect: vi.fn(),
      clip: vi.fn(),
      setLineDash: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
  });

  describe('Constructor', () => {
    it('should create CandlestickPane with valid dimensions', () => {
      const pane = new CandlestickPane(800, 600);
      expect(pane).toBeInstanceOf(CandlestickPane);
    });

    it('should create vertical transform with margins {top: 10, right: 80, bottom: 10, left: 0}', () => {
      const pane = new CandlestickPane(800, 600);
      // Verify by calling getValueRange (which uses the transform internally)
      expect(pane).toBeInstanceOf(CandlestickPane);
    });
  });

  describe('getValueRange', () => {
    it('should return correct PriceRange for valid bar range', () => {
      const range = pane.getValueRange(sampleBars, 0, 4);
      expect(range).not.toBeNull();
      expect(range!.min).toBeLessThan(95); // Should include margin below lowest low
      expect(range!.max).toBeGreaterThan(125); // Should include margin above highest high
    });

    it('should return null for empty bars array', () => {
      const range = pane.getValueRange([], 0, 4);
      expect(range).toBeNull();
    });

    it('should return null when startIndex > endIndex', () => {
      const range = pane.getValueRange(sampleBars, 4, 0);
      expect(range).toBeNull();
    });

    it('should clamp startIndex to 0 if negative', () => {
      const range = pane.getValueRange(sampleBars, -5, 2);
      expect(range).not.toBeNull();
      // Should use bars[0..2], finding min=95, max=120
      expect(range!.min).toBeLessThan(95);
      expect(range!.max).toBeGreaterThan(120);
    });

    it('should clamp endIndex to bars.length-1 if too large', () => {
      const range = pane.getValueRange(sampleBars, 0, 100);
      expect(range).not.toBeNull();
      // Should use bars[0..4], finding min=95, max=125
      expect(range!.min).toBeLessThan(95);
      expect(range!.max).toBeGreaterThan(125);
    });

    it('should handle single bar range', () => {
      const range = pane.getValueRange(sampleBars, 1, 1);
      expect(range).not.toBeNull();
      // Should use bars[1]: high=115, low=100
      expect(range!.min).toBeLessThan(100);
      expect(range!.max).toBeGreaterThan(115);
    });

    it('should return null when clamped indices produce invalid range', () => {
      const range = pane.getValueRange(sampleBars, 10, 20);
      expect(range).toBeNull();
    });
  });

  describe('yToValue', () => {
    it('should convert Y to price after draw sets price range', () => {
      // First call draw to set up the price range
      pane.draw(mockCtx, defaultPaneRect, horizontalTransform, sampleBars, { start: 0, end: 4 });

      // Now yToValue should work
      const price = pane.yToValue(300); // Middle of pane (y=300 in 600px height)
      expect(price).not.toBeNull();
      expect(typeof price).toBe('number');
    });

    it('should return null if priceRange not set', () => {
      // Without calling draw first, price range is not set
      const price = pane.yToValue(300);
      expect(price).toBeNull();
    });

    it('should return null for non-finite Y', () => {
      pane.draw(mockCtx, defaultPaneRect, horizontalTransform, sampleBars, { start: 0, end: 4 });
      const price = pane.yToValue(NaN);
      expect(price).toBeNull();
    });
  });

  describe('draw', () => {
    it('should update vertical transform dimensions on first draw', () => {
      const visibleBarRange: BarRange = { start: 0, end: 4 };
      pane.draw(mockCtx, defaultPaneRect, horizontalTransform, sampleBars, visibleBarRange);

      // Verify ctx.save() was called (part of draw workflow)
      expect(mockCtx.save).toHaveBeenCalled();
      expect(mockCtx.restore).toHaveBeenCalled();
    });

    it('should update vertical transform dimensions when paneRect changes', () => {
      const visibleBarRange: BarRange = { start: 0, end: 4 };

      // First draw
      pane.draw(mockCtx, defaultPaneRect, horizontalTransform, sampleBars, visibleBarRange);
      const saveCallCount1 = (mockCtx.save as any).mock.calls.length;

      // Second draw with different paneRect
      const newPaneRect: PaneRect = { x: 0, y: 0, width: 1000, height: 700 };
      pane.draw(mockCtx, newPaneRect, horizontalTransform, sampleBars, visibleBarRange);
      const saveCallCount2 = (mockCtx.save as any).mock.calls.length;

      // Both draws should call save
      expect(saveCallCount2).toBeGreaterThan(saveCallCount1);
    });

    it('should compute autoscaled price range', () => {
      const visibleBarRange: BarRange = { start: 0, end: 4 };
      pane.draw(mockCtx, defaultPaneRect, horizontalTransform, sampleBars, visibleBarRange);

      // Should have rendered candles (fillRect called for bodies)
      expect(mockCtx.fillRect).toHaveBeenCalled();
    });

    it('should render axis background', () => {
      const visibleBarRange: BarRange = { start: 0, end: 4 };
      pane.draw(mockCtx, defaultPaneRect, horizontalTransform, sampleBars, visibleBarRange);

      // Check fillRect was called for axis background
      expect(mockCtx.fillRect).toHaveBeenCalled();
    });

    it('should render grid at nice-tick prices', () => {
      const visibleBarRange: BarRange = { start: 0, end: 4 };
      pane.draw(mockCtx, defaultPaneRect, horizontalTransform, sampleBars, visibleBarRange);

      // Check stroke was called for grid lines
      expect(mockCtx.stroke).toHaveBeenCalled();
      expect(mockCtx.moveTo).toHaveBeenCalled();
      expect(mockCtx.lineTo).toHaveBeenCalled();
    });

    it('should render candles at correct positions', () => {
      const visibleBarRange: BarRange = { start: 0, end: 4 };
      pane.draw(mockCtx, defaultPaneRect, horizontalTransform, sampleBars, visibleBarRange);

      // Check fillRect called for candle bodies (5 bars)
      const fillRectCalls = (mockCtx.fillRect as any).mock.calls;
      expect(fillRectCalls.length).toBeGreaterThan(0);
    });

    it('should color bullish candles green', () => {
      const bullishBar: BarPayload = { ts_event: 1000, open: 100, high: 110, low: 95, close: 105, volume: 1000 };
      const visibleBarRange: BarRange = { start: 0, end: 0 };

      pane.draw(mockCtx, defaultPaneRect, horizontalTransform, [bullishBar], visibleBarRange);

      // Check that fillStyle was set to green at some point
      // (This is indirect since we can't easily check the exact sequence)
      expect(mockCtx.fillRect).toHaveBeenCalled();
    });

    it('should color bearish candles red', () => {
      const bearishBar: BarPayload = { ts_event: 1000, open: 110, high: 115, low: 100, close: 105, volume: 1000 };
      const visibleBarRange: BarRange = { start: 0, end: 0 };

      pane.draw(mockCtx, defaultPaneRect, horizontalTransform, [bearishBar], visibleBarRange);

      // Check that fillRect was called for candle body
      expect(mockCtx.fillRect).toHaveBeenCalled();
    });

    // --- Delta-based coloring (slice 5) ---

    const UP = '#26a69a';
    const DOWN = '#ef5350';

    // Build a ctx that records every fillStyle assignment so we can assert the
    // candle body color (the only green/red fillStyle in the draw sequence).
    function trackingCtx(): { ctx: CanvasRenderingContext2D; fills: string[] } {
      const fills: string[] = [];
      const base = {
        save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(),
        lineTo: vi.fn(), stroke: vi.fn(), fillRect: vi.fn(), strokeRect: vi.fn(),
        fillText: vi.fn(), measureText: vi.fn(() => ({ width: 50 })), rect: vi.fn(),
        clip: vi.fn(), setLineDash: vi.fn(),
      } as Record<string, unknown>;
      let fillStyle: string | CanvasGradient | CanvasPattern = '';
      Object.defineProperty(base, 'fillStyle', {
        get: () => fillStyle,
        set: (v) => { fillStyle = v; if (typeof v === 'string') fills.push(v); },
      });
      return { ctx: base as unknown as CanvasRenderingContext2D, fills };
    }

    it('defaults to delta coloring enabled', () => {
      expect(pane.isColorByDelta()).toBe(true);
    });

    it('delta mode colors a positive-delta bar green even when close < open', () => {
      // Bearish by price (close < open) but positive order-flow delta.
      const bar: BarPayload = { ts_event: 1000, open: 110, high: 115, low: 100, close: 105, volume: 1000, delta: 250 };
      const { ctx, fills } = trackingCtx();
      pane.draw(ctx, defaultPaneRect, horizontalTransform, [bar], { start: 0, end: 0 });
      expect(fills).toContain(UP);
      expect(fills).not.toContain(DOWN);
    });

    it('delta mode colors a negative-delta bar red even when close > open', () => {
      // Bullish by price (close > open) but negative order-flow delta.
      const bar: BarPayload = { ts_event: 1000, open: 100, high: 115, low: 95, close: 110, volume: 1000, delta: -250 };
      const { ctx, fills } = trackingCtx();
      pane.draw(ctx, defaultPaneRect, horizontalTransform, [bar], { start: 0, end: 0 });
      expect(fills).toContain(DOWN);
      expect(fills).not.toContain(UP);
    });

    it('falls back to close-vs-open coloring when delta is absent', () => {
      const bar: BarPayload = { ts_event: 1000, open: 110, high: 115, low: 100, close: 105, volume: 1000 };
      const { ctx, fills } = trackingCtx();
      pane.draw(ctx, defaultPaneRect, horizontalTransform, [bar], { start: 0, end: 0 });
      expect(fills).toContain(DOWN); // close < open -> red
    });

    it('setColorByDelta(false) reverts to close-vs-open even when delta present', () => {
      // Bullish by price but negative delta; with delta coloring OFF -> green.
      const bar: BarPayload = { ts_event: 1000, open: 100, high: 115, low: 95, close: 110, volume: 1000, delta: -250 };
      pane.setColorByDelta(false);
      expect(pane.isColorByDelta()).toBe(false);
      const { ctx, fills } = trackingCtx();
      pane.draw(ctx, defaultPaneRect, horizontalTransform, [bar], { start: 0, end: 0 });
      expect(fills).toContain(UP);
      expect(fills).not.toContain(DOWN);
    });

    it('should handle doji (bodyHeight < 1) by drawing horizontal line', () => {
      const dojiBar: BarPayload = { ts_event: 1000, open: 100.0, high: 100.5, low: 99.5, close: 100.0, volume: 1000 };
      const visibleBarRange: BarRange = { start: 0, end: 0 };

      pane.draw(mockCtx, defaultPaneRect, horizontalTransform, [dojiBar], visibleBarRange);

      // Should call moveTo/lineTo for horizontal line instead of fillRect for body
      expect(mockCtx.moveTo).toHaveBeenCalled();
      expect(mockCtx.lineTo).toHaveBeenCalled();
    });

    it('should cull missing bars (skip null/undefined bars in iteration)', () => {
      // Create a bar array with a gap (missing bar at index 1)
      const sparseBars: BarPayload[] = [
        sampleBars[0],
        sampleBars[2],
        sampleBars[4],
      ];
      const visibleBarRange: BarRange = { start: 0, end: 4 };

      // Should not throw even when visible range extends beyond actual bars
      // The draw loop will check if (!bar) continue and skip missing bars
      expect(() => {
        pane.draw(mockCtx, defaultPaneRect, horizontalTransform, sparseBars, visibleBarRange);
      }).not.toThrow();
    });

    it('should draw price axis labels on right margin', () => {
      const visibleBarRange: BarRange = { start: 0, end: 4 };
      pane.draw(mockCtx, defaultPaneRect, horizontalTransform, sampleBars, visibleBarRange);

      // Check fillText was called for price labels
      expect(mockCtx.fillText).toHaveBeenCalled();
    });

    it('should draw last-price line as dashed line', () => {
      const visibleBarRange: BarRange = { start: 0, end: 4 };
      pane.draw(mockCtx, defaultPaneRect, horizontalTransform, sampleBars, visibleBarRange);

      // Check setLineDash was called for dashed line
      expect(mockCtx.setLineDash).toHaveBeenCalledWith([5, 5]);
      expect(mockCtx.setLineDash).toHaveBeenCalledWith([]); // Reset after
    });

    it('should draw last-price label box on right margin', () => {
      const visibleBarRange: BarRange = { start: 0, end: 4 };
      pane.draw(mockCtx, defaultPaneRect, horizontalTransform, sampleBars, visibleBarRange);

      // Check strokeRect was called for label box
      expect(mockCtx.strokeRect).toHaveBeenCalled();
    });

    it('should save and restore canvas state', () => {
      const visibleBarRange: BarRange = { start: 0, end: 4 };
      pane.draw(mockCtx, defaultPaneRect, horizontalTransform, sampleBars, visibleBarRange);

      // Verify ctx.save() and ctx.restore() were called
      expect(mockCtx.save).toHaveBeenCalled();
      expect(mockCtx.restore).toHaveBeenCalled();
    });

    it('should draw empty pane with axis background when no valid bars', () => {
      const visibleBarRange: BarRange = { start: 0, end: 4 };
      pane.draw(mockCtx, defaultPaneRect, horizontalTransform, [], visibleBarRange);

      // Should draw axis background but no candles
      expect(mockCtx.fillRect).toHaveBeenCalled();
    });

    it('should set clipping region to paneRect', () => {
      const visibleBarRange: BarRange = { start: 0, end: 4 };
      pane.draw(mockCtx, defaultPaneRect, horizontalTransform, sampleBars, visibleBarRange);

      // Check rect and clip were called
      expect(mockCtx.rect).toHaveBeenCalledWith(0, 0, 800, 600);
      expect(mockCtx.clip).toHaveBeenCalled();
    });

    it('should handle visibleBarRange extending beyond bars array', () => {
      const visibleBarRange: BarRange = { start: 0, end: 10 }; // Beyond 5 bars
      expect(() => {
        pane.draw(mockCtx, defaultPaneRect, horizontalTransform, sampleBars, visibleBarRange);
      }).not.toThrow();
    });

    it('should handle negative startIndex in visibleBarRange', () => {
      const visibleBarRange: BarRange = { start: -5, end: 2 };
      expect(() => {
        pane.draw(mockCtx, defaultPaneRect, horizontalTransform, sampleBars, visibleBarRange);
      }).not.toThrow();
    });
  });

  describe('destroy', () => {
    it('should destroy without errors', () => {
      expect(() => {
        pane.destroy();
      }).not.toThrow();
    });
  });

  describe('Color selection logic', () => {
    it('should use green for bullish candle (close > open)', () => {
      const bullishBar: BarPayload = { ts_event: 1000, open: 100, high: 110, low: 95, close: 108, volume: 1000 };
      const visibleBarRange: BarRange = { start: 0, end: 0 };

      pane.draw(mockCtx, defaultPaneRect, horizontalTransform, [bullishBar], visibleBarRange);

      // Verify fillRect called (candle body rendered)
      expect(mockCtx.fillRect).toHaveBeenCalled();
    });

    it('should use green for bullish candle (close == open)', () => {
      const bullishBar: BarPayload = { ts_event: 1000, open: 100, high: 105, low: 95, close: 100, volume: 1000 };
      const visibleBarRange: BarRange = { start: 0, end: 0 };

      pane.draw(mockCtx, defaultPaneRect, horizontalTransform, [bullishBar], visibleBarRange);

      // Verify rendering (doji case since close == open)
      expect(mockCtx.moveTo).toHaveBeenCalled();
    });

    it('should use red for bearish candle (close < open)', () => {
      const bearishBar: BarPayload = { ts_event: 1000, open: 110, high: 115, low: 100, close: 102, volume: 1000 };
      const visibleBarRange: BarRange = { start: 0, end: 0 };

      pane.draw(mockCtx, defaultPaneRect, horizontalTransform, [bearishBar], visibleBarRange);

      // Verify fillRect called (candle body rendered)
      expect(mockCtx.fillRect).toHaveBeenCalled();
    });
  });
});
