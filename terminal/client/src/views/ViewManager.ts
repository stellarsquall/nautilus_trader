import type { ChartStore } from '../store/ChartStore.js';
import type { ChartView, ViewType, ViewportState } from './ChartView.js';
import type { FootprintPayload } from '../types.js';

export class ViewManager {
  private currentView: ChartView | null = null;
  private chartStore: ChartStore;
  private container: HTMLElement;
  private viewFactory: (type: ViewType) => ChartView;
  public linkViews: boolean = true;
  private viewportStateMap: Map<ViewType, ViewportState> = new Map();
  private sharedAnchor: ViewportState | null = null;
  // Per-view UI toggle state (delta/VP/VA/imbalance/legend); never linked.
  private uiStateMap: Map<ViewType, unknown> = new Map();

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

  public setLinkViews(enabled: boolean): void {
    this.linkViews = enabled;
  }

  public isLinkViewsEnabled(): boolean {
    return this.linkViews;
  }

  public switchToView(type: ViewType): void {
    if (this.currentView?.getType() === type) {
      return;
    }
    if (this.currentView) {
      const outgoingState = this.currentView.getViewportState();
      // Store into BOTH so toggling link on/off mid-session always has data.
      this.sharedAnchor = outgoingState;
      this.viewportStateMap.set(this.currentView.getType(), outgoingState);
      // Per-view UI toggle state (always per-view, never linked).
      const outgoingUi = this.currentView.getUiState?.();
      if (outgoingUi !== undefined) {
        this.uiStateMap.set(this.currentView.getType(), outgoingUi);
      }
      this.currentView.destroy();
    }
    this.currentView = this.viewFactory(type);
    const state = this.chartStore.getState();
    this.currentView.mount(this.container);
    this.currentView.seed(state);
    if (this.currentView) {
      if (this.linkViews && this.sharedAnchor) {
        // Position follows the shared time anchor, but ZOOM is always per-view
        // (Overview and Footprint have different zoom scales).
        const perView = this.viewportStateMap.get(type);
        this.currentView.restoreViewportState({
          anchorTsEvent: this.sharedAnchor.anchorTsEvent,
          followLatest: this.sharedAnchor.followLatest,
          visibleCount: perView?.visibleCount ?? this.sharedAnchor.visibleCount,
        });
      } else if (!this.linkViews) {
        const saved = this.viewportStateMap.get(type);
        if (saved) {
          this.currentView.restoreViewportState(saved);
        }
      }
      // Restore per-view UI toggle state (always, independent of link mode).
      const savedUi = this.uiStateMap.get(type);
      if (savedUi !== undefined) {
        this.currentView.restoreUiState?.(savedUi);
      }
    }
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