import type { LegendEntry } from '../ui/LegendPanel.js';
import type { ChartStoreState, FootprintPayload } from '../types.js';

export enum ViewType {
  Overview = 'overview',
  Footprint = 'footprint',
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
}