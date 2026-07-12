export interface BarRange {
  startIndex: number;
  count: number;
}

export const MIN_VISIBLE_BARS = 20;
export const MAX_VISIBLE_BARS = 500;
export const DEFAULT_VISIBLE_BARS = 100;

export class FootprintViewState {
  private visibleStart: number;
  private visibleCount: number;
  private followLatest: boolean;
  private totalBars: number;

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
    const dataCap = this.totalBars > 0
      ? Math.max(MIN_VISIBLE_BARS, this.totalBars)
      : MAX_VISIBLE_BARS;
    const effectiveMax = Math.min(MAX_VISIBLE_BARS, dataCap);
    return Math.max(MIN_VISIBLE_BARS, Math.min(effectiveMax, Math.round(count)));
  }

  private clampVisibleStart(start: number): number {
    const maxStart = Math.max(0, this.totalBars - this.visibleCount);
    return Math.max(0, Math.min(maxStart, Math.round(start)));
  }
}