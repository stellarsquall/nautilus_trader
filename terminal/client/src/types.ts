/**
 * WebSocket envelope and payload type definitions.
 *
 * Defines the typed contract for all WebSocket messages between the server
 * and client. The envelope protocol is versioned and extensible to support
 * future message types (trade, book_delta, footprint, cvd, depth_heatmap)
 * without breaking existing handlers.
 */

/**
 * WebSocket envelope structure (v1).
 *
 * Every WebSocket frame conforms to this structure, enabling type-safe
 * message parsing and dispatch in the client.
 */
export interface Envelope {
  /** Protocol version (literal 1, not number) */
  v: 1;

  /** Message type - slice 1 implements 'bar', slice 5 adds 'cvd'; others reserved */
  type: 'bar' | 'trade' | 'book_delta' | 'footprint' | 'cvd' | 'depth_heatmap';

  /** Monotonically increasing sequence number (global across all types) */
  seq: number;

  /** Type-specific payload (BarPayload for 'bar', CvdPayload for 'cvd', unknown for future types) */
  payload: BarPayload | CvdPayload | unknown;
}

/**
 * Bar (OHLCV) payload for type='bar' messages.
 *
 * All fields use snake_case to match backend payload keys exactly.
 * Timestamps are in milliseconds (converted from NautilusTrader nanoseconds).
 */
export interface BarPayload {
  /** Event timestamp in milliseconds since UNIX epoch */
  ts_event: number;

  /** Bar open price */
  open: number;

  /** Bar high price (maximum) */
  high: number;

  /** Bar low price (minimum) */
  low: number;

  /** Bar close price */
  close: number;

  /** Bar volume (real traded volume, aggregated from trade ticks) */
  volume: number;

  /**
   * Aggressive buy volume in this bar (trades with BUYER aggressor).
   * Optional: present on slice-5+ order-flow bars; absent on legacy bars.
   */
  buy_volume?: number;

  /** Aggressive sell volume in this bar (trades with SELLER aggressor). Optional. */
  sell_volume?: number;

  /** Per-bar volume delta (buy_volume - sell_volume). Optional. */
  delta?: number;
}

/**
 * Cumulative Volume Delta (CVD) payload for type='cvd' messages.
 *
 * Emitted once per closed bar, immediately after the bar envelope. Carries the
 * session-cumulative volume delta (running sum of per-bar deltas) plus this
 * bar's delta. Aligns to the bar with the matching ts_event.
 */
export interface CvdPayload {
  /** Event timestamp in milliseconds (matches the corresponding bar's ts_event) */
  ts_event: number;

  /** Session-cumulative volume delta (running sum of per-bar deltas) */
  cvd: number;

  /** This bar's volume delta (buy_volume - sell_volume) */
  delta: number;
}
