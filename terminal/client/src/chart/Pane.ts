/**
 * Pane interface: contract for all visual panes in the multi-pane layout.
 *
 * Each pane is responsible for:
 * - Maintaining its own vertical coordinate transform (value→Y mapping)
 * - Computing its value range from bar data (for autoscaling)
 * - Rendering itself to a clipped canvas region
 * - Converting Y coordinates to pane-specific values (for crosshair)
 *
 * Panes share:
 * - Horizontal coordinate transform (bar-index→X, passed by reference)
 * - Bar data array (passed by reference)
 * - Visible bar range (passed as parameter to draw())
 *
 * Implementations: CandlestickPane, VolumePane (future: CVDPane, FootprintPane, etc.)
 */

import type { BarPayload } from '../types.js';
import type { BarRange, CoordinateTransform } from './CoordinateTransform.js';
import type { PaneRect } from './PaneRect.js';

/**
 * Pane interface: contract for all visual panes in the multi-pane chart layout.
 *
 * Defines the rendering API that PaneLayout uses to orchestrate multi-pane rendering.
 */
export interface Pane {
  /**
   * Compute value range for autoscaling from visible bars.
   *
   * Called by PaneLayout before draw() to determine vertical scale.
   *
   * @param bars - Full bar data array
   * @param startIndex - First visible bar index (may be negative or >= bars.length)
   * @param endIndex - Last visible bar index (may be negative or >= bars.length)
   * @returns Value range (min/max) or null if no valid bars in range
   *
   * Implementation notes:
   * - Clamp [startIndex, endIndex] to valid bar indices before iterating
   * - CandlestickPane: returns PriceRange from autoscalePriceRange()
   * - VolumePane: returns { min: 0, max: maxVolume } from visible bars
   */
  getValueRange(
    bars: BarPayload[],
    startIndex: number,
    endIndex: number
  ): { min: number; max: number } | null;

  /**
   * Convert Y-coordinate (canvas pixels) to pane-specific value.
   *
   * Used by CrosshairOverlay to display per-pane value readouts.
   *
   * @param y - Y-coordinate in canvas pixels (relative to full canvas top-left)
   * @returns Value (price for candlestick, volume for volume) or null if y outside pane bounds
   *
   * Implementation:
   * - Check if y is within this pane's rect bounds (paneRect.y to paneRect.y + paneRect.height)
   * - If outside, return null
   * - Otherwise, delegate to this pane's vertical CoordinateTransform.yToPrice() or equivalent
   */
  yToValue(y: number): number | null;

  /**
   * Draw pane content to canvas.
   *
   * Called by PaneLayout.render() after renderer clears the canvas.
   *
   * @param ctx - Canvas 2D context (already scaled for DPR)
   * @param paneRect - This pane's rendering rectangle { x, y, width, height } in CSS pixels
   * @param horizontalTransform - Shared horizontal coordinate transform (bar→X, bar-width)
   * @param bars - Full bar data array
   * @param visibleBarRange - Current visible bar range { start, end } (updated each frame)
   *
   * Implementation:
   * 1. Update this pane's vertical transform dimensions to match paneRect
   * 2. Set canvas clipping region to paneRect (optional but recommended)
   * 3. Draw pane content (candles, volume bars, grid lines)
   * 4. Draw value-axis labels on right margin
   * 5. Draw time-axis labels on bottom margin (ONLY if this is the bottom pane)
   * 6. Restore canvas state
   *
   * Margins (within paneRect):
   * - top: 10px (breathing room)
   * - right: 80px (value-axis labels + padding)
   * - bottom: 40px (time-axis labels + padding, ONLY for bottom pane; 10px for others)
   * - left: 0px (no left margin)
   */
  draw(
    ctx: CanvasRenderingContext2D,
    paneRect: PaneRect,
    horizontalTransform: CoordinateTransform,
    bars: BarPayload[],
    visibleBarRange: BarRange
  ): void;

  /**
   * Destroy and clean up resources.
   *
   * Called when pane is removed from layout or renderer is destroyed.
   */
  destroy(): void;
}
