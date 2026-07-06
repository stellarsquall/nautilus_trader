/**
 * CoordinateTransform module: Pure coordinate transformation logic for charting.
 *
 * This module provides DOM-free coordinate mapping between:
 * - Price (Y-axis, inverted: high price at top)
 * - Bar index (X-axis, left to right)
 * - Canvas pixels (accounting for axis margins)
 *
 * All logic is pure and testable without a canvas or DOM. This module is
 * reusable by future panes (footprint, CVD, depth heatmap).
 */

/**
 * Price range (Y-axis bounds).
 */
export interface PriceRange {
  /** Minimum price (inclusive, bottom of chart) */
  min: number;
  /** Maximum price (inclusive, top of chart) */
  max: number;
}

/**
 * Bar index range for the visible viewport (X-axis bounds).
 * Indices are relative to the bars array (0 = first bar in buffer).
 */
export interface BarRange {
  /** Index of first visible bar (inclusive) */
  start: number;
  /** Index of last visible bar (inclusive) */
  end: number;
}

/**
 * Canvas margin configuration (pixels reserved for axes).
 */
export interface AxisMargins {
  /** Top margin (pixels) */
  top: number;
  /** Right margin (pixels, for price axis) */
  right: number;
  /** Bottom margin (pixels, for time axis) */
  bottom: number;
  /** Left margin (pixels, currently 0 but reserved for future) */
  left: number;
}

/**
 * CoordinateTransform encapsulates coordinate space mapping between:
 * - Price (Y-axis, inverted: high price at top)
 * - Bar index (X-axis, left to right)
 * - Canvas pixels (accounting for axis margins)
 *
 * This class is pure (no DOM dependencies) and stateful (holds current ranges).
 * It is constructed with canvas dimensions and margins, then updated as the
 * price range and visible bar range change.
 *
 * Thread-safety: Not thread-safe (JS is single-threaded). Instances are owned
 * by a single renderer.
 */
export class CoordinateTransform {
  private canvasWidth: number;
  private canvasHeight: number;
  private margins: AxisMargins;

  // Nullable ranges: null indicates "not yet initialized" state
  private priceRange: PriceRange | null = null;
  private visibleBarRange: BarRange | null = null;

  /**
   * Construct a CoordinateTransform with canvas dimensions and margins.
   *
   * @param canvasWidth - Canvas logical width (CSS pixels, NOT backing-store pixels)
   * @param canvasHeight - Canvas logical height (CSS pixels)
   * @param margins - Pixel margins for axes (top/right/bottom/left)
   *
   * @throws Error if canvasWidth or canvasHeight <= 0
   * @throws Error if margins are negative or sum to >= canvas dimensions
   *
   * Initial state: priceRange and visibleBarRange are null. Calling priceToY()
   * or barIndexToX() before setting ranges will throw an error.
   */
  constructor(
    canvasWidth: number,
    canvasHeight: number,
    margins: AxisMargins
  ) {
    if (canvasWidth <= 0 || canvasHeight <= 0) {
      throw new Error(
        `Invalid canvas dimensions: ${canvasWidth}x${canvasHeight}. Must be > 0.`
      );
    }

    if (margins.top < 0 || margins.right < 0 || margins.bottom < 0 || margins.left < 0) {
      throw new Error(
        `Invalid margins: ${JSON.stringify(margins)}. All values must be >= 0.`
      );
    }

    const chartWidth = canvasWidth - margins.left - margins.right;
    const chartHeight = canvasHeight - margins.top - margins.bottom;

    if (chartWidth <= 0 || chartHeight <= 0) {
      throw new Error(
        `Margins too large: canvas ${canvasWidth}x${canvasHeight}, margins leave ${chartWidth}x${chartHeight} for chart.`
      );
    }

    this.canvasWidth = canvasWidth;
    this.canvasHeight = canvasHeight;
    this.margins = margins;
  }

  /**
   * Update canvas dimensions (e.g., after resize).
   *
   * @param canvasWidth - New canvas logical width
   * @param canvasHeight - New canvas logical height
   * @throws Error if dimensions are invalid (same checks as constructor)
   */
  public updateDimensions(canvasWidth: number, canvasHeight: number): void {
    if (canvasWidth <= 0 || canvasHeight <= 0) {
      throw new Error(
        `Invalid canvas dimensions: ${canvasWidth}x${canvasHeight}. Must be > 0.`
      );
    }

    const chartWidth = canvasWidth - this.margins.left - this.margins.right;
    const chartHeight = canvasHeight - this.margins.top - this.margins.bottom;

    if (chartWidth <= 0 || chartHeight <= 0) {
      throw new Error(
        `Margins too large: canvas ${canvasWidth}x${canvasHeight}, margins leave ${chartWidth}x${chartHeight} for chart.`
      );
    }

    this.canvasWidth = canvasWidth;
    this.canvasHeight = canvasHeight;
  }

  /**
   * Set the price range (Y-axis bounds).
   *
   * @param range - Price range with min < max
   * @throws Error if min >= max or either is non-finite
   */
  public setPriceRange(range: PriceRange): void {
    if (!Number.isFinite(range.min) || !Number.isFinite(range.max)) {
      throw new Error(
        `Invalid price range: min=${range.min}, max=${range.max}. Must be finite.`
      );
    }
    if (range.min >= range.max) {
      throw new Error(
        `Invalid price range: min=${range.min}, max=${range.max}. Min must be < max.`
      );
    }
    this.priceRange = range;
  }

  /**
   * Set the visible bar range (X-axis bounds).
   *
   * @param range - Bar index range with start <= end
   * @throws Error if start > end or indices are negative or non-integer
   */
  public setVisibleBarRange(range: BarRange): void {
    if (!Number.isInteger(range.start) || !Number.isInteger(range.end)) {
      throw new Error(
        `Invalid bar range: start=${range.start}, end=${range.end}. Must be integers.`
      );
    }
    if (range.start < 0 || range.end < 0) {
      throw new Error(
        `Invalid bar range: start=${range.start}, end=${range.end}. Must be non-negative.`
      );
    }
    if (range.start > range.end) {
      throw new Error(
        `Invalid bar range: start=${range.start}, end=${range.end}. Start must be <= end.`
      );
    }
    this.visibleBarRange = range;
  }

  /**
   * Convert price to Y-coordinate (canvas pixels).
   *
   * Y-axis is inverted: high prices → low Y values (top of chart).
   * Formula: y = margins.top + (priceRange.max - price) / priceSpan × chartHeight
   *
   * @param price - Price value to convert
   * @returns Y-coordinate in canvas pixels (0 at top)
   * @throws Error if priceRange is not set (null)
   * @throws Error if price is non-finite
   */
  public priceToY(price: number): number {
    if (this.priceRange === null) {
      throw new Error('Cannot convert price to Y: priceRange not set. Call setPriceRange() first.');
    }
    if (!Number.isFinite(price)) {
      throw new Error(`Invalid price: ${price}. Must be finite.`);
    }

    const chartHeight = this.getChartHeight();
    const priceSpan = this.priceRange.max - this.priceRange.min;

    // Invert Y: max price → top (low Y), min price → bottom (high Y)
    return this.margins.top + ((this.priceRange.max - price) / priceSpan) * chartHeight;
  }

  /**
   * Convert Y-coordinate to price.
   *
   * Inverse of priceToY(). Round-trip invariant (within floating-point precision):
   *   yToPrice(priceToY(p)) ≈ p  for all p in [priceRange.min, priceRange.max]
   *
   * @param y - Y-coordinate in canvas pixels
   * @returns Price value
   * @throws Error if priceRange is not set (null)
   * @throws Error if y is non-finite
   */
  public yToPrice(y: number): number {
    if (this.priceRange === null) {
      throw new Error('Cannot convert Y to price: priceRange not set. Call setPriceRange() first.');
    }
    if (!Number.isFinite(y)) {
      throw new Error(`Invalid Y coordinate: ${y}. Must be finite.`);
    }

    const chartHeight = this.getChartHeight();
    const priceSpan = this.priceRange.max - this.priceRange.min;

    // Invert Y: y=top → max price, y=bottom → min price
    return this.priceRange.max - ((y - this.margins.top) / chartHeight) * priceSpan;
  }

  /**
   * Convert bar index to X-coordinate (canvas pixels, center of bar).
   *
   * Bars are laid out left-to-right within the chart area. Each bar occupies
   * getBarWidth() pixels. The returned X is the horizontal center of the bar.
   *
   * @param barIndex - Bar index (0-based, relative to bars array)
   * @returns X-coordinate in canvas pixels (center of bar)
   * @throws Error if visibleBarRange is not set (null)
   * @throws Error if barIndex is non-integer
   */
  public barIndexToX(barIndex: number): number {
    if (this.visibleBarRange === null) {
      throw new Error('Cannot convert bar index to X: visibleBarRange not set. Call setVisibleBarRange() first.');
    }
    if (!Number.isInteger(barIndex)) {
      throw new Error(`Invalid bar index: ${barIndex}. Must be an integer.`);
    }

    const barWidth = this.getBarWidth();

    // Position within visible range (0 = first visible bar)
    const positionInWindow = barIndex - this.visibleBarRange.start;

    // X of bar left edge, plus half bar width to get center
    return this.margins.left + (positionInWindow * barWidth) + (barWidth / 2);
  }

  /**
   * Convert X-coordinate to bar index (floor, for hit-testing).
   *
   * Returns the index of the bar at the given X coordinate. If X falls between
   * bars, returns the index of the bar to the left (floor behavior).
   *
   * @param x - X-coordinate in canvas pixels
   * @returns Bar index (may be outside visible range or negative)
   * @throws Error if visibleBarRange is not set (null)
   * @throws Error if x is non-finite
   */
  public xToBarIndex(x: number): number {
    if (this.visibleBarRange === null) {
      throw new Error('Cannot convert X to bar index: visibleBarRange not set. Call setVisibleBarRange() first.');
    }
    if (!Number.isFinite(x)) {
      throw new Error(`Invalid X coordinate: ${x}. Must be finite.`);
    }

    const barWidth = this.getBarWidth();
    const positionInWindow = (x - this.margins.left) / barWidth;

    return Math.floor(this.visibleBarRange.start + positionInWindow);
  }

  /**
   * Get bar width in pixels.
   *
   * Computed as chartWidth / visibleBarCount, clamped to [2, 20] pixels.
   * Clamping ensures bars are always visible (minimum 2px) and not excessively
   * wide (maximum 20px). If clamped, bars may overlap (at 2px minimum) or have
   * gaps (at 20px maximum).
   *
   * @returns Bar width in pixels (clamped to [2, 20])
   * @throws Error if visibleBarRange is not set (null)
   */
  public getBarWidth(): number {
    if (this.visibleBarRange === null) {
      throw new Error('Cannot compute bar width: visibleBarRange not set. Call setVisibleBarRange() first.');
    }

    const chartWidth = this.getChartWidth();
    const visibleBarCount = this.visibleBarRange.end - this.visibleBarRange.start + 1;

    const rawWidth = chartWidth / visibleBarCount;

    // Clamp to [2, 20] pixels
    return Math.max(2, Math.min(20, rawWidth));
  }

  /**
   * Get chart width (canvas width minus horizontal margins).
   */
  public getChartWidth(): number {
    return this.canvasWidth - this.margins.left - this.margins.right;
  }

  /**
   * Get chart height (canvas height minus vertical margins).
   */
  public getChartHeight(): number {
    return this.canvasHeight - this.margins.top - this.margins.bottom;
  }

  /**
   * Get current price range.
   * @returns Price range or null if not set
   */
  public getPriceRange(): PriceRange | null {
    return this.priceRange;
  }

  /**
   * Get current visible bar range.
   * @returns Bar range or null if not set
   */
  public getVisibleBarRange(): BarRange | null {
    return this.visibleBarRange;
  }
}

/**
 * Compute autoscaled price range from OHLC bars.
 *
 * Finds the min of all low prices and max of all high prices in the given range,
 * then adds a 2% margin on each side for visual breathing room.
 *
 * @param bars - Array of bars (BarPayload)
 * @param startIndex - Index of first bar to include (inclusive)
 * @param endIndex - Index of last bar to include (inclusive)
 * @returns Price range with 2% margin, or null if no bars in range
 *
 * Edge cases:
 * - Empty bars array or startIndex > endIndex → returns null
 * - Single bar (start == end) → returns range with 2% margin around high/low
 * - All bars have same high/low → returns range with artificial 0.1% spread to avoid division by zero
 */
export function autoscalePriceRange(
  bars: Array<{ high: number; low: number }>,
  startIndex: number,
  endIndex: number
): PriceRange | null {
  if (bars.length === 0 || startIndex > endIndex || startIndex < 0 || endIndex >= bars.length) {
    return null;
  }

  let min = Infinity;
  let max = -Infinity;

  for (let i = startIndex; i <= endIndex; i++) {
    const bar = bars[i];
    if (bar.low < min) min = bar.low;
    if (bar.high > max) max = bar.high;
  }

  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return null;
  }

  // Handle case where all bars have identical high/low (zero range)
  if (min === max) {
    const epsilon = min * 0.001; // 0.1% spread
    min -= epsilon;
    max += epsilon;
  }

  // Add 2% margin on each side
  const margin = (max - min) * 0.02;
  return {
    min: min - margin,
    max: max + margin,
  };
}

/**
 * Generate nice-number tick values using Paul Heckbert's algorithm.
 *
 * Reference: "Nice Numbers for Graph Labels" (Graphics Gems, Academic Press, 1990)
 * Algorithm: Choose tick intervals from {1, 2, 5} × 10^n to produce approximately
 * targetCount ticks evenly distributed across [range.min, range.max].
 *
 * @param range - Price range (min, max)
 * @param targetCount - Desired number of ticks (typically 5-10)
 * @returns Array of tick values (sorted ascending)
 *
 * Edge cases:
 * - range.min >= range.max → returns empty array
 * - targetCount <= 0 → returns empty array
 * - Very small range (< 1e-10) → may return fewer ticks or single tick at midpoint
 *
 * Implementation:
 * 1. Compute raw interval = (max - min) / targetCount
 * 2. Round interval to nice number: 1, 2, or 5 × 10^n
 * 3. Compute first tick = ceil(min / interval) × interval
 * 4. Generate ticks at multiples of interval until > max
 */
export function generateNiceTicks(
  range: PriceRange,
  targetCount: number
): number[] {
  if (range.min >= range.max || targetCount <= 0) {
    return [];
  }

  const rangeSpan = range.max - range.min;
  const rawInterval = rangeSpan / targetCount;

  // Find exponent: 10^exp where exp = floor(log10(rawInterval))
  const exp = Math.floor(Math.log10(rawInterval));
  const powerOf10 = Math.pow(10, exp);

  // Normalized interval in [1, 10)
  const normalized = rawInterval / powerOf10;

  // Round to nice number: 1, 2, or 5
  let niceNormalized: number;
  if (normalized < 1.5) {
    niceNormalized = 1;
  } else if (normalized < 3.5) {
    niceNormalized = 2;
  } else if (normalized < 7.5) {
    niceNormalized = 5;
  } else {
    niceNormalized = 10;
  }

  const niceInterval = niceNormalized * powerOf10;

  // Generate ticks
  const ticks: number[] = [];
  const firstTick = Math.ceil(range.min / niceInterval) * niceInterval;

  for (let tick = firstTick; tick <= range.max; tick += niceInterval) {
    // Guard against floating-point drift (if tick overshoots due to precision)
    if (tick > range.max + niceInterval * 0.01) break;
    ticks.push(tick);
  }

  return ticks;
}

/**
 * Format price for axis labels.
 *
 * Returns a fixed-decimal string with trailing zeros removed if unnecessary.
 * For AUD/USD (~0.67), this produces labels like "0.67045" (5 decimals).
 * For larger prices, auto-adjusts decimal places.
 *
 * @param price - Price value
 * @returns Formatted string (e.g., "0.67045", "1234.56")
 *
 * Implementation:
 * - If |price| >= 10: use 2 decimal places
 * - If 1 <= |price| < 10: use 3 decimal places
 * - If |price| < 1: use 5 decimal places
 */
export function formatPrice(price: number): string {
  const abs = Math.abs(price);
  let decimals: number;

  if (abs >= 10) {
    decimals = 2;
  } else if (abs >= 1) {
    decimals = 3;
  } else {
    decimals = 5;
  }

  return price.toFixed(decimals);
}

/**
 * Format timestamp for time axis labels.
 *
 * Converts milliseconds since UNIX epoch to "HH:MM" in UTC.
 *
 * @param timestampMs - Timestamp in milliseconds
 * @returns Formatted string "HH:MM" (24-hour, UTC, zero-padded)
 *
 * Implementation: Use Date.UTC() and toISOString() to guarantee UTC.
 * Slice characters 11-16 from ISO string (format: "YYYY-MM-DDTHH:MM:SS.sssZ").
 */
export function formatTime(timestampMs: number): string {
  return new Date(timestampMs).toISOString().slice(11, 16);
}
