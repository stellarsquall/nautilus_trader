import type { CoordinateTransform } from './CoordinateTransform';
import type { ChartViewState } from './ChartViewState';

export interface InteractionControllerCallbacks {
  /** Called after view-state mutation (pan/zoom) to schedule redraw */
  onViewChanged: () => void;
  /** Called on mousemove to update crosshair position */
  onMouseMove: (canvasX: number, canvasY: number, barIndex: number) => void;
  /** Called on mouseleave to hide crosshair */
  onMouseLeave: () => void;
}

export class InteractionController {
  private canvas: HTMLCanvasElement;
  private transform: CoordinateTransform;
  private viewState: ChartViewState;
  private callbacks: InteractionControllerCallbacks;

  // Drag-pan state
  private isDragging = false;
  private dragStartX = 0;
  private dragStartVisibleStart = 0;

  // Fractional-bar accumulator for wheel/trackpad horizontal panning: a single
  // scroll tick is often a fraction of a bar wide and would round to zero, so we
  // sum deltas and pan once a whole bar's worth has accrued.
  private wheelPanAccumulator = 0;

  // Smoothing constant for wheel/trackpad zoom (scales scroll magnitude).
  private static readonly ZOOM_SENSITIVITY = 0.008;
  // Clamp per-event scroll magnitude so a single mouse-wheel notch can't
  // zoom too aggressively while a fine trackpad scroll stays smooth.
  private static readonly MAX_WHEEL_DELTA = 40;

  // Bound event handler references (for cleanup)
  private boundHandleMouseDown: (event: MouseEvent) => void;
  private boundHandleMouseMove: (event: MouseEvent) => void;
  private boundHandleMouseLeave: (event: MouseEvent) => void;
  private boundHandleWheel: (event: WheelEvent) => void;
  // Window-level drag handlers, attached only while a drag is active so the
  // pan keeps working (and ends) even when the pointer leaves the canvas.
  private boundHandleDragMove: (event: MouseEvent) => void;
  private boundHandleDragEnd: (event: MouseEvent) => void;

  /**
   * Construct and attach event listeners.
   *
   * @param canvas - Canvas element to attach listeners to
   * @param transform - CoordinateTransform for hit-testing (xToBarIndex, yToPrice)
   * @param viewState - ChartViewState to mutate on pan/zoom
   * @param callbacks - Callbacks for triggering redraws and crosshair updates
   */
  constructor(
    canvas: HTMLCanvasElement,
    transform: CoordinateTransform,
    viewState: ChartViewState,
    callbacks: InteractionControllerCallbacks
  ) {
    this.canvas = canvas;
    this.transform = transform;
    this.viewState = viewState;
    this.callbacks = callbacks;

    // Bind event handlers to preserve 'this' context
    this.boundHandleMouseDown = this.handleMouseDown.bind(this);
    this.boundHandleMouseMove = this.handleMouseMove.bind(this);
    this.boundHandleMouseLeave = this.handleMouseLeave.bind(this);
    this.boundHandleWheel = this.handleWheel.bind(this);
    this.boundHandleDragMove = this.handleDragMove.bind(this);
    this.boundHandleDragEnd = this.handleDragEnd.bind(this);

    // Attach event listeners. mousemove on the canvas drives the crosshair;
    // the drag pan uses window-level listeners added on mousedown.
    this.canvas.addEventListener('mousedown', this.boundHandleMouseDown);
    this.canvas.addEventListener('mousemove', this.boundHandleMouseMove);
    this.canvas.addEventListener('mouseleave', this.boundHandleMouseLeave);
    // wheel must be non-passive so preventDefault() can suppress page scroll/zoom.
    this.canvas.addEventListener('wheel', this.boundHandleWheel, { passive: false });

    // Affordance: a grab hand indicates the chart is draggable.
    this.canvas.style.cursor = 'grab';
  }

  /**
   * Destroy and remove all event listeners.
   *
   * MUST be called to avoid memory leaks. All listeners added in the constructor
   * are removed here, plus any active window-level drag listeners.
   */
  public destroy(): void {
    this.canvas.removeEventListener('mousedown', this.boundHandleMouseDown);
    this.canvas.removeEventListener('mousemove', this.boundHandleMouseMove);
    this.canvas.removeEventListener('mouseleave', this.boundHandleMouseLeave);
    this.canvas.removeEventListener('wheel', this.boundHandleWheel);
    // Tear down any in-flight drag listeners.
    window.removeEventListener('mousemove', this.boundHandleDragMove);
    window.removeEventListener('mouseup', this.boundHandleDragEnd);
    this.isDragging = false;
  }

  private handleMouseDown(event: MouseEvent): void {
    // Prevent native text/image drag or selection from swallowing the drag.
    event.preventDefault();

    this.isDragging = true;
    this.dragStartX = event.clientX;
    this.dragStartVisibleStart = this.viewState.getState().visibleStart;
    this.canvas.style.cursor = 'grabbing';

    // Promote move/up to the window so the drag survives the pointer leaving
    // the canvas and always ends on release, wherever that happens.
    window.addEventListener('mousemove', this.boundHandleDragMove);
    window.addEventListener('mouseup', this.boundHandleDragEnd);
  }

  /** Window-level: pan while a drag is active. */
  private handleDragMove(event: MouseEvent): void {
    if (!this.isDragging) return;

    const barWidth = this.safeBarWidth();
    if (barWidth === null) return; // transform not ready; ignore this move
    const deltaX = event.clientX - this.dragStartX;
    const deltaBars = -deltaX / barWidth;

    // Compute the target relative to the drag origin, then apply the residual
    // via the relative pan() (cumulative, drift-free).
    const currentVisibleStart = this.viewState.getState().visibleStart;
    const targetVisibleStart = this.dragStartVisibleStart + Math.round(deltaBars);
    this.viewState.pan(targetVisibleStart - currentVisibleStart);
    this.callbacks.onViewChanged();
  }

  /** Read getBarWidth() defensively: never let a null-range/non-finite width from
   *  a mid-switch transform throw out of a handler or feed NaN into pan/zoom.
   *  Returns null (=> caller should no-op) on any anomaly. */
  private safeBarWidth(): number | null {
    let bw: number;
    try {
      bw = this.transform.getBarWidth();
    } catch {
      return null;
    }
    return Number.isFinite(bw) && bw > 0 ? bw : null;
  }

  /** Window-level: end the drag on mouse release. */
  private handleDragEnd(_event: MouseEvent): void {
    this.isDragging = false;
    this.canvas.style.cursor = 'grab';
    window.removeEventListener('mousemove', this.boundHandleDragMove);
    window.removeEventListener('mouseup', this.boundHandleDragEnd);
  }

  /** Canvas-level: update the crosshair (suppressed while dragging). */
  private handleMouseMove(event: MouseEvent): void {
    if (this.isDragging) return;

    const rect = this.canvas.getBoundingClientRect();
    const canvasX = event.clientX - rect.left;
    const canvasY = event.clientY - rect.top;
    const barIndex = this.transform.xToBarIndex(canvasX);

    this.callbacks.onMouseMove(canvasX, canvasY, barIndex);
  }

  private handleMouseLeave(_event: MouseEvent): void {
    this.callbacks.onMouseLeave();
  }

  private handleWheel(event: WheelEvent): void {
    event.preventDefault();

    const rect = this.canvas.getBoundingClientRect();
    const canvasX = event.clientX - rect.left;

    // Two-finger horizontal swipe (no pinch): pan through time. Accumulate
    // sub-bar deltas so fine scrolling still pans instead of rounding to zero.
    if (!event.ctrlKey && Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
      const barWidth = this.safeBarWidth();
      if (barWidth === null) return;
      if (!Number.isFinite(this.wheelPanAccumulator)) this.wheelPanAccumulator = 0;
      this.wheelPanAccumulator += event.deltaX / barWidth;
      const wholeBars = Math.trunc(this.wheelPanAccumulator);
      if (wholeBars !== 0) {
        this.wheelPanAccumulator -= wholeBars;
        this.viewState.pan(wholeBars);
        this.callbacks.onViewChanged();
      }
      return;
    }

    // Pinch (ctrlKey) or vertical scroll / mouse wheel: smooth cursor-anchored
    // zoom. Scaling by the (clamped) scroll magnitude keeps a fine trackpad
    // scroll smooth while a single mouse-wheel notch still zooms perceptibly,
    // instead of the old flat 10%-per-event that stuttered on trackpads.
    const clampedDelta = Math.max(
      -InteractionController.MAX_WHEEL_DELTA,
      Math.min(InteractionController.MAX_WHEEL_DELTA, event.deltaY)
    );
    const zoomFactor = Math.exp(clampedDelta * InteractionController.ZOOM_SENSITIVITY);
    let anchorBarIndex: number;
    try {
      anchorBarIndex = this.transform.xToBarIndex(canvasX);
    } catch {
      return; // transform not ready; ignore this zoom
    }
    if (!Number.isFinite(anchorBarIndex)) return;
    this.viewState.zoom(zoomFactor, anchorBarIndex);
    this.callbacks.onViewChanged();
  }
}
