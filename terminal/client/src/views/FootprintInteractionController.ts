import type { FootprintViewState } from './FootprintViewState.js';

export interface FootprintInteractionControllerCallbacks {
  onViewChanged: () => void;
}

const MIN_COLUMN_WIDTH = 60;

export class FootprintInteractionController {
  private canvas: HTMLCanvasElement;
  private viewState: FootprintViewState;
  private callbacks: FootprintInteractionControllerCallbacks;
  private isDragging = false;
  private dragStartX = 0;
  private dragStartVisibleStart = 0;
  private dragStartY = 0;
  private dragStartVerticalOffset = 0;
  // Fractional-bar accumulator for two-finger horizontal wheel/trackpad panning
  // (mirrors the Overview) so a fine swipe still pans instead of rounding to 0.
  private wheelPanAccumulator = 0;

  private boundHandleMouseDown: (event: MouseEvent) => void;
  private boundHandleDragMove: (event: MouseEvent) => void;
  private boundHandleDragEnd: (event: MouseEvent) => void;
  private boundHandleWheel: (event: WheelEvent) => void;
  private boundHandleDblClick: (event: MouseEvent) => void;

  constructor(
    canvas: HTMLCanvasElement,
    viewState: FootprintViewState,
    callbacks: FootprintInteractionControllerCallbacks
  ) {
    this.canvas = canvas;
    this.viewState = viewState;
    this.callbacks = callbacks;

    this.boundHandleMouseDown = this.handleMouseDown.bind(this);
    this.boundHandleDragMove = this.handleDragMove.bind(this);
    this.boundHandleDragEnd = this.handleDragEnd.bind(this);
    this.boundHandleWheel = this.handleWheel.bind(this);
    this.boundHandleDblClick = this.handleDblClick.bind(this);

    this.canvas.addEventListener('mousedown', this.boundHandleMouseDown);
    this.canvas.addEventListener('wheel', this.boundHandleWheel, { passive: false });
    this.canvas.addEventListener('dblclick', this.boundHandleDblClick);
    this.canvas.style.cursor = 'grab';
  }

  destroy(): void {
    this.canvas.removeEventListener('mousedown', this.boundHandleMouseDown);
    this.canvas.removeEventListener('wheel', this.boundHandleWheel);
    this.canvas.removeEventListener('dblclick', this.boundHandleDblClick);
    window.removeEventListener('mousemove', this.boundHandleDragMove);
    window.removeEventListener('mouseup', this.boundHandleDragEnd);
    this.isDragging = false;
  }

  private getBarWidth(): number {
    const rect = this.canvas.getBoundingClientRect();
    const range = this.viewState.getVisibleBarRange();
    if (range.count <= 0) return MIN_COLUMN_WIDTH;
    return Math.max(MIN_COLUMN_WIDTH, rect.width / range.count);
  }

  private handleMouseDown(event: MouseEvent): void {
    event.preventDefault();
    this.isDragging = true;
    this.dragStartX = event.clientX;
    this.dragStartVisibleStart = this.viewState.getVisibleBarRange().startIndex;
    this.dragStartY = event.clientY;
    this.dragStartVerticalOffset = this.viewState.getVerticalOffset();
    this.canvas.style.cursor = 'grabbing';

    window.addEventListener('mousemove', this.boundHandleDragMove);
    window.addEventListener('mouseup', this.boundHandleDragEnd);
  }

  private handleDragMove(event: MouseEvent): void {
    if (!this.isDragging) return;

    // Horizontal pan (bars).
    const deltaX = event.clientX - this.dragStartX;
    const barWidth = this.getBarWidth();
    const deltaBars = -deltaX / barWidth;
    const currentVisibleStart = this.viewState.getVisibleBarRange().startIndex;
    const targetVisibleStart = this.dragStartVisibleStart + Math.round(deltaBars);
    this.viewState.pan(targetVisibleStart - currentVisibleStart);

    // Vertical pan (price ladder). Dragging down (deltaY > 0) reveals higher
    // prices, i.e. scrolls the ladder DOWN => smaller offset. A diagonal drag
    // therefore pans both axes at once.
    const deltaY = event.clientY - this.dragStartY;
    const targetOffset = this.dragStartVerticalOffset - deltaY;
    this.viewState.panVertical(targetOffset - this.viewState.getVerticalOffset());

    this.callbacks.onViewChanged();
  }

  private handleWheel(event: WheelEvent): void {
    event.preventDefault();
    // Two-finger horizontal swipe (deltaX dominant, no pinch): pan through time,
    // mirroring the Overview. Accumulate sub-bar deltas so fine scrolling pans.
    if (!event.ctrlKey && Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
      if (!Number.isFinite(this.wheelPanAccumulator)) this.wheelPanAccumulator = 0;
      this.wheelPanAccumulator += event.deltaX / this.getBarWidth();
      const wholeBars = Math.trunc(this.wheelPanAccumulator);
      if (wholeBars !== 0) {
        this.wheelPanAccumulator -= wholeBars;
        this.viewState.pan(wholeBars);
        this.callbacks.onViewChanged();
      }
      return;
    }
    // Vertical scroll: pan the price ladder. Wheel down (deltaY > 0) scrolls the
    // ladder up => reveals lower prices.
    this.viewState.panVertical(event.deltaY);
    this.callbacks.onViewChanged();
  }

  private handleDblClick(event: MouseEvent): void {
    event.preventDefault();
    this.viewState.resetVertical();
    this.callbacks.onViewChanged();
  }

  private handleDragEnd(_event: MouseEvent): void {
    this.isDragging = false;
    this.canvas.style.cursor = 'grab';
    window.removeEventListener('mousemove', this.boundHandleDragMove);
    window.removeEventListener('mouseup', this.boundHandleDragEnd);
  }
}