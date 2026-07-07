/**
 * VolumePane: renders per-bar volume histogram with volume axis.
 *
 * Volume bars colored green (#26a69a) for up-bars (close >= open),
 * red (#ef5350) for down-bars (close < open).
 *
 * Autoscales to max visible volume; draws 2-3 nice-tick labels on right margin.
 */

import type { BarPayload } from '../types.js';
import type { Pane } from './Pane.js';
import type { PaneRect } from './PaneRect.js';
import {
  CoordinateTransform,
  generateNiceTicks,
  formatTime,
  type BarRange,
  type PriceRange,
  type AxisMargins,
} from './CoordinateTransform.js';

export class VolumePane implements Pane {
  // Vertical coordinate transform (volume→Y)
  // Initialized with full canvas dimensions, updated in draw() to pane-specific rect
  private verticalTransform: CoordinateTransform;

  // Track last pane rect to detect dimension changes
  private lastPaneRect: PaneRect | null = null;

  // Pane-specific margins (within paneRect)
  private readonly margins: AxisMargins = {
    top: 10,
    right: 80,
    bottom: 40, // Bottom pane: includes time axis
    left: 0,
  };

  // Visual constants
  private static readonly COLOR_UP = '#26a69a';
  private static readonly COLOR_DOWN = '#ef5350';
  // Slight transparency on the volume bars so they read as a secondary,
  // supporting layer beneath the price pane (axis/labels stay fully opaque).
  private static readonly BAR_ALPHA = 0.72;
  private static readonly COLOR_GRID = '#e0e0e0';
  private static readonly COLOR_TEXT = '#333333';
  private static readonly COLOR_AXIS_BG = '#f5f5f5';

  /**
   * Construct VolumePane.
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

    // Find max volume in visible range
    let maxVolume = 0;
    for (let i = clampedStart; i <= clampedEnd; i++) {
      const bar = bars[i];
      if (bar && bar.volume > maxVolume) {
        maxVolume = bar.volume;
      }
    }

    // Volume range is always [0, maxVolume]
    // Add 5% headroom so tallest bar doesn't touch top margin
    return { min: 0, max: maxVolume * 1.05 };
  }

  public yToValue(y: number): number | null {
    // Convert Y to volume using vertical transform
    // Note: CoordinateTransform.yToPrice() works for any value→Y mapping,
    // not just price. We'll use it for volume→Y here.
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

    // Compute autoscaled volume range
    const volumeRange = this.getValueRange(bars, visibleBarRange.start, visibleBarRange.end);
    if (!volumeRange) {
      // No valid bars; draw empty pane with axes
      this.drawAxisBackground(ctx, paneRect);
      this.drawTimeAxis(ctx, paneRect, horizontalTransform, bars, visibleBarRange);
      return;
    }

    // Update vertical transform's "price" range (repurposed for volume)
    this.verticalTransform.setPriceRange(volumeRange);

    // Set clipping region to pane rect
    ctx.save();
    ctx.beginPath();
    ctx.rect(paneRect.x, paneRect.y, paneRect.width, paneRect.height);
    ctx.clip();

    // Draw pane content
    this.drawAxisBackground(ctx, paneRect);
    this.drawGrid(ctx, paneRect, volumeRange);
    this.drawVolumeBars(ctx, paneRect, horizontalTransform, bars, visibleBarRange);
    this.drawVolumeAxis(ctx, paneRect, volumeRange);
    this.drawTimeAxis(ctx, paneRect, horizontalTransform, bars, visibleBarRange);

    // Restore canvas state
    ctx.restore();
  }

  public destroy(): void {
    // No resources to clean up
  }

  // Private drawing methods...

  private drawAxisBackground(ctx: CanvasRenderingContext2D, paneRect: PaneRect): void {
    // Draw right margin background for volume axis
    ctx.fillStyle = VolumePane.COLOR_AXIS_BG;
    ctx.fillRect(
      paneRect.x + paneRect.width - this.margins.right,
      paneRect.y,
      this.margins.right,
      paneRect.height
    );

    // Draw bottom margin background for time axis
    ctx.fillRect(
      paneRect.x,
      paneRect.y + paneRect.height - this.margins.bottom,
      paneRect.width,
      this.margins.bottom
    );
  }

  private drawGrid(
    ctx: CanvasRenderingContext2D,
    paneRect: PaneRect,
    volumeRange: PriceRange
  ): void {
    // Generate 2-3 nice ticks for volume axis
    const ticks = generateNiceTicks(volumeRange, 3);

    ctx.strokeStyle = VolumePane.COLOR_GRID;
    ctx.lineWidth = 1;

    const chartWidth = paneRect.width - this.margins.left - this.margins.right;

    for (const volume of ticks) {
      const yRelative = this.verticalTransform.priceToY(volume);
      const yAbsolute = paneRect.y + yRelative;

      ctx.beginPath();
      ctx.moveTo(paneRect.x + this.margins.left, yAbsolute);
      ctx.lineTo(paneRect.x + this.margins.left + chartWidth, yAbsolute);
      ctx.stroke();
    }
  }

  private drawVolumeBars(
    ctx: CanvasRenderingContext2D,
    paneRect: PaneRect,
    horizontalTransform: CoordinateTransform,
    bars: BarPayload[],
    visibleBarRange: BarRange
  ): void {
    const barWidth = horizontalTransform.getBarWidth();
    const volumeBarWidth = barWidth * 0.8; // Match candlestick body width

    // Compute baseline Y (volume = 0)
    const baselineYRelative = this.verticalTransform.priceToY(0);
    const baselineYAbsolute = paneRect.y + baselineYRelative;

    ctx.save();
    ctx.globalAlpha = VolumePane.BAR_ALPHA;
    for (let i = visibleBarRange.start; i <= visibleBarRange.end; i++) {
      const bar = bars[i];
      if (!bar) continue; // Cull missing bars

      // Determine color: green if close >= open, red otherwise
      const isUp = bar.close >= bar.open;
      const color = isUp ? VolumePane.COLOR_UP : VolumePane.COLOR_DOWN;

      // Get X from shared horizontal transform
      const x = horizontalTransform.barIndexToX(i);

      // Get Y from this pane's vertical transform
      const volumeYRelative = this.verticalTransform.priceToY(bar.volume);
      const volumeYAbsolute = paneRect.y + volumeYRelative;

      // Volume bar height (from baseline to volume Y)
      const barHeight = baselineYAbsolute - volumeYAbsolute;

      // Skip zero or negative volume bars
      if (barHeight <= 0) continue;

      // Draw volume bar
      ctx.fillStyle = color;
      ctx.fillRect(
        x - volumeBarWidth / 2,
        volumeYAbsolute,
        volumeBarWidth,
        barHeight
      );
    }
    ctx.restore();
  }

  private drawVolumeAxis(
    ctx: CanvasRenderingContext2D,
    paneRect: PaneRect,
    volumeRange: PriceRange
  ): void {
    const ticks = generateNiceTicks(volumeRange, 3);

    ctx.fillStyle = VolumePane.COLOR_TEXT;
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    const labelX = paneRect.x + paneRect.width - this.margins.right + 5;

    for (const volume of ticks) {
      const yRelative = this.verticalTransform.priceToY(volume);
      const yAbsolute = paneRect.y + yRelative;

      // Format volume as integer (no decimals)
      const label = Math.round(volume).toString();

      ctx.fillText(label, labelX, yAbsolute);
    }
  }

  private drawTimeAxis(
    ctx: CanvasRenderingContext2D,
    paneRect: PaneRect,
    horizontalTransform: CoordinateTransform,
    bars: BarPayload[],
    visibleBarRange: BarRange
  ): void {
    const visibleBarCount = visibleBarRange.end - visibleBarRange.start + 1;
    const labelInterval = Math.max(1, Math.floor(visibleBarCount / 10));

    ctx.fillStyle = VolumePane.COLOR_TEXT;
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const labelY = paneRect.y + paneRect.height - this.margins.bottom / 2;

    for (let i = visibleBarRange.start; i <= visibleBarRange.end; i += labelInterval) {
      const bar = bars[i];
      if (!bar) continue;

      const x = horizontalTransform.barIndexToX(i);
      const label = formatTime(bar.ts_event);

      ctx.fillText(label, x, labelY);
    }
  }
}
