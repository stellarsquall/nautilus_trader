/**
 * CVDPane: renders cumulative volume delta (CVD) as a line chart with CVD axis.
 *
 * CVD line rendered in blue (#3f51b5).
 *
 * Autoscales to min/max CVD from visible range with 5% headroom;
 * draws 2-3 nice-tick labels on right margin as integers.
 *
 * No bottom time axis (not the bottom pane).
 */

import type { BarPayload } from '../types.js';
import type { Pane } from './Pane.js';
import type { PaneRect } from './PaneRect.js';
import {
  CoordinateTransform,
  generateNiceTicks,
  type BarRange,
  type PriceRange,
  type AxisMargins,
} from './CoordinateTransform.js';

export class CVDPane implements Pane {
  // CVD data storage: Map<barIndex, { cvd: number; delta: number }>
  private cvdData: Map<number, { cvd: number; delta: number }> = new Map();

  // Vertical coordinate transform (CVD→Y)
  // Initialized with full canvas dimensions, updated in draw() to pane-specific rect
  private verticalTransform: CoordinateTransform;

  // Track last pane rect to detect dimension changes
  private lastPaneRect: PaneRect | null = null;

  // Pane-specific margins (within paneRect)
  private readonly margins: AxisMargins = {
    top: 10,
    right: 80,
    bottom: 10, // NOT the bottom pane: no time axis
    left: 0,
  };

  // Visual constants
  private static readonly COLOR_LINE = '#3f51b5'; // Blue
  private static readonly COLOR_GRID = '#e0e0e0';
  private static readonly COLOR_TEXT = '#333333';
  private static readonly COLOR_AXIS_BG = '#f5f5f5';

  /**
   * Construct CVDPane.
   *
   * @param initialWidth - Initial canvas width (CSS pixels)
   * @param initialHeight - Initial canvas height (CSS pixels)
   */
  constructor(initialWidth: number, initialHeight: number) {
    this.verticalTransform = new CoordinateTransform(
      initialWidth,
      initialHeight,
      this.margins
    );
  }

  /**
   * Update CVD data for a specific bar index.
   *
   * @param barIndex - Bar index (0-based, matches bars array)
   * @param cvd - Cumulative volume delta value
   * @param delta - Delta for this bar (buy_volume - sell_volume)
   */
  public updateCvdData(barIndex: number, cvd: number, delta: number): void {
    this.cvdData.set(barIndex, { cvd, delta });
  }

  /**
   * Reset CVD data (clear all stored values).
   */
  public reset(): void {
    this.cvdData.clear();
  }

  public getValueRange(
    bars: BarPayload[],
    startIndex: number,
    endIndex: number
  ): { min: number; max: number } | null {
    // Clamp to valid bar indices
    const clampedStart = Math.max(0, startIndex);
    const clampedEnd = Math.min(bars.length - 1, endIndex);

    if (clampedStart > clampedEnd || bars.length === 0) {
      return null;
    }

    // Find min/max CVD in visible range
    let minCvd: number | null = null;
    let maxCvd: number | null = null;

    for (let i = clampedStart; i <= clampedEnd; i++) {
      const cvdEntry = this.cvdData.get(i);
      if (cvdEntry !== undefined) {
        const cvd = cvdEntry.cvd;
        if (minCvd === null || cvd < minCvd) {
          minCvd = cvd;
        }
        if (maxCvd === null || cvd > maxCvd) {
          maxCvd = cvd;
        }
      }
    }

    // If no CVD data in visible range, return null
    if (minCvd === null || maxCvd === null) {
      return null;
    }

    // Add 5% headroom
    const range = maxCvd - minCvd;
    const headroom = range * 0.05;

    // Handle case where min === max (single CVD point or all same value)
    if (range === 0) {
      // Add fixed headroom of ±5% of absolute value, or ±1 if value is 0
      const absValue = Math.abs(minCvd);
      const fixedHeadroom = absValue === 0 ? 1 : absValue * 0.05;
      return {
        min: minCvd - fixedHeadroom,
        max: maxCvd + fixedHeadroom,
      };
    }

    return {
      min: minCvd - headroom,
      max: maxCvd + headroom,
    };
  }

  public yToValue(y: number): number | null {
    // Convert Y to CVD using vertical transform
    // Note: CoordinateTransform.yToPrice() works for any value→Y mapping,
    // not just price. We'll use it for CVD→Y here.
    try {
      return this.verticalTransform.yToPrice(y);
    } catch {
      return null;
    }
  }

  public draw(
    ctx: CanvasRenderingContext2D,
    paneRect: PaneRect,
    horizontalTransform: CoordinateTransform,
    bars: BarPayload[],
    visibleBarRange: BarRange
  ): void {
    // Update vertical transform dimensions if pane rect changed
    if (
      !this.lastPaneRect ||
      this.lastPaneRect.width !== paneRect.width ||
      this.lastPaneRect.height !== paneRect.height
    ) {
      this.verticalTransform.updateDimensions(paneRect.width, paneRect.height);
      this.lastPaneRect = { ...paneRect };
    }

    // Compute autoscaled CVD range
    const cvdRange = this.getValueRange(bars, visibleBarRange.start, visibleBarRange.end);
    if (!cvdRange) {
      // No valid CVD data; draw empty pane with axes
      this.drawAxisBackground(ctx, paneRect);
      return;
    }

    // Update vertical transform's "price" range (repurposed for CVD)
    this.verticalTransform.setPriceRange(cvdRange);

    // Set clipping region to pane rect
    ctx.save();
    ctx.beginPath();
    ctx.rect(paneRect.x, paneRect.y, paneRect.width, paneRect.height);
    ctx.clip();

    // Draw pane content
    this.drawAxisBackground(ctx, paneRect);
    this.drawGrid(ctx, paneRect, cvdRange);
    this.drawCvdLine(ctx, paneRect, horizontalTransform, bars, visibleBarRange);
    this.drawCvdAxis(ctx, paneRect, cvdRange);

    // Restore canvas state
    ctx.restore();
  }

  public destroy(): void {
    // No resources to clean up
  }

  // Private drawing methods...

  private drawAxisBackground(ctx: CanvasRenderingContext2D, paneRect: PaneRect): void {
    // Draw right margin background for CVD axis
    ctx.fillStyle = CVDPane.COLOR_AXIS_BG;
    ctx.fillRect(
      paneRect.x + paneRect.width - this.margins.right,
      paneRect.y,
      this.margins.right,
      paneRect.height
    );
  }

  private drawGrid(
    ctx: CanvasRenderingContext2D,
    paneRect: PaneRect,
    cvdRange: PriceRange
  ): void {
    // Generate 2-3 nice ticks for CVD axis
    const ticks = generateNiceTicks(cvdRange, 3);

    ctx.strokeStyle = CVDPane.COLOR_GRID;
    ctx.lineWidth = 1;

    const chartWidth = paneRect.width - this.margins.left - this.margins.right;

    for (const cvd of ticks) {
      const yRelative = this.verticalTransform.priceToY(cvd);
      const yAbsolute = paneRect.y + yRelative;

      ctx.beginPath();
      ctx.moveTo(paneRect.x + this.margins.left, yAbsolute);
      ctx.lineTo(paneRect.x + this.margins.left + chartWidth, yAbsolute);
      ctx.stroke();
    }
  }

  private drawCvdLine(
    ctx: CanvasRenderingContext2D,
    paneRect: PaneRect,
    horizontalTransform: CoordinateTransform,
    bars: BarPayload[],
    visibleBarRange: BarRange
  ): void {
    ctx.strokeStyle = CVDPane.COLOR_LINE;
    ctx.lineWidth = 2;
    ctx.beginPath();

    let firstPoint = true;

    for (let i = visibleBarRange.start; i <= visibleBarRange.end; i++) {
      const bar = bars[i];
      if (!bar) continue; // Cull missing bars

      const cvdEntry = this.cvdData.get(i);
      if (cvdEntry === undefined) continue; // No CVD data for this bar

      // Get X from shared horizontal transform
      const x = horizontalTransform.barIndexToX(i);

      // Get Y from this pane's vertical transform
      const cvdYRelative = this.verticalTransform.priceToY(cvdEntry.cvd);
      const cvdYAbsolute = paneRect.y + cvdYRelative;

      // Draw line segment
      if (firstPoint) {
        ctx.moveTo(x, cvdYAbsolute);
        firstPoint = false;
      } else {
        ctx.lineTo(x, cvdYAbsolute);
      }
    }

    ctx.stroke();
  }

  private drawCvdAxis(
    ctx: CanvasRenderingContext2D,
    paneRect: PaneRect,
    cvdRange: PriceRange
  ): void {
    const ticks = generateNiceTicks(cvdRange, 3);

    ctx.fillStyle = CVDPane.COLOR_TEXT;
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    const labelX = paneRect.x + paneRect.width - this.margins.right + 5;

    for (const cvd of ticks) {
      const yRelative = this.verticalTransform.priceToY(cvd);
      const yAbsolute = paneRect.y + yRelative;

      // Format CVD as integer (no decimals)
      const label = Math.round(cvd).toString();

      ctx.fillText(label, labelX, yAbsolute);
    }
  }
}
