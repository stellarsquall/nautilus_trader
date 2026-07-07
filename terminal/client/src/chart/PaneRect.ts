/**
 * PaneRect type: defines a pane's rendering rectangle in CSS pixels.
 *
 * All coordinates are in CSS pixels (not DPR-scaled backing-store pixels).
 * Used by PaneLayout to allocate vertical space for each pane and by panes
 * to determine their rendering bounds during draw().
 */

/**
 * Rectangle defining a pane's rendering area.
 *
 * All coordinates in CSS pixels (not DPR-scaled).
 */
export interface PaneRect {
  /**
   * X offset from canvas left edge (CSS pixels).
   *
   * Always 0 for full-width panes in current design.
   */
  x: number;

  /**
   * Y offset from canvas top edge (CSS pixels).
   *
   * Computed by PaneLayout based on pane stacking order and height fractions.
   */
  y: number;

  /**
   * Width in CSS pixels.
   *
   * Typically full canvas width for vertically-stacked panes.
   */
  width: number;

  /**
   * Height in CSS pixels.
   *
   * Computed by PaneLayout based on pane height fraction (e.g., 75% for candlestick, 25% for volume).
   */
  height: number;
}
