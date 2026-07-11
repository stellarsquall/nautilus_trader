import type { ChartStoreState, FootprintPayload } from '../types.js';
import { ChartView, ViewType } from './ChartView.js';
import { CanvasCandlestickRenderer } from '../renderers/CanvasCandlestickRenderer.js';
import { LegendPanel, type LegendEntry, type LegendPanelConfig } from '../ui/LegendPanel.js';

export class OverviewView implements ChartView {
  private renderer: CanvasCandlestickRenderer | null = null;
  private _legendPanel: LegendPanel | null = null;

  mount(container: HTMLElement): void {
    this.renderer = new CanvasCandlestickRenderer(container);
    const config: LegendPanelConfig = { entries: this.getLegendEntries(), defaultVisible: false };
    this._legendPanel = new LegendPanel(container, config);
  }

  seed(state: ChartStoreState): void {
    if (!this.renderer) return;

    for (const bar of state.bars) {
      this.renderer.update(bar);
    }

    for (const [, cvd] of state.cvd) {
      this.renderer.updateCvd(cvd);
    }

    for (const [, footprint] of state.footprints) {
      this.renderer.updateFootprint(footprint);
    }
  }

  updateBar(data: unknown): void {
    this.renderer?.update(data);
  }

  updateCvd(data: unknown): void {
    this.renderer?.updateCvd(data);
  }

  updateFootprint(data: FootprintPayload): void {
    this.renderer?.updateFootprint(data);
  }

  destroy(): void {
    if (this._legendPanel) {
      this._legendPanel.destroy();
      this._legendPanel = null;
    }
    if (this.renderer) {
      this.renderer.destroy();
      this.renderer = null;
    }
  }

  getType(): ViewType {
    return ViewType.Overview;
  }

  // Colors mirror the actual Overview renderers: delta candles + volume bars
  // (#26a69a/#ef5350), CVD line (CVDPane #3f51b5), Volume Profile buy/sell +
  // POC (VolumeProfileOverlay #26a69a/#ef5350; POC is a filled orange dot #ff9800).
  getLegendEntries(): LegendEntry[] {
    return [
      { label: 'Delta Up', color: '#26a69a', kind: 'fill' },
      { label: 'Delta Down', color: '#ef5350', kind: 'fill' },
      { label: 'CVD Line', color: '#3f51b5', kind: 'line' },
      { label: 'Volume Up', color: '#26a69a', kind: 'fill' },
      { label: 'Volume Down', color: '#ef5350', kind: 'fill' },
      { label: 'VP Buy', color: '#26a69a', kind: 'fill' },
      { label: 'VP Sell', color: '#ef5350', kind: 'fill' },
      { label: 'POC', color: '#ff9800', kind: 'dot' },
      { label: 'Value Area (VAH/VAL)', color: '#787b86', kind: 'valueArea' },
    ];
  }
}