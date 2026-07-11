import type { ChartStoreState, FootprintPayload, FootprintLevel, BarPayload } from '../types.js';
import { ChartView, ViewType } from './ChartView.js';
import { FootprintViewState, type BarRange } from './FootprintViewState.js';
import { FootprintInteractionController } from './FootprintInteractionController.js';
import { formatTime } from '../chart/CoordinateTransform.js';
import { calculateDiagonalImbalances, calculateStackedImbalances } from './footprintImbalance.js';
import type { DiagonalImbalanceResult, StackedImbalanceRun } from './footprintImbalance.js';
import { LegendPanel, type LegendEntry, type LegendPanelConfig } from '../ui/LegendPanel.js';

export interface PocResult {
  pocPrice: number | null;
  maxTotal: number;
}

export class FootprintView implements ChartView {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private container: HTMLElement | null = null;
  private _viewState: FootprintViewState;
  private bars: BarPayload[] = [];
  private footprints: Map<number, FootprintPayload> = new Map();
  private resizeObserver: ResizeObserver | null = null;
  private interactionController: FootprintInteractionController | null = null;
  private currentDPR = 1;
  private _imbalanceMarkersVisible = true;
  private _imbalanceToggleButton: HTMLButtonElement | null = null;
  private _legendPanel: LegendPanel | null = null;

  static readonly COLOR_POC = '#ff9800';
  static readonly COLOR_POC_BG = 'rgba(255, 152, 0, 0.12)';
  static readonly COLOR_BUY = '#26a69a';
  static readonly COLOR_SELL = '#ef5350';
  static readonly COLOR_DELTA_BUY_BG = 'rgba(38, 166, 154, 0.15)';
  static readonly COLOR_DELTA_SELL_BG = 'rgba(239, 83, 80, 0.15)';
  static readonly COLOR_CELL_BG = '#fafafa';
  static readonly COLOR_CELL_BORDER = '#e0e0e0';
  static readonly COLOR_TEXT = '#333333';
  static readonly COLOR_NO_DATA = '#eeeeee';

  static readonly IMBALANCE_MARKER_WIDTH = 4;
  static readonly STACKED_BRACKET_WIDTH = 6;

  static readonly CELL_HEIGHT = 20;
  static readonly CELL_PADDING = 4;
  static readonly MIN_COLUMN_WIDTH = 60;
  static readonly POC_OUTLINE_WIDTH = 2;

  constructor() {
    this._viewState = new FootprintViewState(0);
  }

  get viewState(): FootprintViewState {
    return this._viewState;
  }

  calculatePOC(levels: FootprintLevel[]): PocResult {
    if (levels.length === 0) {
      return { pocPrice: null, maxTotal: 0 };
    }

    let pocPrice: number | null = levels[0].price;
    let maxTotal = levels[0].buy + levels[0].sell;

    for (let i = 1; i < levels.length; i++) {
      const total = levels[i].buy + levels[i].sell;
      if (total > maxTotal) {
        maxTotal = total;
        pocPrice = levels[i].price;
      }
    }

    return { pocPrice, maxTotal };
  }

  calculatePOCForBar(barTsEvent: number): PocResult {
    const fp = this.footprints.get(barTsEvent);
    if (!fp || fp.levels.length === 0) {
      return { pocPrice: null, maxTotal: 0 };
    }
    return this.calculatePOC(fp.levels);
  }

  mount(container: HTMLElement): void {
    this.container = container;

    const canvas = document.createElement('canvas');
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    container.appendChild(canvas);

    const ctx = canvas.getContext('2d');
    this.canvas = canvas;
    this.ctx = ctx;

    this.currentDPR = window.devicePixelRatio || 1;
    this.resizeCanvas();

    this.resizeObserver = new ResizeObserver(() => {
      this.resizeCanvas();
      this.draw();
    });
    this.resizeObserver.observe(container);

    this.interactionController = new FootprintInteractionController(canvas, this._viewState, {
      onViewChanged: () => this.draw(),
    });

    this.createImbalanceToggleButton();
    this.mountLegendPanel();
  }

  private createImbalanceToggleButton(): void {
    if (!this.container) return;

    const button = document.createElement('button');
    button.textContent = 'Imbalance: ON';
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

    button.addEventListener('click', () => {
      this._imbalanceMarkersVisible = !this._imbalanceMarkersVisible;
      button.textContent = this._imbalanceMarkersVisible ? 'Imbalance: ON' : 'Imbalance: OFF';
      this.draw();
    });

    if (getComputedStyle(this.container).position === 'static') {
      this.container.style.position = 'relative';
    }
    this.container.appendChild(button);
    this._imbalanceToggleButton = button;
  }

  seed(state: ChartStoreState): void {
    this.bars = [...state.bars];

    for (const [, footprint] of state.footprints) {
      this.footprints.set(footprint.ts_event, footprint);
    }

    this._viewState.setTotalBars(this.bars.length);
    this._viewState.goToLatest();
    this.draw();
  }

  updateBar(data: unknown): void {
    const bar = data as BarPayload;
    if (!bar || typeof bar.ts_event !== 'number') return;

    if (this.bars.length === 0) {
      this.bars.push(bar);
    } else {
      const lastBar = this.bars[this.bars.length - 1];
      if (bar.ts_event === lastBar.ts_event) {
        this.bars[this.bars.length - 1] = bar;
      } else if (bar.ts_event > lastBar.ts_event) {
        this.bars.push(bar);
      } else {
        return;
      }
    }

    this._viewState.setTotalBars(this.bars.length);
    this.draw();
  }

  updateCvd(_data: unknown): void {
    // CVD not rendered in footprint view
  }

  updateFootprint(data: FootprintPayload): void {
    this.footprints.set(data.ts_event, data);
    this.draw();
  }

  destroy(): void {
    if (this._legendPanel) {
      this._legendPanel.destroy();
      this._legendPanel = null;
    }
    if (this._imbalanceToggleButton) {
      if (this._imbalanceToggleButton.parentNode) {
        this._imbalanceToggleButton.parentNode.removeChild(this._imbalanceToggleButton);
      }
      this._imbalanceToggleButton = null;
    }
    if (this.interactionController) {
      this.interactionController.destroy();
      this.interactionController = null;
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    if (this.canvas && this.canvas.parentNode) {
      this.canvas.parentNode.removeChild(this.canvas);
    }
    this.canvas = null;
    this.ctx = null;
    this.container = null;
    this.bars = [];
    this.footprints.clear();
  }

  getType(): ViewType {
    return ViewType.Footprint;
  }

  getLegendEntries(): LegendEntry[] {
    return [
      { label: 'Buy Dominant', color: FootprintView.COLOR_BUY, kind: 'fill' },
      { label: 'Sell Dominant', color: FootprintView.COLOR_SELL, kind: 'fill' },
      { label: 'POC', color: FootprintView.COLOR_POC, kind: 'outline' },
      { label: 'Buy Imbalance', color: FootprintView.COLOR_BUY, kind: 'rightStrip' },
      { label: 'Sell Imbalance', color: FootprintView.COLOR_SELL, kind: 'leftStrip' },
      { label: 'Stacked Run', color: FootprintView.COLOR_BUY, kind: 'bracket' },
    ];
  }

  private mountLegendPanel(): void {
    if (!this.container) return;
    const config: LegendPanelConfig = { entries: this.getLegendEntries(), defaultVisible: false };
    this._legendPanel = new LegendPanel(this.container, config);
  }

  setImbalanceMarkersVisible(visible: boolean): void {
    this._imbalanceMarkersVisible = visible;
    if (this._imbalanceToggleButton) {
      this._imbalanceToggleButton.textContent = visible ? 'Imbalance: ON' : 'Imbalance: OFF';
    }
    this.draw();
  }

  get imbalanceMarkersVisible(): boolean {
    return this._imbalanceMarkersVisible;
  }

  private resizeCanvas(): void {
    if (!this.canvas || !this.container) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = this.container.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    if (width <= 0 || height <= 0) return;

    this.currentDPR = dpr;
    this.canvas.width = width * dpr;
    this.canvas.height = height * dpr;
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
  }

  private draw(): void {
    if (!this.ctx || !this.canvas) return;

    const ctx = this.ctx;
    const dpr = this.currentDPR;
    const width = this.canvas.width / dpr;
    const height = this.canvas.height / dpr;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const range = this._viewState.getVisibleBarRange();
    const visibleBars = this.getVisibleBars(range);

    if (visibleBars.length === 0) return;

    this.drawFootprintGrid(ctx, width, height, visibleBars);
  }

  private getVisibleBars(range: BarRange): BarPayload[] {
    const result: BarPayload[] = [];
    for (let i = range.startIndex; i < range.startIndex + range.count && i < this.bars.length; i++) {
      if (i >= 0 && i < this.bars.length) {
        result.push(this.bars[i]);
      }
    }
    return result;
  }

  private drawFootprintGrid(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    visibleBars: BarPayload[]
  ): void {
    const columnCount = visibleBars.length;
    if (columnCount === 0) return;

    const columnWidth = Math.max(FootprintView.MIN_COLUMN_WIDTH, width / columnCount);

    // Collect all price levels across visible bars
    const allPrices = new Set<number>();
    const barLevels: Map<number, { price: number; buy: number; sell: number }>[] = [];

    for (const bar of visibleBars) {
      const fp = this.footprints.get(bar.ts_event);
      if (!fp) {
        barLevels.push(new Map());
        continue;
      }

      const levelMap = new Map<number, { price: number; buy: number; sell: number }>();
      for (const level of fp.levels) {
        levelMap.set(level.price, level);
        allPrices.add(level.price);
      }
      barLevels.push(levelMap);
    }

    if (allPrices.size === 0) {
      this.drawEmptyState(ctx, width, height);
      return;
    }

    const prices = Array.from(allPrices).sort((a, b) => b - a);
    const cellHeight = FootprintView.CELL_HEIGHT;
    const pocOutlineWidth = FootprintView.POC_OUTLINE_WIDTH;

    // Price-to-row mapping for bracket drawing
    const priceToRow = new Map<number, number>();
    for (let r = 0; r < prices.length; r++) {
      priceToRow.set(prices[r], r);
    }

    // Pre-compute imbalance data per visible bar (at most once per bar per draw pass)
    const barImbalances: Map<number, Map<number, DiagonalImbalanceResult>> = new Map();
    const barStackedRuns: Map<number, StackedImbalanceRun[]> = new Map();
    if (this._imbalanceMarkersVisible) {
      for (const bar of visibleBars) {
        const fp = this.footprints.get(bar.ts_event);
        if (!fp || fp.levels.length === 0) continue;
        const diagResults = calculateDiagonalImbalances(fp.levels, fp.bin_size);
        const priceToDiag = new Map<number, DiagonalImbalanceResult>();
        for (const d of diagResults) {
          priceToDiag.set(d.price, d);
        }
        barImbalances.set(bar.ts_event, priceToDiag);
        const stacked = calculateStackedImbalances(diagResults, fp.bin_size);
        if (stacked.length > 0) {
          barStackedRuns.set(bar.ts_event, stacked);
        }
      }
    }

    // Calculate font size based on column width
    const fontSize = Math.max(9, Math.min(12, columnWidth / 6));
    ctx.font = `${fontSize}px monospace`;
    ctx.textBaseline = 'middle';

    // Draw grid header
    const headerHeight = 24;
    ctx.fillStyle = '#f5f5f5';
    ctx.fillRect(0, 0, width, headerHeight);
    ctx.strokeStyle = '#e0e0e0';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, headerHeight);
    ctx.lineTo(width, headerHeight);
    ctx.stroke();

    ctx.fillStyle = '#666666';
    ctx.textAlign = 'center';
    ctx.font = '11px sans-serif';
    for (let c = 0; c < columnCount; c++) {
      const x = c * columnWidth + columnWidth / 2;
      // Per-column time label from the bar's ts_event (updates as you pan),
      // reusing the shared formatTime helper ("HH:MM", UTC) that the overview
      // time axis and crosshair use for consistency.
      ctx.fillText(formatTime(visibleBars[c].ts_event), x, headerHeight / 2 + 1);
    }

    for (let r = 0; r < prices.length; r++) {
      const price = prices[r];
      const y = headerHeight + r * cellHeight;

      // Background for alternating rows
      ctx.fillStyle = r % 2 === 0 ? '#ffffff' : FootprintView.COLOR_CELL_BG;
      ctx.fillRect(0, y, width, cellHeight);

      // Horizontal grid line
      ctx.strokeStyle = FootprintView.COLOR_CELL_BORDER;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, y + cellHeight);
      ctx.lineTo(width, y + cellHeight);
      ctx.stroke();

      // Price label (left side)
      ctx.fillStyle = '#999999';
      ctx.textAlign = 'right';
      ctx.font = '10px sans-serif';
      ctx.fillText(price.toFixed(5), 8, y + cellHeight / 2);

      for (let c = 0; c < columnCount; c++) {
        const level = barLevels[c].get(price);
        const cellX = c * columnWidth;

        // Draw vertical separator
        if (c > 0) {
          ctx.strokeStyle = '#e8e8e8';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(cellX, y);
          ctx.lineTo(cellX, y + cellHeight);
          ctx.stroke();
        }

        if (!level) continue;

        // Check if this level is POC for this bar
        const bar = visibleBars[c];
        const pocResult = this.calculatePOCForBar(bar.ts_event);
        const isPOC = pocResult.pocPrice !== null && Math.abs(level.price - pocResult.pocPrice) < 1e-10;

        // Draw delta-colored background
        const deltaBg = this.getDeltaBackground(level.buy, level.sell);
        if (deltaBg) {
          ctx.fillStyle = deltaBg;
          ctx.fillRect(cellX, y, columnWidth, cellHeight);
        }

        // Draw POC highlight
        if (isPOC) {
          ctx.fillStyle = FootprintView.COLOR_POC_BG;
          ctx.fillRect(cellX + pocOutlineWidth, y + pocOutlineWidth, columnWidth - pocOutlineWidth * 2, cellHeight - pocOutlineWidth * 2);

          ctx.strokeStyle = FootprintView.COLOR_POC;
          ctx.lineWidth = pocOutlineWidth;
          ctx.strokeRect(cellX + 1, y + 1, columnWidth - 2, cellHeight - 2);
        }

        // Draw imbalance marker (edge strip)
        if (this._imbalanceMarkersVisible) {
          const diagMap = barImbalances.get(bar.ts_event);
          if (diagMap) {
            const diag = diagMap.get(level.price);
            if (diag && diag.side === 'buy') {
              ctx.fillStyle = FootprintView.COLOR_BUY;
              ctx.fillRect(cellX + columnWidth - FootprintView.IMBALANCE_MARKER_WIDTH, y, FootprintView.IMBALANCE_MARKER_WIDTH, cellHeight);
            } else if (diag && diag.side === 'sell') {
              ctx.fillStyle = FootprintView.COLOR_SELL;
              ctx.fillRect(cellX, y, FootprintView.IMBALANCE_MARKER_WIDTH, cellHeight);
            }
          }
        }

        // Draw volume numbers
        const numX = cellX + columnWidth / 2;
        ctx.textAlign = 'center';
        ctx.font = `bold ${fontSize}px monospace`;

        const volumeText = `${Math.round(level.sell)} | ${Math.round(level.buy)}`;

        if (isPOC) {
          ctx.fillStyle = FootprintView.COLOR_POC;
        } else {
          ctx.fillStyle = FootprintView.COLOR_TEXT;
        }
        ctx.fillText(volumeText, numX, y + cellHeight / 2);
      }
    }

    // Draw stacked brackets (spans multiple price levels)
    if (this._imbalanceMarkersVisible) {
      for (let c = 0; c < columnCount; c++) {
        const bar = visibleBars[c];
        const runs = barStackedRuns.get(bar.ts_event);
        if (!runs) continue;
        const cellX = c * columnWidth;
        for (const run of runs) {
          const fromRow = priceToRow.get(run.fromPrice);
          const toRow = priceToRow.get(run.toPrice);
          if (fromRow === undefined || toRow === undefined) continue;
          const topRow = Math.min(fromRow, toRow);
          const bottomRow = Math.max(fromRow, toRow);
          const runY = headerHeight + topRow * cellHeight;
          const runHeight = (bottomRow - topRow + 1) * cellHeight;
          const color = run.side === 'buy' ? FootprintView.COLOR_BUY : FootprintView.COLOR_SELL;
          ctx.fillStyle = color;
          if (run.side === 'buy') {
            ctx.fillRect(cellX + columnWidth - FootprintView.STACKED_BRACKET_WIDTH, runY, FootprintView.STACKED_BRACKET_WIDTH, runHeight);
          } else {
            ctx.fillRect(cellX, runY, FootprintView.STACKED_BRACKET_WIDTH, runHeight);
          }
        }
      }
    }
  }

  private drawEmptyState(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    ctx.fillStyle = FootprintView.COLOR_NO_DATA;
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = '#999999';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '14px sans-serif';
    ctx.fillText('No footprint data available', width / 2, height / 2);
  }

  private getDeltaBackground(buy: number, sell: number): string | null {
    if (buy > sell) return FootprintView.COLOR_DELTA_BUY_BG;
    if (sell > buy) return FootprintView.COLOR_DELTA_SELL_BG;
    return null;
  }
}
