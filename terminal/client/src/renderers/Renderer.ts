import type { FootprintPayload } from '../types';

export interface Renderer {
  /**
   * Update renderer with new data.
   *
   * Data type is unknown to support different renderers (bars, footprint, depth).
   */
  update(data: unknown): void;

  /**
   * Update renderer with a cumulative-volume-delta (CVD) payload.
   *
   * Optional: renderers that do not render a CVD pane may omit this.
   */
  updateCvd?(data: unknown): void;

  /**
   * Update renderer with a footprint (order-flow / bid-ask) payload.
   *
   * Optional: renderers that do not render footprint visualizations may omit this.
   */
  updateFootprint?(data: FootprintPayload): void;

  /**
   * Destroy renderer and clean up resources.
   */
  destroy(): void;
}
