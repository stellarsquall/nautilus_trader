import type { LegendEntry } from '../ui/LegendPanel.js';
import type { ChartStoreState, FootprintPayload } from '../types.js';

export enum ViewType {
  Overview = 'overview',
  Footprint = 'footprint',
}

export interface ViewportState {
  anchorTsEvent: number | null;
  followLatest: boolean;
  /** Zoom level (visible bar count). Restored PER-VIEW (never linked, since
   *  Overview and Footprint operate at different zoom scales). Optional for
   *  backward-compat with states that only carried position. */
  visibleCount?: number;
}

export interface ChartView {
  mount(container: HTMLElement): void;
  seed(state: ChartStoreState): void;
  updateBar(data: unknown): void;
  updateCvd(data: unknown): void;
  updateFootprint(data: FootprintPayload): void;
  destroy(): void;
  getType(): ViewType;
  getLegendEntries(): LegendEntry[];
  getViewportState(): ViewportState;
  restoreViewportState(state: ViewportState): void;
  /** Per-view UI toggle state (delta/VP/VA/imbalance/legend). Never linked —
   *  always restored per-view. Optional so non-persisting views can omit it. */
  getUiState?(): unknown;
  restoreUiState?(state: unknown): void;
}