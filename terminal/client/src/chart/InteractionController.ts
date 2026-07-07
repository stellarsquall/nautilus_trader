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

  // Bound event handler references (for cleanup)
  private boundHandleMouseDown: (event: MouseEvent) => void;
  private boundHandleMouseMove: (event: MouseEvent) => void;
  private boundHandleMouseUp: (event: MouseEvent) => void;
  private boundHandleMouseLeave: (event: MouseEvent) => void;
  private boundHandleWheel: (event: WheelEvent) => void;

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
    this.boundHandleMouseUp = this.handleMouseUp.bind(this);
    this.boundHandleMouseLeave = this.handleMouseLeave.bind(this);
    this.boundHandleWheel = this.handleWheel.bind(this);

    // Attach event listeners
    this.canvas.addEventListener('mousedown', this.boundHandleMouseDown);
    this.canvas.addEventListener('mousemove', this.boundHandleMouseMove);
    this.canvas.addEventListener('mouseup', this.boundHandleMouseUp);
    this.canvas.addEventListener('mouseleave', this.boundHandleMouseLeave);
    this.canvas.addEventListener('wheel', this.boundHandleWheel);
  }

  /**
   * Destroy and remove all event listeners.
   *
   * MUST be called to avoid memory leaks. All listeners added in constructor
   * are removed here.
   */
  public destroy(): void {
    this.canvas.removeEventListener('mousedown', this.boundHandleMouseDown);
    this.canvas.removeEventListener('mousemove', this.boundHandleMouseMove);
    this.canvas.removeEventListener('mouseup', this.boundHandleMouseUp);
    this.canvas.removeEventListener('mouseleave', this.boundHandleMouseLeave);
    this.canvas.removeEventListener('wheel', this.boundHandleWheel);
  }

  private handleMouseDown(event: MouseEvent): void {
    this.isDragging = true;
    this.dragStartX = event.clientX;
    this.dragStartVisibleStart = this.viewState.getState().visibleStart;
  }

  private handleMouseMove(event: MouseEvent): void {
    if (this.isDragging) {
      // Drag-pan logic
      const deltaX = event.clientX - this.dragStartX;
      const deltaBars = -deltaX / this.transform.getBarWidth();

      // Reset to drag start position and apply delta
      const state = this.viewState.getState();
      const currentVisibleStart = state.visibleStart;
      const targetVisibleStart = this.dragStartVisibleStart + Math.round(deltaBars);
      const actualDeltaBars = targetVisibleStart - currentVisibleStart;

      this.viewState.pan(actualDeltaBars);
      this.callbacks.onViewChanged();
    } else {
      // Crosshair update logic
      const rect = this.canvas.getBoundingClientRect();
      const canvasX = event.clientX - rect.left;
      const canvasY = event.clientY - rect.top;
      const barIndex = this.transform.xToBarIndex(canvasX);

      this.callbacks.onMouseMove(canvasX, canvasY, barIndex);
    }
  }

  private handleMouseUp(event: MouseEvent): void {
    this.isDragging = false;
  }

  private handleMouseLeave(event: MouseEvent): void {
    this.callbacks.onMouseLeave();
  }

  private handleWheel(event: WheelEvent): void {
    event.preventDefault();

    // Compute zoom factor
    const zoomFactor = event.deltaY > 0 ? 1.1 : 0.9;

    // Compute anchor bar index (bar under cursor)
    const rect = this.canvas.getBoundingClientRect();
    const canvasX = event.clientX - rect.left;
    const anchorBarIndex = this.transform.xToBarIndex(canvasX);

    // Apply zoom
    this.viewState.zoom(zoomFactor, anchorBarIndex);
    this.callbacks.onViewChanged();
  }
}
