export interface BarRange {
  startIndex: number;
  count: number;
}

export const MIN_VISIBLE_BARS = 20;
export const MAX_VISIBLE_BARS = 500;
export const DEFAULT_VISIBLE_BARS = 100;

/** Footprint cell height in px (mirrors FootprintView.CELL_HEIGHT). */
export const CELL_HEIGHT_PX = 20;
/** Minimum number of price rows kept visible at the vertical scroll extremes. */
export const MIN_VISIBLE_ROWS = 3;
/** How many extra viewport-heights of EMPTY gridded space you can scroll past the
 *  traded range in each direction (TradingView-style near-infinite scroll). */
export const EXTRA_SCROLL_SCREENS = 5;

export class FootprintViewState {
  private visibleStart: number;
  private visibleCount: number;
  private followLatest: boolean;
  private totalBars: number;

  // Vertical scroll (price-ladder pan). verticalOffset is in px: positive scrolls
  // the ladder UP (reveals lower prices). autoCenter true => the renderer centers
  // the ladder and ignores verticalOffset; the first manual pan flips it false.
  private verticalOffset = 0;
  private verticalAutoCenter = true;
  private contentHeightPx = 0;
  private viewportHeightPx = 0;

  constructor(totalBars: number, visibleCount: number = DEFAULT_VISIBLE_BARS) {
    this.totalBars = Math.max(0, totalBars);
    this.visibleCount = this.clampVisibleCount(visibleCount);
    this.visibleStart = Math.max(0, this.totalBars - this.visibleCount);
    this.followLatest = true;
  }

  public setTotalBars(newTotalBars: number): void {
    this.totalBars = Math.max(0, newTotalBars);
    this.visibleStart = this.clampVisibleStart(this.visibleStart);
  }

  public pan(deltaBars: number): void {
    const wasAtLatest = this.isAtLatest();

    const newVisibleStart = this.visibleStart + Math.round(deltaBars);
    this.visibleStart = this.clampVisibleStart(newVisibleStart);

    const nowAtLatest = this.isAtLatest();

    if (wasAtLatest && !nowAtLatest) {
      this.followLatest = false;
    } else if (!wasAtLatest && nowAtLatest) {
      this.followLatest = true;
    }
  }

  public getVisibleBarRange(): BarRange {
    return {
      startIndex: this.visibleStart,
      count: this.visibleCount,
    };
  }

  public isAtLatest(): boolean {
    return this.visibleStart + this.visibleCount >= this.totalBars;
  }

  /** Set the zoom level (visible bar count), clamped; re-clamps visibleStart. */
  public setVisibleCount(count: number): void {
    this.visibleCount = this.clampVisibleCount(count);
    this.visibleStart = this.clampVisibleStart(this.visibleStart);
  }

  public goToLatest(): void {
    this.visibleStart = Math.max(0, this.totalBars - this.visibleCount);
    this.followLatest = true;
  }

  public getRightEdgeBarIndex(): number {
    if (this.totalBars === 0) {
      return -1;
    }
    return Math.min(this.visibleStart + this.visibleCount - 1, this.totalBars - 1);
  }

  public setRightEdgeBarIndex(index: number): void {
    if (this.totalBars === 0) {
      return;
    }
    const clampedIndex = Math.max(0, Math.min(Math.round(index), this.totalBars - 1));
    this.visibleStart = this.clampVisibleStart(clampedIndex - this.visibleCount + 1);
    this.followLatest = this.isAtLatest();
  }

  public getFollowLatest(): boolean {
    return this.followLatest;
  }

  public setFollowLatest(follow: boolean): void {
    this.followLatest = follow;
  }

  private clampVisibleCount(count: number): number {
    if (!Number.isFinite(count)) count = DEFAULT_VISIBLE_BARS;
    const dataCap = this.totalBars > 0
      ? Math.max(MIN_VISIBLE_BARS, this.totalBars)
      : MAX_VISIBLE_BARS;
    const effectiveMax = Math.min(MAX_VISIBLE_BARS, dataCap);
    return Math.max(MIN_VISIBLE_BARS, Math.min(effectiveMax, Math.round(count)));
  }

  private clampVisibleStart(start: number): number {
    if (!Number.isFinite(start)) {
      return Number.isFinite(this.visibleStart) ? this.visibleStart : 0;
    }
    const maxStart = Math.max(0, this.totalBars - this.visibleCount);
    return Math.max(0, Math.min(maxStart, Math.round(start)));
  }

  // ---- Vertical scroll (price-ladder pan) --------------------------------

  /** Store the current content (full ladder) + viewport heights so the offset
   *  can be clamped. Re-clamps the existing offset against the new bounds. */
  public setVerticalContentBounds(contentHeightPx: number, viewportHeightPx: number): void {
    this.contentHeightPx = Math.max(0, contentHeightPx);
    this.viewportHeightPx = Math.max(0, viewportHeightPx);
    this.verticalOffset = this.clampVerticalOffset(this.verticalOffset);
  }

  /** Pan the ladder by a pixel delta; disables auto-center and clamps. */
  public panVertical(deltaPx: number): void {
    this.verticalAutoCenter = false;
    this.verticalOffset = this.clampVerticalOffset(this.verticalOffset + deltaPx);
  }

  /** Keep the offset in sync with the renderer's computed centering offset WHILE
   *  staying in auto-center mode, so the first manual pan starts from the current
   *  on-screen position instead of jumping. */
  public syncVerticalOffset(offsetPx: number): void {
    this.verticalOffset = this.clampVerticalOffset(offsetPx);
  }

  /** Set an absolute offset (used on restore); disables auto-center and clamps. */
  public setVerticalOffset(offsetPx: number): void {
    this.verticalAutoCenter = false;
    this.verticalOffset = this.clampVerticalOffset(offsetPx);
  }

  /** Return to auto-centered mode. */
  public resetVertical(): void {
    this.verticalOffset = 0;
    this.verticalAutoCenter = true;
  }

  public setVerticalAutoCenter(autoCenter: boolean): void {
    this.verticalAutoCenter = autoCenter;
  }

  public getVerticalOffset(): number {
    return this.verticalOffset;
  }

  public getVerticalAutoCenter(): boolean {
    return this.verticalAutoCenter;
  }

  /** Clamp a vertical offset. offset=0 means the top of the traded ladder sits at
   *  the header; positive scrolls the ladder UP (reveals lower prices). Scrolling
   *  is allowed far past the traded range into empty gridded space
   *  (EXTRA_SCROLL_SCREENS viewports each way). Degenerate bounds collapse to 0. */
  private clampVerticalOffset(offsetPx: number): number {
    if (!Number.isFinite(offsetPx)) return 0;
    if (this.contentHeightPx <= 0 || this.viewportHeightPx <= 0) return 0;
    const extra = EXTRA_SCROLL_SCREENS * this.viewportHeightPx;
    const maxOffset = this.contentHeightPx + extra;
    const minOffset = -(this.viewportHeightPx + extra);
    return Math.max(minOffset, Math.min(maxOffset, offsetPx));
  }
}