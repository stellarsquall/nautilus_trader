/**
 * PaneLayout: orchestrates multi-pane rendering with shared horizontal transform.
 *
 * Responsibilities:
 * - Compute vertical layout (pane height allocation)
 * - Maintain shared horizontal CoordinateTransform
 * - Update per-pane vertical transforms based on autoscaled value ranges
 * - Orchestrate per-pane draw() calls with correct clipping rects
 * - Provide utilities for hit-testing (getBarIndexAtX, getPaneAtY, yToValue)
 *
 * Does NOT:
 * - Clear canvas (renderer's responsibility)
 * - Own ChartViewState or InteractionController (renderer's responsibility)
 * - Draw crosshair (CrosshairOverlay's responsibility)
 */

import type { BarPayload } from '../types.js';
import type { Pane } from './Pane.js';
import type { PaneRect } from './PaneRect.js';
import { CoordinateTransform, type AxisMargins, type BarRange } from './CoordinateTransform.js';

export class PaneLayout {
  private panes: Pane[];
  private paneHeightFractions: number[]; // [0.75, 0.25] for candlestick + volume
  private paneRects: PaneRect[] = [];

  // Canvas dimensions (CSS pixels, NOT DPR-scaled)
  private canvasWidth: number;
  private canvasHeight: number;

  // Shared horizontal coordinate transform (bar→X mapping)
  // Initialized with placeholder dimensions, updated in updateLayout()
  private horizontalTransform: CoordinateTransform;

  // Bar data reference (updated by renderer)
  private bars: BarPayload[] = [];

  /**
   * Construct PaneLayout with initial panes and height allocations.
   *
   * @param panes - Array of Pane instances (e.g., [candlestickPane, volumePane])
   * @param paneHeightFractions - Fraction of total height for each pane (must sum to 1.0)
   * @param canvasWidth - Initial canvas width (CSS pixels)
   * @param canvasHeight - Initial canvas height (CSS pixels)
   *
   * @throws Error if paneHeightFractions.length !== panes.length
   * @throws Error if sum(paneHeightFractions) !== 1.0 (within 0.01 tolerance)
   * @throws Error if any paneHeightFraction <= 0
   */
  constructor(
    panes: Pane[],
    paneHeightFractions: number[],
    canvasWidth: number,
    canvasHeight: number
  ) {
    // Validate paneHeightFractions length matches panes
    if (paneHeightFractions.length !== panes.length) {
      throw new Error(
        `paneHeightFractions length (${paneHeightFractions.length}) must equal panes length (${panes.length})`
      );
    }

    // Validate all fractions are positive
    for (let i = 0; i < paneHeightFractions.length; i++) {
      if (paneHeightFractions[i] <= 0) {
        throw new Error(
          `paneHeightFraction at index ${i} is ${paneHeightFractions[i]}, must be > 0`
        );
      }
    }

    // Validate sum of fractions equals 1.0 (within 0.01 tolerance)
    const sum = paneHeightFractions.reduce((acc, val) => acc + val, 0);
    if (Math.abs(sum - 1.0) > 0.01) {
      throw new Error(
        `Sum of paneHeightFractions (${sum}) must equal 1.0 (within 0.01 tolerance)`
      );
    }

    this.panes = panes;
    this.paneHeightFractions = paneHeightFractions;
    this.canvasWidth = canvasWidth;
    this.canvasHeight = canvasHeight;

    // Create shared horizontal transform with placeholder margins
    // Margins will be taken from bottom pane (which has time axis)
    const placeholderMargins: AxisMargins = { top: 0, right: 80, bottom: 40, left: 0 };
    this.horizontalTransform = new CoordinateTransform(
      canvasWidth,
      canvasHeight,
      placeholderMargins
    );

    // Compute initial pane rectangles
    this.updateLayout(canvasWidth, canvasHeight);
  }

  /**
   * Update canvas dimensions and recompute pane layout.
   *
   * Called by renderer on resize.
   *
   * @param canvasWidth - New canvas width (CSS pixels)
   * @param canvasHeight - New canvas height (CSS pixels)
   */
  public updateLayout(canvasWidth: number, canvasHeight: number): void {
    this.canvasWidth = canvasWidth;
    this.canvasHeight = canvasHeight;

    // Update shared horizontal transform dimensions
    this.horizontalTransform.updateDimensions(canvasWidth, canvasHeight);

    // Recompute pane rectangles
    this.paneRects = [];
    let currentY = 0;

    for (let i = 0; i < this.panes.length; i++) {
      const heightFraction = this.paneHeightFractions[i];
      const paneHeight = Math.floor(canvasHeight * heightFraction);

      this.paneRects.push({
        x: 0,
        y: currentY,
        width: canvasWidth,
        height: paneHeight,
      });

      currentY += paneHeight;
    }
  }

  /**
   * Update bar data reference.
   *
   * Called by renderer when new bars arrive.
   *
   * @param bars - Current bar buffer
   */
  public setBars(bars: BarPayload[]): void {
    this.bars = bars;
  }

  /**
   * Render all panes.
   *
   * Assumes canvas has already been cleared by renderer.
   *
   * @param ctx - Canvas 2D context (already scaled for DPR)
   * @param visibleBarRange - Current visible bar range from ChartViewState
   *
   * Algorithm:
   * 1. Update shared horizontal transform's visible bar range
   * 2. For each pane:
   *    a. Compute autoscaled value range via pane.getValueRange()
   *    b. Update pane's internal vertical transform (if needed, pane handles this)
   *    c. Call pane.draw() with paneRect, horizontalTransform, bars, visibleBarRange
   */
  public render(
    ctx: CanvasRenderingContext2D,
    visibleBarRange: BarRange
  ): void {
    // Update shared horizontal transform's visible bar range
    this.horizontalTransform.setVisibleBarRange(visibleBarRange);

    // Render each pane
    for (let i = 0; i < this.panes.length; i++) {
      const pane = this.panes[i];
      const paneRect = this.paneRects[i];

      // Pane draws itself, handling its own vertical transform and autoscaling
      pane.draw(ctx, paneRect, this.horizontalTransform, this.bars, visibleBarRange);
    }
  }

  /**
   * Get pane rectangle by index.
   *
   * Used by CrosshairOverlay to determine pane boundaries.
   *
   * @param paneIndex - Pane index (0-based)
   * @returns PaneRect or null if index out of bounds
   */
  public getPaneRect(paneIndex: number): PaneRect | null {
    if (paneIndex < 0 || paneIndex >= this.paneRects.length) {
      return null;
    }
    return this.paneRects[paneIndex];
  }

  /**
   * Get bar index at X coordinate.
   *
   * Delegates to shared horizontal transform.
   *
   * @param x - X coordinate in canvas pixels
   * @returns Bar index (may be negative or >= bars.length)
   */
  public getBarIndexAtX(x: number): number {
    return this.horizontalTransform.xToBarIndex(x);
  }

  /**
   * Get bar width in pixels.
   *
   * Delegates to shared horizontal transform.
   *
   * @returns Bar width in CSS pixels
   */
  public getBarWidth(): number {
    return this.horizontalTransform.getBarWidth();
  }

  /**
   * Find which pane contains a Y coordinate.
   *
   * Used by CrosshairOverlay for per-pane value readout.
   *
   * @param y - Y coordinate in canvas pixels
   * @returns Pane index or null if y outside all panes
   */
  public getPaneAtY(y: number): number | null {
    for (let i = 0; i < this.paneRects.length; i++) {
      const rect = this.paneRects[i];
      if (y >= rect.y && y < rect.y + rect.height) {
        return i;
      }
    }
    return null;
  }

  /**
   * Convert Y coordinate to pane-specific value.
   *
   * Used by CrosshairOverlay for per-pane value readout.
   * Delegates to the pane at the given Y coordinate.
   *
   * @param y - Y coordinate in canvas pixels
   * @returns Value (price, volume, etc.) or null if y outside all panes
   */
  public yToValue(y: number): { paneIndex: number; value: number } | null {
    const paneIndex = this.getPaneAtY(y);
    if (paneIndex === null) {
      return null;
    }

    const value = this.panes[paneIndex].yToValue(y);
    if (value === null) {
      return null;
    }

    return { paneIndex, value };
  }

  /**
   * Destroy all panes and clean up resources.
   */
  public destroy(): void {
    for (const pane of this.panes) {
      pane.destroy();
    }
    this.panes = [];
    this.bars = [];
  }
}
