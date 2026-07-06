export interface Renderer {
  /**
   * Update renderer with new data.
   *
   * Data type is unknown to support different renderers (bars, footprint, depth).
   */
  update(data: unknown): void;

  /**
   * Destroy renderer and clean up resources.
   */
  destroy(): void;
}
