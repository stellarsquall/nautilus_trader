import type { Renderer } from './Renderer';
import type { BarPayload } from '../types';
import {
  CoordinateTransform,
  autoscalePriceRange,
  generateNiceTicks,
  formatPrice,
  formatTime,
  type PriceRange,
  type BarRange,
  type AxisMargins,
} from '../chart/CoordinateTransform';
import { ChartViewState } from '../chart/ChartViewState';
import { InteractionController } from '../chart/InteractionController';
import { CrosshairOverlay } from '../chart/CrosshairOverlay';
import { ResetToLatestButton } from '../chart/ResetToLatestButton';

export class CanvasCandlestickRenderer implements Renderer {
  // Canvas and context
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private container: HTMLElement;

  // Data buffer: rolling window, max 1000 bars
  private bars: BarPayload[] = [];
  private readonly MAX_BARS = 1000;
  private readonly VISIBLE_BARS = 100;

  // Coordinate transform
  private transform: CoordinateTransform;

  // ResizeObserver and devicePixelRatio tracking
  private resizeObserver: ResizeObserver;
  private currentDPR: number;

  // RAF batching state
  private rafHandle: number | null = null;
  private isDirty = false;

  // Interaction components
  private viewState: ChartViewState;
  private interactionController: InteractionController;
  private crosshairOverlay: CrosshairOverlay;
  private resetButton: ResetToLatestButton;

  // Axis margin configuration (pixels)
  private static readonly MARGINS: AxisMargins = {
    top: 20,
    right: 80,
    bottom: 40,
    left: 0,
  };

  // Visual constants (matching slice 1)
  private static readonly COLOR_UP = '#26a69a';
  private static readonly COLOR_DOWN = '#ef5350';
  private static readonly COLOR_GRID = '#e0e0e0';
  private static readonly COLOR_TEXT = '#333333';
  private static readonly COLOR_LAST_PRICE = '#333333';
  private static readonly COLOR_BACKGROUND = '#ffffff';
  private static readonly COLOR_AXIS_BG = '#f5f5f5';

  // Canvas size limits (backing store, not CSS size)
  private static readonly MAX_CANVAS_DIMENSION = 4096;

  constructor(container: HTMLElement) {
    this.container = container;

    // Create canvas
    this.canvas = document.createElement('canvas');
    this.canvas.style.display = 'block';

    // Get 2D context (FATAL if null)
    const ctx = this.canvas.getContext('2d');
    if (!ctx) {
      const errorMsg = 'Failed to get 2D canvas context. Canvas rendering is not supported.';
      console.error(errorMsg);
      throw new Error(errorMsg);
    }
    this.ctx = ctx;

    // Append to container
    this.container.appendChild(this.canvas);

    // Measure container
    const containerWidth = this.container.clientWidth;
    const containerHeight = this.container.clientHeight;

    if (containerWidth <= 0 || containerHeight <= 0) {
      console.warn(
        `Container has zero dimensions: ${containerWidth}x${containerHeight}. Canvas will not be visible.`
      );
    }

    // Initialize transform with container dimensions
    this.transform = new CoordinateTransform(
      containerWidth,
      containerHeight,
      CanvasCandlestickRenderer.MARGINS
    );

    // Track current DPR
    this.currentDPR = window.devicePixelRatio || 1;

    // Size canvas
    this.resizeCanvas(containerWidth, containerHeight);

    // Set up ResizeObserver
    this.resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const newWidth = entry.contentRect.width;
        const newHeight = entry.contentRect.height;
        this.handleResize(newWidth, newHeight);
      }
    });
    this.resizeObserver.observe(this.container);

    // Initialize view-state (initially 0 bars, will update on first bar)
    this.viewState = new ChartViewState(0, this.VISIBLE_BARS);

    // Create crosshair overlay
    this.crosshairOverlay = new CrosshairOverlay(this.container, this.transform);

    // Create interaction controller with callbacks
    this.interactionController = new InteractionController(
      this.canvas,
      this.transform,
      this.viewState,
      {
        onViewChanged: () => {
          this.updateTransformRanges(); // Recompute transform ranges from view-state
          this.scheduleRedraw(); // Redraw main chart
          this.resetButton.updateVisibility(); // Update button visibility
        },
        onMouseMove: (canvasX, canvasY, barIndex) => {
          this.crosshairOverlay.show({ canvasX, canvasY, barIndex });
        },
        onMouseLeave: () => {
          this.crosshairOverlay.hide();
        },
      }
    );

    // Create reset-to-latest button
    this.resetButton = new ResetToLatestButton(this.container, this.viewState, {
      onReset: () => {
        this.updateTransformRanges();
        this.scheduleRedraw();
        this.resetButton.updateVisibility();
      },
    });

    // Initial render (blank)
    this.scheduleRedraw();
  }

  public update(data: unknown): void {
    const bar = data as BarPayload;

    if (!this.isValidBarPayload(bar)) {
      console.error('Invalid BarPayload received:', data);
      return;
    }

    // Determine append vs replace-last vs ignore
    if (this.bars.length === 0) {
      this.bars.push(bar);
    } else {
      const lastBar = this.bars[this.bars.length - 1];

      if (bar.ts_event === lastBar.ts_event) {
        // Replace last bar
        this.bars[this.bars.length - 1] = bar;
      } else if (bar.ts_event > lastBar.ts_event) {
        // Append
        this.bars.push(bar);

        // Enforce rolling buffer limit
        if (this.bars.length > this.MAX_BARS) {
          const excess = this.bars.length - this.MAX_BARS;
          this.bars.splice(0, excess);
        }
      } else {
        // Out-of-order: ignore
        console.warn(
          `Out-of-order bar ignored: ts_event=${bar.ts_event} is older than last bar ts_event=${lastBar.ts_event}`
        );
        return;
      }
    }

    // Update view-state with new total bar count
    this.viewState.setTotalBars(this.bars.length);

    // If in auto-follow mode, notify view-state to advance window
    this.viewState.onNewBar(this.bars.length);

    // Update crosshair overlay's bar reference
    this.crosshairOverlay.setBars(this.bars);

    // Update transform ranges (view-state may have advanced)
    this.updateTransformRanges();

    // Update reset button visibility (follow mode may have changed)
    this.resetButton.updateVisibility();

    // Schedule redraw
    this.scheduleRedraw();
  }

  public destroy(): void {
    // Destroy interaction controller (removes event listeners)
    this.interactionController.destroy();

    // Destroy crosshair overlay
    this.crosshairOverlay.destroy();

    // Destroy reset button
    this.resetButton.destroy();

    this.resizeObserver.disconnect();

    if (this.rafHandle !== null) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }

    if (this.canvas.parentNode) {
      this.canvas.parentNode.removeChild(this.canvas);
    }

    this.bars = [];
  }

  private isValidBarPayload(data: unknown): data is BarPayload {
    if (typeof data !== 'object' || data === null) {
      return false;
    }

    const bar = data as Record<string, unknown>;

    return (
      typeof bar.ts_event === 'number' && Number.isFinite(bar.ts_event) &&
      typeof bar.open === 'number' && Number.isFinite(bar.open) &&
      typeof bar.high === 'number' && Number.isFinite(bar.high) &&
      typeof bar.low === 'number' && Number.isFinite(bar.low) &&
      typeof bar.close === 'number' && Number.isFinite(bar.close) &&
      typeof bar.volume === 'number' && Number.isFinite(bar.volume)
    );
  }

  private updateTransformRanges(): void {
    if (this.bars.length === 0) {
      return;
    }

    // Get visible range from view-state (replaces hardcoded tail window)
    const state = this.viewState.getState();
    const visibleStart = state.visibleStart;
    const visibleEnd = Math.min(
      visibleStart + state.visibleCount - 1,
      this.bars.length - 1
    );

    const barRange: BarRange = {
      start: visibleStart,
      end: visibleEnd,
    };

    this.transform.setVisibleBarRange(barRange);

    // Autoscale price from VISIBLE bars only (not entire buffer)
    const priceRange = autoscalePriceRange(this.bars, visibleStart, visibleEnd);
    if (priceRange) {
      this.transform.setPriceRange(priceRange);
    } else {
      console.warn('Failed to compute price range from visible bars.');
    }
  }

  private resizeCanvas(newWidth: number, newHeight: number): void {
    const newDPR = window.devicePixelRatio || 1;
    if (newDPR !== this.currentDPR) {
      console.log(
        `devicePixelRatio changed: ${this.currentDPR} → ${newDPR}. Re-rendering for crisp display.`
      );
      this.currentDPR = newDPR;
    }

    const maxCSSWidth = CanvasCandlestickRenderer.MAX_CANVAS_DIMENSION / this.currentDPR;
    const maxCSSHeight = CanvasCandlestickRenderer.MAX_CANVAS_DIMENSION / this.currentDPR;

    const clampedWidth = Math.min(newWidth, maxCSSWidth);
    const clampedHeight = Math.min(newHeight, maxCSSHeight);

    if (clampedWidth < newWidth || clampedHeight < newHeight) {
      console.warn(
        `Canvas size clamped: requested ${newWidth}x${newHeight}, using ${clampedWidth}x${clampedHeight}`
      );
    }

    this.canvas.width = clampedWidth * this.currentDPR;
    this.canvas.height = clampedHeight * this.currentDPR;

    this.canvas.style.width = `${clampedWidth}px`;
    this.canvas.style.height = `${clampedHeight}px`;

    this.ctx.scale(this.currentDPR, this.currentDPR);

    this.transform.updateDimensions(clampedWidth, clampedHeight);
  }

  private handleResize(newWidth: number, newHeight: number): void {
    this.resizeCanvas(newWidth, newHeight);

    // Resize crosshair overlay to match
    this.crosshairOverlay.updateDimensions(newWidth, newHeight);

    // Recompute transform ranges (chart dimensions changed)
    this.updateTransformRanges();

    this.scheduleRedraw();
  }

  private scheduleRedraw(): void {
    this.isDirty = true;

    if (this.rafHandle === null) {
      this.rafHandle = requestAnimationFrame(() => {
        this.rafHandle = null;
        if (this.isDirty) {
          this.isDirty = false;
          this.render();
        }
      });
    }
  }

  private render(): void {
    this.ctx.clearRect(0, 0, this.canvas.width / this.currentDPR, this.canvas.height / this.currentDPR);

    this.drawBackground();

    if (this.bars.length === 0) {
      return;
    }

    this.drawGrid();
    this.drawCandles();
    this.drawTimeAxis();
    this.drawPriceAxis();
    this.drawLastPriceLine();
  }

  private drawBackground(): void {
    const canvasWidth = this.canvas.width / this.currentDPR;
    const canvasHeight = this.canvas.height / this.currentDPR;
    const margins = CanvasCandlestickRenderer.MARGINS;

    this.ctx.fillStyle = CanvasCandlestickRenderer.COLOR_BACKGROUND;
    this.ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    this.ctx.fillStyle = CanvasCandlestickRenderer.COLOR_AXIS_BG;
    this.ctx.fillRect(0, canvasHeight - margins.bottom, canvasWidth, margins.bottom);

    this.ctx.fillRect(
      canvasWidth - margins.right,
      0,
      margins.right,
      canvasHeight - margins.bottom
    );
  }

  private drawGrid(): void {
    const priceRange = this.transform.getPriceRange();
    if (!priceRange) return;

    const ticks = generateNiceTicks(priceRange, 8);

    this.ctx.strokeStyle = CanvasCandlestickRenderer.COLOR_GRID;
    this.ctx.lineWidth = 1;

    const chartWidth = this.transform.getChartWidth();
    const margins = CanvasCandlestickRenderer.MARGINS;

    for (const price of ticks) {
      const y = this.transform.priceToY(price);

      this.ctx.beginPath();
      this.ctx.moveTo(margins.left, y);
      this.ctx.lineTo(margins.left + chartWidth, y);
      this.ctx.stroke();
    }
  }

  private drawCandles(): void {
    const visibleRange = this.transform.getVisibleBarRange();
    if (!visibleRange) return;

    const barWidth = this.transform.getBarWidth();
    const bodyWidth = barWidth * 0.8;

    for (let i = visibleRange.start; i <= visibleRange.end; i++) {
      const bar = this.bars[i];
      if (!bar) continue;

      const x = this.transform.barIndexToX(i);
      const openY = this.transform.priceToY(bar.open);
      const closeY = this.transform.priceToY(bar.close);
      const highY = this.transform.priceToY(bar.high);
      const lowY = this.transform.priceToY(bar.low);

      const isBullish = bar.close >= bar.open;
      const color = isBullish
        ? CanvasCandlestickRenderer.COLOR_UP
        : CanvasCandlestickRenderer.COLOR_DOWN;

      this.ctx.fillStyle = color;
      this.ctx.strokeStyle = color;

      // Draw wick
      this.ctx.lineWidth = 1;
      this.ctx.beginPath();
      this.ctx.moveTo(x, highY);
      this.ctx.lineTo(x, lowY);
      this.ctx.stroke();

      // Draw body
      const bodyTop = Math.min(openY, closeY);
      const bodyHeight = Math.abs(closeY - openY);

      if (bodyHeight < 1) {
        // Doji
        this.ctx.lineWidth = 1;
        this.ctx.beginPath();
        this.ctx.moveTo(x - bodyWidth / 2, openY);
        this.ctx.lineTo(x + bodyWidth / 2, openY);
        this.ctx.stroke();
      } else {
        this.ctx.fillRect(x - bodyWidth / 2, bodyTop, bodyWidth, bodyHeight);
      }
    }
  }

  private drawTimeAxis(): void {
    const visibleRange = this.transform.getVisibleBarRange();
    if (!visibleRange) return;

    const canvasHeight = this.canvas.height / this.currentDPR;
    const margins = CanvasCandlestickRenderer.MARGINS;

    const visibleBarCount = visibleRange.end - visibleRange.start + 1;
    const labelInterval = Math.max(1, Math.floor(visibleBarCount / 10));

    this.ctx.fillStyle = CanvasCandlestickRenderer.COLOR_TEXT;
    this.ctx.font = '12px sans-serif';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';

    const labelY = canvasHeight - margins.bottom / 2;

    for (let i = visibleRange.start; i <= visibleRange.end; i += labelInterval) {
      const bar = this.bars[i];
      if (!bar) continue;

      const x = this.transform.barIndexToX(i);
      const label = formatTime(bar.ts_event);

      this.ctx.fillText(label, x, labelY);
    }
  }

  private drawPriceAxis(): void {
    const priceRange = this.transform.getPriceRange();
    if (!priceRange) return;

    const canvasWidth = this.canvas.width / this.currentDPR;
    const margins = CanvasCandlestickRenderer.MARGINS;

    const ticks = generateNiceTicks(priceRange, 8);

    this.ctx.fillStyle = CanvasCandlestickRenderer.COLOR_TEXT;
    this.ctx.font = '12px sans-serif';
    this.ctx.textAlign = 'left';
    this.ctx.textBaseline = 'middle';

    const labelX = canvasWidth - margins.right + 5;

    for (const price of ticks) {
      const y = this.transform.priceToY(price);
      const label = formatPrice(price);

      this.ctx.fillText(label, labelX, y);
    }
  }

  private drawLastPriceLine(): void {
    if (this.bars.length === 0) return;

    const lastBar = this.bars[this.bars.length - 1];
    const y = this.transform.priceToY(lastBar.close);

    const chartWidth = this.transform.getChartWidth();
    const canvasWidth = this.canvas.width / this.currentDPR;
    const margins = CanvasCandlestickRenderer.MARGINS;

    // Draw dashed line
    this.ctx.strokeStyle = CanvasCandlestickRenderer.COLOR_LAST_PRICE;
    this.ctx.lineWidth = 1;
    this.ctx.setLineDash([5, 5]);

    this.ctx.beginPath();
    this.ctx.moveTo(margins.left, y);
    this.ctx.lineTo(margins.left + chartWidth, y);
    this.ctx.stroke();

    this.ctx.setLineDash([]);

    // Draw label box
    const label = formatPrice(lastBar.close);
    this.ctx.font = '12px sans-serif';
    const textMetrics = this.ctx.measureText(label);
    const textWidth = textMetrics.width;

    const boxX = canvasWidth - margins.right + 2;
    const boxY = y - 8;
    const boxWidth = textWidth + 6;
    const boxHeight = 16;

    this.ctx.fillStyle = CanvasCandlestickRenderer.COLOR_BACKGROUND;
    this.ctx.fillRect(boxX, boxY, boxWidth, boxHeight);

    this.ctx.strokeStyle = CanvasCandlestickRenderer.COLOR_LAST_PRICE;
    this.ctx.lineWidth = 1;
    this.ctx.strokeRect(boxX, boxY, boxWidth, boxHeight);

    this.ctx.fillStyle = CanvasCandlestickRenderer.COLOR_TEXT;
    this.ctx.textAlign = 'left';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText(label, boxX + 3, y);
  }
}
