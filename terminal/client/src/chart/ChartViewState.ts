/**
 * Visible bar range and auto-follow state.
 *
 * This module is pure (no DOM dependencies) and fully unit-testable.
 * All mutations enforce bounds and maintain invariants.
 */
export interface ViewStateSnapshot {
  /** Index of first visible bar (0-based, clamped to [0, max(0, totalBars - visibleCount)]) */
  visibleStart: number;
  /** Number of visible bars (clamped to [MIN_VISIBLE_BARS, MAX_VISIBLE_BARS]) */
  visibleCount: number;
  /** Auto-follow mode: if true, arriving bars advance visibleStart to keep tail visible */
  followLatest: boolean;
}

export const MIN_VISIBLE_BARS = 20;
export const MAX_VISIBLE_BARS = 500;
export const DEFAULT_VISIBLE_BARS = 100;

export class ChartViewState {
  private visibleStart: number;
  private visibleCount: number;
  private followLatest: boolean;
  private totalBars: number;

  /**
   * Construct with initial state.
   *
   * @param totalBars - Current total bar count in buffer
   * @param visibleCount - Initial visible bar count (default 100, clamped to [MIN, MAX])
   */
  constructor(totalBars: number, visibleCount: number = DEFAULT_VISIBLE_BARS) {
    this.totalBars = Math.max(0, totalBars);
    this.visibleCount = this.clampVisibleCount(visibleCount);
    this.visibleStart = Math.max(0, this.totalBars - this.visibleCount);
    this.followLatest = true;
  }

  /**
   * Pan the visible window by a bar-count delta.
   *
   * Positive delta → pan right (forward in time, newer bars)
   * Negative delta → pan left (backward in time, older bars)
   *
   * Panning away from the tail (when at tail) pauses auto-follow.
   * Panning to the tail re-enables auto-follow.
   *
   * @param deltaBars - Bar count to pan (can be fractional, will be rounded)
   */
  public pan(deltaBars: number): void {
    const wasAtTail = this.isAtTail();

    // Update visibleStart with clamping
    const newVisibleStart = this.visibleStart + Math.round(deltaBars);
    this.visibleStart = this.clampVisibleStart(newVisibleStart);

    const nowAtTail = this.isAtTail();

    // Update followLatest based on pan direction and tail position
    if (wasAtTail && !nowAtTail) {
      // Panned away from tail (left pan when at tail)
      this.followLatest = false;
    } else if (!wasAtTail && nowAtTail) {
      // Panned to tail (right pan reaching tail)
      this.followLatest = true;
    }
  }

  /**
   * Zoom by adjusting visible bar count, anchored at a specific bar index.
   *
   * The anchor bar remains at the same screen position (same fraction of visible range).
   * If the anchor would move outside the visible range after zoom, clamp it to edges.
   *
   * @param zoomFactor - Multiplicative factor (>1 = zoom out / more bars, <1 = zoom in / fewer bars)
   * @param anchorBarIndex - Bar index to keep fixed (typically the bar under cursor)
   */
  public zoom(zoomFactor: number, anchorBarIndex: number): void {
    // Calculate anchor position as fraction of current visible range
    const anchorFraction = this.visibleCount > 0
      ? (anchorBarIndex - this.visibleStart) / this.visibleCount
      : 0.5;

    // Apply zoom to visible count
    const newVisibleCount = this.visibleCount * zoomFactor;
    this.visibleCount = this.clampVisibleCount(newVisibleCount);

    // Recompute visibleStart to preserve anchor position
    const newVisibleStart = anchorBarIndex - (anchorFraction * this.visibleCount);
    this.visibleStart = this.clampVisibleStart(newVisibleStart);
  }

  /**
   * Notify view-state of a new bar arriving.
   *
   * If followLatest=true and the window is at the tail, advance visibleStart
   * to keep the newest bar visible.
   *
   * @param newTotalBars - New total bar count (after bar appended)
   */
  public onNewBar(newTotalBars: number): void {
    const wasAtTail = this.isAtTail();
    this.totalBars = Math.max(0, newTotalBars);

    if (this.followLatest && wasAtTail) {
      // Advance window to keep tail visible
      this.visibleStart = Math.max(0, this.totalBars - this.visibleCount);
    } else {
      // Clamp visibleStart in case totalBars changed
      this.visibleStart = this.clampVisibleStart(this.visibleStart);
    }
  }

  /**
   * Reset to latest bars and re-enable auto-follow.
   *
   * Sets visibleStart = max(0, totalBars - visibleCount), followLatest = true.
   */
  public resetToLatest(): void {
    this.visibleStart = Math.max(0, this.totalBars - this.visibleCount);
    this.followLatest = true;
  }

  /**
   * Update total bar count (e.g., when buffer shrinks or grows).
   *
   * Clamps visibleStart to valid range. Does NOT change followLatest.
   *
   * @param newTotalBars - New total bar count
   */
  public setTotalBars(newTotalBars: number): void {
    this.totalBars = Math.max(0, newTotalBars);
    this.visibleStart = this.clampVisibleStart(this.visibleStart);
  }

  /**
   * Get current state snapshot (read-only).
   */
  public getState(): Readonly<ViewStateSnapshot> {
    return {
      visibleStart: this.visibleStart,
      visibleCount: this.visibleCount,
      followLatest: this.followLatest,
    };
  }

  /**
   * Check if currently at tail (last bar visible).
   *
   * Returns true if visibleStart + visibleCount >= totalBars.
   */
  public isAtTail(): boolean {
    return this.visibleStart + this.visibleCount >= this.totalBars;
  }

  /**
   * Clamp visibleCount to [MIN_VISIBLE_BARS, MAX_VISIBLE_BARS].
   */
  private clampVisibleCount(count: number): number {
    return Math.max(MIN_VISIBLE_BARS, Math.min(MAX_VISIBLE_BARS, Math.round(count)));
  }

  /**
   * Clamp visibleStart to [0, max(0, totalBars - visibleCount)].
   */
  private clampVisibleStart(start: number): number {
    const maxStart = Math.max(0, this.totalBars - this.visibleCount);
    return Math.max(0, Math.min(maxStart, Math.round(start)));
  }
}
