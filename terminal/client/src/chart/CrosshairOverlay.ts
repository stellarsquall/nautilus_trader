import type { CoordinateTransform } from './CoordinateTransform';
import type { BarPayload } from '../types';
import { formatPrice, formatTime } from './CoordinateTransform';

export interface CrosshairState {
  /** Canvas X coordinate of cursor */
  canvasX: number;
  /** Canvas Y coordinate of cursor */
  canvasY: number;
  /** Index of hovered bar (for OHLC readout) */
  barIndex: number;
}

export class CrosshairOverlay {
  private overlayCanvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private transform: CoordinateTransform;
  private currentDPR: number;

  // Crosshair visibility state
  private visible = false;
  private state: CrosshairState | null = null;

  // Bar data reference (for OHLC readout)
  private bars: BarPayload[] = [];

  // Optional per-pane value resolver. In multi-pane mode the renderer sets this
  // so the right-margin value label shows the value of the pane under the cursor
  // (price in the candlestick pane, volume in the volume pane). When null, the
  // label falls back to the single price transform (yToPrice).
  private valueResolver: ((y: number) => string | null) | null = null;

  // Canvas dimensions
  private canvasWidth = 0;
  private canvasHeight = 0;

  // Margins (from CoordinateTransform, hardcoded to match existing pattern)
  private readonly margins = {
    top: 20,
    right: 80,
    bottom: 40,
    left: 0,
  };

  /**
   * Construct and create overlay canvas.
   *
   * The overlay canvas is positioned absolutely above the main chart canvas
   * with `pointer-events: none` to let mouse events pass through to the main canvas.
   *
   * @param container - Container element (same as main chart container)
   * @param transform - CoordinateTransform for price/bar conversions
   */
  constructor(container: HTMLElement, transform: CoordinateTransform) {
    this.transform = transform;
    this.currentDPR = window.devicePixelRatio || 1;

    // Create overlay canvas
    this.overlayCanvas = document.createElement('canvas');
    this.overlayCanvas.style.position = 'absolute';
    this.overlayCanvas.style.top = '0';
    this.overlayCanvas.style.left = '0';
    this.overlayCanvas.style.pointerEvents = 'none';

    // Get 2D context
    const ctx = this.overlayCanvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to get 2D context for overlay canvas');
    }
    this.ctx = ctx;

    // Append to container
    container.appendChild(this.overlayCanvas);
  }

  /**
   * Update crosshair position and make visible.
   *
   * @param state - Crosshair position and hovered bar index
   */
  public show(state: CrosshairState): void {
    this.visible = true;
    this.state = state;
    this.render();
  }

  /**
   * Hide crosshair (clear overlay canvas).
   */
  public hide(): void {
    this.visible = false;
    this.state = null;
    this.ctx.clearRect(0, 0, this.canvasWidth, this.canvasHeight);
  }

  /**
   * Update bar data reference (for OHLC readout).
   *
   * @param bars - Current bar buffer
   */
  public setBars(bars: BarPayload[]): void {
    this.bars = bars;
  }

  /**
   * Set (or clear) the per-pane value resolver used for the right-margin label.
   *
   * @param fn - Maps a canvas Y to a formatted value string (or null when Y is
   *   outside every pane, suppressing the label). Pass null to restore the
   *   default single-transform (yToPrice) behavior.
   */
  public setValueResolver(fn: ((y: number) => string | null) | null): void {
    this.valueResolver = fn;
  }

  /**
   * Update canvas dimensions (e.g., after resize).
   *
   * @param width - New canvas width (CSS pixels)
   * @param height - New canvas height (CSS pixels)
   */
  public updateDimensions(width: number, height: number): void {
    this.canvasWidth = width;
    this.canvasHeight = height;
    this.currentDPR = window.devicePixelRatio || 1;

    // Set canvas size with DPR scaling
    this.overlayCanvas.width = width * this.currentDPR;
    this.overlayCanvas.height = height * this.currentDPR;

    // Set CSS size
    this.overlayCanvas.style.width = `${width}px`;
    this.overlayCanvas.style.height = `${height}px`;

    // Scale context for DPR (use setTransform to avoid accumulation)
    this.ctx.setTransform(this.currentDPR, 0, 0, this.currentDPR, 0, 0);
  }

  /**
   * Destroy and remove overlay canvas.
   */
  public destroy(): void {
    if (this.overlayCanvas.parentNode) {
      this.overlayCanvas.parentNode.removeChild(this.overlayCanvas);
    }
  }

  /**
   * Render crosshair lines and labels.
   */
  private render(): void {
    // Clear entire overlay canvas
    this.ctx.clearRect(0, 0, this.canvasWidth, this.canvasHeight);

    if (!this.visible || !this.state) {
      return;
    }

    const { canvasX, canvasY, barIndex } = this.state;

    // Draw crosshair lines (always drawn)
    this.drawCrosshairLines(canvasX, canvasY);

    // Draw price label (always drawn)
    this.drawPriceLabel(canvasY);

    // Validate barIndex before drawing time label and OHLC readout
    const barIndexValid = barIndex >= 0 && barIndex < this.bars.length;

    if (barIndexValid) {
      this.drawTimeLabel(canvasX, barIndex);
      this.drawOHLCReadout(barIndex);
    }
  }

  /**
   * Draw vertical and horizontal crosshair lines.
   */
  private drawCrosshairLines(x: number, y: number): void {
    this.ctx.save();
    this.ctx.strokeStyle = '#999999';
    this.ctx.lineWidth = 1;

    this.ctx.beginPath();

    // Vertical line (from top margin to bottom margin)
    const chartTop = this.margins.top;
    const chartBottom = this.canvasHeight - this.margins.bottom;
    this.ctx.moveTo(x, chartTop);
    this.ctx.lineTo(x, chartBottom);

    // Horizontal line (from left margin to right margin)
    const chartLeft = this.margins.left;
    const chartRight = this.canvasWidth - this.margins.right;
    this.ctx.moveTo(chartLeft, y);
    this.ctx.lineTo(chartRight, y);

    this.ctx.stroke();
    this.ctx.restore();
  }

  /**
   * Draw price label at canvasY on right margin.
   */
  private drawPriceLabel(y: number): void {
    this.ctx.save();

    // Resolve the label text: per-pane value in multi-pane mode, else price.
    let priceText: string;
    if (this.valueResolver) {
      const resolved = this.valueResolver(y);
      if (resolved === null) {
        // Cursor is outside every pane -> no value label.
        this.ctx.restore();
        return;
      }
      priceText = resolved;
    } else {
      priceText = formatPrice(this.transform.yToPrice(y));
    }

    // Measure text
    this.ctx.font = '12px sans-serif';
    const metrics = this.ctx.measureText(priceText);
    const textWidth = metrics.width;
    const textHeight = 12; // Approximate height

    // Position in right margin
    const padding = 4;
    const boxX = this.canvasWidth - this.margins.right + 2;
    const boxY = y - textHeight / 2 - padding;
    const boxWidth = textWidth + padding * 2;
    const boxHeight = textHeight + padding * 2;

    // Draw background
    this.ctx.fillStyle = '#ffffff';
    this.ctx.fillRect(boxX, boxY, boxWidth, boxHeight);

    // Draw border
    this.ctx.strokeStyle = '#333333';
    this.ctx.lineWidth = 1;
    this.ctx.strokeRect(boxX, boxY, boxWidth, boxHeight);

    // Draw text
    this.ctx.fillStyle = '#000000';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText(priceText, boxX + padding, y);

    this.ctx.restore();
  }

  /**
   * Draw time label at canvasX on bottom margin.
   */
  private drawTimeLabel(x: number, barIndex: number): void {
    this.ctx.save();

    // Get time from bar
    const bar = this.bars[barIndex];
    const timeText = formatTime(bar.ts_event);

    // Measure text
    this.ctx.font = '12px sans-serif';
    const metrics = this.ctx.measureText(timeText);
    const textWidth = metrics.width;
    const textHeight = 12; // Approximate height

    // Position in bottom margin
    const padding = 4;
    const boxX = x - textWidth / 2 - padding;
    const boxY = this.canvasHeight - this.margins.bottom + 2;
    const boxWidth = textWidth + padding * 2;
    const boxHeight = textHeight + padding * 2;

    // Draw background
    this.ctx.fillStyle = '#ffffff';
    this.ctx.fillRect(boxX, boxY, boxWidth, boxHeight);

    // Draw border
    this.ctx.strokeStyle = '#333333';
    this.ctx.lineWidth = 1;
    this.ctx.strokeRect(boxX, boxY, boxWidth, boxHeight);

    // Draw text
    this.ctx.fillStyle = '#000000';
    this.ctx.textBaseline = 'top';
    this.ctx.fillText(timeText, boxX + padding, boxY + padding);

    this.ctx.restore();
  }

  /**
   * Draw OHLC readout box at top-left corner.
   */
  private drawOHLCReadout(barIndex: number): void {
    this.ctx.save();

    // Get bar data
    const bar = this.bars[barIndex];

    // Format OHLC values
    const oText = `O: ${formatPrice(bar.open)}`;
    const hText = `H: ${formatPrice(bar.high)}`;
    const lText = `L: ${formatPrice(bar.low)}`;
    const cText = `C: ${formatPrice(bar.close)}`;
    const vText = `V: ${bar.volume.toFixed(0)}`;

    // Setup font
    this.ctx.font = '11px monospace';

    // Measure text to calculate box size
    const lines = [oText, hText, lText, cText, vText];
    const lineHeight = 14;
    const padding = 6;

    let maxWidth = 0;
    for (const line of lines) {
      const width = this.ctx.measureText(line).width;
      if (width > maxWidth) {
        maxWidth = width;
      }
    }

    const boxX = 10;
    const boxY = 10;
    const boxWidth = maxWidth + padding * 2;
    const boxHeight = lines.length * lineHeight + padding * 2;

    // Draw semi-transparent background
    this.ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    this.ctx.fillRect(boxX, boxY, boxWidth, boxHeight);

    // Draw border
    this.ctx.strokeStyle = '#333333';
    this.ctx.lineWidth = 1;
    this.ctx.strokeRect(boxX, boxY, boxWidth, boxHeight);

    // Draw text lines
    this.ctx.fillStyle = '#000000';
    this.ctx.textBaseline = 'top';

    for (let i = 0; i < lines.length; i++) {
      const textY = boxY + padding + i * lineHeight;
      this.ctx.fillText(lines[i], boxX + padding, textY);
    }

    this.ctx.restore();
  }
}
