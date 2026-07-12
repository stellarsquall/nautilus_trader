import type { ChartStoreState, FootprintPayload } from '../types.js';
import { ChartView, type ViewportState, ViewType } from './ChartView.js';
import { CanvasCandlestickRenderer } from '../renderers/CanvasCandlestickRenderer.js';
import { LegendPanel, type LegendEntry, type LegendPanelConfig } from '../ui/LegendPanel.js';

export class OverviewView implements ChartView {
  private renderer: CanvasCandlestickRenderer | null = null;
  private _legendPanel: LegendPanel | null = null;

  mount(container: HTMLElement): void {
    this.renderer = new CanvasCandlestickRenderer(container);
    const config: LegendPanelConfig = {
      entries: this.getLegendEntries(),
      defaultVisible: false,
      // Overview nav column: Legend sits below Color/View/VP/VA.
      toggleTop: '136px',
      toggleLeft: '64px',
    };
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
      { label: 'Current Price', color: '#333333', kind: 'dashedLine' },
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

  getViewportState(): ViewportState {
    if (!this.renderer) return { anchorTsEvent: null, followLatest: true };
    return this.renderer.getViewportState();
  }

  restoreViewportState(state: ViewportState): void {
    if (!this.renderer) return;
    this.renderer.restoreViewportState(state);
  }

  getUiState(): unknown {
    if (!this.renderer) return undefined;
    return {
      colorByDelta: this.renderer.getColorByDelta(),
      vpVisible: this.renderer.isVolumeProfileVisible(),
      vaVisible: this.renderer.isValueAreaVisible(),
      legendVisible: this._legendPanel?.isVisible() ?? false,
    };
  }

  restoreUiState(state: unknown): void {
    if (!this.renderer || !state || typeof state !== 'object') return;
    const s = state as {
      colorByDelta?: boolean; vpVisible?: boolean; vaVisible?: boolean; legendVisible?: boolean;
    };
    if (typeof s.colorByDelta === 'boolean') this.renderer.setColorByDelta(s.colorByDelta);
    if (typeof s.vpVisible === 'boolean') this.renderer.setVolumeProfileVisible(s.vpVisible);
    if (typeof s.vaVisible === 'boolean') this.renderer.setValueAreaVisible(s.vaVisible);
    if (typeof s.legendVisible === 'boolean') this._legendPanel?.setVisible(s.legendVisible);
  }
}