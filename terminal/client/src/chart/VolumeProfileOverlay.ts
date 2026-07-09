import type { CoordinateTransform, BarRange } from './CoordinateTransform';
import type { BarPayload, FootprintPayload } from '../types';

interface VolumeProfileLevel {
  price: number;
  buy: number;
  sell: number;
  total: number;
}

interface AggregationResult {
  levels: VolumeProfileLevel[];
  maxTotal: number;
  pocPrice: number | null;
}

export class VolumeProfileOverlay {
  private overlayCanvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private transform: CoordinateTransform;
  private currentDPR: number;

  private footprints: Map<number, FootprintPayload> = new Map();

  private canvasWidth = 0;
  private canvasHeight = 0;

  // Cached aggregation result for efficient crosshair lookup
  private cachedLevels: Map<number, { buy: number; sell: number; total: number }> | null = null;

  private static readonly COLOR_BUY = '#26a69a';
  private static readonly COLOR_SELL = '#ef5350';
  private static readonly COLOR_POC = '#ff9800';
  private static readonly BAR_HEIGHT_PX = 6;
  private static readonly MAX_BAR_WIDTH_RATIO = 0.6;

  constructor(container: HTMLElement, transform: CoordinateTransform) {
    this.transform = transform;
    this.currentDPR = window.devicePixelRatio || 1;

    this.overlayCanvas = document.createElement('canvas');
    this.overlayCanvas.style.position = 'absolute';
    this.overlayCanvas.style.top = '0';
    this.overlayCanvas.style.left = '0';
    this.overlayCanvas.style.pointerEvents = 'none';

    const ctx = this.overlayCanvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to get 2D context for overlay canvas');
    }
    this.ctx = ctx;

    container.appendChild(this.overlayCanvas);
  }

  public updateFootprintData(data: Map<number, FootprintPayload>): void {
    this.footprints = data;
    this.cachedLevels = null;
  }

  public addFootprint(payload: FootprintPayload): void {
    this.footprints.set(payload.ts_event, payload);
    this.cachedLevels = null;
  }

  public clearFootprints(): void {
    this.footprints.clear();
    this.cachedLevels = null;
  }

  public getFootprintCount(): number {
    return this.footprints.size;
  }

  public updateDimensions(width: number, height: number): void {
    this.canvasWidth = width;
    this.canvasHeight = height;
    this.currentDPR = window.devicePixelRatio || 1;

    this.overlayCanvas.width = width * this.currentDPR;
    this.overlayCanvas.height = height * this.currentDPR;

    this.overlayCanvas.style.width = `${width}px`;
    this.overlayCanvas.style.height = `${height}px`;

    this.ctx.setTransform(this.currentDPR, 0, 0, this.currentDPR, 0, 0);
  }

  public destroy(): void {
    if (this.overlayCanvas.parentNode) {
      this.overlayCanvas.parentNode.removeChild(this.overlayCanvas);
    }
  }

  public render(bars: BarPayload[], visibleBarRange: BarRange): void {
    this.ctx.clearRect(0, 0, this.canvasWidth, this.canvasHeight);

    const result = this.aggregate(bars, visibleBarRange);
    if (!result) return;

    const chartRightEdge = this.transform.getChartWidth();
    const marginsRight = this.canvasWidth - chartRightEdge;
    const maxBarLength = marginsRight * VolumeProfileOverlay.MAX_BAR_WIDTH_RATIO;

    for (const level of result.levels) {
      const y = this.transform.priceToY(level.price);

      const totalWidth = (level.total / result.maxTotal) * maxBarLength;
      const barHeight = VolumeProfileOverlay.BAR_HEIGHT_PX;

      if (level.buy > 0) {
        const buyWidth = (level.buy / level.total) * totalWidth;
        this.ctx.fillStyle = VolumeProfileOverlay.COLOR_BUY;
        this.ctx.fillRect(chartRightEdge - buyWidth, y - barHeight / 2, buyWidth, barHeight);
      }

      if (level.sell > 0) {
        const sellWidth = (level.sell / level.total) * totalWidth;
        this.ctx.fillStyle = VolumeProfileOverlay.COLOR_SELL;
        this.ctx.fillRect(chartRightEdge, y - barHeight / 2, sellWidth, barHeight);
      }

      if (level.price === result.pocPrice) {
        this.ctx.fillStyle = VolumeProfileOverlay.COLOR_POC;
        this.ctx.beginPath();
        this.ctx.arc(chartRightEdge, y, 3, 0, Math.PI * 2);
        this.ctx.fill();
      }
    }
  }

  public getVolumeAtPrice(
    price: number,
    bars: BarPayload[],
    visibleBarRange: BarRange
  ): { buy: number; sell: number; total: number } | null {
    // Use cached levels if available, otherwise compute
    if (!this.cachedLevels) {
      const result = this.aggregate(bars, visibleBarRange);
      if (!result) return null;
      this.cachedLevels = new Map();
      for (const level of result.levels) {
        this.cachedLevels.set(level.price, { buy: level.buy, sell: level.sell, total: level.total });
      }
    }
    return this.cachedLevels.get(price) ?? null;
  }

  public aggregate(bars: BarPayload[], visibleBarRange: BarRange): AggregationResult | null {
    const levelMap = new Map<number, { buy: number; sell: number }>();

    for (let i = visibleBarRange.start; i <= visibleBarRange.end; i++) {
      const bar = bars[i];
      if (!bar) continue;

      const fp = this.footprints.get(bar.ts_event);
      if (!fp) continue;

      for (const level of fp.levels) {
        const existing = levelMap.get(level.price) || { buy: 0, sell: 0 };
        existing.buy += level.buy;
        existing.sell += level.sell;
        levelMap.set(level.price, existing);
      }
    }

    if (levelMap.size === 0) return null;

    const levels: VolumeProfileLevel[] = [];
    let maxTotal = 0;
    let pocPrice: number | null = null;
    let maxTotalSoFar = 0;

    for (const [price, { buy, sell }] of levelMap) {
      const total = buy + sell;
      if (total > maxTotalSoFar) {
        maxTotalSoFar = total;
        pocPrice = price;
      }
      if (total > maxTotal) maxTotal = total;
      levels.push({ price, buy, sell, total });
    }

    levels.sort((a, b) => a.price - b.price);

    return { levels, maxTotal, pocPrice };
  }
}