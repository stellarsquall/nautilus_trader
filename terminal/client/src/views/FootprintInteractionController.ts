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

  private boundHandleMouseDown: (event: MouseEvent) => void;
  private boundHandleDragMove: (event: MouseEvent) => void;
  private boundHandleDragEnd: (event: MouseEvent) => void;

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

    this.canvas.addEventListener('mousedown', this.boundHandleMouseDown);
    this.canvas.style.cursor = 'grab';
  }

  destroy(): void {
    this.canvas.removeEventListener('mousedown', this.boundHandleMouseDown);
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
    this.canvas.style.cursor = 'grabbing';

    window.addEventListener('mousemove', this.boundHandleDragMove);
    window.addEventListener('mouseup', this.boundHandleDragEnd);
  }

  private handleDragMove(event: MouseEvent): void {
    if (!this.isDragging) return;

    const deltaX = event.clientX - this.dragStartX;
    const barWidth = this.getBarWidth();
    const deltaBars = -deltaX / barWidth;

    const currentVisibleStart = this.viewState.getVisibleBarRange().startIndex;
    const targetVisibleStart = this.dragStartVisibleStart + Math.round(deltaBars);
    this.viewState.pan(targetVisibleStart - currentVisibleStart);
    this.callbacks.onViewChanged();
  }

  private handleDragEnd(_event: MouseEvent): void {
    this.isDragging = false;
    this.canvas.style.cursor = 'grab';
    window.removeEventListener('mousemove', this.boundHandleDragMove);
    window.removeEventListener('mouseup', this.boundHandleDragEnd);
  }
}