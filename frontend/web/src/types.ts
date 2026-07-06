/**
 * WebSocket envelope and payload type definitions.
 *
 * Defines the typed contract for all WebSocket messages between the backend
 * and frontend. The envelope protocol is versioned and extensible to support
 * future message types (trade, book_delta, footprint, cvd, depth_heatmap)
 * without breaking existing handlers.
 */

/**
 * WebSocket envelope structure (v1).
 *
 * Every WebSocket frame conforms to this structure, enabling type-safe
 * message parsing and dispatch in the frontend.
 */
export interface Envelope {
  /** Protocol version (literal 1, not number) */
  v: 1;

  /** Message type - slice 1 implements only 'bar', others reserved */
  type: 'bar' | 'trade' | 'book_delta' | 'footprint' | 'cvd' | 'depth_heatmap';

  /** Monotonically increasing sequence number (global across all types) */
  seq: number;

  /** Type-specific payload (BarPayload for type='bar', unknown for future types) */
  payload: BarPayload | unknown;
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

  /** Bar volume */
  volume: number;
}
