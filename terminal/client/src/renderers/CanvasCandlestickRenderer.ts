import type { Renderer } from './Renderer';
import type { BarPayload, CvdPayload, FootprintPayload } from '../types';
import { formatPrice, type BarRange } from '../chart/CoordinateTransform';
import { ChartViewState } from '../chart/ChartViewState';
import { InteractionController } from '../chart/InteractionController';
import { CrosshairOverlay } from '../chart/CrosshairOverlay';
import { ResetToLatestButton } from '../chart/ResetToLatestButton';
import { PaneLayout } from '../chart/PaneLayout';
import { CandlestickPane } from '../chart/CandlestickPane';
import { VolumePane } from '../chart/VolumePane';
import { CVDPane } from '../chart/CVDPane';
import { VolumeProfileOverlay } from '../chart/VolumeProfileOverlay';

/**
 * CanvasCandlestickRenderer: the app-facing Renderer.
 *
 * Composes a three-pane layout — a delta-colored candlestick (price) pane over
 * a cumulative-volume-delta (CVD) line pane over a volume histogram — all
 * sharing one horizontal (time) coordinate transform and a single
 * ChartViewState. The renderer owns the canvas, the DPR/resize plumbing, the
 * RAF-batched draw, and the interaction stack (pan/zoom, crosshair, Latest reset);
 * PaneLayout owns the per-pane drawing and the shared horizontal transform.
 */
export class CanvasCandlestickRenderer implements Renderer {
  // Canvas and context
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private container: HTMLElement;

  // Data buffer: rolling window, max 1000 bars
  private bars: BarPayload[] = [];
  private readonly MAX_BARS = 1000;
  private readonly VISIBLE_BARS = 100;

  // Multi-pane layout (candlestick + CVD + volume) sharing one horizontal transform
  private paneLayout: PaneLayout;
  private currentVisibleRange: BarRange = { start: 0, end: 0 };

  // Pane references retained for post-construction control (delta toggle, CVD feed)
  private candlestickPane: CandlestickPane;
  private cvdPane: CVDPane;

  // CVD values keyed by bar ts_event (the cvd envelope's alignment key). Kept
  // separate from bar indices so the CVDPane's per-index map can be rebuilt
  // after the rolling buffer trims/shifts bars.
  private cvdByTs: Map<number, { cvd: number; delta: number }> = new Map();

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
  private deltaToggleButton: HTMLButtonElement | null = null;

  // Volume Profile overlay and toggle
  private volumeProfileOverlay: VolumeProfileOverlay;
  private volumeProfileToggleButton: HTMLButtonElement | null = null;
  private volumeProfileVisible = true;

  // Vertical split: price 60%, CVD 20%, volume 20% (volume bottom = time axis)
  private static readonly PANE_HEIGHT_FRACTIONS = [0.6, 0.2, 0.2];

  // Visual constants
  private static readonly COLOR_BACKGROUND = '#ffffff';

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

    // Track current DPR
    this.currentDPR = window.devicePixelRatio || 1;

    // Compose the three-pane layout: candlestick (price) over CVD over volume.
    // Volume is the bottom pane (it draws the shared time axis).
    const candlestickPane = new CandlestickPane(containerWidth, containerHeight);
    const cvdPane = new CVDPane(containerWidth, containerHeight);
    const volumePane = new VolumePane(containerWidth, containerHeight);
    this.candlestickPane = candlestickPane;
    this.cvdPane = cvdPane;
    this.paneLayout = new PaneLayout(
      [candlestickPane, cvdPane, volumePane],
      CanvasCandlestickRenderer.PANE_HEIGHT_FRACTIONS,
      containerWidth,
      containerHeight
    );

    // Size canvas (also lays out panes)
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

    // The interaction layer and crosshair share the one horizontal (time) transform.
    const horizontalTransform = this.paneLayout.getHorizontalTransform();

    // Create crosshair overlay
    this.crosshairOverlay = new CrosshairOverlay(this.container, horizontalTransform);
    // Per-pane value readout: price in the candle pane, integer CVD / volume in
    // the lower panes (null suppresses the label when the cursor is off panes).
    this.crosshairOverlay.setValueResolver((y: number): string | null => {
      const resolved = this.paneLayout.yToValue(y);
      if (!resolved) return null;

      if (resolved.paneIndex === 0) {
        // When Volume Profile is visible and has data at this price level,
        // show volume-at-price instead of just the price.
        const price = resolved.value;
        if (this.volumeProfileVisible) {
          const vol = this.volumeProfileOverlay.getVolumeAtPrice(price, this.bars, this.currentVisibleRange);
          if (vol) {
            return `V:${vol.total} B:${vol.buy} S:${vol.sell}`;
          }
        }
        return formatPrice(resolved.value);
      }
      // Pane 1 (CVD) or 2 (volume) = integers.
      return Math.round(resolved.value).toString();
    });

    // Create interaction controller with callbacks (drives the SHARED x-axis, so
    // pan/zoom move every pane in lockstep).
    this.interactionController = new InteractionController(
      this.canvas,
      horizontalTransform,
      this.viewState,
      {
        onViewChanged: () => {
          this.updateVisibleRange(); // Recompute the visible window from view-state
          this.scheduleRedraw(); // Redraw all panes
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
        this.updateVisibleRange();
        this.scheduleRedraw();
        this.resetButton.updateVisibility();
      },
    });

    // Create the delta-coloring toggle (delta coloring is ON by default).
    this.createDeltaToggleButton();

    // Create Volume Profile Overlay (shares horizontal transform for chart width).
    this.volumeProfileOverlay = new VolumeProfileOverlay(this.container, horizontalTransform);
    this.createVolumeProfileToggleButton();

    // Initial render (blank)
    this.scheduleRedraw();
  }

  /**
   * Create a small toggle button that switches candle coloring between
   * order-flow delta (default) and traditional close-vs-open. Positioned in the
   * top-left of the container so it does not overlap the right-side price axis.
   */
  private createDeltaToggleButton(): void {
    const button = document.createElement('button');
    button.style.position = 'absolute';
    button.style.top = '8px';
    button.style.left = '8px';
    button.style.zIndex = '10';
    button.style.padding = '4px 8px';
    button.style.font = '12px sans-serif';
    button.style.cursor = 'pointer';
    button.style.border = '1px solid #cccccc';
    button.style.borderRadius = '4px';
    button.style.background = '#ffffff';
    button.style.color = '#333333';

    const syncLabel = (): void => {
      button.textContent = this.candlestickPane.isColorByDelta()
        ? 'Color: Delta'
        : 'Color: Price';
    };
    syncLabel();

    button.addEventListener('click', () => {
      const next = !this.candlestickPane.isColorByDelta();
      this.candlestickPane.setColorByDelta(next);
      syncLabel();
      this.scheduleRedraw();
    });

    // Ensure the container can anchor the absolutely-positioned button.
    if (getComputedStyle(this.container).position === 'static') {
      this.container.style.position = 'relative';
    }
    this.container.appendChild(button);
    this.deltaToggleButton = button;
  }

  /**
   * Create a toggle button for Volume Profile visibility (ON by default).
   * Positioned below the delta toggle button with the same style.
   */
  private createVolumeProfileToggleButton(): void {
    const button = document.createElement('button');
    button.style.position = 'absolute';
    button.style.top = '34px';
    button.style.left = '8px';
    button.style.zIndex = '10';
    button.style.padding = '4px 8px';
    button.style.font = '12px sans-serif';
    button.style.cursor = 'pointer';
    button.style.border = '1px solid #cccccc';
    button.style.borderRadius = '4px';
    button.style.background = '#ffffff';
    button.style.color = '#333333';

    const syncLabel = (): void => {
      button.textContent = this.volumeProfileVisible ? 'VP: On' : 'VP: Off';
    };
    syncLabel();

    button.addEventListener('click', () => {
      this.volumeProfileVisible = !this.volumeProfileVisible;
      syncLabel();
      this.scheduleRedraw();
    });

    this.container.appendChild(button);
    this.volumeProfileToggleButton = button;
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

    // Notify the view-state of the new bar. onNewBar() updates the total bar
    // count AND advances the follow window when at the tail. It must be the ONLY
    // total-count update here: it decides whether to advance by comparing the
    // window against the PREVIOUS total, so calling setTotalBars() first (which
    // pre-advances the total) would make onNewBar believe it is no longer at the
    // tail once the buffer exceeds visibleCount, freezing visibleStart at 0
    // while followLatest stays true (breaking pan).
    this.viewState.onNewBar(this.bars.length);

    // Share the updated bar buffer with the panes and crosshair.
    this.paneLayout.setBars(this.bars);
    this.crosshairOverlay.setBars(this.bars);

    // Re-align CVD values to the (possibly shifted) bar indices.
    this.resyncCvd();

    // Recompute the visible window (view-state may have advanced)
    this.updateVisibleRange();

    // Update reset button visibility (follow mode may have changed)
    this.resetButton.updateVisibility();

    // Schedule redraw
    this.scheduleRedraw();
  }

  /**
   * Ingest a cumulative-volume-delta (CVD) payload.
   *
   * CVD is stored keyed by ts_event (the envelope's alignment key) and then
   * re-projected onto the current bar indices for the CVDPane. Storing by
   * ts_event (rather than a running index) keeps the pane correct even after the
   * rolling bar buffer trims and shifts indices.
   */
  public updateCvd(data: unknown): void {
    if (!this.isValidCvdPayload(data)) {
      console.error('Invalid CvdPayload received:', data);
      return;
    }

    this.cvdByTs.set(data.ts_event, { cvd: data.cvd, delta: data.delta });
    this.resyncCvd();
    this.scheduleRedraw();
  }

  /**
   * Rebuild the CVDPane's per-bar-index map from the ts_event-keyed store.
   *
   * O(n) over the current bar buffer (n <= MAX_BARS). Called whenever bars or
   * CVD values change so the pane's index-keyed data stays aligned with the
   * renderer's bar array after appends/replacements/trims.
   */
  private resyncCvd(): void {
    if (this.cvdByTs.size === 0) {
      return;
    }
    this.cvdPane.reset();
    for (let i = 0; i < this.bars.length; i++) {
      const entry = this.cvdByTs.get(this.bars[i].ts_event);
      if (entry !== undefined) {
        this.cvdPane.updateCvdData(i, entry.cvd, entry.delta);
      }
    }
  }

  private isValidCvdPayload(data: unknown): data is CvdPayload {
    if (typeof data !== 'object' || data === null) {
      return false;
    }
    const cvd = data as Record<string, unknown>;
    return (
      typeof cvd.ts_event === 'number' && Number.isFinite(cvd.ts_event) &&
      typeof cvd.cvd === 'number' && Number.isFinite(cvd.cvd) &&
      typeof cvd.delta === 'number' && Number.isFinite(cvd.delta)
    );
  }

  public updateFootprint(data: FootprintPayload): void {
    this.volumeProfileOverlay.addFootprint(data);
  }

  public destroy(): void {
    // Destroy interaction controller (removes event listeners)
    this.interactionController.destroy();

    // Destroy crosshair overlay
    this.crosshairOverlay.destroy();

    // Destroy reset button
    this.resetButton.destroy();

    // Remove the delta toggle button
    if (this.deltaToggleButton && this.deltaToggleButton.parentNode) {
      this.deltaToggleButton.parentNode.removeChild(this.deltaToggleButton);
    }
    this.deltaToggleButton = null;

    // Remove the volume profile toggle button
    if (this.volumeProfileToggleButton && this.volumeProfileToggleButton.parentNode) {
      this.volumeProfileToggleButton.parentNode.removeChild(this.volumeProfileToggleButton);
    }
    this.volumeProfileToggleButton = null;

    // Destroy Volume Profile overlay
    this.volumeProfileOverlay.destroy();

    // Destroy panes
    this.paneLayout.destroy();

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

  /**
   * Recompute the visible bar window from the view-state and publish it to the
   * shared horizontal transform.
   *
   * Right-anchors the viewport: the render window is always exactly
   * `visibleCount` slots wide, and its right edge tracks the newest bar when
   * following (or the panned position otherwise). renderStart may be negative
   * and renderEnd may exceed bars.length - 1 — those slots are simply empty
   * (each pane culls missing bars), so a sparse chart shows the latest bar flush
   * right with empty space on the LEFT (standard trading-chart layout).
   *
   * Publishing the range here (not only in render()) keeps interaction
   * hit-testing (xToBarIndex/getBarWidth) consistent between frames.
   */
  private updateVisibleRange(): void {
    if (this.bars.length === 0) {
      return;
    }

    const state = this.viewState.getState();
    const visibleCount = state.visibleCount;

    const renderEnd = state.followLatest
      ? this.bars.length - 1
      : state.visibleStart + visibleCount - 1;
    const renderStart = renderEnd - visibleCount + 1;

    this.currentVisibleRange = { start: renderStart, end: renderEnd };

    // Keep the shared horizontal transform current for interaction hit-testing.
    this.paneLayout.getHorizontalTransform().setVisibleBarRange(this.currentVisibleRange);
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

    // Assigning canvas.width/height resets the context transform, so re-apply
    // the DPR scale (non-accumulating).
    this.ctx.scale(this.currentDPR, this.currentDPR);

    // Re-layout panes (recomputes pane rects and the shared transform dims).
    this.paneLayout.updateLayout(clampedWidth, clampedHeight);
  }

  private handleResize(newWidth: number, newHeight: number): void {
    this.resizeCanvas(newWidth, newHeight);

    // Resize crosshair overlay to match
    this.crosshairOverlay.updateDimensions(newWidth, newHeight);

    // Resize Volume Profile overlay to match
    this.volumeProfileOverlay.updateDimensions(newWidth, newHeight);

    // Recompute the visible window (chart dimensions changed)
    this.updateVisibleRange();

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
    const canvasWidth = this.canvas.width / this.currentDPR;
    const canvasHeight = this.canvas.height / this.currentDPR;

    // Clear and paint the full-canvas background.
    this.ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    this.ctx.fillStyle = CanvasCandlestickRenderer.COLOR_BACKGROUND;
    this.ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    if (this.bars.length === 0) {
      return;
    }

    // Delegate all pane drawing (candles + volume histogram) to the layout.
    this.paneLayout.render(this.ctx, this.currentVisibleRange);

    // Render Volume Profile overlay (if visible) on top of the panes.
    if (this.volumeProfileVisible) {
      const priceRange = this.candlestickPane.getPriceRange();
      if (priceRange) {
        // Configure the shared transform for the overlay's price→Y mapping.
        // The overlay shares the horizontal transform from PaneLayout, which
        // already has correct dimensions and margins for chart width.
        const horizontalTransform = this.paneLayout.getHorizontalTransform();
        horizontalTransform.setPriceRange(priceRange);
        this.volumeProfileOverlay.render(this.bars, this.currentVisibleRange);
      }
    }
  }
}
