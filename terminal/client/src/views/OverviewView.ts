import type { ChartStoreState, FootprintPayload } from '../types.js';
import { ChartView, ViewType } from './ChartView.js';
import { CanvasCandlestickRenderer } from '../renderers/CanvasCandlestickRenderer.js';

export class OverviewView implements ChartView {
  private renderer: CanvasCandlestickRenderer | null = null;

  mount(container: HTMLElement): void {
    this.renderer = new CanvasCandlestickRenderer(container);
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
    if (this.renderer) {
      this.renderer.destroy();
      this.renderer = null;
    }
  }

  getType(): ViewType {
    return ViewType.Overview;
  }
}