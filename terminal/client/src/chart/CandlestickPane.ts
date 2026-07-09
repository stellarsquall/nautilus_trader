/**
 * CandlestickPane: renders OHLC candlesticks with price axis.
 *
 * Extracted from CanvasCandlestickRenderer's inline draw logic.
 * Maintains its own vertical CoordinateTransform for price→Y mapping.
 *
 * Implements Pane interface for multi-pane chart layout system.
 */

import type { BarPayload } from '../types.js';
import type { Pane } from './Pane.js';
import type { PaneRect } from './PaneRect.js';
import {
  CoordinateTransform,
  autoscalePriceRange,
  generateNiceTicks,
  formatPrice,
  type BarRange,
  type AxisMargins,
  type PriceRange,
} from './CoordinateTransform.js';

/**
 * CandlestickPane implementation.
 *
 * Renders OHLC candlesticks with:
 * - Price grid at nice-tick intervals
 * - Price axis labels on right margin
 * - Last-price line (dashed) with label box
 * - Bullish candles (close >= open) in green (#26a69a)
 * - Bearish candles (close < open) in red (#ef5350)
 */
export class CandlestickPane implements Pane {
  // Vertical coordinate transform (price→Y)
  // Initialized with full canvas dimensions, updated in draw() to pane-specific rect
  private verticalTransform: CoordinateTransform;

  // Track last pane rect to detect dimension changes
  private lastPaneRect: PaneRect | null = null;

  // Current price range (updated in draw())
  private currentPriceRange: PriceRange | null = null;

  // Pane-specific margins (within paneRect)
  private readonly margins: AxisMargins = {
    top: 10,
    right: 80,
    bottom: 10, // NOT bottom pane, so no time axis
    left: 0,
  };

  // Visual constants
  private static readonly COLOR_UP = '#26a69a';
  private static readonly COLOR_DOWN = '#ef5350';
  private static readonly COLOR_GRID = '#e0e0e0';
  private static readonly COLOR_TEXT = '#333333';
  private static readonly COLOR_LAST_PRICE = '#333333';
  private static readonly COLOR_AXIS_BG = '#f5f5f5';

  // When true (default), candles are colored by order-flow delta sign
  // (buy_volume - sell_volume): non-negative delta = green, negative = red.
  // Bars without a delta field fall back to close/open coloring. When false,
  // all candles use traditional close-vs-open coloring.
  private colorByDelta = true;

  /**
   * Construct CandlestickPane.
   *
   * @param initialWidth - Initial canvas width (CSS pixels)
   * @param initialHeight - Initial canvas height (CSS pixels)
   *
   * Note: Dimensions are placeholders; updated to pane-specific rect in draw().
   */
  constructor(initialWidth: number, initialHeight: number) {
    // Initialize vertical transform with placeholder dimensions
    // Will be updated in draw() to match pane rect
    this.verticalTransform = new CoordinateTransform(
      initialWidth,
      initialHeight,
      this.margins
    );
  }

  /**
   * Toggle delta-based candle coloring.
   *
   * @param enabled - true to color by order-flow delta sign (default),
   *                  false to use traditional close-vs-open coloring.
   */
  public setColorByDelta(enabled: boolean): void {
    this.colorByDelta = enabled;
  }

  /**
   * Whether delta-based coloring is currently enabled.
   */
  public isColorByDelta(): boolean {
    return this.colorByDelta;
  }

  /**
   * Get the current price range used for vertical autoscaling.
   *
   * @returns Current PriceRange or null if no bars have been drawn yet.
   */
  public getPriceRange(): PriceRange | null {
    return this.currentPriceRange;
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

    // Delegate to autoscalePriceRange (existing utility)
    return autoscalePriceRange(bars, clampedStart, clampedEnd);
  }

  public yToValue(y: number): number | null {
    // Check if y is within this pane's bounds
    // Note: Pane doesn't track its own rect; caller (CrosshairOverlay via PaneLayout)
    // must check getPaneAtY() first to route to correct pane

    // Attempt conversion; CoordinateTransform will throw if priceRange not set
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

    // Compute autoscaled price range
    const priceRange = this.getValueRange(bars, visibleBarRange.start, visibleBarRange.end);
    if (!priceRange) {
      // No valid bars; draw empty pane with axis background
      this.drawAxisBackground(ctx, paneRect);
      return;
    }

    // Update vertical transform's price range
    this.verticalTransform.setPriceRange(priceRange);
    this.currentPriceRange = priceRange;

    // Set clipping region to pane rect (optional but recommended)
    ctx.save();
    ctx.beginPath();
    ctx.rect(paneRect.x, paneRect.y, paneRect.width, paneRect.height);
    ctx.clip();

    // Draw pane content
    this.drawAxisBackground(ctx, paneRect);
    this.drawGrid(ctx, paneRect, priceRange);
    this.drawCandles(ctx, paneRect, horizontalTransform, bars, visibleBarRange);
    this.drawPriceAxis(ctx, paneRect, priceRange);
    this.drawLastPriceLine(ctx, paneRect, horizontalTransform, bars);

    // Restore canvas state (remove clipping)
    ctx.restore();
  }

  public destroy(): void {
    // No resources to clean up (transform is stateless)
  }

  // Private drawing methods (extracted from CanvasCandlestickRenderer)...

  private drawAxisBackground(ctx: CanvasRenderingContext2D, paneRect: PaneRect): void {
    // Draw right margin background for price axis
    ctx.fillStyle = CandlestickPane.COLOR_AXIS_BG;
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
    priceRange: PriceRange
  ): void {
    const ticks = generateNiceTicks(priceRange, 8);

    ctx.strokeStyle = CandlestickPane.COLOR_GRID;
    ctx.lineWidth = 1;

    const chartWidth = paneRect.width - this.margins.left - this.margins.right;

    for (const price of ticks) {
      // Convert price to Y coordinate (relative to canvas top, accounting for paneRect.y)
      const yRelative = this.verticalTransform.priceToY(price);
      const yAbsolute = paneRect.y + yRelative;

      ctx.beginPath();
      ctx.moveTo(paneRect.x + this.margins.left, yAbsolute);
      ctx.lineTo(paneRect.x + this.margins.left + chartWidth, yAbsolute);
      ctx.stroke();
    }
  }

  private drawCandles(
    ctx: CanvasRenderingContext2D,
    paneRect: PaneRect,
    horizontalTransform: CoordinateTransform,
    bars: BarPayload[],
    visibleBarRange: BarRange
  ): void {
    const barWidth = horizontalTransform.getBarWidth();
    const bodyWidth = barWidth * 0.8;

    for (let i = visibleBarRange.start; i <= visibleBarRange.end; i++) {
      const bar = bars[i];
      if (!bar) continue; // Cull missing bars

      // Get X from shared horizontal transform
      const x = horizontalTransform.barIndexToX(i);

      // Get Y from this pane's vertical transform (relative to pane top)
      const openYRelative = this.verticalTransform.priceToY(bar.open);
      const closeYRelative = this.verticalTransform.priceToY(bar.close);
      const highYRelative = this.verticalTransform.priceToY(bar.high);
      const lowYRelative = this.verticalTransform.priceToY(bar.low);

      // Convert to absolute canvas coordinates
      const openY = paneRect.y + openYRelative;
      const closeY = paneRect.y + closeYRelative;
      const highY = paneRect.y + highYRelative;
      const lowY = paneRect.y + lowYRelative;

      // Candle color. In delta mode (default) color by order-flow delta sign
      // when the bar carries a delta; otherwise fall back to close-vs-open.
      const isUp =
        this.colorByDelta && typeof bar.delta === 'number'
          ? bar.delta >= 0
          : bar.close >= bar.open;
      const color = isUp ? CandlestickPane.COLOR_UP : CandlestickPane.COLOR_DOWN;

      ctx.fillStyle = color;
      ctx.strokeStyle = color;

      // Draw wick
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, highY);
      ctx.lineTo(x, lowY);
      ctx.stroke();

      // Draw body
      const bodyTop = Math.min(openY, closeY);
      const bodyHeight = Math.abs(closeY - openY);

      if (bodyHeight < 1) {
        // Doji: draw horizontal line
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x - bodyWidth / 2, openY);
        ctx.lineTo(x + bodyWidth / 2, openY);
        ctx.stroke();
      } else {
        ctx.fillRect(x - bodyWidth / 2, bodyTop, bodyWidth, bodyHeight);
      }
    }
  }

  private drawPriceAxis(
    ctx: CanvasRenderingContext2D,
    paneRect: PaneRect,
    priceRange: PriceRange
  ): void {
    const ticks = generateNiceTicks(priceRange, 8);

    ctx.fillStyle = CandlestickPane.COLOR_TEXT;
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    const labelX = paneRect.x + paneRect.width - this.margins.right + 5;

    for (const price of ticks) {
      const yRelative = this.verticalTransform.priceToY(price);
      const yAbsolute = paneRect.y + yRelative;
      const label = formatPrice(price);

      ctx.fillText(label, labelX, yAbsolute);
    }
  }

  private drawLastPriceLine(
    ctx: CanvasRenderingContext2D,
    paneRect: PaneRect,
    horizontalTransform: CoordinateTransform,
    bars: BarPayload[]
  ): void {
    if (bars.length === 0) return;

    const lastBar = bars[bars.length - 1];
    const yRelative = this.verticalTransform.priceToY(lastBar.close);
    const yAbsolute = paneRect.y + yRelative;

    const chartWidth = paneRect.width - this.margins.left - this.margins.right;

    // Draw dashed line
    ctx.strokeStyle = CandlestickPane.COLOR_LAST_PRICE;
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 5]);

    ctx.beginPath();
    ctx.moveTo(paneRect.x + this.margins.left, yAbsolute);
    ctx.lineTo(paneRect.x + this.margins.left + chartWidth, yAbsolute);
    ctx.stroke();

    ctx.setLineDash([]);

    // Draw label box
    const label = formatPrice(lastBar.close);
    ctx.font = '12px sans-serif';
    const textMetrics = ctx.measureText(label);
    const textWidth = textMetrics.width;

    const boxX = paneRect.x + paneRect.width - this.margins.right + 2;
    const boxY = yAbsolute - 8;
    const boxWidth = textWidth + 6;
    const boxHeight = 16;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(boxX, boxY, boxWidth, boxHeight);

    ctx.strokeStyle = CandlestickPane.COLOR_LAST_PRICE;
    ctx.lineWidth = 1;
    ctx.strokeRect(boxX, boxY, boxWidth, boxHeight);

    ctx.fillStyle = CandlestickPane.COLOR_TEXT;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, boxX + 3, yAbsolute);
  }
}
