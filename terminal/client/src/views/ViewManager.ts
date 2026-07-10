import type { ChartStore } from '../store/ChartStore.js';
import type { ChartView, ViewType } from './ChartView.js';
import type { FootprintPayload } from '../types.js';

export class ViewManager {
  private currentView: ChartView | null = null;
  private chartStore: ChartStore;
  private container: HTMLElement;
  private viewFactory: (type: ViewType) => ChartView;

  constructor(
    chartStore: ChartStore,
    container: HTMLElement,
    viewFactory: (type: ViewType) => ChartView,
  ) {
    this.chartStore = chartStore;
    this.container = container;
    this.viewFactory = viewFactory;
  }

  public getCurrentViewType(): ViewType | null {
    return this.currentView?.getType() ?? null;
  }

  public switchToView(type: ViewType): void {
    if (this.currentView?.getType() === type) {
      return;
    }
    if (this.currentView) {
      this.currentView.destroy();
    }
    this.currentView = this.viewFactory(type);
    const state = this.chartStore.getState();
    this.currentView.mount(this.container);
    this.currentView.seed(state);
  }

  public updateBar(data: unknown): void {
    this.currentView?.updateBar(data);
  }

  public updateCvd(data: unknown): void {
    this.currentView?.updateCvd(data);
  }

  public updateFootprint(data: FootprintPayload): void {
    this.currentView?.updateFootprint(data);
  }

  public destroy(): void {
    if (this.currentView) {
      this.currentView.destroy();
      this.currentView = null;
    }
  }
}