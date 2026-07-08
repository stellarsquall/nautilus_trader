/**
 * Integration tests for CVDPane interaction with realistic bar data patterns.
 *
 * These tests verify that CVDPane correctly handles data flows from the
 * bar streaming pipeline, including:
 * - Sequential CVD updates matching bar indices
 * - Realistic cumulative volume delta patterns
 * - Mixed positive/negative deltas
 * - Interaction with coordinate transforms and rendering
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CVDPane } from './CVDPane.js';
import { CoordinateTransform, type BarRange, type AxisMargins } from './CoordinateTransform.js';
import type { BarPayload } from '../types.js';
import type { PaneRect } from './PaneRect.js';

describe('CVDPane Integration with Bar Data Pipeline', () => {
  let pane: CVDPane;
  let ctx: CanvasRenderingContext2D;
  let paneRect: PaneRect;
  let horizontalTransform: CoordinateTransform;

  beforeEach(() => {
    pane = new CVDPane(800, 150);

    // Create mock canvas context
    ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      fillRect: vi.fn(),
      fillText: vi.fn(),
      rect: vi.fn(),
      clip: vi.fn(),
      strokeStyle: '',
      fillStyle: '',
      lineWidth: 0,
      font: '',
      textAlign: 'left' as CanvasTextAlign,
      textBaseline: 'alphabetic' as CanvasTextBaseline,
    } as unknown as CanvasRenderingContext2D;

    paneRect = {
      x: 0,
      y: 600,
      width: 800,
      height: 150,
    };

    const margins: AxisMargins = { top: 0, right: 80, bottom: 10, left: 0 };
    horizontalTransform = new CoordinateTransform(800, 150, margins);
  });

  it('should handle sequential CVD updates matching bar indices from streaming pipeline', () => {
    /**
     * Simulates the streaming pipeline where:
     * 1. Bars arrive sequentially (index 0, 1, 2, ...)
     * 2. Each bar has buy_volume and sell_volume
     * 3. Delta = buy_volume - sell_volume
     * 4. CVD is cumulative sum of deltas
     */
    const bars: BarPayload[] = [
      { ts_event: 1000000, open: 100, high: 105, low: 95, close: 102, volume: 1500 },
      { ts_event: 1060000, open: 102, high: 108, low: 100, close: 106, volume: 1800 },
      { ts_event: 1120000, open: 106, high: 110, low: 104, close: 107, volume: 1200 },
      { ts_event: 1180000, open: 107, high: 112, low: 105, close: 109, volume: 2000 },
      { ts_event: 1240000, open: 109, high: 111, low: 106, close: 108, volume: 1600 },
    ];

    // Simulate order-flow analytics calculating deltas and CVD
    const buyVolumes = [1000, 1200, 600, 1500, 800];
    const sellVolumes = [500, 600, 600, 500, 800];
    const deltas = buyVolumes.map((buy, i) => buy - sellVolumes[i]);
    // deltas = [500, 600, 0, 1000, 0]

    // Calculate CVD (cumulative sum)
    const cvdValues: number[] = [];
    let cumulativeCvd = 0;
    for (const delta of deltas) {
      cumulativeCvd += delta;
      cvdValues.push(cumulativeCvd);
    }
    // cvdValues = [500, 1100, 1100, 2100, 2100]

    // Update CVDPane with sequential data
    for (let i = 0; i < bars.length; i++) {
      pane.updateCvdData(i, cvdValues[i], deltas[i]);
    }

    // Verify value range calculation
    const range = pane.getValueRange(bars, 0, 4);
    expect(range).not.toBeNull();

    // Range should include min CVD (500) and max CVD (2100) with headroom
    expect(range!.min).toBeLessThan(500);
    expect(range!.max).toBeGreaterThan(2100);

    // Verify range includes the full extent
    const cvdSpan = range!.max - range!.min;
    const dataSpan = 2100 - 500; // 1600
    expect(cvdSpan).toBeGreaterThan(dataSpan); // Should have headroom
  });

  it('should correctly handle mixed buy/sell dominance with realistic CVD progression', () => {
    /**
     * Realistic scenario: market switches between buy and sell pressure.
     * - Bars 0-2: buy pressure (CVD increases)
     * - Bars 3-4: sell pressure (CVD decreases)
     * - Bar 5: balanced (CVD flat)
     */
    const bars: BarPayload[] = Array.from({ length: 6 }, (_, i) => ({
      ts_event: 1000000 + i * 60000,
      open: 100 + i,
      high: 105 + i,
      low: 95 + i,
      close: 102 + i,
      volume: 1000 + i * 100,
    }));

    // Deltas: buy pressure → sell pressure → balanced
    const deltas = [300, 500, 200, -400, -300, 0];
    const cvdValues = [300, 800, 1000, 600, 300, 300];

    for (let i = 0; i < bars.length; i++) {
      pane.updateCvdData(i, cvdValues[i], deltas[i]);
    }

    // Verify range captures the full swing
    const range = pane.getValueRange(bars, 0, 5);
    expect(range).not.toBeNull();
    expect(range!.min).toBeLessThan(300); // Min CVD with headroom
    expect(range!.max).toBeGreaterThan(1000); // Max CVD with headroom

    // Test autoscaling to visible range (bars 2-4)
    const visibleRange = pane.getValueRange(bars, 2, 4);
    expect(visibleRange).not.toBeNull();
    // Visible CVD: [1000, 600, 300] → min 300, max 1000. This subset contains
    // both the global min and max, so its span equals (not is strictly less
    // than) the full-range span.
    expect(visibleRange!.min).toBeLessThan(300);
    expect(visibleRange!.max).toBeGreaterThan(1000);
    expect(visibleRange!.max - visibleRange!.min).toBeLessThanOrEqual(range!.max - range!.min);
  });

  it('should handle negative CVD values from sustained sell pressure', () => {
    /**
     * Scenario: Market under heavy sell pressure, CVD goes negative.
     */
    const bars: BarPayload[] = Array.from({ length: 5 }, (_, i) => ({
      ts_event: 1000000 + i * 60000,
      open: 100 - i * 2,
      high: 105 - i * 2,
      low: 95 - i * 2,
      close: 98 - i * 2,
      volume: 1000 + i * 100,
    }));

    // Heavy sell pressure: negative deltas
    const deltas = [100, -300, -500, -200, -100];
    const cvdValues = [100, -200, -700, -900, -1000];

    for (let i = 0; i < bars.length; i++) {
      pane.updateCvdData(i, cvdValues[i], deltas[i]);
    }

    const range = pane.getValueRange(bars, 0, 4);
    expect(range).not.toBeNull();
    expect(range!.min).toBeLessThan(-1000);
    expect(range!.max).toBeGreaterThan(100);
  });

  it('should render CVD line chart with correct canvas operations', () => {
    /**
     * Integration test: verify CVD data flows through to canvas rendering.
     */
    const bars: BarPayload[] = Array.from({ length: 3 }, (_, i) => ({
      ts_event: 1000000 + i * 60000,
      open: 100 + i,
      high: 105 + i,
      low: 95 + i,
      close: 102 + i,
      volume: 1000,
    }));

    // CVD progression: 500 → 1000 → 1200
    pane.updateCvdData(0, 500, 500);
    pane.updateCvdData(1, 1000, 500);
    pane.updateCvdData(2, 1200, 200);

    const visibleBarRange: BarRange = { start: 0, end: 2 };
    horizontalTransform.setVisibleBarRange(visibleBarRange);

    // Draw the pane
    pane.draw(ctx, paneRect, horizontalTransform, bars, visibleBarRange);

    // Verify canvas state management
    expect(ctx.save).toHaveBeenCalled();
    expect(ctx.restore).toHaveBeenCalled();

    // Verify clipping region set to pane rect
    expect(ctx.rect).toHaveBeenCalledWith(
      paneRect.x,
      paneRect.y,
      paneRect.width,
      paneRect.height
    );
    expect(ctx.clip).toHaveBeenCalled();

    // Verify line drawing operations (beginPath, moveTo, lineTo, stroke)
    expect(ctx.beginPath).toHaveBeenCalled();
    expect(ctx.stroke).toHaveBeenCalled();

    // Should call moveTo for first point, then lineTo for subsequent points
    const moveToCallCount = (ctx.moveTo as any).mock.calls.length;
    const lineToCallCount = (ctx.lineTo as any).mock.calls.length;
    expect(moveToCallCount).toBeGreaterThan(0);
    expect(lineToCallCount).toBeGreaterThan(0);
  });

  it('should update CVD data multiple times for same bar index (late updates)', () => {
    /**
     * Scenario: CVD value for a bar gets updated (e.g., late-arriving trade data).
     * This tests that CVDPane correctly overwrites previous CVD values.
     */
    const bars: BarPayload[] = [
      { ts_event: 1000000, open: 100, high: 105, low: 95, close: 102, volume: 1000 },
    ];

    // Initial CVD update
    pane.updateCvdData(0, 500, 500);

    let range = pane.getValueRange(bars, 0, 0);
    expect(range).not.toBeNull();
    // Range should be around 500 with headroom

    // Late update: CVD recalculated to 800
    pane.updateCvdData(0, 800, 800);

    range = pane.getValueRange(bars, 0, 0);
    expect(range).not.toBeNull();
    // Range should now be around 800, not 500
    expect(range!.max).toBeGreaterThan(800);
    expect(range!.min).toBeLessThan(800);
  });

  it('should handle CVD updates arriving out of order (realistic streaming scenario)', () => {
    /**
     * Scenario: CVD updates may arrive out of order due to async processing.
     * CVDPane should handle this gracefully.
     */
    const bars: BarPayload[] = Array.from({ length: 5 }, (_, i) => ({
      ts_event: 1000000 + i * 60000,
      open: 100 + i,
      high: 105 + i,
      low: 95 + i,
      close: 102 + i,
      volume: 1000,
    }));

    // Updates arrive out of order: 0, 2, 1, 4, 3
    pane.updateCvdData(0, 100, 100);
    pane.updateCvdData(2, 300, 100);
    pane.updateCvdData(1, 200, 100);
    pane.updateCvdData(4, 500, 100);
    pane.updateCvdData(3, 400, 100);

    // Verify all data is stored correctly
    const range = pane.getValueRange(bars, 0, 4);
    expect(range).not.toBeNull();
    expect(range!.min).toBeLessThan(100);
    expect(range!.max).toBeGreaterThan(500);
  });

  it('should correctly autoscale when visible range excludes min/max CVD', () => {
    /**
     * Integration test: Autoscaling should only consider VISIBLE bar range.
     * This is a critical requirement from the CVD pane spec.
     */
    const bars: BarPayload[] = Array.from({ length: 10 }, (_, i) => ({
      ts_event: 1000000 + i * 60000,
      open: 100 + i,
      high: 105 + i,
      low: 95 + i,
      close: 102 + i,
      volume: 1000,
    }));

    // CVD values: spike at indices 0 and 9
    const cvdValues = [5000, 1000, 900, 800, 850, 900, 950, 1000, 1100, 6000];
    for (let i = 0; i < 10; i++) {
      pane.updateCvdData(i, cvdValues[i], 0);
    }

    // Full range includes spikes: [5000, 6000]
    const fullRange = pane.getValueRange(bars, 0, 9);
    expect(fullRange).not.toBeNull();
    expect(fullRange!.min).toBeLessThan(5000);
    expect(fullRange!.max).toBeGreaterThan(6000);

    // Visible range (1-8) excludes spikes: [800, 1100]
    const visibleRange = pane.getValueRange(bars, 1, 8);
    expect(visibleRange).not.toBeNull();
    expect(visibleRange!.min).toBeLessThan(800);
    expect(visibleRange!.max).toBeGreaterThan(1100);

    // Visible range should be MUCH smaller than full range
    const fullSpan = fullRange!.max - fullRange!.min;
    const visibleSpan = visibleRange!.max - visibleRange!.min;
    expect(visibleSpan).toBeLessThan(fullSpan * 0.5);
  });

  it('should handle zero CVD values (balanced market)', () => {
    /**
     * Scenario: Market is balanced (equal buy/sell volume), CVD stays at 0.
     */
    const bars: BarPayload[] = Array.from({ length: 5 }, (_, i) => ({
      ts_event: 1000000 + i * 60000,
      open: 100,
      high: 105,
      low: 95,
      close: 102,
      volume: 1000,
    }));

    // All deltas are 0, CVD stays at 0
    for (let i = 0; i < 5; i++) {
      pane.updateCvdData(i, 0, 0);
    }

    const range = pane.getValueRange(bars, 0, 4);
    expect(range).not.toBeNull();
    // Should add headroom around 0 (±1 since value is 0)
    expect(range!.min).toBeLessThan(0);
    expect(range!.max).toBeGreaterThan(0);
  });

  it('should handle sparse CVD data (missing bars)', () => {
    /**
     * Scenario: Not all bars have CVD data (e.g., data still loading).
     * CVDPane should only render bars that have CVD data.
     */
    const bars: BarPayload[] = Array.from({ length: 10 }, (_, i) => ({
      ts_event: 1000000 + i * 60000,
      open: 100 + i,
      high: 105 + i,
      low: 95 + i,
      close: 102 + i,
      volume: 1000,
    }));

    // Only update CVD for indices 0, 2, 5, 9
    pane.updateCvdData(0, 100, 100);
    pane.updateCvdData(2, 300, 200);
    pane.updateCvdData(5, 600, 300);
    pane.updateCvdData(9, 1000, 400);

    // Range should only consider bars with CVD data
    const range = pane.getValueRange(bars, 0, 9);
    expect(range).not.toBeNull();
    expect(range!.min).toBeLessThan(100);
    expect(range!.max).toBeGreaterThan(1000);

    // Range for bars without CVD data should return null
    const emptyRange = pane.getValueRange(bars, 3, 4);
    expect(emptyRange).toBeNull();
  });
});
